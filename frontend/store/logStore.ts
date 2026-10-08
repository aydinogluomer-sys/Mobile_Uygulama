import { currentUser } from '../lib/session';
import { create } from 'zustand';
import type { HabitLog } from '../lib/supabase';
import { ymd, deviceTimeZone } from '../lib/date';
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
import {
  loadDay,
  persistCompletion,
  toPatch,
  type LogPatch,
} from '../services/habitLogService';

/**
 * What a write actually did. The previous signature was `Promise<void>` and
 * both branches destructured only `data`, so every failure -- RLS denial,
 * network drop, constraint violation -- was indistinguishable from success.
 */
export type LogResult =
  | { ok: true; log: HabitLog }
  /**
   * `offline` distinguishes "the request never reached the server" from "the
   * server refused it". `runAttempt` treats the two completely differently,
   * and until this flag existed it could not tell them apart — see
   * `isTransportFailure` in `repositories/shared.ts`.
   */
  | { ok: false; error: string; offline?: boolean };

/** UI-facing sync status for one (habit, day) key -- see `getSyncStatusFor`. */
export type HabitSyncStatus = 'synced' | 'pending' | 'dead';


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
// XP and the persisted patch are DOMAIN decisions and live in
// `services/habitLogService.ts`. They were here because this store was the
// only caller; leaving them here made the store the place that decided what a
// completion is worth, which is not UI state.

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
  // ── why `xp` is excluded from the optimistic row ──────────────────────
  //
  // XP is decided by the SERVER. `fn_habit_log_set_xp` overwrites whatever
  // the client sends, using the habit's difficulty, impact, behaviour and
  // tracking type; `xpFor` here knows none of that. The two disagree by a
  // lot — measured live: a plain binary `done` is 10 on the server and 30
  // by this formula, a 12/20 duration day is 6 against 18.
  //
  // `app/tabs/timeline.tsx` renders `+{log.xp}`, so showing the guess means
  // showing a number that is simply wrong until the write lands — and while
  // offline, that is not a flicker, it is however long the queue waits.
  //
  // So the optimistic row carries the last CONFIRMED xp (or none yet), and
  // the badge's own `xp > 0` guard hides it until the server has spoken.
  // The patch still sends `xp`, which the trigger ignores; the value is left
  // in place because `xpFor` is also the offline-queue's intent record and
  // is asserted by its own tests.
  const { xp: _serverOwned, ...displayable } = patch;
  if (priorLocal) return { ...priorLocal, ...displayable };
  return {
    id: `${LOCAL_ID_PREFIX}${habitId}|${dateStr}`,
    habit_id: habitId,
    // No confirmed row yet, so no real user id to carry -- nothing in this
    // codebase filters `logs` by `user_id` (see `getLogForHabit`), and this
    // placeholder is replaced by the DB-confirmed row the moment it lands.
    user_id: '',
    completed_at: dateStr,
    created_at: new Date().toISOString(),
    xp: 0,
    ...displayable,
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

/** The persisted shape of a completion — defined by the service. */
type Patch = LogPatch;

type SetState = (fn: (s: { logs: HabitLog[] }) => Partial<{ logs: HabitLog[] }>) => void;
type GetState = () => { logs: HabitLog[]; getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined };

/**
 * Writes one completion through the service and reconciles local state.
 *
 * The insert / update / 23505-recovery DECISION lives in
 * `services/habitLogService.persistCompletion`; what remains here is the part
 * that is genuinely the store's: replacing the optimistic row with the
 * confirmed one.
 */
async function attemptWrite(
  set: SetState,
  get: GetState,
  habitId: string,
  dateStr: string,
  patch: Patch,
): Promise<LogResult> {
  // An optimistic placeholder is a guess, not a confirmed row to update.
  const existing = get().getLogForHabit(habitId, dateStr);
  const confirmed = existing && !isLocalPlaceholder(existing) ? existing : undefined;

  const res = await persistCompletion({
    habitId, dateStr, patch, confirmedId: confirmed?.id,
  });
  if (!res.ok) return { ok: false, error: res.error, offline: res.offline };

  set((s) => replaceLogForKey(s, res.log.habit_id, res.log.completed_at, res.log));
  return { ok: true, log: res.log };
}

export const useLogStore = create<LogStore>((set, get) => {
  // In-memory mirror of the persisted queue. Replaced wholesale by
  // `hydrateSyncQueue()` (see that method's doc for the ordering contract),
  // mutated by every `logHabit`/`flushPendingSync` write attempt, and
  // persisted after every mutation so `pending sync` survives a restart.
  let queueState: SyncQueueState = emptyQueueState();
  /**
   * The account whose queue is currently loaded.
   *
   * The queue is persisted per account (`lib/syncQueue.ts`), and the replay
   * path resolves the user at FLUSH time. Without an owner recorded here, a
   * queue built by one account drains through whichever session happens to be
   * signed in later. Set by `hydrateSyncQueue`; `null` means nothing has been
   * hydrated yet and there is no account to persist against.
   */
  let queueOwnerId: string | null = null;

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
   *  - success                       -> `markSynced` (nothing left to do)
   *  - the server REFUSED the write  -> `markFailed(..., 'rejected')`
   *    (counts toward the terminal budget; still returned to the caller
   *    exactly as before -- this is what keeps `logHabitErrorsSurfaced`
   *    (commit 8a04c04) true)
   *  - the request never REACHED the server -> `markFailed(..., 'network')`
   *    (does not count; the op stays pending for the next attempt)
   *
   * ## The rule this used to use, and why it never fired
   *
   * The split was originally "a returned `{ error }` means the server was
   * reached; a THROWN call means connectivity". That was written under a
   * mocks-only constraint -- "no live Supabase call exists to observe
   * directly" -- and the mock duly threw. The real client does not:
   * supabase-js catches the transport error and returns
   * `{ data: null, error: { message: 'TypeError: Network request failed',
   * code: '' }, status: 0 }`, observed live against this project.
   *
   * So on a real device the `network` branch was unreachable and every
   * offline tap was counted as a server rejection: five of them exhausted
   * `MAX_ATTEMPTS` and the op went `dead` -- a completion the user logged,
   * silently dropped -- while each one also rolled the optimistic row back,
   * so the tap appeared to fail as it was made.
   *
   * The classification is now made on `result.offline`, which the repository
   * layer derives from the HTTP status rather than from the shape of the
   * failure. The `catch` is kept: a call that genuinely throws also never
   * got a response.
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

      // A lost connection arrives here as an ordinary `{ ok: false }`, NOT as
      // a throw — supabase-js catches the transport error itself. Treating it
      // as a rejection is what the `catch` below was written to avoid, so it
      // takes the same route: the attempt does not count, the op stays
      // pending, and the caller keeps its optimistic row.
      if (!result.ok && result.offline) {
        queueState = markOpFailed(queueState, op.id, 'network', { now });
        await saveSyncQueue(queueState, queueOwnerId ?? '');
        publishSyncCounts();
        throw new Error('__offline__');
      }

      queueState = result.ok
        ? markOpSynced(queueState, op.id)
        : markOpFailed(queueState, op.id, 'rejected', { error: result.error, now });
      await saveSyncQueue(queueState, queueOwnerId ?? '');
      publishSyncCounts();
      return result;
    } catch (e) {
      // Re-thrown from the offline branch above; the queue is already updated.
      if (e instanceof Error && e.message === '__offline__') throw e;
      queueState = markOpFailed(queueState, op.id, 'network', { now });
      await saveSyncQueue(queueState, queueOwnerId ?? '');
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
    const all = orderedPending(queueState, now);
    // Second line of defence behind the per-account storage key: an op that
    // names a different owner is never replayed, whatever is in memory. The
    // write path resolves the user at flush time, so replaying a foreign op
    // would attribute one account's offline work to another.
    const ready = queueOwnerId
      ? all.filter((op) => !op.userId || op.userId === queueOwnerId)
      : [];
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
      const res = await loadDay(dateStr);
      if (res.ok) set({ logs: res.logs });
      set({ loading: false });
    },

    logHabit: ({ habitId, date, state, value, targetValue, baseXp = 30, targetDirection }) => {
      const dateStr = ymd(date);
      const key = `${habitId}|${dateStr}`;
      // R01.06 — the zone is captured now, at the tap, and queued with the intent.
      const tz = deviceTimeZone();
      const intent: HabitLogIntent = { state, value, targetValue, baseXp, targetDirection, ...(tz ? { tz } : {}) };
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
      const persisted = saveSyncQueue(queueState, queueOwnerId ?? '');

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

    // DISPLAY ONLY ("3 kaldı"). Never a state input: the state of a measurable
    // day is derived from the day's TOTAL by services/habitLogService
    // (`measuredEntryFor` -> `stateForValue`). `value >= remaining` was floor
    // arithmetic on an increment and wrote `done` rows at 40% (R01.03-a).
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
      const user = await currentUser();
      // No session means no account to load a queue for. Loading the previous
      // account's queue here is exactly the cross-account bug this guards.
      if (!user) {
        queueOwnerId = null;
        queueState = emptyQueueState();
        publishSyncCounts();
        return;
      }
      queueOwnerId = user.id;
      queueState = await loadSyncQueue(user.id);
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
