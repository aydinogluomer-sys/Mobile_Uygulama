import { create } from 'zustand';
import { supabase, HabitLog } from '../lib/supabase';
import { ymd } from '../lib/date';
import { completionRatio, type TrackingType } from '../lib/habitEngine';
import {
  emptyQueueState,
  enqueue as enqueueOp,
  markSynced as markOpSynced,
  markFailed as markOpFailed,
  statusFor as queueStatusFor,
  pendingCount as queuePendingCount,
  deadCount as queueDeadCount,
  orderedPending,
  loadSyncQueue,
  saveSyncQueue,
  type SyncQueueState,
  type SyncOp,
  type HabitLogIntent,
} from '../lib/syncQueue';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';

/**
 * What a write actually did. The previous signature was `Promise<void>` and
 * both branches destructured only `data`, so every failure -- RLS denial,
 * network drop, constraint violation -- was indistinguishable from success.
 */
export type LogResult =
  | { ok: true; log: HabitLog }
  | { ok: false; error: string };

/** UI-facing sync status for one (habit, day) key -- see `getSyncStatusFor`. */
export type HabitSyncStatus = 'synced' | 'pending' | 'dead';

const COLS = 'id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at';

type LogStore = {
  logs: HabitLog[];
  loading: boolean;
  /** Ops with status 'pending' across ALL habits/days -- drives a global "syncing" indicator. */
  pendingSyncCount: number;
  /** Ops that exhausted their retry budget (plan §18's terminal state) -- surfaced, not hidden. */
  deadSyncCount: number;
  fetchLogsForDate: (date: Date | string) => Promise<void>;
  logHabit: (params: {
    habitId: string;
    date: Date;
    state: HabitLog['state'];
    value?: number;
    targetValue?: number;
    baseXp?: number;
    /**
     * Which side of `targetValue` counts as success. Absent means
     * `at_least`, preserving the behaviour of every caller written before
     * ceilings were expressible.
     */
    targetDirection?: 'at_least' | 'at_most';
  }) => Promise<LogResult>;
  getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined;
  getRemainingValue: (habitId: string, targetValue: number, date: Date) => number;
  /** Per-(habit, day) sync flag for the UI -- 'pending sync' per plan §18. */
  getSyncStatusFor: (habitId: string, date: Date | string) => HabitSyncStatus;
  /**
   * Loads the persisted queue from disk. Call ONCE at app boot, before any
   * `logHabit` call -- it REPLACES the in-memory queue with what was on
   * disk, so a tap that races ahead of hydration would be clobbered. This
   * mirrors `store/themeStore.ts`'s `load()` contract (called once, awaited,
   * before the store's persisted fields are trusted).
   */
  hydrateSyncQueue: () => Promise<void>;
  /**
   * Replays every eligible queued op (plan §18's "sync queue -> Supabase
   * update -> server confirmation" step), in the deterministic order
   * `lib/syncQueue.ts` defines. Safe to call with an empty queue (no-op) or
   * repeatedly (already-synced/dead ops are simply not eligible). Intended
   * to be called by a future UI unit on app foreground / reconnect -- not
   * invoked automatically here, per this task's UI-free scope.
   *
   * `now`, like `lib/date.ts`'s injectable clock convention, lets a test
   * drive the exponential-backoff window deterministically; a real caller
   * omits it and gets the actual clock.
   */
  flushPendingSync: (now?: number) => Promise<LogResult[]>;
};

/**
 * W1 (task 1-D, Phase 1 wiring): the `partial` branch used to be ad-hoc
 * maths -- `baseXp * (value / targetValue)`, unclamped and un-guarded --
 * with two real defects, both now fixed by routing through the domain
 * layer's `completionRatio` (`lib/habitEngine.ts`) instead:
 *
 *  1. Unclamped -- a partial log with `value > targetValue` awarded MORE
 *     than `baseXp`, i.e. over 100% XP for an incomplete habit.
 *  2. NaN-vulnerable -- identical to QA finding A-01. `parseFloat('')` ->
 *     `NaN` -> `Math.round(NaN)` -> `NaN` XP written to the database.
 *
 * `completionRatio` clamps its numeric ratio to `[0, 1]` and is NaN-safe by
 * construction (see its own doc comment), so both defects are fixed at the
 * source rather than patched here.
 *
 * `calcXp`'s signature is unchanged (`logHabit`'s public params carry no
 * real V2 tracking-type -- widening the store's public surface for that
 * would be a bigger change than this wiring task calls for). The tracking
 * type is instead INFERRED from the arguments already available: a
 * positive numeric `targetValue` implies a numeric/duration-tracked habit
 * (mirrors `logHabit`'s own callers, who only ever pass `targetValue` for a
 * numeric habit); anything else is treated as `binary`, which is the
 * conservative choice and -- for the `partial` branch specifically --
 * collapses to the same "no valid target -> 0 XP" behaviour `calcXp`
 * already had before this change. This is deliberately the smallest change
 * to `logStore`'s public surface, per this task's brief.
 */
function calcXp(
  baseXp: number,
  value: number | undefined,
  targetValue: number | undefined,
  state: HabitLog['state'],
  targetDirection?: 'at_least' | 'at_most',
): number {
  if (state === 'done') return baseXp;
  if (state === 'partial') {
    const trackingType: TrackingType = targetValue != null && targetValue > 0 ? 'numeric' : 'binary';
    // `direction` matters here: for a ceiling ("at most 2"), the at_least
    // ratio clamps any overshoot to 1 and would award FULL XP for exceeding
    // the limit. `completionRatio` decays it instead.
    const ratio = completionRatio({
      trackingType, state, value, target: targetValue, direction: targetDirection,
    });
    return Math.round(baseXp * ratio);
  }
  return 0;
}

function toPatch(intent: HabitLogIntent): Patch {
  return {
    state: intent.state,
    value: intent.value ?? null,
    xp: calcXp(intent.baseXp ?? 30, intent.value, intent.targetValue, intent.state, intent.targetDirection),
    is_completed: intent.state === 'done',
  };
}

/**
 * §22 ANALYTICS EMISSION — why this lives in the store and not in a screen.
 *
 * A habit is completed from at least three places (`app/tabs/today.tsx`'s
 * inline row, `app/tabs/timeline.tsx`, `app/screens/recovery.tsx`), and a
 * fourth is one deep link away. An event emitted from a screen fires for the
 * taps that happen to go through that screen and silently never fires for the
 * rest -- and the failure is invisible, because a missing event looks exactly
 * like a user who did not do the thing. `logHabit` is the single choke point
 * every one of those paths already goes through, so emitting here means the
 * event cannot be bypassed by adding a screen.
 *
 * `skip` deliberately has NO entry. Plan §22 declares no `habit_skipped`
 * event, and `buildEvent` throws on an undeclared name -- inventing one here
 * would turn "user skipped a habit" into a crash. Absent from this map means
 * "not an analytics event", not "forgotten".
 */
const EVENT_BY_STATE: Partial<Record<HabitLog['state'], AnalyticsEventName>> = {
  done: 'habit_completed',
  partial: 'habit_partial',
  miss: 'habit_missed',
};

/**
 * Builds and emits the §22 event for one log write. NEVER throws.
 *
 * Two guards, for two different failures:
 *  - the `if (!name) return` above handles a state with no declared event;
 *  - the `try` handles everything else (a future undeclared name, a sink that
 *    blows up). An analytics failure is not a product failure: the user
 *    tapped, the habit is logged, and nothing about that should be undone
 *    because a telemetry call went wrong.
 *
 * PAYLOAD: ids, an enum, a date and counts only -- `patch` is used rather
 * than the raw params on purpose, because `patch.value` is already
 * `number | null` (never `undefined`, which the allowlist would drop) and
 * `patch.xp` is the number actually written. The habit's TITLE is not passed
 * and must never be: §22 forbids free text on an event, and `buildEvent`
 * would drop it anyway -- but a payload that relies on the allowlist to
 * scrub it is one refactor away from leaking.
 */
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
    // Deliberately empty: see above.
  }
}

/**
 * One promise chain per (habit, day). A second tap on the same habit waits for
 * the first write to settle, so it observes the row the first one created and
 * takes the update branch instead of inserting again. Different habits keep
 * independent chains and remain concurrent.
 *
 * SCOPE, stated rather than implied: this closes the double-tap window *within
 * one client*. It is not a lock. Two devices, or a reinstalled app, can still
 * race. Only a UNIQUE (habit_id, completed_at) constraint makes a duplicate
 * impossible -- so the insert path below also handles the 23505 that such a
 * constraint raises, without depending on it being present.
 *
 * OFFLINE-FIRST NOTE (plan §18): this map is in-memory and per-process -- it
 * is empty the instant the app restarts, and nothing below tries to make it
 * otherwise. What survives a restart is `queueState` (`lib/syncQueue.ts`),
 * persisted to `AsyncStorage`. A replay after a cold start (`flushPendingSync`)
 * therefore does NOT rely on this map for de-duplication; it goes through the
 * exact same `attemptWrite` -- including its 23505-recovery branch -- that a
 * live tap does, which is what makes replay safe with no chain protecting it.
 */
const chains = new Map<string, Promise<unknown>>();

function serialise<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const result = prev.then(run, run);
  // Drop the entry once this link is the last one, so the map cannot grow
  // without bound over a long session.
  const holder: { tail?: Promise<void> } = {};
  holder.tail = result.then(() => undefined, () => undefined).then(() => {
    if (chains.get(key) === holder.tail) chains.delete(key);
  });
  chains.set(key, holder.tail);
  return result;
}

/**
 * Placeholder ids for a local, not-yet-confirmed optimistic row. Deterministic
 * per (habit, day) key (not random) -- repeated taps before confirmation
 * reuse the same placeholder rather than minting a new one each time.
 *
 * Why this matters beyond display: `attemptWrite`'s insert-vs-update decision
 * reads `getLogForHabit`, which now can return a row that is ONLY a local
 * optimistic guess. Treating that as a "confirmed existing row" would send an
 * UPDATE against an id the database has never heard of -- silently losing the
 * write instead of inserting it. `isLocalPlaceholder` is the guard against
 * exactly that.
 */
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
  if (priorLocal) return { ...priorLocal, ...patch };
  return {
    id: `${LOCAL_ID_PREFIX}${habitId}|${dateStr}`,
    habit_id: habitId,
    // No confirmed row yet, so no real user id to carry -- nothing in this
    // codebase filters `logs` by `user_id` (see `getLogForHabit`), and this
    // placeholder is replaced by the DB-confirmed row the moment it lands.
    user_id: '',
    completed_at: dateStr,
    created_at: new Date().toISOString(),
    ...patch,
  };
}

/** Replaces whatever is stored for (habitId, dateStr) with `log` -- by KEY, not by id. */
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

/**
 * Guards a rollback from clobbering a NEWER, still-pending optimistic tap on
 * the same key. Two rapid taps on the same habit both apply their optimistic
 * update synchronously before either write settles; if the FIRST tap's write
 * later fails for a real (non-network) reason, its rollback must not erase
 * the SECOND tap's still-in-flight optimistic value -- that tap's own outcome
 * is what should govern the display. Keyed the same as `chains`.
 */
const optimisticGen = new Map<string, number>();
let optimisticGenSeq = 0;

type Patch = {
  state: HabitLog['state'];
  value: number | null;
  xp: number;
  is_completed: boolean;
};

type SetState = (fn: (s: { logs: HabitLog[] }) => Partial<{ logs: HabitLog[] }>) => void;
type GetState = () => { logs: HabitLog[]; getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined };

async function applyUpdate(set: SetState, id: string, patch: Patch): Promise<LogResult> {
  const { data, error } = await supabase
    .from('habit_logs')
    .update(patch)
    .eq('id', id)
    .select(COLS)
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Kayıt güncellenemedi.' };
  }
  const log = data as HabitLog;
  set((s) => replaceLogForKey(s, log.habit_id, log.completed_at, log));
  return { ok: true, log };
}

/**
 * The one place the insert/update/23505-recovery decision is made -- shared
 * by a live tap (`logHabit`) and a replayed one (`flushPendingSync`), so
 * replay can never drift from what a fresh tap would do. This is the
 * function that makes a cold-start replay land on an UPDATE instead of a
 * duplicate INSERT when the row already exists remotely: it is exactly the
 * pre-existing 23505 recovery, run again, and it is idempotent by
 * construction against the `UNIQUE (habit_id, completed_at)` constraint
 * (`supabase/migrations/001_initial_schema.sql:34`) whether or not this
 * process has ever seen the row before.
 *
 * `existing` explicitly excludes a local-only placeholder (see
 * `isLocalPlaceholder`) -- an optimistic guess is not a confirmed row to
 * update against.
 */
async function attemptWrite(
  set: SetState,
  get: GetState,
  habitId: string,
  dateStr: string,
  patch: Patch,
): Promise<LogResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Oturum bulunamadı.' };

  const existing = get().getLogForHabit(habitId, dateStr);
  const confirmed = existing && !isLocalPlaceholder(existing) ? existing : undefined;
  if (confirmed) return applyUpdate(set, confirmed.id, patch);

  const { data, error } = await supabase
    .from('habit_logs')
    .insert({ habit_id: habitId, user_id: user.id, completed_at: dateStr, ...patch })
    .select(COLS)
    .single();

  if (!error && data) {
    const log = data as HabitLog;
    set((s) => replaceLogForKey(s, log.habit_id, log.completed_at, log));
    return { ok: true, log };
  }

  // 23505 = unique_violation. The row exists in the database but not in
  // local state -- another device wrote it, this date was never fetched, or
  // (plan §18) a previous session's write reached the server before the app
  // was killed and this is that same intent replaying. Recover the row and
  // update it rather than dropping the tap or duplicating the row.
  if (error?.code === '23505') {
    const { data: found } = await supabase
      .from('habit_logs')
      .select(COLS)
      .eq('habit_id', habitId)
      .eq('user_id', user.id)
      .eq('completed_at', dateStr)
      .maybeSingle();
    if (found) return applyUpdate(set, (found as HabitLog).id, patch);
  }

  return { ok: false, error: error?.message ?? 'Kayıt oluşturulamadı.' };
}

export const useLogStore = create<LogStore>((set, get) => {
  // In-memory mirror of the persisted queue. Replaced wholesale by
  // `hydrateSyncQueue()` (see that method's doc for the ordering contract),
  // mutated by every `logHabit`/`flushPendingSync` write attempt, and
  // persisted after every mutation so `pending sync` survives a restart.
  let queueState: SyncQueueState = emptyQueueState();

  /**
   * RE-ENTRANCY GUARD for `flushPendingSync`.
   *
   * WHY IT LIVES HERE, in the store, and not in the component that calls the
   * flush. There are now two independent triggers -- app boot and
   * `AppState -> 'active'`, both in `app/_layout.tsx` -- and a third (a
   * manual retry, a reconnect signal) is one feature away. A `useRef` guard
   * inside a calling component only ever protects that component from
   * ITSELF: a second caller elsewhere sails straight past it, which is
   * exactly the case the guard exists for. The invariant is a property of
   * the flush ("at most one pass in flight"), so it belongs with the flush.
   *
   * WHY IT COALESCES rather than skips. Returning the in-flight promise means
   * a second caller still gets a real completion to await, with the real
   * results, instead of a lie (`[]`) that reads as "nothing was owed".
   *
   * WHAT GOES WRONG WITHOUT IT: `orderedPending` is read at the START of a
   * pass, so an overlapping second pass sees the same op, and both run it.
   * `serialise` then chains them, so the second attempt observes the row the
   * first one created and takes the UPDATE branch -- no duplicate row, but a
   * second, entirely pointless round trip per queued op on every flush, and
   * a `markSynced`/`markFailed` applied to an op that is already gone.
   *
   * Consequence worth stating: a coalesced caller's `now` argument is
   * ignored (the in-flight pass keeps its own). Only tests pass `now`, and
   * they drive the backoff clock sequentially, awaiting each pass.
   */
  let flushInFlight: Promise<LogResult[]> | null = null;

  function publishSyncCounts() {
    set(() => ({
      pendingSyncCount: queuePendingCount(queueState),
      deadSyncCount: queueDeadCount(queueState),
    }));
  }

  /**
   * Runs one queued/live write through `attemptWrite`, classifying the
   * outcome back into the queue:
   *  - success                          -> `markSynced` (nothing left to do)
   *  - a real `{ error }` response      -> `markFailed(..., 'rejected')`
   *    (counts toward the terminal budget; still returned to the caller
   *    exactly as before -- this is what keeps `logHabitErrorsSurfaced`
   *    (commit 8a04c04) true)
   *  - a THROWN/rejected call           -> `markFailed(..., 'network')`
   *    (does not count; the op stays pending for the next attempt)
   *
   * The network/rejected split is the one interpretive call this task's
   * mocks-only constraint requires: no live Supabase call exists to observe
   * directly, so the rule adopted -- documented once, here -- is "a normal
   * `{ data, error }` response means the server was reached, so any error in
   * it is a real rejection; a thrown exception means the request never got a
   * response, i.e. connectivity". Every EXISTING test's fake client only
   * ever returns `{ error }` and never throws, so this is additive: those
   * tests keep exercising the untouched `try` path and their asserted
   * behaviour is unchanged.
   */
  async function runAttempt(
    habitId: string,
    dateStr: string,
    op: SyncOp,
    patch: Patch,
    now?: number,
  ): Promise<LogResult> {
    try {
      const result = await attemptWrite(set, get, habitId, dateStr, patch);
      queueState = result.ok
        ? markOpSynced(queueState, op.id)
        : markOpFailed(queueState, op.id, 'rejected', { error: result.error, now });
      await saveSyncQueue(queueState);
      publishSyncCounts();
      return result;
    } catch {
      queueState = markOpFailed(queueState, op.id, 'network', { now });
      await saveSyncQueue(queueState);
      publishSyncCounts();
      throw new Error('__offline__'); // caller distinguishes network from a real result
    }
  }

  /**
   * The body of one flush pass. Extracted from `flushPendingSync` UNCHANGED
   * -- only the re-entrancy wrapper is new -- so that the guard has something
   * to wrap without the guard's own bookkeeping ending up interleaved with
   * the replay loop.
   */
  async function runFlushPass(now?: number): Promise<LogResult[]> {
    const ready = orderedPending(queueState, now);
    const results: LogResult[] = [];
    for (const op of ready) {
      const patch = toPatch(op.intent);

      // Re-show optimistic state for anything a previous session queued but
      // never confirmed -- "nothing lost" across a restart, not just "not
      // duplicated".
      const priorLocal = get().getLogForHabit(op.habitId, op.date);
      if (!priorLocal) {
        set((s) => replaceLogForKey(s, op.habitId, op.date, buildOptimisticLog(op.habitId, op.date, patch, undefined)));
      }

      const key = `${op.habitId}|${op.date}`;
      try {
        const result = await serialise(key, () => runAttempt(op.habitId, op.date, op, patch, now));
        results.push(result);
      } catch {
        // Still offline -- op remains pending (see runAttempt's 'network'
        // classification); nothing else to do this pass.
        results.push({ ok: false, error: 'Ağ bağlantısı yok, tekrar denenecek.' });
      }
    }
    return results;
  }

  return {
    logs: [],
    loading: false,
    pendingSyncCount: 0,
    deadSyncCount: 0,

    fetchLogsForDate: async (date) => {
      set({ loading: true });
      const dateStr = typeof date === 'string' ? date : ymd(date);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { set({ loading: false }); return; }

      const { data, error } = await supabase
        .from('habit_logs')
        .select(COLS)
        .eq('user_id', user.id)
        .eq('completed_at', dateStr);

      if (!error && data) set({ logs: data as HabitLog[] });
      set({ loading: false });
    },

    logHabit: ({ habitId, date, state, value, targetValue, baseXp = 30, targetDirection }) => {
      const dateStr = ymd(date);
      const key = `${habitId}|${dateStr}`;
      const intent: HabitLogIntent = { state, value, targetValue, baseXp, targetDirection };
      const patch = toPatch(intent);

      // 1) Optimistic local update -- synchronous, no I/O. Plan §18: "local
      //    optimistic state -> UI immediately updates", before any network.
      const priorLocal = get().getLogForHabit(habitId, dateStr);
      const optimisticLog = buildOptimisticLog(habitId, dateStr, patch, priorLocal);
      const myGen = ++optimisticGenSeq;
      optimisticGen.set(key, myGen);
      set((s) => replaceLogForKey(s, habitId, dateStr, optimisticLog));

      // 2) Enqueue the intent (collapses onto any pending op for this key --
      //    see lib/syncQueue.ts's `enqueue` doc) and persist BEFORE
      //    attempting the network call, so the intent is durable even if the
      //    app is killed the instant after this tap.
      const enq = enqueueOp(queueState, habitId, dateStr, intent);
      queueState = enq.state;
      publishSyncCounts();
      const persisted = saveSyncQueue(queueState);

      // 3) Attempt to sync now, through the EXISTING serialise() chain,
      //    unchanged -- this is what still gives a same-session double-tap
      //    exactly one insert.
      return serialise(key, async (): Promise<LogResult> => {
        await persisted;
        try {
          return await runAttempt(habitId, dateStr, enq.op, patch);
        } catch {
          // Network failure: the tap is NOT an error from the user's point of
          // view -- it is queued, and stays optimistically applied. Only a
          // REAL rejection rolls the optimistic value back (below).
          return { ok: true, log: optimisticLog };
        }
      }).then((result) => {
        if (!result.ok && optimisticGen.get(key) === myGen) {
          set((s) => rollbackTo(s, habitId, dateStr, priorLocal));
        }
        // 4) §22 event, emitted here rather than at the top of `logHabit` for
        //    one reason: `result.ok` is what separates a completion that
        //    STANDS from one that was rejected and rolled back a line above.
        //    Emitting on the tap would count completions the user never got.
        //
        //    Offline still counts. An offline tap resolves `{ ok: true }`
        //    with the optimistic log (see the catch inside the chain), which
        //    is the honest reading under plan §18: the tap IS the completion,
        //    the write is just owed. `flushPendingSync` deliberately does NOT
        //    emit, so replaying that owed write later cannot double-count the
        //    same completion.
        if (result.ok) emitHabitLogEvent(habitId, dateStr, state, patch);
        return result;
      });
    },

    getLogForHabit: (habitId, date) => {
      if (!date) {
        return get().logs.find((l) => l.habit_id === habitId);
      }
      const dateStr = typeof date === 'string' ? date : ymd(date);
      return get().logs.find((l) => l.habit_id === habitId && l.completed_at === dateStr);
    },

    getRemainingValue: (habitId, targetValue, date) => {
      const log = get().getLogForHabit(habitId, date);
      const done = log?.value ?? 0;
      return Math.max(0, targetValue - done);
    },

    getSyncStatusFor: (habitId, date) => {
      const dateStr = typeof date === 'string' ? date : ymd(date);
      return queueStatusFor(queueState, habitId, dateStr);
    },

    hydrateSyncQueue: async () => {
      queueState = await loadSyncQueue();
      publishSyncCounts();
    },

    flushPendingSync: (now) => {
      // See `flushInFlight`'s doc above for why this guard is here and not in
      // the caller. The `finally` cannot clear a LATER pass by mistake: while
      // `flushInFlight` is set, every caller is handed that same promise, so
      // no second pass can exist to overwrite.
      if (flushInFlight) return flushInFlight;
      const pass = runFlushPass(now).finally(() => { flushInFlight = null; });
      flushInFlight = pass;
      return pass;
    },
  };
});
