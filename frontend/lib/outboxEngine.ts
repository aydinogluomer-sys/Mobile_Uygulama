/**
 * F46 (SYN-14, STO-10, SYN-17, SYN-10, REP-14, DOM-21, SYN-26) — Unified Outbox Engine.
 *
 * Registers the four durable channels (`task`, `core`, `habit`, `effect`) through a structural
 * interface so `lib/` never imports `services/*` or `store/*`. Also owns the entity policy
 * registry, `writeThrough` helper for stores, habit-log legacy migration planner, and
 * deterministic webhook side-effect operation IDs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from './crashReporting';
import {
  emptyOutbox,
  hasPending,
  MAX_ATTEMPTS,
  stableJson,
  type EnqueueInput,
  type EntityPolicy,
  type OutboxCommand,
  type OutboxKind,
  type OutboxState,
  type OutboxSummary,
} from './outbox';
import type { OutboxStorage } from './outboxStorage';
import type { Flusher } from './syncCoordinator';
import {
  loadSyncQueue,
  QUARANTINE_KEY,
  type HabitLogIntent,
  type SyncOp,
  type SyncQueueState,
} from './syncQueue';
import { createWebTabDeps, type TabDeps } from './tabCoordination';

export { createWebTabDeps };
export type { HabitLogIntent, SyncOp, SyncQueueState };

export type ChannelId = 'task' | 'core' | 'habit' | 'effect';

export type SettleReport = {
  operationId: string;
  entity: string;
  entityId: string;
  outcome: 'applied' | 'offline' | 'auth' | 'rejected' | 'retryable' | 'conflict' | 'gone' | 'dead';
  error?: string;
};

export type WriteOptions = {
  operationId?: string;
  onEnqueued?: (state: OutboxState) => void;
  awaitFirstAttempt?: { timeoutMs: number };
};

export type EngineWriteResult =
  | { ok: true; operationId: string; savedOnDevice: boolean; firstAttempt?: SettleReport | 'timeout' }
  | { ok: false; error: string };

/** Structural subset of `services/outboxChannel.OutboxChannel` so `lib/` never imports `services/`. */
export interface EngineChannel {
  ensure(): Promise<OutboxState | null>;
  state(): OutboxState | null;
  sync(): OutboxSummary;
  subscribe(fn: (s: OutboxState | null) => void): () => void;
  retry(operationId: string, baseVersion: string | null): Promise<void>;
  discard(operationId: string): Promise<void>;
  authRefreshed(): Promise<void>;
  reset(): void;
  write(input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions): Promise<EngineWriteResult>;
  replace(operationId: string, input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions): Promise<EngineWriteResult>;
  flush(opts?: { now?: number }): Promise<void>;
  onSettled(fn: (r: SettleReport) => void): () => void;
  reloadFromStorage(): Promise<void>;
  nextReadyAt(): number | null;
  attachTabs(tabs: TabDeps | null): () => void;
  resolveLabel?(cmd: OutboxCommand): string | undefined;
}

export const HABIT_LOG_ENTITY = 'habit_log';
export const WEBHOOK_EVENT_ENTITY = 'webhook_event';
export const WEBHOOK_DEDUPE_TTL_MS = 14 * 24 * 3600_000;
export const WEBHOOK_MAX_PENDING = 200;

export const ENTITY_POLICIES: Readonly<Record<string, EntityPolicy>> = {
  task: { coalesce: 'merge', conflict: 'versioned' },
  note: { coalesce: 'merge', conflict: 'versioned' },
  journal_entry: { coalesce: 'merge', conflict: 'content-cas' },
  recovery_plan: { coalesce: 'merge', conflict: 'last-writer-wins' },
  goal: { coalesce: 'merge', conflict: 'last-writer-wins' },
  project: { coalesce: 'merge', conflict: 'last-writer-wins' },
  reading_item: { coalesce: 'merge', conflict: 'last-writer-wins' },
  okr_objective: { coalesce: 'merge', conflict: 'last-writer-wins' },
  key_result: { coalesce: 'merge', conflict: 'last-writer-wins' },
  life_area_log: { coalesce: 'merge', conflict: 'last-writer-wins' },
  focus_session: { coalesce: 'merge', conflict: 'none' },
  habit_log: { coalesce: 'replace', conflict: 'none' },
  webhook_event: {
    coalesce: 'replace',
    conflict: 'none',
    maxPending: WEBHOOK_MAX_PENDING,
    dedupeTtlMs: WEBHOOK_DEDUPE_TTL_MS,
  },
};

export const ENTITY_LABELS_TR: Readonly<Record<string, string>> = {
  journal_entry: 'Günlük',
  note: 'Not',
  recovery_plan: 'Telafi planı',
  focus_session: 'Odak seansı',
  goal: 'Hedef',
  project: 'Proje',
  reading_item: 'Okuma öğesi',
  okr_objective: 'OKR hedefi',
  key_result: 'Anahtar sonuç',
  life_area_log: 'Yaşam alanı',
  habit_log: 'Alışkanlık kaydı',
  task: 'Görev',
  webhook_event: 'Otomasyon bildirimi',
};

export const WEBHOOK_DEAD_REASON =
  'Otomasyon bildirimi ulaşmadı. Adresi kontrol edip yeniden deneyebilirsin.';

const DEFAULT_REFUSED_REASON = 'Sunucu kabul etmedi.';
const DEFAULT_CONFLICT_REASON = 'Başka bir yerde değiştirilmiş.';

const CHANNEL_ORDER: readonly ChannelId[] = ['habit', 'task', 'core', 'effect'];

const emptySummary = (): OutboxSummary => ({
  pending: 0,
  dead: 0,
  conflict: 0,
  authBlocked: false,
});

export type EngineSummary = OutboxSummary & { channels: Record<ChannelId, OutboxSummary> };

export type EngineIssue = {
  channel: ChannelId;
  operationId: string;
  entity: string;
  entityId: string;
  status: 'dead' | 'conflict';
  label: string;
  reason: string;
};

export type OutboxEngine = {
  register(id: ChannelId, channel: EngineChannel): void;
  channel(id: ChannelId): EngineChannel | null;
  summaryAll(): EngineSummary;
  subscribeAll(fn: () => void): () => void;
  flushAll(): Promise<{ errors: Partial<Record<ChannelId, string>> }>;
  flushers(): Flusher[];
  listIssues(): EngineIssue[];
  attachTabs(tabs: TabDeps | null): () => void;
};

export function createOutboxEngine(): OutboxEngine {
  const channels = new Map<ChannelId, EngineChannel>();
  const channelUnsubs = new Map<ChannelId, () => void>();
  const tabUnsubs = new Map<ChannelId, () => void>();
  const listeners = new Set<() => void>();
  let activeTabs: TabDeps | null = null;

  const notifyAll = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* listener errors never break engine updates */
      }
    }
  };

  return {
    register(id, channel) {
      channelUnsubs.get(id)?.();
      tabUnsubs.get(id)?.();
      channels.set(id, channel);
      channelUnsubs.set(
        id,
        channel.subscribe(() => notifyAll()),
      );
      if (activeTabs) {
        tabUnsubs.set(id, channel.attachTabs(activeTabs));
      }
    },

    channel(id) {
      return channels.get(id) ?? null;
    },

    summaryAll() {
      const byChannel: Record<ChannelId, OutboxSummary> = {
        task: channels.get('task')?.sync() ?? emptySummary(),
        core: channels.get('core')?.sync() ?? emptySummary(),
        habit: channels.get('habit')?.sync() ?? emptySummary(),
        effect: channels.get('effect')?.sync() ?? emptySummary(),
      };
      return {
        pending: byChannel.task.pending + byChannel.core.pending + byChannel.habit.pending + byChannel.effect.pending,
        dead: byChannel.task.dead + byChannel.core.dead + byChannel.habit.dead + byChannel.effect.dead,
        conflict:
          byChannel.task.conflict + byChannel.core.conflict + byChannel.habit.conflict + byChannel.effect.conflict,
        authBlocked: Boolean(
          byChannel.task.authBlocked ||
            byChannel.core.authBlocked ||
            byChannel.habit.authBlocked ||
            byChannel.effect.authBlocked,
        ),
        channels: byChannel,
      };
    },

    subscribeAll(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async flushAll() {
      const entries = CHANNEL_ORDER.map(
        (id) => [id, channels.get(id)] as const,
      ).filter((pair): pair is readonly [ChannelId, EngineChannel] => pair[1] !== undefined);

      const settled = await Promise.allSettled(
        entries.map(([, ch]) => Promise.resolve().then(() => ch.flush())),
      );
      const errors: Partial<Record<ChannelId, string>> = {};
      settled.forEach((r, idx) => {
        if (r.status === 'rejected') {
          const id = entries[idx][0];
          errors[id] = r.reason instanceof Error ? r.reason.message : 'Bilinmeyen hata';
        }
      });
      return { errors };
    },

    flushers() {
      return CHANNEL_ORDER.map((id): Flusher => ({
        name: id,
        pending: () => channels.get(id)?.sync().pending ?? 0,
        nextReadyAt: () => channels.get(id)?.nextReadyAt() ?? null,
        flush: async () => {
          const ch = channels.get(id);
          if (ch) await ch.flush();
        },
      }));
    },

    listIssues() {
      const out: EngineIssue[] = [];
      for (const id of CHANNEL_ORDER) {
        const ch = channels.get(id);
        const cmds = ch?.state()?.commands ?? [];
        for (const c of cmds) {
          if (c.status === 'pending') continue;
          const status: 'dead' | 'conflict' = c.status === 'conflict' ? 'conflict' : 'dead';
          const label = ch?.resolveLabel?.(c) ?? ENTITY_LABELS_TR[c.entity] ?? 'Değişiklik';
          const reason =
            status === 'conflict'
              ? DEFAULT_CONFLICT_REASON
              : c.entity === WEBHOOK_EVENT_ENTITY
                ? WEBHOOK_DEAD_REASON
                : (c.lastError ?? DEFAULT_REFUSED_REASON);
          out.push({
            channel: id,
            operationId: c.operationId,
            entity: c.entity,
            entityId: c.entityId,
            status,
            label,
            reason,
          });
        }
      }
      return out;
    },

    attachTabs(tabs) {
      for (const unsub of tabUnsubs.values()) unsub();
      tabUnsubs.clear();
      activeTabs = tabs;
      if (tabs) {
        for (const [id, ch] of channels.entries()) {
          tabUnsubs.set(id, ch.attachTabs(tabs));
        }
      } else {
        for (const ch of channels.values()) {
          ch.attachTabs(null);
        }
      }
      return () => {
        for (const unsub of tabUnsubs.values()) unsub();
        tabUnsubs.clear();
        if (activeTabs === tabs) activeTabs = null;
        tabs?.bus?.close();
      };
    },
  };
}

export const outboxEngine: OutboxEngine = createOutboxEngine();

export type WriteThroughSpec<Row> = {
  channel: Pick<EngineChannel, 'write'> & Partial<Pick<EngineChannel, 'ensure' | 'state'>>;
  entity: string;
  entityId: string;
  kind: OutboxKind;
  payload?: Record<string, unknown>;
  baseVersion?: string | null;
  dependsOn?: string[];
  online: () => Promise<{ ok: true; data: Row } | { ok: false; error: string; offline?: boolean }>;
  userId: () => Promise<string | null>;
  onEnqueued?: (state: OutboxState) => void;
};

export type WriteThroughResult<Row> =
  | { ok: true; via: 'online'; row: Row; userId: string | null }
  | { ok: true; via: 'outbox'; operationId: string; savedOnDevice: boolean; userId: string | null }
  | { ok: false; error: string };

async function resolveSafeUserId(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return (await read()) ?? null;
  } catch {
    return null;
  }
}

export async function safeUserIdOf(read: () => Promise<{ id: string } | null>): Promise<string | null> {
  try {
    return (await read())?.id ?? null;
  } catch {
    return null;
  }
}

export async function writeThrough<Row>(spec: WriteThroughSpec<Row>): Promise<WriteThroughResult<Row>> {
  let mustQueue = Boolean(spec.dependsOn && spec.dependsOn.length > 0);
  if (!mustQueue && spec.kind !== 'create' && typeof spec.channel.ensure === 'function' && typeof spec.channel.state === 'function') {
    await spec.channel.ensure();
    const box = spec.channel.state();
    if (box && hasPending(box, spec.entity, spec.entityId)) {
      mustQueue = true;
    }
  }

  if (!mustQueue) {
    const onlineRes = await spec.online();
    if (onlineRes.ok) {
      const uid = await resolveSafeUserId(spec.userId);
      return { ok: true, via: 'online', row: onlineRes.data, userId: uid };
    }
    if (!onlineRes.offline) {
      return { ok: false, error: onlineRes.error };
    }
  }

  const uid = await resolveSafeUserId(spec.userId);
  const queued = await spec.channel.write(
    {
      entity: spec.entity,
      entityId: spec.entityId,
      kind: spec.kind,
      ...(spec.payload !== undefined ? { payload: spec.payload } : {}),
      ...(spec.baseVersion !== undefined ? { baseVersion: spec.baseVersion } : {}),
      ...(spec.dependsOn !== undefined ? { dependsOn: spec.dependsOn } : {}),
    },
    spec.onEnqueued ? { onEnqueued: spec.onEnqueued } : undefined,
  );
  if (!queued.ok) {
    return { ok: false, error: queued.error };
  }
  return {
    ok: true,
    via: 'outbox',
    operationId: queued.operationId,
    savedOnDevice: queued.savedOnDevice,
    userId: uid,
  };
}

export const habitLogEntityId = (habitId: string, date: string): string => `${habitId}|${date}`;

export function parseHabitLogEntityId(id: string): { habitId: string; date: string } | null {
  const sep = id.lastIndexOf('|');
  if (sep <= 0) return null;
  const habitId = id.slice(0, sep);
  const date = id.slice(sep + 1);
  if (habitId.includes('|') || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { habitId, date };
}

export function legacyOpToCommand(op: SyncOp, userId: string, seq: number): OutboxCommand {
  return {
    operationId: op.id,
    userId,
    entity: HABIT_LOG_ENTITY,
    entityId: habitLogEntityId(op.habitId, op.date),
    kind: 'update',
    payload: { intent: op.intent },
    baseVersion: null,
    dependsOn: [],
    seq,
    attempts: op.status === 'dead' ? MAX_ATTEMPTS : Math.min(Math.max(0, op.attempts), MAX_ATTEMPTS - 1),
    status: op.status,
    readyAt: op.readyAt ?? 0,
    ...(op.lastError !== undefined ? { lastError: op.lastError } : {}),
    ...(op.retryableCount !== undefined ? { retryableCount: op.retryableCount } : {}),
    ...(op.firstRetryableAt !== undefined ? { firstRetryableAt: op.firstRetryableAt } : {}),
    createdAt: op.createdAt,
    rev: 1,
  };
}

export function planLegacyMigration(input: {
  userId: string;
  legacy: SyncQueueState;
  quarantined: readonly SyncOp[];
  current: OutboxState;
}): { next: OutboxState; adopted: number; adoptedFromQuarantine: number; skippedForeign: number } {
  const { userId, legacy, quarantined, current } = input;
  let skippedForeign = 0;

  const ownLegacy: SyncOp[] = [];
  for (const op of legacy.ops) {
    if (op.userId && op.userId !== userId) {
      skippedForeign += 1;
      continue;
    }
    ownLegacy.push(op);
  }
  ownLegacy.sort((a, b) => a.seq - b.seq);

  const ownQuarantined = quarantined
    .filter((op) => op.userId === userId)
    .sort((a, b) => a.seq - b.seq);

  const currentEntityIds = new Set(
    current.commands.filter((c) => c.entity === HABIT_LOG_ENTITY).map((c) => c.entityId),
  );
  const currentOpIds = new Set<string>([
    ...current.commands.map((c) => c.operationId),
    ...Object.keys(current.settled ?? {}),
  ]);

  const quarantineKeys = new Set(ownQuarantined.map((op) => habitLogEntityId(op.habitId, op.date)));

  let seq = current.nextSeq;
  let adopted = 0;
  let adoptedFromQuarantine = 0;
  const added: OutboxCommand[] = [];

  for (const op of ownLegacy) {
    const eid = habitLogEntityId(op.habitId, op.date);
    if (quarantineKeys.has(eid)) continue;
    if (currentEntityIds.has(eid) || currentOpIds.has(op.id)) continue;
    currentEntityIds.add(eid);
    currentOpIds.add(op.id);
    added.push(legacyOpToCommand(op, userId, seq));
    seq += 1;
    adopted += 1;
  }

  for (const op of ownQuarantined) {
    const eid = habitLogEntityId(op.habitId, op.date);
    if (currentEntityIds.has(eid) || currentOpIds.has(op.id)) continue;
    currentEntityIds.add(eid);
    currentOpIds.add(op.id);
    added.push(legacyOpToCommand(op, userId, seq));
    seq += 1;
    adoptedFromQuarantine += 1;
  }

  if (added.length === 0) {
    return { next: current, adopted: 0, adoptedFromQuarantine: 0, skippedForeign };
  }

  return {
    next: {
      ...current,
      commands: [...current.commands, ...added],
      nextSeq: seq,
    },
    adopted,
    adoptedFromQuarantine,
    skippedForeign,
  };
}

export const habitMigratedKey = (userId: string): string => `outbox.habit.migrated.v1.${userId}`;
export const legacyHabitQueueKey = (userId: string): string => `atlas_sync_queue_v1:${userId}`;
export const legacyHabitMigratedKey = (userId: string): string => `atlas_sync_queue_v1:${userId}.migrated`;

export function commandToLegacyDeadOp(cmd: OutboxCommand): SyncOp | null {
  if (cmd.entity !== HABIT_LOG_ENTITY || cmd.status !== 'dead') return null;
  const parsed = parseHabitLogEntityId(cmd.entityId);
  if (!parsed) return null;
  const intent = (cmd.payload.intent ?? { state: 'done' }) as HabitLogIntent;
  return {
    id: cmd.operationId,
    habitId: parsed.habitId,
    date: parsed.date,
    intent,
    attempts: cmd.attempts,
    status: 'dead',
    seq: cmd.seq,
    createdAt: cmd.createdAt,
    updatedAt: cmd.createdAt,
    ...(cmd.readyAt > 0 ? { readyAt: cmd.readyAt } : {}),
    ...(cmd.lastError !== undefined ? { lastError: cmd.lastError } : {}),
    userId: cmd.userId,
    ...(cmd.retryableCount !== undefined ? { retryableCount: cmd.retryableCount } : {}),
    ...(cmd.firstRetryableAt !== undefined ? { firstRetryableAt: cmd.firstRetryableAt } : {}),
  };
}

/**
 * F46 (Stage G, step 30): one-time idempotent migration from `atlas_sync_queue_v1[:<uid>]`
 * and `atlas_sync_quarantine_v1` onto the shared `habit` outbox storage, verified by read-back
 * before writing the migration marker or renaming the legacy key to `.migrated`.
 */
export async function migrateLegacyHabitQueue(userId: string, storage: OutboxStorage): Promise<boolean> {
  if (!userId) return false;
  const markerKey = habitMigratedKey(userId);
  const userQueueKey = legacyHabitQueueKey(userId);

  try {
    const marker = await AsyncStorage.getItem(markerKey);
    const rawUserQueue = await AsyncStorage.getItem(userQueueKey);
    const rawUnscoped = await AsyncStorage.getItem('atlas_sync_queue_v1');
    const rawQuarantine = await AsyncStorage.getItem(QUARANTINE_KEY);
    if (marker === '1' && rawUserQueue === null && rawUnscoped === null && rawQuarantine === null) {
      return true;
    }
    if (rawUserQueue === null && rawUnscoped === null && rawQuarantine === null) {
      return true;
    }

    let preQuarantined: SyncOp[] = [];
    if (rawQuarantine) {
      try {
        const parsedQ: unknown = JSON.parse(rawQuarantine);
        if (Array.isArray(parsedQ)) {
          preQuarantined = parsedQ.filter(
            (o): o is SyncOp =>
              Boolean(o && typeof o === 'object' && typeof (o as SyncOp).id === 'string' && (o as SyncOp).userId === userId),
          );
        }
      } catch {
        preQuarantined = [];
      }
    }

    if (rawUserQueue === null && rawUnscoped === null && preQuarantined.length === 0) {
      return true;
    }

    // Verify we can read & write the target outbox BEFORE `loadSyncQueue` mutates legacy/quarantine keys.
    const current = (await storage.load(userId)) ?? emptyOutbox(userId);

    const loadedLegacy = await loadSyncQueue(userId);
    const planned = planLegacyMigration({
      userId,
      legacy: loadedLegacy,
      quarantined: preQuarantined,
      current,
    });

    await storage.save(planned.next);
    const readBack = await storage.load(userId);
    const verified =
      readBack.commands.length === planned.next.commands.length &&
      stableJson(readBack.commands) === stableJson(planned.next.commands);

    if (!verified) {
      throw new Error('habit outbox migration read-back verification failed');
    }

    const latestLegacyRaw = (await AsyncStorage.getItem(userQueueKey)) ?? rawUserQueue;
    if (latestLegacyRaw !== null) {
      await AsyncStorage.setItem(legacyHabitMigratedKey(userId), latestLegacyRaw);
      await AsyncStorage.removeItem(userQueueKey);
    }
    await AsyncStorage.setItem(markerKey, '1');
    return true;
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), 'manual', 'habit-migration');
    return false;
  }
}

export function webhookOperationId(
  event: 'habit_completed' | 'task_completed',
  subjectKey: string,
  webhookId: string,
): string {
  return `wh1.${event}.${subjectKey}.${webhookId}`;
}
