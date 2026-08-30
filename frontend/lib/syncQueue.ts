/**
 * Offline habit-log sync queue.  (Phase 4, plan §18)
 *
 * THE PROBLEM THIS FILE SOLVES, stated once so every function below can stay
 * small and undocumented individually:
 *
 * `store/logStore.ts` already serialises writes with an in-memory
 * `Map<string, Promise<unknown>>` keyed `habitId|date` -- a second tap on the
 * same habit waits for the first write to settle, so it observes the row the
 * first one created and takes the update branch instead of inserting again.
 * That map is per-process. It is empty the instant the app restarts, so it
 * cannot be what makes a REPLAYED write safe after a cold start -- there is
 * nothing left to wait on. This module is the piece that survives the
 * restart: a persisted, ordered record of "what the user's last tap actually
 * intended", so that replaying it after the in-memory map is gone still
 * lands on the right row instead of a duplicate one.
 *
 * This module owns none of the actual insert/update decision -- that stays
 * in `logStore.ts`, which already has it (including the `23505`
 * unique-violation recovery that is the REAL backstop, per
 * `supabase/migrations/001_initial_schema.sql:34`'s `UNIQUE (habit_id,
 * date)`). What this module owns is: what is still owed, in what order, how
 * many times has it been tried, and when must it stop being tried.
 *
 * Pure by design -- no `supabase` import, no React, no timers. Every
 * function below takes a `SyncQueueState` and returns a new one (or, for the
 * two persistence functions at the bottom, a `Promise` around `AsyncStorage`
 * -- the only I/O in the file, kept separate and easy to skip in a unit
 * test). That is what makes the ordering/collapse/backoff rules fully
 * unit-testable without a fake network or a fake clock hidden inside a
 * store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Ymd } from './date';

/**
 * Deliberately NOT imported from `lib/supabase.ts`'s `HabitLog['state']`,
 * even though the two must stay in sync by hand. This file's brief is "no
 * supabase" -- keeping it to a standalone literal union means this module
 * has zero import edge, direct or transitive, to the supabase client.
 */
export type HabitLogState = 'done' | 'partial' | 'skip' | 'miss';

/** What a tap intended to write. Everything `logHabit` needs to redo the write. */
export type HabitLogIntent = {
  state: HabitLogState;
  value?: number;
  targetValue?: number;
  baseXp?: number;
  /**
   * Which side of `targetValue` counts as success. Absent means `at_least`,
   * which is what every log written before this field existed meant, so
   * queued ops persisted by an older build replay unchanged.
   *
   * It has to travel with the intent rather than be looked up at replay time:
   * a queued op is replayed later, possibly after the habit's target or
   * direction has been edited, and it must be scored as the day it describes.
   */
  targetDirection?: 'at_least' | 'at_most';
};

export type SyncOpStatus = 'pending' | 'dead';

/**
 * One queued write.
 *
 * `date` is the LOCAL day key (`lib/date.ts`'s `Ymd`) -- never a UTC one.
 * `seq` is the ordering key (see `orderedPending`'s doc); `createdAt` is
 * wall-clock, for display/debugging only, and is untouched by collapsing.
 * `updatedAt` DOES move on every collapse or attempt, so "this looks stuck"
 * is answerable without inspecting `attempts`.
 */
export type SyncOp = {
  id: string;
  habitId: string;
  date: Ymd;
  intent: HabitLogIntent;
  /** Count of REJECTED (server-reached-and-said-no) failures only. See `markFailed`. */
  attempts: number;
  status: SyncOpStatus;
  seq: number;
  createdAt: number;
  updatedAt: number;
  /** Not eligible for `orderedPending` before this time -- backoff after a rejection. */
  readyAt?: number;
  lastError?: string;
};

export type SyncQueueState = {
  ops: SyncOp[];
  /** Next `seq` to assign. Persisted so ordering survives a restart. */
  nextSeq: number;
};

export function emptyQueueState(): SyncQueueState {
  return { ops: [], nextSeq: 1 };
}

function genId(habitId: string, date: string): string {
  return `${habitId}|${date}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * ENQUEUE / COLLAPSE RULE.
 *
 * At most one op ever exists per `(habitId, date)` key. A second offline tap
 * on the same habit/day does not become a second op -- it overwrites the
 * FIRST op's `intent` in place, so N offline taps collapse to exactly one
 * write: the last one's. Replaying "tapped done, then partial(3), then
 * miss" as three writes would be wrong twice over -- it would re-derive two
 * states the user no longer wants, and it would do three round trips (three
 * chances to collide or fail) for one intended outcome.
 *
 * The collapsed op KEEPS its original `seq` (queue position), not a new one
 * at the tail. Ordering is therefore "when this KEY first entered the
 * queue", not "when it was last touched" -- so if habit A was tapped before
 * habit B, A replays before B even if A was tapped again (with a different
 * final state) after B. This is the one place ordering is a real design
 * decision rather than an obvious default, so it is called out here rather
 * than only in `orderedPending`'s doc.
 *
 * A revival also resets `attempts` to 0 and clears `status`/`lastError`,
 * including reviving a `dead` op. A fresh tap is a fresh user intent; making
 * it inherit a previous intent's exhausted retry budget would let today's
 * tap die from yesterday's unrelated error.
 */
export function enqueue(
  state: SyncQueueState,
  habitId: string,
  date: Ymd,
  intent: HabitLogIntent,
  opts: { id?: string; now?: number } = {},
): { state: SyncQueueState; op: SyncOp } {
  const now = opts.now ?? Date.now();
  const idx = state.ops.findIndex((o) => o.habitId === habitId && o.date === date);

  if (idx >= 0) {
    const prior = state.ops[idx];
    const revived: SyncOp = {
      ...prior,
      intent,
      attempts: 0,
      status: 'pending',
      lastError: undefined,
      readyAt: undefined,
      updatedAt: now,
    };
    const ops = state.ops.slice();
    ops[idx] = revived;
    return { state: { ...state, ops }, op: revived };
  }

  const op: SyncOp = {
    id: opts.id ?? genId(habitId, date),
    habitId,
    date,
    intent,
    attempts: 0,
    status: 'pending',
    seq: state.nextSeq,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, ops: [...state.ops, op], nextSeq: state.nextSeq + 1 }, op };
}

/** Removes an op entirely, whatever its status. The general-purpose primitive. */
export function dequeue(state: SyncQueueState, id: string): SyncQueueState {
  return { ...state, ops: state.ops.filter((o) => o.id !== id) };
}

/** A synced write has nothing left to retry -- there is nothing to do but remove it. */
export function markSynced(state: SyncQueueState, id: string): SyncQueueState {
  return dequeue(state, id);
}

/**
 * RETRY / BACKOFF / TERMINAL POLICY.
 *
 * `kind` distinguishes WHY the attempt did not confirm, and the two kinds
 * are handled on purpose differently:
 *
 * - `'network'` -- the write never reached the server (offline, DNS down,
 *   request timed out before a response). This is not the operation being
 *   wrong; it is the operation not having had its chance yet. It does NOT
 *   count against the attempt budget and the op stays `pending` with no
 *   backoff -- offline-first means a tap made on a plane must still sync the
 *   moment the plane lands, not "eventually give up because five attempts
 *   happened to occur while there was no signal".
 *
 * - `'rejected'` -- the server was reached and said no (validation, RLS,
 *   anything that comes back as a real `{ error }` rather than a thrown
 *   connectivity exception). THIS counts, because it is evidence about the
 *   operation itself, not about connectivity. `attempts` increments; once it
 *   reaches `MAX_ATTEMPTS` the op becomes `status: 'dead'` -- a TERMINAL
 *   state. A dead op is excluded from `orderedPending` (so a background
 *   flush stops hammering a write that can never succeed) but is NOT
 *   deleted -- `pendingCount`/`deadCount`/`statusFor` in `logStore.ts` are
 *   how the user finds out ("this failed to sync") rather than the app
 *   silently retrying forever or silently dropping the tap. A fresh tap on
 *   the same (habit, day) revives it (see `enqueue`) rather than requiring
 *   any special "un-stick" action.
 *
 * Backoff for a non-terminal rejection is exponential (`nextRetryDelayMs`),
 * so a flush loop does not hot-loop against a server that is genuinely
 * rejecting the write.
 */
export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

export function nextRetryDelayMs(attempts: number): number {
  const n = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** n, MAX_DELAY_MS);
}

export function markFailed(
  state: SyncQueueState,
  id: string,
  kind: 'network' | 'rejected',
  opts: { error?: string; now?: number } = {},
): SyncQueueState {
  const now = opts.now ?? Date.now();
  return {
    ...state,
    ops: state.ops.map((o) => {
      if (o.id !== id) return o;
      if (kind === 'network') {
        return { ...o, updatedAt: now };
      }
      const attempts = o.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      return {
        ...o,
        attempts,
        status: dead ? 'dead' : 'pending',
        lastError: opts.error,
        updatedAt: now,
        readyAt: dead ? undefined : now + nextRetryDelayMs(attempts),
      };
    }),
  };
}

/** The pending op for a (habit, day) key, if one is queued -- excludes `dead` ops. */
export function pendingFor(state: SyncQueueState, habitId: string, date: Ymd): SyncOp | undefined {
  return state.ops.find((o) => o.habitId === habitId && o.date === date && o.status === 'pending');
}

/** UI-facing tri-state for a (habit, day) key -- the "pending sync" flag `logStore` exposes. */
export function statusFor(state: SyncQueueState, habitId: string, date: Ymd): 'synced' | SyncOpStatus {
  const op = state.ops.find((o) => o.habitId === habitId && o.date === date);
  return op ? op.status : 'synced';
}

export function pendingCount(state: SyncQueueState): number {
  return state.ops.filter((o) => o.status === 'pending').length;
}

export function deadCount(state: SyncQueueState): number {
  return state.ops.filter((o) => o.status === 'dead').length;
}

/**
 * DETERMINISTIC ORDERING RULE.
 *
 * Ascending by `seq` -- the order each (habit, day) KEY first entered the
 * queue (see `enqueue`'s doc for why collapsing does not change `seq`).
 * `seq` is an integer counter threaded through `SyncQueueState`, not a
 * timestamp -- two taps in the same millisecond (trivial in a test, not
 * impossible on a fast device) would tie under `createdAt` and leave replay
 * order to whatever the sort happened to do with equal keys. A counter
 * cannot tie.
 *
 * `dead` ops are excluded (see `markFailed`'s doc); a `pending` op whose
 * `readyAt` has not arrived yet (backoff in effect) is excluded too.
 */
export function orderedPending(state: SyncQueueState, now: number = Date.now()): SyncOp[] {
  return state.ops
    .filter((o) => o.status === 'pending' && (o.readyAt ?? 0) <= now)
    .sort((a, b) => a.seq - b.seq);
}

// ---------------------------------------------------------------------------
// Persistence -- the only I/O in this file. (W2)
//
// Follows `store/themeStore.ts`'s established pattern: `load` never throws
// (a corrupt or unparseable payload is discarded in favour of a safe
// default, never allowed to crash boot), `save` is best-effort.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'atlas_sync_queue_v1';

function isValidOp(x: unknown): x is SyncOp {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.habitId !== 'string') return false;
  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return false;
  if (typeof o.attempts !== 'number' || typeof o.seq !== 'number') return false;
  if (typeof o.createdAt !== 'number' || typeof o.updatedAt !== 'number') return false;
  if (o.status !== 'pending' && o.status !== 'dead') return false;
  if (!o.intent || typeof o.intent !== 'object') return false;
  const intent = o.intent as Record<string, unknown>;
  if (!['done', 'partial', 'skip', 'miss'].includes(intent.state as string)) return false;
  return true;
}

function isValidQueueState(x: unknown): x is SyncQueueState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return typeof s.nextSeq === 'number' && Array.isArray(s.ops) && s.ops.every(isValidOp);
}

/**
 * Loads the persisted queue, or an empty one if there is nothing stored, the
 * stored value is not valid JSON, or it does not match the expected shape
 * (a corrupt payload is discarded rather than allowed to crash boot or
 * silently wedge the app with garbage ops).
 */
export async function loadSyncQueue(): Promise<SyncQueueState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyQueueState();
    const parsed: unknown = JSON.parse(raw);
    return isValidQueueState(parsed) ? parsed : emptyQueueState();
  } catch {
    return emptyQueueState();
  }
}

export async function saveSyncQueue(state: SyncQueueState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort, same posture as themeStore's persistence calls -- the
    // in-memory queue remains correct for this session even if the disk
    // write failed; the next successful save will catch it up.
  }
}
