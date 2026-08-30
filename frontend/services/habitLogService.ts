/**
 * Habit completion — the domain operation.  (plan §8 service layer)
 *
 * ## What belongs here and what does not
 *
 * The store used to own all of this. That put four different kinds of
 * decision in one file: how a value becomes a state, how a state becomes XP,
 * how a write resolves against an existing row, and what the screen shows
 * while any of it is in flight. Only the last is UI state.
 *
 * What moved here:
 *   - deriving the log state from a value against its target AND direction
 *   - the XP the completion is worth
 *   - the insert / update / 23505-recovery decision
 *
 * What stayed in the store:
 *   - optimistic rows, the serialise chain, the offline queue, sync counts
 *
 * The split matters beyond tidiness: the write decision is shared by a live
 * tap and an offline replay, and both must reach the same answer. Having it
 * in one exported function makes that structural rather than a convention
 * two code paths happen to follow.
 */
import { notify } from './webhookService';
import type { Habit, HabitLog } from '../lib/supabase';
import {
  adaptTrackingType,
  completionRatio,
  deriveState,
  type TargetDirection,
} from '../lib/habitEngine';
import {
  fetchLogsForDate as repoFetchLogsForDate,
  findHabitLog as repoFindHabitLog,
  insertHabitLog as repoInsertHabitLog,
  updateHabitLog as repoUpdateHabitLog,
} from '../repositories/habitLogRepository';

export type LogState = HabitLog['state'];

/** The persisted shape of one completion. */
export type LogPatch = {
  state: LogState;
  value: number | null;
  xp: number;
  is_completed: boolean;
};

export type CompletionIntent = {
  state: LogState;
  value?: number;
  targetValue?: number;
  baseXp?: number;
  targetDirection?: TargetDirection;
};

export const DEFAULT_BASE_XP = 30;

/**
 * XP for one completion.
 *
 * A `done` day is worth the full base. A `partial` day is worth the base
 * scaled by the completion ratio — which is where `direction` matters: for a
 * ceiling ("at most 2"), an at_least ratio clamps any overshoot to 1 and
 * would award FULL XP for exceeding the limit.
 *
 * Anything else is worth nothing. `miss` and `skip` are not partial credit.
 */
export function xpFor(intent: CompletionIntent): number {
  const base = intent.baseXp ?? DEFAULT_BASE_XP;
  if (intent.state === 'done') return base;
  if (intent.state !== 'partial') return 0;
  const measurable = intent.targetValue != null && intent.targetValue > 0;
  const ratio = completionRatio({
    trackingType: measurable ? 'numeric' : 'binary',
    state: intent.state,
    value: intent.value,
    target: intent.targetValue,
    direction: intent.targetDirection,
  });
  return Math.round(base * ratio);
}

/** Turns an intent into the row the database stores. */
export function toPatch(intent: CompletionIntent): LogPatch {
  return {
    state: intent.state,
    value: intent.value ?? null,
    xp: xpFor(intent),
    is_completed: intent.state === 'done',
  };
}

/**
 * The state a logged VALUE implies for a habit, given its own tracking type,
 * target and direction.
 *
 * Screens used to work this out themselves — `value >= remaining ? 'done' :
 * 'partial'`, which is floor arithmetic and calls a perfect ceiling day
 * partial. There is one answer and it lives here.
 */
export function stateForValue(
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>,
  value: number,
): 'done' | 'partial' | 'miss' {
  return deriveState({
    trackingType: adaptTrackingType(habit),
    value,
    target: habit.daily_goal,
    direction: habit.target_direction,
  });
}

/** Builds the full intent for logging `value` against `habit`. */
export function completionFor(
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>,
  value: number,
  baseXp = DEFAULT_BASE_XP,
): CompletionIntent {
  return {
    state: stateForValue(habit, value),
    value,
    targetValue: habit.daily_goal ?? undefined,
    targetDirection: habit.target_direction ?? undefined,
    baseXp,
  };
}

export type PersistResult =
  | { ok: true; log: HabitLog }
  | { ok: false; error: string };

/**
 * Writes one completion, resolving insert vs update against what is already
 * stored.
 *
 * `confirmedId` is the caller's existing CONFIRMED row for this (habit, day)
 * — never an optimistic placeholder, which is a guess and not something to
 * update against.
 *
 * The 23505 branch is the reason this is one function. A unique violation
 * means the row exists in the database but not in the caller's state: another
 * device wrote it, the date was never fetched, or an earlier session's write
 * landed before the app was killed and this is that same intent replaying.
 * Recovering and updating is what makes a cold-start replay idempotent
 * against `UNIQUE (habit_id, completed_at)` whether or not this process has
 * ever seen the row.
 */
/**
 * Tells the user's own automations that a habit was completed.
 *
 * Only for `done`. A partial or a miss is not a completion, and the legacy
 * service fired on the same condition, so an existing n8n flow keeps its
 * meaning. Never awaited -- see `notify` in webhookService.
 */
function announce(habitId: string, dateStr: string, log: HabitLog): void {
  if (log.state !== 'done') return;
  notify('habit_completed', {
    habit_id: habitId,
    date: dateStr,
    state: log.state,
    value: log.value ?? null,
  });
}

export async function persistCompletion(params: {
  habitId: string;
  dateStr: string;
  patch: LogPatch;
  confirmedId?: string;
}): Promise<PersistResult> {
  if (params.confirmedId) {
    const updated = await repoUpdateHabitLog(params.confirmedId, params.patch as Record<string, unknown>);
    if (!updated.ok) return { ok: false, error: updated.error };
    announce(params.habitId, params.dateStr, updated.data);
    return { ok: true, log: updated.data };
  }

  const inserted = await repoInsertHabitLog({
    habitId: params.habitId,
    dateStr: params.dateStr,
    patch: params.patch as Record<string, unknown>,
  });
  if (inserted.ok) {
    announce(params.habitId, params.dateStr, inserted.data);
    return { ok: true, log: inserted.data };
  }

  if (inserted.code === '23505') {
    const found = await repoFindHabitLog({ habitId: params.habitId, dateStr: params.dateStr });
    if (found.ok && found.data) {
      const updated = await repoUpdateHabitLog(found.data.id, params.patch as Record<string, unknown>);
      if (!updated.ok) return { ok: false, error: updated.error };
      announce(params.habitId, params.dateStr, updated.data);
      return { ok: true, log: updated.data };
    }
  }

  return { ok: false, error: inserted.error };
}

/** Every log for one local day, for the signed-in user. */
export async function loadDay(dateStr: string): Promise<
  { ok: true; logs: HabitLog[] } | { ok: false; error: string }
> {
  const res = await repoFetchLogsForDate(dateStr);
  return res.ok ? { ok: true, logs: res.data } : { ok: false, error: res.error };
}
