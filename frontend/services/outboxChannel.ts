/**
 * R02.03 / F46 — one durable, per-account outbox channel with atomic replace,
 * settle reporting, and optional multi-tab coordination on the web.
 */
import { registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import {
  clearAuthBlock,
  clearSending,
  clearTombstones as clearTombstonesIn,
  discard as discardCommand,
  emptyOutbox,
  enqueue,
  mergeOutboxStates,
  newOperationId,
  nextReadyAt as computeNextReadyAt,
  replaceCommand,
  retry as retryCommand,
  stableJson,
  summary,
  type DeliveryOutcome,
  type EnqueueInput,
  type EntityPolicy,
  type OutboxCommand,
  type OutboxState,
  type OutboxSummary,
} from '../lib/outbox';
import type { EngineWriteResult, SettleReport, WriteOptions } from '../lib/outboxEngine';
import { namespacedOutboxKey, outboxKey, type OutboxStorage } from '../lib/outboxStorage';
import { LOCK_BUSY, RELOAD_DEBOUNCE_MS, type TabDeps } from '../lib/tabCoordination';
import { flushOutbox, type Transport } from './outboxRunner';

export type WriteResult = EngineWriteResult;

export type OutboxChannel = {
  /** The live outbox of the signed-in account (loads it on first use). */
  ensure(): Promise<OutboxState | null>;
  /** Enqueue a change, save it on the device, then try to deliver. */
  write(input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions): Promise<EngineWriteResult>;
  /** Atomically replace an existing command (e.g. conflict -> resolution); rolls back memory if save fails. */
  replace(operationId: string, input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions): Promise<EngineWriteResult>;
  flush(opts?: { now?: number }): Promise<void>;
  state(): OutboxState | null;
  sync(): OutboxSummary;
  subscribe(fn: (s: OutboxState | null) => void): () => void;
  /**
   * Called after the server applied a command, with the version it now holds
   * (null when the table has none).
   */
  onApplied(fn: (cmd: OutboxCommand, version: string | null) => void): () => void;
  /** Called whenever a command attempt settles in `flushOutbox`. */
  onSettled(fn: (report: SettleReport) => void): () => void;
  reloadFromStorage(): Promise<void>;
  nextReadyAt(): number | null;
  attachTabs(tabs: TabDeps | null): () => void;
  retry(operationId: string, baseVersion: string | null): Promise<void>;
  discard(operationId: string): Promise<void>;
  clearTombstones(entity: string, ids: readonly string[]): Promise<void>;
  authRefreshed(): Promise<void>;
  /** Signed out / switched account: forget the in-memory copy (the saved one stays). */
  reset(): void;
};

export function createOutboxChannel(opts: {
  storage: OutboxStorage;
  transports: Record<string, Transport>;
  currentUserId: () => Promise<string | null>;
  now?: () => number;
  namespace?: string;
  policies?: Readonly<Record<string, EntityPolicy>>;
  registerStorage?: { name: string; keysFor: (uid: string) => readonly string[] };
  persistOnSignOut?: boolean;
}): OutboxChannel {
  const now = opts.now ?? (() => Date.now());
  const ns = opts.registerStorage?.name ?? opts.namespace ?? 'task';
  const storageKeyFor = (uid: string): string => {
    const custom = opts.registerStorage?.keysFor(uid)[0];
    if (custom) return custom;
    return ns === 'task' ? outboxKey(uid) : namespacedOutboxKey(ns, uid);
  };
  const matchesStorageKey = (msgKey: string): boolean => {
    if (box) return msgKey === storageKeyFor(box.userId);
    if (opts.registerStorage) {
      const sample = opts.registerStorage.keysFor('__probe__')[0] ?? '';
      const prefix = sample.replace('__probe__', '');
      return prefix.length > 0 && msgKey.startsWith(prefix);
    }
    if (ns === 'task') {
      return msgKey.startsWith('outbox.v1.') && !msgKey.slice('outbox.v1.'.length).includes('.');
    }
    return msgKey.startsWith(`outbox.v1.${ns}.`);
  };
  const writeLockName = (uid: string) => `aderyth-outbox-write:${ns}:${uid}`;
  const flushLockName = (uid: string) => `aderyth-outbox-flush:${ns}:${uid}`;

  let box: OutboxState | null = null;
  let inFlight: Promise<void> | null = null;
  let gen = 0;
  let tabs: TabDeps | null = null;
  let detachBus: (() => void) | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<(s: OutboxState | null) => void>();
  const appliedListeners = new Set<(cmd: OutboxCommand, version: string | null) => void>();
  const settledListeners = new Set<(report: SettleReport) => void>();

  let pendingStep: { cmd: OutboxCommand; outcome: DeliveryOutcome } | null = null;

  const transports: Record<string, Transport> = Object.fromEntries(
    Object.entries(opts.transports).map(([entity, t]) => [
      entity,
      async (cmd: OutboxCommand) => {
        let outcome: DeliveryOutcome;
        try {
          outcome = await t(cmd);
        } catch (e) {
          outcome = { kind: 'rejected', error: e instanceof Error ? e.message : 'transport threw' };
        }
        pendingStep = { cmd, outcome };
        if (outcome.kind === 'applied') {
          for (const l of appliedListeners) {
            try {
              l(cmd, outcome.version ?? null);
            } catch {
              /* never breaks delivery */
            }
          }
        }
        return outcome;
      },
    ]),
  );

  const publish = (next: OutboxState | null) => {
    box = next;
    for (const l of listeners) {
      try {
        l(next);
      } catch {
        /* a listener never breaks a write */
      }
    }
  };

  const emitSettled = (report: SettleReport) => {
    for (const fn of settledListeners) {
      try {
        fn(report);
      } catch {
        /* listener errors never break delivery */
      }
    }
  };

  async function ensure(): Promise<OutboxState | null> {
    const uid = await opts.currentUserId();
    if (!uid) return null;
    if (box && box.userId === uid) return box;
    const g = gen;
    const loaded = await opts.storage.load(uid);
    if (g !== gen) return null;
    if (box && box.userId === uid) return box;
    publish(loaded);
    return loaded;
  }

  async function save(expectedGen: number = gen): Promise<boolean> {
    if (!box || expectedGen !== gen) return false;
    const activeTabs = tabs;
    if (!activeTabs) {
      try {
        if (expectedGen !== gen || !box) return false;
        await opts.storage.save(box);
        return true;
      } catch {
        return false;
      }
    }

    const uid = box.userId;
    const result = await activeTabs.lock(writeLockName(uid), async () => {
      if (expectedGen !== gen || !box || box.userId !== uid) return false;
      try {
        const disk = await opts.storage.load(uid);
        if (expectedGen !== gen || !box || box.userId !== uid) return false;
        const merged = mergeOutboxStates(box, disk, now(), { authFrom: 'local' });
        if (stableJson(merged) !== stableJson(box)) {
          publish(merged);
        }
        await opts.storage.save(merged);
        activeTabs.bus?.post({ type: 'outbox-changed', storageKey: storageKeyFor(uid) });
        return true;
      } catch {
        return false;
      }
    });
    return result === LOCK_BUSY ? false : result;
  }

  function buildSettleReport(step: { cmd: OutboxCommand; outcome: DeliveryOutcome }, next: OutboxState): SettleReport {
    const { cmd, outcome } = step;
    const after = next.commands.find((c) => c.operationId === cmd.operationId);
    let reportOutcome: SettleReport['outcome'];
    let error: string | undefined;
    if (!after) {
      reportOutcome = outcome.kind === 'gone' ? 'gone' : 'applied';
    } else if (after.status === 'dead') {
      reportOutcome = 'dead';
      error = after.lastError;
    } else if (after.status === 'conflict') {
      reportOutcome = 'conflict';
      error = after.lastError;
    } else if (outcome.kind === 'rejected' || outcome.kind === 'retryable' || outcome.kind === 'conflict') {
      reportOutcome = outcome.kind;
      error = outcome.error ?? after.lastError;
    } else if (outcome.kind === 'auth') {
      reportOutcome = 'auth';
    } else {
      reportOutcome = 'offline';
    }
    return {
      operationId: cmd.operationId,
      entity: cmd.entity,
      entityId: cmd.entityId,
      outcome: reportOutcome,
      ...(error !== undefined ? { error } : {}),
    };
  }

  async function runFlushInner(start: OutboxState, g: number, flushNow?: number): Promise<void> {
    const stepClock = flushNow !== undefined ? () => flushNow : now;
    await flushOutbox(
      {
        get: () => (g === gen ? (box ?? start) : { ...start, commands: [] }),
        set: async (next) => {
          const step = pendingStep;
          pendingStep = null;
          if (g !== gen) return;
          publish(next);
          await save(g);
          if (step && g === gen) {
            emitSettled(buildSettleReport(step, box ?? next));
          }
        },
      },
      transports,
      { currentUserId: opts.currentUserId, now: stepClock },
    );
  }

  async function runFlush(flushNow?: number): Promise<void> {
    const start = await ensure();
    if (!start) return;
    const g = gen;
    const activeTabs = tabs;
    if (!activeTabs) {
      if (start.commands.length === 0) return;
      await runFlushInner(start, g, flushNow);
      return;
    }

    const uid = start.userId;
    await activeTabs.lock(
      flushLockName(uid),
      async () => {
        if (g !== gen) return;
        let current = box ?? start;
        try {
          const disk = await opts.storage.load(uid);
          if (g !== gen) return;
          const merged = clearSending(mergeOutboxStates(current, disk, flushNow ?? now(), { authFrom: 'disk' }));
          if (stableJson(merged) !== stableJson(current)) {
            publish(merged);
          }
          current = merged;
        } catch {
          /* continue with in-memory state if reload fails */
        }
        if (current.commands.length === 0) return;
        await runFlushInner(current, g, flushNow);
      },
      { ifAvailable: true },
    );
  }

  function waitFirstAttempt(
    carrierId: string,
    entity: string,
    entityId: string,
    timeoutMs: number,
  ): Promise<SettleReport | 'timeout'> {
    if (!box || !box.commands.some((c) => c.operationId === carrierId)) {
      return Promise.resolve({ operationId: carrierId, entity, entityId, outcome: 'applied' });
    }
    return new Promise<SettleReport | 'timeout'>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (val: SettleReport | 'timeout') => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        unsub();
        resolve(val);
      };
      const unsub = channel.onSettled((r) => {
        if (r.operationId === carrierId) finish(r);
      });
      timer = setTimeout(() => finish('timeout'), Math.max(1, timeoutMs));
      void channel.flush().then(
        () => {
          if (done) return;
          const cur = box;
          if (!cur) {
            finish({ operationId: carrierId, entity, entityId, outcome: 'offline' });
            return;
          }
          const cmd = cur.commands.find((c) => c.operationId === carrierId);
          if (!cmd) {
            finish({ operationId: carrierId, entity, entityId, outcome: 'applied' });
          } else if (cur.authBlocked) {
            finish({ operationId: carrierId, entity, entityId, outcome: 'auth' });
          } else if (cmd.status === 'dead') {
            finish({ operationId: carrierId, entity, entityId, outcome: 'dead', ...(cmd.lastError ? { error: cmd.lastError } : {}) });
          } else if (cmd.status === 'conflict') {
            finish({ operationId: carrierId, entity, entityId, outcome: 'conflict', ...(cmd.lastError ? { error: cmd.lastError } : {}) });
          } else if (!cmd.sending) {
            finish({ operationId: carrierId, entity, entityId, outcome: 'offline' });
          }
        },
        () => {
          finish({ operationId: carrierId, entity, entityId, outcome: 'offline' });
        },
      );
    });
  }

  async function reloadFromStorage(): Promise<void> {
    const uid = box?.userId ?? (await opts.currentUserId());
    if (!uid) return;
    const g = gen;
    const activeTabs = tabs;
    const doReload = async () => {
      if (g !== gen) return;
      let disk: OutboxState;
      try {
        disk = await opts.storage.load(uid);
      } catch {
        return;
      }
      if (g !== gen) return;
      if (!box || box.userId !== uid) {
        publish(disk);
        return;
      }
      const merged = mergeOutboxStates(box, disk, now(), { authFrom: 'disk' });
      if (stableJson(merged) !== stableJson(box)) {
        publish(merged);
      }
      if (stableJson(merged) !== stableJson(disk)) {
        try {
          await opts.storage.save(merged);
          activeTabs?.bus?.post({ type: 'outbox-changed', storageKey: storageKeyFor(uid) });
        } catch {
          /* best effort */
        }
      }
    };

    if (activeTabs) {
      await activeTabs.lock(writeLockName(uid), doReload);
    } else {
      await doReload();
    }
  }

  function clearTabAttachments() {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (detachBus) {
      detachBus();
      detachBus = null;
    }
  }

  const channel: OutboxChannel = {
    ensure,
    async write(input, writeOpts) {
      const live = await ensure();
      if (!live) return { ok: false, error: 'Oturum bulunamadı.' };
      const g = gen;
      const operationId = writeOpts?.operationId ?? newOperationId();
      const policy = input.policy ?? opts.policies?.[input.entity];
      const current = box ?? live;
      const res = enqueue(
        current,
        { ...input, operationId, ...(policy ? { policy } : {}) },
        current.userId,
        now(),
      );
      if (!res.ok) return { ok: false, error: 'Değişiklik kaydedilemedi.' };

      if (res.effect === 'duplicate' && res.state === current) {
        writeOpts?.onEnqueued?.(res.state);
        return { ok: true, operationId, savedOnDevice: true };
      }

      publish(res.state);
      writeOpts?.onEnqueued?.(res.state);
      const savedOnDevice = await save(g);

      const carrier = res.effect === 'merged'
        ? [...res.state.commands].reverse().find((c) => c.entity === input.entity && c.entityId === input.entityId)?.operationId
        : operationId;
      const finalOpId = carrier ?? operationId;

      if (writeOpts?.awaitFirstAttempt) {
        const firstAttempt = await waitFirstAttempt(
          finalOpId,
          input.entity,
          input.entityId,
          writeOpts.awaitFirstAttempt.timeoutMs,
        );
        return { ok: true, operationId: finalOpId, savedOnDevice, firstAttempt };
      }

      void channel.flush();
      return { ok: true, operationId: finalOpId, savedOnDevice };
    },
    async replace(oldOperationId, input, writeOpts) {
      const live = await ensure();
      if (!live || !box) return { ok: false, error: 'Oturum bulunamadı.' };
      const prev = box;
      const g = gen;
      const operationId = writeOpts?.operationId ?? newOperationId();
      const policy = input.policy ?? opts.policies?.[input.entity];
      const res = replaceCommand(
        prev,
        oldOperationId,
        { ...input, operationId, ...(policy ? { policy } : {}) },
        prev.userId,
        now(),
      );
      if (!res.ok) {
        return {
          ok: false,
          error: res.reason === 'not_found' ? 'Çakışma bulunamadı.' : 'Değişiklik kaydedilemedi.',
        };
      }
      publish(res.state);
      writeOpts?.onEnqueued?.(res.state);
      const savedOnDevice = await save(g);
      if (!savedOnDevice) {
        if (g === gen) publish(prev);
        return { ok: false, error: 'Değişiklik cihaza kaydedilemedi.' };
      }
      const carrier = res.effect === 'merged'
        ? [...res.state.commands].reverse().find((c) => c.entity === input.entity && c.entityId === input.entityId)?.operationId
        : operationId;
      const finalOpId = carrier ?? operationId;
      if (writeOpts?.awaitFirstAttempt) {
        const firstAttempt = await waitFirstAttempt(
          finalOpId,
          input.entity,
          input.entityId,
          writeOpts.awaitFirstAttempt.timeoutMs,
        );
        return { ok: true, operationId: finalOpId, savedOnDevice: true, firstAttempt };
      }
      void channel.flush();
      return { ok: true, operationId: finalOpId, savedOnDevice: true };
    },
    async flush(flushOpts) {
      while (inFlight) await inFlight;
      inFlight = runFlush(flushOpts?.now);
      try {
        await inFlight;
      } finally {
        inFlight = null;
      }
    },
    state: () => box,
    sync: () => summary(box ?? emptyOutbox('')),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onApplied(fn) {
      appliedListeners.add(fn);
      return () => {
        appliedListeners.delete(fn);
      };
    },
    onSettled(fn) {
      settledListeners.add(fn);
      return () => {
        settledListeners.delete(fn);
      };
    },
    reloadFromStorage,
    nextReadyAt: () => (box ? computeNextReadyAt(box) : null),
    attachTabs(nextTabs) {
      clearTabAttachments();
      tabs = nextTabs;
      if (nextTabs?.bus) {
        detachBus = nextTabs.bus.subscribe((msg) => {
          if (msg.type !== 'outbox-changed' || !matchesStorageKey(msg.storageKey)) return;
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            void reloadFromStorage();
          }, RELOAD_DEBOUNCE_MS);
        });
      }
      return () => {
        clearTabAttachments();
        if (tabs === nextTabs) tabs = null;
      };
    },
    async retry(operationId, baseVersion) {
      if (!box) return;
      const g = gen;
      publish(retryCommand(box, operationId, baseVersion));
      await save(g);
      void channel.flush();
    },
    async discard(operationId) {
      if (!box) return;
      const g = gen;
      publish(discardCommand(box, operationId, now()));
      await save(g);
    },
    async clearTombstones(entity, ids) {
      const live = await ensure();
      if (!live || !box) return;
      const g = gen;
      const next = clearTombstonesIn(box, entity, ids);
      if (next === box) return;
      publish(next);
      await save(g);
    },
    async authRefreshed() {
      const live = box ?? (await ensure());
      if (!live) return;
      const g = gen;
      if (box?.authBlocked) {
        publish(clearAuthBlock(box));
        await save(g);
      }
      void channel.flush();
    },
    reset() {
      gen += 1;
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      publish(null);
    },
  };

  if (opts.registerStorage) {
    registerAccountStorage({
      name: opts.registerStorage.name,
      transient: false,
      keysFor: opts.registerStorage.keysFor,
    });
    registerAccountScoped({
      name: `outbox:${opts.registerStorage.name}`,
      onReset: (reason) => {
        if (opts.persistOnSignOut && reason !== 'account_deleted' && box && box.commands.length > 0) {
          void opts.storage.save(box).catch(() => undefined);
        }
        channel.reset();
      },
    });
  }

  return channel;
}
