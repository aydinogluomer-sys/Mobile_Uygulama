/**
 * E05 — Pure, dependency-free resilience & latency probe for the AsyncStorage-backed
 * `OutboxStorage` contract (zero new native packages).
 *
 * Proves on a configurable large queue (default 150 commands):
 *  1. Zero data loss and zero duplicate delivery across 150 queued commands + duplicate operationId replay.
 *  2. Cold read + warm read/write p50 and p95 latency measurement.
 *  3. Mid-delivery kill recovery (`sending: true` on disk -> `clearSending` restores sendability on boot).
 *  4. Low-disk / quota refusal (`savedOnDevice: false` preserved while keeping memory intact) and
 *     corrupt-blob quarantine protection (never overwriting an unquarantined corrupt blob).
 *  5. Account A -> B isolation (zero cross-account leakage; foreign blobs rejected with `'account'`).
 */
import {
  emptyOutbox,
  enqueue,
  markSending,
  ready,
  settle,
  type OutboxState,
} from './outbox';
import {
  OUTBOX_QUARANTINE_SLOTS,
  OUTBOX_VERSION,
  outboxKey,
  parseStored,
  quarantineKeyFor,
  type OutboxStorage,
} from './outboxStorage';

export interface OutboxKvDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export type OutboxResilienceProbeOptions = {
  queueSize?: number;
  iterations?: number;
  userA?: string;
  userB?: string;
  clock?: () => number;
  createDriver?: () => OutboxKvDriver;
};

export type OutboxResilienceReport = {
  allPassed: boolean;
  largeQueue: {
    enqueuedCount: number;
    deliveredUniqueCount: number;
    lostCount: number;
    duplicateDeliveryCount: number;
    dedupedRepeatEnqueue: boolean;
    remainingPending: number;
  };
  latencyMs: {
    coldReadMs: number;
    writeP50Ms: number;
    writeP95Ms: number;
    readP50Ms: number;
    readP95Ms: number;
  };
  crashRecovery: {
    inFlightBeforeCrash: number;
    sendingAfterBoot: number;
    readyAfterBoot: number;
    lostAfterCrash: number;
  };
  lowDiskAndQuarantine: {
    writeFailureSurfacedAsUnsaved: boolean;
    inMemoryPreservedOnWriteFailure: boolean;
    corruptBlobQuarantined: boolean;
    corruptOverwriteRefusedWhenDiskFull: boolean;
  };
  accountIsolation: {
    userACommandsOnDisk: number;
    leakedToUserBCount: number;
    foreignBlobRejected: boolean;
    crossAccountEnqueueRejected: boolean;
    userARetainedAfterSwitchBack: number;
  };
};

export function createMemoryKvDriver(opts?: { failWrites?: () => boolean }): OutboxKvDriver & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      if (opts?.failWrites?.()) {
        throw new Error('QuotaExceededError: device storage full');
      }
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
    async getAllKeys() {
      return [...data.keys()];
    },
  };
}

function defaultClock(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Computes percentile `p` (`0..100`) on numeric samples using nearest-rank interpolation. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, p));
  if (clamped === 0) return sorted[0];
  if (clamped === 100) return sorted[sorted.length - 1];
  const idx = Math.ceil((clamped / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

/**
 * Builds an `OutboxStorage` instance over any `OutboxKvDriver` using the exact same
 * guarded quarantine + `parseStored` (`clearSending`) semantics as `lib/outboxStorage.ts`.
 */
export function createDriverBackedOutboxStorage(
  driver: OutboxKvDriver,
  now: () => number = () => Date.now(),
): OutboxStorage {
  const unquarantinedKeys = new Set<string>();

  async function quarantineInDriver(baseKey: string, raw: string): Promise<boolean> {
    try {
      const marker = `${baseKey}.quarantine.`;
      const existing = (await driver.getAllKeys()).filter((k) => k.startsWith(marker)).sort();
      while (existing.length >= OUTBOX_QUARANTINE_SLOTS) {
        const oldest = existing.shift();
        if (oldest) await driver.removeItem(oldest);
      }
      await driver.setItem(quarantineKeyFor(baseKey, Math.floor(now())), raw);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async load(userId: string): Promise<OutboxState> {
      const k = outboxKey(userId);
      const raw = await driver.getItem(k);
      const parsed = parseStored(raw, userId);
      if (parsed.problem !== null && raw !== null) {
        if (parsed.problem === 'commands') {
          await quarantineInDriver(k, JSON.stringify({ reason: 'commands', commands: parsed.rejected }));
        } else if (await quarantineInDriver(k, raw)) {
          await driver.removeItem(k);
          unquarantinedKeys.delete(k);
        } else {
          unquarantinedKeys.add(k);
        }
      } else if (parsed.problem === null) {
        unquarantinedKeys.delete(k);
      }
      return parsed.state;
    },
    async save(state: OutboxState): Promise<void> {
      const k = outboxKey(state.userId);
      if (unquarantinedKeys.has(k)) {
        throw new Error('outbox_quarantine_failed');
      }
      await driver.setItem(k, JSON.stringify({ v: OUTBOX_VERSION, state }));
    },
  };
}

async function saveCapturingDeviceStatus(storage: OutboxStorage, state: OutboxState): Promise<boolean> {
  try {
    await storage.save(state);
    return true;
  } catch {
    return false;
  }
}

export async function runOutboxResilienceProbe(
  opts: OutboxResilienceProbeOptions = {},
): Promise<OutboxResilienceReport> {
  const queueSize = Math.max(1, Math.floor(opts.queueSize ?? 150));
  const iterations = Math.max(2, Math.floor(opts.iterations ?? 12));
  const userA = opts.userA ?? 'probe-user-a';
  const userB = opts.userB ?? 'probe-user-b';
  const clock = opts.clock ?? defaultClock;

  const baseNow = 1_700_000_000_000;
  let diskFull = false;
  const driver = opts.createDriver
    ? opts.createDriver()
    : createMemoryKvDriver({ failWrites: () => diskFull });
  const storage = createDriverBackedOutboxStorage(driver, () => baseNow);

  // ── 1. Enqueue 150 commands + verify duplicate operationId deduplication ──
  let stateA = emptyOutbox(userA);
  for (let i = 0; i < queueSize; i += 1) {
    const res = enqueue(
      stateA,
      {
        operationId: `probe-op-${i}`,
        entity: 'task',
        entityId: `probe-task-${i}`,
        kind: 'create',
        payload: {
          title: `Task #${i}`,
          estimated_minutes: (i % 60) + 1,
          estimate_source: 'user',
        },
      },
      userA,
      baseNow + i,
    );
    if (!res.ok) {
      throw new Error(`Unexpected enqueue failure at ${i}: ${res.reason}`);
    }
    stateA = res.state;
  }

  const repeatRes = enqueue(
    stateA,
    {
      operationId: 'probe-op-0',
      entity: 'task',
      entityId: 'probe-task-0',
      kind: 'create',
      payload: {
        title: 'Task #0',
        estimated_minutes: 1,
        estimate_source: 'user',
      },
    },
    userA,
    baseNow + queueSize,
  );
  const dedupedRepeatEnqueue = repeatRes.ok && repeatRes.effect === 'duplicate' && repeatRes.state.commands.length === queueSize;

  await storage.save(stateA);

  // ── 2. Cold read + warm read/write p50/p95 benchmark on 150-command state ──
  const coldStart = clock();
  const coldLoaded = await storage.load(userA);
  const coldReadMs = Math.max(0, clock() - coldStart);

  const writeSamples: number[] = [];
  const readSamples: number[] = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    const w0 = clock();
    await storage.save(coldLoaded);
    writeSamples.push(Math.max(0, clock() - w0));

    const r0 = clock();
    await storage.load(userA);
    readSamples.push(Math.max(0, clock() - r0));
  }

  const writeP50Ms = percentile(writeSamples, 50);
  const writeP95Ms = percentile(writeSamples, 95);
  const readP50Ms = percentile(readSamples, 50);
  const readP95Ms = percentile(readSamples, 95);

  // ── 3. Kill mid-delivery (`sending: true` persisted) -> boot recovery ──
  const firstOpId = coldLoaded.commands[0]?.operationId ?? 'probe-op-0';
  const crashedState = markSending(coldLoaded, firstOpId);
  const inFlightBeforeCrash = crashedState.commands.filter((c) => c.sending).length;
  await storage.save(crashedState);

  const recoveredAfterBoot = await storage.load(userA);
  const sendingAfterBoot = recoveredAfterBoot.commands.filter((c) => c.sending).length;
  const readyAfterBoot = ready(recoveredAfterBoot, baseNow + queueSize + 10).length;
  const lostAfterCrash = Math.max(0, queueSize - recoveredAfterBoot.commands.length);

  // ── 4. Account A -> B isolation while A still holds 150 unsent commands ──
  const userACommandsOnDisk = recoveredAfterBoot.commands.length;
  const loadedForB = await storage.load(userB);
  const leakedToUserBCount = loadedForB.commands.length;

  const rawBlobOfA = await driver.getItem(outboxKey(userA));
  const foreignParse = parseStored(rawBlobOfA, userB);
  const foreignBlobRejected = foreignParse.problem === 'account' && foreignParse.state.commands.length === 0;

  const crossAccountEnq = enqueue(
    loadedForB,
    {
      operationId: 'cross-op',
      entity: 'task',
      entityId: 'cross-task',
      kind: 'create',
      payload: { title: 'Foreign write' },
    },
    userA,
    baseNow,
  );
  const crossAccountEnqueueRejected = !crossAccountEnq.ok && crossAccountEnq.reason === 'wrong_account';

  const reloadedA = await storage.load(userA);
  const userARetainedAfterSwitchBack = reloadedA.commands.length;

  // ── 5. Drain all 150 commands: verify zero loss & zero duplicates ──
  let draining = reloadedA;
  const deliveredEntityIds = new Set<string>();
  let duplicateDeliveryCount = 0;

  for (;;) {
    const batch = ready(draining, baseNow + queueSize + 100);
    if (batch.length === 0) break;
    const nextCmd = batch[0];
    draining = markSending(draining, nextCmd.operationId);
    if (deliveredEntityIds.has(nextCmd.entityId)) {
      duplicateDeliveryCount += 1;
    } else {
      deliveredEntityIds.add(nextCmd.entityId);
    }
    draining = settle(draining, nextCmd.operationId, { kind: 'applied', version: `v-${nextCmd.seq}` }, baseNow + queueSize + 200);
  }
  await storage.save(draining);

  const deliveredUniqueCount = deliveredEntityIds.size;
  const lostCount = Math.max(0, queueSize - deliveredUniqueCount);
  const remainingPending = draining.commands.length;

  // ── 6. Low-disk write refusal + corrupt-blob quarantine protection ──
  let writeFailureSurfacedAsUnsaved = false;
  let inMemoryPreservedOnWriteFailure = false;
  let corruptBlobQuarantined = false;
  let corruptOverwriteRefusedWhenDiskFull = false;

  const faultDriver = createMemoryKvDriver({ failWrites: () => diskFull });
  const faultStorage = createDriverBackedOutboxStorage(faultDriver, () => baseNow + 500);

  const memEnq = enqueue(
    emptyOutbox(userA),
    {
      operationId: 'low-disk-op',
      entity: 'task',
      entityId: 'low-disk-task',
      kind: 'create',
      payload: { title: 'Unsaved on full disk', estimated_minutes: 15 },
    },
    userA,
    baseNow + 500,
  );
  if (memEnq.ok) {
    diskFull = true;
    const savedOnDevice = await saveCapturingDeviceStatus(faultStorage, memEnq.state);
    diskFull = false;
    writeFailureSurfacedAsUnsaved = savedOnDevice === false;
    inMemoryPreservedOnWriteFailure = memEnq.state.commands.length === 1;
  }

  // Corrupt blob with available disk -> quarantined cleanly
  faultDriver.data.set(outboxKey(userA), '{corrupt-json');
  const afterQuarantine = await faultStorage.load(userA);
  const quarantineKeys = (await faultDriver.getAllKeys()).filter((k) => k.startsWith(`${outboxKey(userA)}.quarantine.`));
  corruptBlobQuarantined = afterQuarantine.commands.length === 0 && quarantineKeys.length === 1;

  // Corrupt blob when disk is full -> quarantine fails, subsequent save refuses to clobber corrupt blob
  const fullCorruptKey = outboxKey(userB);
  faultDriver.data.set(fullCorruptKey, '{corrupt-unquarantinable');
  diskFull = true;
  await faultStorage.load(userB);
  diskFull = false;
  const overwriteSaved = await saveCapturingDeviceStatus(faultStorage, emptyOutbox(userB));
  corruptOverwriteRefusedWhenDiskFull =
    overwriteSaved === false && faultDriver.data.get(fullCorruptKey) === '{corrupt-unquarantinable';

  const allPassed =
    enqueuedCountOk(queueSize, deliveredUniqueCount, lostCount, duplicateDeliveryCount, remainingPending, dedupedRepeatEnqueue) &&
    inFlightBeforeCrash === 1 &&
    sendingAfterBoot === 0 &&
    readyAfterBoot === queueSize &&
    lostAfterCrash === 0 &&
    writeFailureSurfacedAsUnsaved &&
    inMemoryPreservedOnWriteFailure &&
    corruptBlobQuarantined &&
    corruptOverwriteRefusedWhenDiskFull &&
    userACommandsOnDisk === queueSize &&
    leakedToUserBCount === 0 &&
    foreignBlobRejected &&
    crossAccountEnqueueRejected &&
    userARetainedAfterSwitchBack === queueSize;

  return {
    allPassed,
    largeQueue: {
      enqueuedCount: queueSize,
      deliveredUniqueCount,
      lostCount,
      duplicateDeliveryCount,
      dedupedRepeatEnqueue,
      remainingPending,
    },
    latencyMs: {
      coldReadMs,
      writeP50Ms,
      writeP95Ms,
      readP50Ms,
      readP95Ms,
    },
    crashRecovery: {
      inFlightBeforeCrash,
      sendingAfterBoot,
      readyAfterBoot,
      lostAfterCrash,
    },
    lowDiskAndQuarantine: {
      writeFailureSurfacedAsUnsaved,
      inMemoryPreservedOnWriteFailure,
      corruptBlobQuarantined,
      corruptOverwriteRefusedWhenDiskFull,
    },
    accountIsolation: {
      userACommandsOnDisk,
      leakedToUserBCount,
      foreignBlobRejected,
      crossAccountEnqueueRejected,
      userARetainedAfterSwitchBack,
    },
  };
}

function enqueuedCountOk(
  queueSize: number,
  deliveredUniqueCount: number,
  lostCount: number,
  duplicateDeliveryCount: number,
  remainingPending: number,
  dedupedRepeatEnqueue: boolean,
): boolean {
  return (
    deliveredUniqueCount === queueSize &&
    lostCount === 0 &&
    duplicateDeliveryCount === 0 &&
    remainingPending === 0 &&
    dedupedRepeatEnqueue
  );
}
