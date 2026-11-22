import { registerAccountScoped } from '../lib/accountScope';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { reportError } from '../lib/crashReporting';
import { deviceTimeZone, isLoggableDay, todayLocal, ymd } from '../lib/date';
import { normalizeNote } from '../lib/habitNote';
import { createLatestByKey } from '../lib/latestOnly';
import { emptyOutbox, summary, type DeliveryOutcome, type OutboxCommand } from '../lib/outbox';
import {
  commandToLegacyDeadOp,
  ENTITY_POLICIES,
  HABIT_LOG_ENTITY,
  habitLogEntityId,
  migrateLegacyHabitQueue,
  outboxEngine,
  parseHabitLogEntityId,
  type HabitLogIntent,
  type SyncOp,
} from '../lib/outboxEngine';
import { asyncStorageOutboxNs, namespacedOutboxKey } from '../lib/outboxStorage';
import { LOGGABLE_DAY_MESSAGE } from '../lib/pgErrors';
import { currentUser } from '../lib/session';
import type { HabitLog } from '../lib/supabase';
import { create } from 'zustand';
import {
  loadDay,
  persistCompletion,
  toPatch,
  type LogPatch,
} from '../services/habitLogService';
import { createOutboxChannel } from '../services/outboxChannel';

export type LogResult =
  | { ok: true; log: HabitLog }
  | { ok: false; error: string; offline?: boolean; retryable?: boolean };

/** F05: what a write that nobody owns returns: no queue to keep it in, no false success. */
export const NO_SESSION_ERROR = 'Oturum bulunamadı. Giriş yapıp tekrar dene.';

/** UI-facing sync status for one (habit, day) key -- see `getSyncStatusFor`. */
export type HabitSyncStatus = 'synced' | 'pending' | 'dead';

const FIRST_ATTEMPT_WAIT_MS = 4_000;

type LogStore = {
  logs: HabitLog[];
  loading: boolean;
  logsError: string | null;
  pendingSyncCount: number;
  deadSyncCount: number;
  fetchLogsForDate: (date: Date | string) => Promise<void>;
  applyFetchedDay: (dateStr: string, rows: readonly HabitLog[]) => void;
  logHabit: (params: {
    habitId: string;
    date: Date;
    state: HabitLog['state'];
    value?: number;
    targetValue?: number;
    baseXp?: number;
    targetDirection?: 'at_least' | 'at_most';
    note?: string | null;
  }) => Promise<LogResult>;
  getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined;
  getRemainingValue: (habitId: string, targetValue: number, date: Date) => number;
  getSyncStatusFor: (habitId: string, date: Date | string) => HabitSyncStatus;
  hydrateSyncQueue: () => Promise<void>;
  flushPendingSync: (now?: number) => Promise<LogResult[]>;
  rebindSyncQueue: (userId: string | null) => Promise<void>;
  reviveSyncOp: (opId: string) => Promise<void>;
  dropSyncOp: (opId: string) => Promise<void>;
  deadSyncOps: () => SyncOp[];
  nextSyncReadyAt: () => number | null;
};

const EVENT_BY_STATE: Partial<Record<HabitLog['state'], AnalyticsEventName>> = {
  done: 'habit_completed',
  partial: 'habit_partial',
  miss: 'habit_missed',
};

type Patch = LogPatch;

function emitHabitLogEvent(
  habitId: string,
  dateStr: string,
  state: HabitLog['state'],
  patch: Patch,
): void {
  const name = EVENT_BY_STATE[state];
  if (!name) return;
  try {
    emitEvent(buildEvent(name, {
      habit_id: habitId,
      date: dateStr,
      state,
      xp: patch.xp,
      value: patch.value,
    }));
  } catch {
    // Deliberately empty: analytics never fails a user completion.
  }
}

const dayLatest = createLatestByKey();
const inFlightKeys = new Set<string>();
const enqueuingCounts = new Map<string, number>();

function incrementEnqueuing(eid: string): void {
  enqueuingCounts.set(eid, (enqueuingCounts.get(eid) ?? 0) + 1);
}

function decrementEnqueuing(eid: string): void {
  const cur = enqueuingCounts.get(eid) ?? 0;
  if (cur <= 1) enqueuingCounts.delete(eid);
  else enqueuingCounts.set(eid, cur - 1);
}

const LOCAL_ID_PREFIX = 'pending-';

function isLocalPlaceholder(log: HabitLog): boolean {
  return log.id.startsWith(LOCAL_ID_PREFIX);
}

function buildOptimisticLog(
  habitId: string,
  dateStr: string,
  patch: Patch,
  priorLocal: HabitLog | undefined,
): HabitLog {
  const { xp: _serverOwned, notes: _privateNote, ...displayable } = patch;
  if (priorLocal) return { ...priorLocal, ...displayable };
  return {
    id: `${LOCAL_ID_PREFIX}${habitId}|${dateStr}`,
    habit_id: habitId,
    user_id: '',
    completed_at: dateStr,
    created_at: new Date().toISOString(),
    xp: 0,
    ...displayable,
  };
}

function replaceLogForKey(
  s: { logs: HabitLog[] },
  habitId: string,
  dateStr: string,
  log: HabitLog,
): { logs: HabitLog[] } {
  return {
    logs: [...s.logs.filter((l) => !(l.habit_id === habitId && l.completed_at === dateStr)), log],
  };
}

function rollbackTo(
  s: { logs: HabitLog[] },
  habitId: string,
  dateStr: string,
  priorLocal: HabitLog | undefined,
): { logs: HabitLog[] } {
  const others = s.logs.filter((l) => !(l.habit_id === habitId && l.completed_at === dateStr));
  return { logs: priorLocal ? [...others, priorLocal] : others };
}

export const MAX_LOG_DAYS = 120;

function capDays(rows: HabitLog[], max: number): HabitLog[] {
  const days = [...new Set(rows.map((r) => r.completed_at))];
  if (days.length <= max) return rows;
  const keep = new Set(days.sort().slice(-max));
  return rows.filter((r) => keep.has(r.completed_at) || isLocalPlaceholder(r));
}

export function mergeDayLogs(
  current: readonly HabitLog[],
  dateStr: string,
  server: readonly HabitLog[],
  isProtected: (habitId: string) => boolean,
): HabitLog[] {
  const others = current.filter((l) => l.completed_at !== dateStr);
  const localByHabit = new Map<string, HabitLog>();
  for (const l of current) {
    if (l.completed_at === dateStr) localByHabit.set(l.habit_id, l);
  }

  const day: HabitLog[] = [];
  const seen = new Set<string>();
  for (const row of server) {
    seen.add(row.habit_id);
    const local = localByHabit.get(row.habit_id);
    day.push(local && isProtected(row.habit_id) ? local : row);
  }
  for (const [habitId, local] of localByHabit) {
    if (!seen.has(habitId) && isProtected(habitId)) day.push(local);
  }
  return capDays([...others, ...day], MAX_LOG_DAYS);
}

const optimisticGen = new Map<string, number>();
let optimisticGenSeq = 0;

type SetState = (fn: (s: { logs: HabitLog[] }) => Partial<{ logs: HabitLog[] }>) => void;
type GetState = () => { logs: HabitLog[]; getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined };

async function attemptWrite(
  set: SetState,
  get: GetState,
  habitId: string,
  dateStr: string,
  patch: Patch,
  canUpdateMemory: () => boolean,
): Promise<LogResult> {
  const existing = get().getLogForHabit(habitId, dateStr);
  const confirmed = existing && !isLocalPlaceholder(existing) ? existing : undefined;

  const res = await persistCompletion({
    habitId,
    dateStr,
    patch,
    confirmedId: confirmed?.id,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      offline: res.offline,
      ...(res.retryable ? { retryable: true } : {}),
    };
  }

  if (canUpdateMemory()) {
    set((s) => replaceLogForKey(s, res.log.habit_id, res.log.completed_at, res.log));
  }
  return { ok: true, log: res.log };
}

const habitStorage = asyncStorageOutboxNs('habit');
let resetOwnerState: () => void = () => undefined;

export const useLogStore = create<LogStore>((set, get) => {
  let queueOwnerId: string | null = null;
  let flushInFlight: Promise<LogResult[]> | null = null;
  let queueEpoch = 0;
  let rebindChain: Promise<void> = Promise.resolve();
  const attemptResults = new Map<string, LogResult>();
  const latestNoteByKey = new Map<string, string | null>();

  async function deliverHabitLog(cmd: OutboxCommand): Promise<DeliveryOutcome> {
    const parsed = parseHabitLogEntityId(cmd.entityId);
    if (!parsed) return { kind: 'gone' };
    const rawIntent = cmd.payload.intent;
    if (!rawIntent || typeof rawIntent !== 'object') return { kind: 'gone' };
    const intent = rawIntent as HabitLogIntent;
    const patch = toPatch(intent);
    const epochAtStart = queueEpoch;
    inFlightKeys.add(cmd.entityId);

    try {
      const res = await attemptWrite(
        set,
        get,
        parsed.habitId,
        parsed.date,
        patch,
        () => epochAtStart === queueEpoch && queueOwnerId === cmd.userId,
      );
      attemptResults.set(cmd.operationId, res);
      if (res.ok) {
        if (latestNoteByKey.has(cmd.entityId) && epochAtStart === queueEpoch) {
          const stillQueued = habitChannel
            .state()
            ?.commands.some((c) => c.entity === HABIT_LOG_ENTITY && c.entityId === cmd.entityId && c.operationId !== cmd.operationId);
          if (!stillQueued) latestNoteByKey.delete(cmd.entityId);
        }
        return { kind: 'applied' };
      }
      if (res.offline) return { kind: 'offline' };
      if (res.retryable) return { kind: 'retryable', error: res.error };
      return { kind: 'rejected', error: res.error };
    } catch {
      const fallback: LogResult = { ok: false, error: 'Ağ bağlantısı yok, tekrar denenecek.', offline: true };
      attemptResults.set(cmd.operationId, fallback);
      return { kind: 'offline' };
    } finally {
      inFlightKeys.delete(cmd.entityId);
    }
  }

  const habitChannel = createOutboxChannel({
    storage: habitStorage,
    transports: { [HABIT_LOG_ENTITY]: deliverHabitLog },
    currentUserId: async () => queueOwnerId,
    policies: ENTITY_POLICIES,
    persistOnSignOut: true,
    registerStorage: {
      name: 'habit',
      keysFor: (uid) => [namespacedOutboxKey('habit', uid)],
    },
  });

  habitChannel.subscribe((s) => {
    const sum = summary(s ?? emptyOutbox(''));
    set({ pendingSyncCount: sum.pending, deadSyncCount: sum.dead });
  });

  outboxEngine.register('habit', {
    ...habitChannel,
    flush: async (opts) => {
      await get().flushPendingSync(opts?.now);
    },
  });

  resetOwnerState = () => {
    queueEpoch += 1;
    queueOwnerId = null;
    flushInFlight = null;
    attemptResults.clear();
    latestNoteByKey.clear();
    enqueuingCounts.clear();
  };

  async function applyOwner(userId: string | null, force: boolean): Promise<void> {
    if (userId === queueOwnerId && !force) return;
    queueEpoch += 1;
    const epoch = queueEpoch;
    queueOwnerId = userId;
    flushInFlight = null;
    latestNoteByKey.clear();
    habitChannel.reset();

    if (!userId) return;
    await migrateLegacyHabitQueue(userId, habitStorage);
    if (epoch !== queueEpoch) return;
    await habitChannel.ensure();
    if (epoch !== queueEpoch) return;
    if (!force) void get().flushPendingSync();
  }

  function enqueueOwnerChange(userId: string | null, force: boolean): Promise<void> {
    const run = rebindChain.then(() => applyOwner(userId, force), () => applyOwner(userId, force));
    rebindChain = run.catch(() => undefined);
    return run;
  }

  function resolveEffectiveIntent(eid: string, intent: HabitLogIntent): HabitLogIntent {
    const normalized: HabitLogIntent =
      intent.note === undefined ? intent : { ...intent, note: normalizeNote(intent.note) ?? null };
    if (normalized.note !== undefined) {
      latestNoteByKey.set(eid, normalized.note ?? null);
      return normalized;
    }
    const nonSending = [...(habitChannel.state()?.commands ?? [])]
      .reverse()
      .find(
        (c) =>
          c.entity === HABIT_LOG_ENTITY &&
          c.entityId === eid &&
          !c.sending &&
          (c.status === 'pending' || c.status === 'dead'),
      );
    const cmdIntent = nonSending?.payload?.intent as HabitLogIntent | undefined;
    if (cmdIntent && cmdIntent.note !== undefined) {
      return { ...normalized, note: cmdIntent.note };
    }
    if (latestNoteByKey.has(eid)) {
      return { ...normalized, note: latestNoteByKey.get(eid) ?? null };
    }
    return normalized;
  }

  async function runFlushPass(now?: number): Promise<LogResult[]> {
    await rebindChain;
    if (!queueOwnerId) return [];
    const live = await habitChannel.ensure();
    if (!live || live.userId !== queueOwnerId) return [];

    const effectiveNow = now ?? Date.now();
    for (const c of live.commands) {
      if (c.entity !== HABIT_LOG_ENTITY || c.status !== 'pending' || c.sending || c.readyAt > effectiveNow) {
        continue;
      }
      const parsed = parseHabitLogEntityId(c.entityId);
      const rawIntent = c.payload.intent as HabitLogIntent | undefined;
      if (!parsed || !rawIntent) continue;
      if (!get().getLogForHabit(parsed.habitId, parsed.date)) {
        const patch = toPatch(rawIntent);
        set((s) => replaceLogForKey(s, parsed.habitId, parsed.date, buildOptimisticLog(parsed.habitId, parsed.date, patch, undefined)));
      }
    }

    const collected: LogResult[] = [];
    const unsub = habitChannel.onSettled((report) => {
      if (report.entity !== HABIT_LOG_ENTITY) return;
      const recorded = attemptResults.get(report.operationId);
      attemptResults.delete(report.operationId);
      if (report.outcome === 'offline' || report.outcome === 'retryable' || report.outcome === 'auth') {
        collected.push({ ok: false, error: report.error ?? 'Ağ bağlantısı yok, tekrar denenecek.' });
      } else if (recorded) {
        collected.push(recorded);
      } else if (report.outcome === 'rejected' || report.outcome === 'dead') {
        collected.push({ ok: false, error: report.error ?? 'Kayıt reddedildi.' });
      }
    });

    try {
      await habitChannel.flush(now !== undefined ? { now } : undefined);
    } finally {
      unsub();
    }
    return collected;
  }

  return {
    logs: [],
    loading: false,
    logsError: null,
    pendingSyncCount: 0,
    deadSyncCount: 0,

    fetchLogsForDate: async (date) => {
      const dateStr = typeof date === 'string' ? date : ymd(date);
      const run = dayLatest.begin(dateStr);
      set({ loading: true });
      try {
        const res = await loadDay(dateStr);
        if (!run.isCurrent()) return;
        if (res.ok) {
          get().applyFetchedDay(dateStr, res.logs);
          set({ logsError: null });
        } else {
          set({ logsError: res.error });
        }
      } finally {
        run.done();
        if (dayLatest.pending() === 0) set({ loading: false });
      }
    },

    applyFetchedDay: (dateStr, rows) => {
      const isProtected = (habitId: string) => {
        const eid = habitLogEntityId(habitId, dateStr);
        return inFlightKeys.has(eid) || get().getSyncStatusFor(habitId, dateStr) === 'pending';
      };
      set((s) => ({ logs: mergeDayLogs(s.logs, dateStr, rows, isProtected) }));
    },

    logHabit: ({ habitId, date, state, value, targetValue, baseXp = 30, targetDirection, note }) => {
      const dateStr = ymd(date);
      if (!isLoggableDay(dateStr)) return Promise.resolve({ ok: false, error: LOGGABLE_DAY_MESSAGE });
      const eid = habitLogEntityId(habitId, dateStr);
      const tz = deviceTimeZone();
      const rawIntent: HabitLogIntent = {
        state,
        value,
        targetValue,
        baseXp,
        targetDirection,
        ...(tz ? { tz } : {}),
        ...(note !== undefined ? { note } : {}),
      };

      const initialIntent = resolveEffectiveIntent(eid, rawIntent);
      const patch = toPatch(initialIntent);
      const priorLocal = get().getLogForHabit(habitId, dateStr);
      const optimisticLog = buildOptimisticLog(habitId, dateStr, patch, priorLocal);
      const myGen = ++optimisticGenSeq;
      optimisticGen.set(eid, myGen);
      incrementEnqueuing(eid);
      set((s) => replaceLogForKey(s, habitId, dateStr, optimisticLog));

      return (async (): Promise<LogResult> => {
        let decremented = false;
        const releaseEnqueuing = () => {
          if (decremented) return;
          decremented = true;
          decrementEnqueuing(eid);
        };

        try {
          await rebindChain;
          if (queueOwnerId === null) {
            const u = await currentUser();
            if (u) await get().rebindSyncQueue(u.id);
          }
          if (queueOwnerId === null) {
            releaseEnqueuing();
            return { ok: false, error: NO_SESSION_ERROR };
          }

          await habitChannel.ensure();
          const finalIntent = resolveEffectiveIntent(eid, rawIntent);
          const written = await habitChannel.write(
            {
              entity: HABIT_LOG_ENTITY,
              entityId: eid,
              kind: 'update',
              payload: { intent: finalIntent },
            },
            {
              onEnqueued: () => {
                releaseEnqueuing();
              },
              awaitFirstAttempt: { timeoutMs: FIRST_ATTEMPT_WAIT_MS },
            },
          );
          releaseEnqueuing();

          if (!written.ok) {
            return { ok: false, error: written.error };
          }
          if (!written.savedOnDevice) {
            reportError(new Error('habit log queue could not be saved'), 'manual', 'queue-save');
          }

          const fa = written.firstAttempt;
          const recorded = attemptResults.get(written.operationId);
          attemptResults.delete(written.operationId);

          if (fa && fa !== 'timeout') {
            if (fa.outcome === 'applied') {
              return recorded && recorded.ok ? recorded : { ok: true, log: get().getLogForHabit(habitId, dateStr) ?? optimisticLog };
            }
            if (fa.outcome === 'rejected' || fa.outcome === 'dead') {
              return recorded && !recorded.ok ? recorded : { ok: false, error: fa.error ?? 'Kayıt reddedildi.' };
            }
          }
          return { ok: true, log: optimisticLog };
        } finally {
          releaseEnqueuing();
        }
      })().then((result) => {
        if (!result.ok && optimisticGen.get(eid) === myGen) {
          set((s) => rollbackTo(s, habitId, dateStr, priorLocal));
        }
        if (result.ok) emitHabitLogEvent(habitId, dateStr, state, patch);
        return result;
      });
    },

    getLogForHabit: (habitId, date) => {
      const dateStr = date === undefined ? todayLocal() : typeof date === 'string' ? date : ymd(date);
      return get().logs.find((l) => l.habit_id === habitId && l.completed_at === dateStr);
    },

    getRemainingValue: (habitId, targetValue, date) => {
      const log = get().getLogForHabit(habitId, date);
      const done = log?.value ?? 0;
      return Math.max(0, targetValue - done);
    },

    getSyncStatusFor: (habitId, date) => {
      const dateStr = typeof date === 'string' ? date : ymd(date);
      const eid = habitLogEntityId(habitId, dateStr);
      if ((enqueuingCounts.get(eid) ?? 0) > 0) return 'pending';
      const cmds = habitChannel.state()?.commands ?? [];
      let hasDead = false;
      for (const c of cmds) {
        if (c.entity !== HABIT_LOG_ENTITY || c.entityId !== eid) continue;
        if (c.status === 'pending') return 'pending';
        if (c.status === 'dead') hasDead = true;
      }
      return hasDead ? 'dead' : 'synced';
    },

    hydrateSyncQueue: async () => {
      const user = await currentUser();
      await enqueueOwnerChange(user?.id ?? null, true);
    },

    rebindSyncQueue: (userId) => enqueueOwnerChange(userId, false),

    reviveSyncOp: async (opId) => {
      await habitChannel.ensure();
      await habitChannel.retry(opId, null);
      void get().flushPendingSync();
    },

    dropSyncOp: async (opId) => {
      await habitChannel.ensure();
      const cmd = habitChannel.state()?.commands.find((c) => c.operationId === opId && c.entity === HABIT_LOG_ENTITY);
      if (!cmd) return;
      const parsed = parseHabitLogEntityId(cmd.entityId);
      latestNoteByKey.delete(cmd.entityId);
      await habitChannel.discard(opId);
      if (!parsed) return;
      const res = await loadDay(parsed.date);
      if (!res.ok) return;
      const serverRow = res.logs.find((l) => l.habit_id === parsed.habitId);
      set((s) => (serverRow
        ? replaceLogForKey(s, parsed.habitId, parsed.date, serverRow)
        : rollbackTo(s, parsed.habitId, parsed.date, undefined)));
    },

    deadSyncOps: () =>
      (habitChannel.state()?.commands ?? [])
        .map(commandToLegacyDeadOp)
        .filter((o): o is SyncOp => o !== null),

    nextSyncReadyAt: () => habitChannel.nextReadyAt(),

    flushPendingSync: (now) => {
      if (flushInFlight) return flushInFlight;
      const pass: Promise<LogResult[]> = runFlushPass(now).finally(() => {
        if (flushInFlight === pass) flushInFlight = null;
      });
      flushInFlight = pass;
      return pass;
    },
  };
});

// F04 (STO-20): the store, in-flight flags, optimistic generations and the channel owner state.
registerAccountScoped({
  name: 'log',
  store: useLogStore,
  onReset: () => {
    inFlightKeys.clear();
    dayLatest.invalidate();
    optimisticGen.clear();
    resetOwnerState();
  },
});
