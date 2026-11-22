import { registerAccountScoped } from '../lib/accountScope';
import { createLatestByKey } from '../lib/latestOnly';
import { currentUser } from '../lib/session';
import { create } from 'zustand';
import type { HabitLog } from '../lib/supabase';
import { ymd, todayLocal, deviceTimeZone, isLoggableDay } from '../lib/date';
import { LOGGABLE_DAY_MESSAGE } from '../lib/pgErrors';
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
  dequeue,
  mergeOps,
  revive,
  deadOps,
  nextReadyAt,
  type SyncQueueState,
  type SyncOp,
  type HabitLogIntent,
} from '../lib/syncQueue';
import { reportError } from '../lib/crashReporting';
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
  | { ok: false; error: string; offline?: boolean; retryable?: boolean };

/** F05: what a write that nobody owns returns: no queue to keep it in, no false success. */
export const NO_SESSION_ERROR = 'Oturum bulunamadı. Giriş yapıp tekrar dene.';

/** UI-facing sync status for one (habit, day) key -- see `getSyncStatusFor`. */
export type HabitSyncStatus = 'synced' | 'pending' | 'dead';


type LogStore = {
  logs: HabitLog[];
  loading: boolean;
  logsError: string | null;
  /** Ops with status 'pending' across ALL habits/days -- drives a global "syncing" indicator. */
  pendingSyncCount: number;
  /** Ops that exhausted their retry budget (plan §18's terminal state) -- surfaced, not hidden. */
  deadSyncCount: number;
  /** Yalnız kendi gününü değiştirir; başka günlerin satırlarını ve uçuştaki/bekleyen yerel dokunuşları korur. */
  fetchLogsForDate: (date: Date | string) => Promise<void>;
  applyFetchedDay: (dateStr: string, rows: readonly HabitLog[]) => void;
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
    note?: string | null;
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
  /**
   * F05 (SYN-01, STO-02, SYN-V01): binds the queue to the signed-in account. The previous owner's
   * remaining work is saved under ITS key, the new owner's queue is loaded from disk, taps made while
   * nobody owned the queue are stamped and merged, and a flush follows. Calls are serialised and the
   * last one wins. The same user again is a no-op (an in-memory tap is never overwritten).
   */
  rebindSyncQueue: (userId: string | null) => Promise<void>;
  /** F05 (SYN-03): a `dead` op the user asked to try again. */
  reviveSyncOp: (opId: string) => Promise<void>;
  /** F05 (SYN-03): a `dead` op the user gave up; the day's row is reconciled with the server. */
  dropSyncOp: (opId: string) => Promise<void>;
  deadSyncOps: () => SyncOp[];
  /** F05 (SYN-15): the soonest explicit retry time of a pending op (for the sync coordinator). */
  nextSyncReadyAt: () => number | null;
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
const dayLatest = createLatestByKey();

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
  const { xp: _serverOwned, notes: _privateNote, ...displayable } = patch;
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
  ctx: { priorState?: SyncOp['priorState']; deliveryKey?: string } = {},
): Promise<LogResult> {
  // An optimistic placeholder is a guess, not a confirmed row to update.
  const existing = get().getLogForHabit(habitId, dateStr);
  const confirmed = existing && !isLocalPlaceholder(existing) ? existing : undefined;

  const res = await persistCompletion({
    habitId, dateStr, patch, confirmedId: confirmed?.id,
    // F05 (DOM-21, SYN-26): the webhook announces only a real transition into `done`, once per queued write
    priorState: ctx.priorState, deliveryKey: ctx.deliveryKey,
  });
  // `retryable` only when it is true: every other failure keeps exactly the shape it had before F05
  if (!res.ok) return { ok: false, error: res.error, offline: res.offline, ...(res.retryable ? { retryable: true } : {}) };

  set((s) => replaceLogForKey(s, res.log.habit_id, res.log.completed_at, res.log));
  return { ok: true, log: res.log };
}

/**
 * F04 (STO-01): the queue state lives inside the `create` closure, so the account registry cannot reach
 * it directly. The closure assigns this function; the registry calls it. Memory only: the queue on disk
 * (`atlas_sync_queue_v1:<uid>`) is saved after every mutation and stays for the same account.
 */
let resetQueueMemory: (keepOnDisk: boolean) => void = () => undefined;

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
  /**
   * F05: +1 on every change of owner. A write in flight across that change finds a different epoch
   * when it returns and leaves the (new owner's) queue alone; its op is still pending under its own
   * account's key and is replayed when that account returns (idempotent through the 23505 path).
   */
  let queueEpoch = 0;
  /** F05: owner changes run one after another; the last call wins. */
  let rebindChain: Promise<void> = Promise.resolve();
  resetQueueMemory = (keepOnDisk) => {
    // F05: what the leaving account still owes is written under ITS key before memory is cleared;
    // a deleted account's queue is not (the device sweep removes its key right after)
    if (keepOnDisk && queueOwnerId) void saveSyncQueue(queueState, queueOwnerId);
    queueEpoch += 1;
    queueOwnerId = null;
    queueState = emptyQueueState();
    flushInFlight = null;
  };

  /** One owner change (see `rebindSyncQueue`). `force` reloads the same owner from disk (boot hydration). */
  async function applyOwner(userId: string | null, force: boolean): Promise<void> {
    if (userId === queueOwnerId && !force) return;
    queueEpoch += 1;
    const epoch = queueEpoch;
    const oldOwner = queueOwnerId;
    const oldState = queueState;
    if (oldOwner && oldOwner !== userId) await saveSyncQueue(oldState, oldOwner);
    // taps made while nobody owned the queue: they belong to whoever signs in now
    const ownerless = oldOwner === null ? oldState.ops.filter((o) => !o.userId) : [];
    queueOwnerId = userId;
    queueState = emptyQueueState();
    flushInFlight = null;
    publishSyncCounts();
    if (!userId) return;
    const loaded = await loadSyncQueue(userId);
    if (epoch !== queueEpoch) return; // a newer owner change has started
    // taps made while the queue was loading are already stamped with this owner and win their key
    queueState = mergeOps(loaded, [...ownerless, ...queueState.ops], userId);
    if (queueState.ops.length !== loaded.ops.length || ownerless.length > 0) await saveSyncQueue(queueState, userId);
    publishSyncCounts();
    // A real owner change sends the new owner's waiting work at once. The boot load (`force`) does
    // not: the boot sequence flushes explicitly right after hydration (app/_layout.tsx, AC-W03),
    // and `hydrateSyncQueue` stays a pure "load what is on disk".
    if (!force) void get().flushPendingSync();
  }

  function enqueueOwnerChange(userId: string | null, force: boolean): Promise<void> {
    const run = rebindChain.then(() => applyOwner(userId, force), () => applyOwner(userId, force));
    rebindChain = run.catch(() => undefined);
    return run;
  }

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
    const epoch = queueEpoch;
    try {
      const result = await attemptWrite(set, get, habitId, dateStr, patch, { priorState: op.priorState, deliveryKey: op.id });
      // F05: the owner changed while this was in flight: the queue in memory is someone else's now
      if (epoch !== queueEpoch) return result;

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

      // F05 (SYN-03): a transient server failure (408/425/429/5xx) keeps the tap like a lost
      // connection does, and waits for its backoff without spending an attempt
      if (!result.ok && result.retryable) {
        queueState = markOpFailed(queueState, op.id, 'retryable', { error: result.error, now });
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
      if (epoch !== queueEpoch) throw new Error('__offline__'); // F05: not this owner's queue any more
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
    // F05 (SYN-V01): stamped ops only. An unstamped op is stamped when an owner adopts it
    // (`rebindSyncQueue`); it is never replayed on the way.
    const ready = queueOwnerId
      ? all.filter((op) => op.userId === queueOwnerId)
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
      const isProtected = (habitId: string) =>
        chains.has(`${habitId}|${dateStr}`) || queueStatusFor(queueState, habitId, dateStr) === 'pending';
      set((s) => ({ logs: mergeDayLogs(s.logs, dateStr, rows, isProtected) }));
    },

    logHabit: ({ habitId, date, state, value, targetValue, baseXp = 30, targetDirection, note }) => {
      const dateStr = ymd(date);
      // F03 — a day outside the loggable window (today and the previous 14 days)
      // is refused HERE, before the optimistic row and before the queue: the
      // server (migration 038) would refuse it on every replay until the op went
      // `dead`, while the user believed it saved. Local clock only, so it works
      // offline too.
      if (!isLoggableDay(dateStr)) return Promise.resolve({ ok: false, error: LOGGABLE_DAY_MESSAGE });
      const key = `${habitId}|${dateStr}`;
      // R01.06 — the zone is captured now, at the tap, and queued with the intent.
      const tz = deviceTimeZone();
      const intent: HabitLogIntent = {
        state,
        value,
        targetValue,
        baseXp,
        targetDirection,
        ...(tz ? { tz } : {}),
        ...(note !== undefined ? { note } : {}),
      };

      // 1) Optimistic local update + queue collapse (preserves prior queued note if omitted).
      const priorLocal = get().getLogForHabit(habitId, dateStr);
      const enq = enqueueOp(queueState, habitId, dateStr, intent, {
        userId: queueOwnerId ?? undefined,
        priorState: priorLocal?.state ?? null,
      });
      const patch = toPatch(enq.op.intent);
      const optimisticLog = buildOptimisticLog(habitId, dateStr, patch, priorLocal);
      const myGen = ++optimisticGenSeq;
      optimisticGen.set(key, myGen);
      set((s) => replaceLogForKey(s, habitId, dateStr, optimisticLog));

      // 2) Persist collapsed queue BEFORE attempting the network call.
      queueState = enq.state;
      publishSyncCounts();
      // F05 (SYN-01): no owner yet (the app booted signed out): bind to the session first, then save
      // under that account. An owner change in progress finishes before this save.
      const persisted = (async (): Promise<boolean> => {
        await rebindChain;
        if (queueOwnerId === null) {
          const u = await currentUser();
          if (u) await get().rebindSyncQueue(u.id);
        }
        if (!queueOwnerId) return false;
        const saved = await saveSyncQueue(queueState, queueOwnerId);
        // the tap stays in memory and is tried now; only the disk copy failed, which the user cannot fix
        if (!saved) reportError(new Error('habit log queue could not be saved'), 'manual', 'queue-save');
        return saved;
      })();

      // 3) Attempt to sync now, through the EXISTING serialise() chain,
      //    unchanged -- this is what still gives a same-session double-tap
      //    exactly one insert.
      return serialise(key, async (): Promise<LogResult> => {
        await persisted;
        if (queueOwnerId === null) {
          // really no session: nothing can keep this tap, so it is not pretended to be saved (SYN-01)
          queueState = dequeue(queueState, enq.op.id);
          publishSyncCounts();
          return { ok: false, error: NO_SESSION_ERROR };
        }
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
      const dateStr = date === undefined ? todayLocal() : typeof date === 'string' ? date : ymd(date);
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
      // No session means no account to load a queue for. Loading the previous
      // account's queue here is exactly the cross-account bug this guards.
      // F05: the boot load goes through the same serialised owner change as a
      // rebind; it keeps its contract of replacing memory with what is on disk
      // for the current account (`force`), which a plain rebind does not.
      const user = await currentUser();
      await enqueueOwnerChange(user?.id ?? null, true);
    },

    rebindSyncQueue: (userId) => enqueueOwnerChange(userId, false),

    reviveSyncOp: async (opId) => {
      queueState = revive(queueState, opId);
      if (queueOwnerId) await saveSyncQueue(queueState, queueOwnerId);
      publishSyncCounts();
      void get().flushPendingSync();
    },

    dropSyncOp: async (opId) => {
      const op = queueState.ops.find((o) => o.id === opId);
      if (!op) return;
      queueState = dequeue(queueState, opId);
      if (queueOwnerId) await saveSyncQueue(queueState, queueOwnerId);
      publishSyncCounts();
      // the optimistic row of the given-up change goes; the server's row for
      // that day (if there is one) comes back in its place
      const res = await loadDay(op.date);
      if (!res.ok) return;
      const serverRow = res.logs.find((l) => l.habit_id === op.habitId);
      set((s) => (serverRow
        ? replaceLogForKey(s, op.habitId, op.date, serverRow)
        : rollbackTo(s, op.habitId, op.date, undefined)));
    },

    deadSyncOps: () => deadOps(queueState),

    nextSyncReadyAt: () => nextReadyAt(queueState),

    flushPendingSync: (now) => {
      // See `flushInFlight`'s doc above for why this guard is here and not in
      // the caller. F05: an owner change clears `flushInFlight` while a pass
      // may still be running, so the `finally` clears it only if it is still
      // this pass (it never clears a LATER pass).
      if (flushInFlight) return flushInFlight;
      const pass: Promise<LogResult[]> = runFlushPass(now).finally(() => {
        if (flushInFlight === pass) flushInFlight = null;
      });
      flushInFlight = pass;
      return pass;
    },
  };
});

// F04 (STO-20): the store, the per-key write chains, the optimistic generations and the queue in memory.
registerAccountScoped({
  name: 'log',
  store: useLogStore,
  onReset: (reason) => {
    chains.clear();
    dayLatest.invalidate();
    optimisticGen.clear();
    resetQueueMemory(reason !== 'account_deleted');
  },
});
