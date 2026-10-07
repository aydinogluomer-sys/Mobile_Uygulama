/**
 * Recovery plans.  (plan §8 service layer, §9 recovery engine)
 *
 * Creating a plan is three things that must agree: a persisted row, a
 * scheduled reminder, and an analytics event that must not fire unless the
 * row exists. Completing one is two writes across different tables — the
 * plan's status and the habit log that proves the make-up happened.
 *
 * The store previously did all of it inline, which is why the reminder was
 * cancelled and the plan removed from the list before anyone checked whether
 * the write had succeeded.
 */
import type { Habit, RecoveryPlan, RecoveryStrategy } from '../lib/supabase';
import { isMeasurableTracking } from '../lib/habitEngine';
// R01.03-a's one place where an amount becomes a state. KD-12: the make-up
// paths go through it too, so a recovery row can never say `done` while its
// value says 0%.
import { measuredEntryFor } from './habitLogService';
import {
  deleteRecoveryPlan,
  fetchPlannedRecoveryPlans,
  insertRecoveryPlan,
  setRecoveryPlanStatus,
} from '../repositories/recoveryRepository';

export const listPlannedPlans = () => fetchPlannedRecoveryPlans();

export type CreatePlanInput = {
  habitId: string;
  sourceDate: string;
  targetDate: string;
  /** Was `string`, which let any spelling through to a CHECK that would
   *  reject it at runtime. */
  strategy: RecoveryStrategy;
  note?: string | null;
  reminderTime?: string | null;
  /** What the plan answers and how much of it — see insertRecoveryPlan. */
  sourceLogId?: string | null;
  deficitType?: 'numeric' | 'binary' | null;
  deficitValue?: number | null;
  distributedDays?: { date: string; value: number }[] | null;
};

export const createPlan = (input: CreatePlanInput) => insertRecoveryPlan(input);

/**
 * Marks a plan done.
 *
 * Returns the outcome rather than assuming it: the caller cancels the
 * reminder and drops the row from the list ONLY on success, because a plan
 * that is still `planned` on the server with no reminder scheduled is worse
 * than one the user has to complete twice.
 */
// 'done' and 'skipped' were the LEGACY spellings. The table now accepts only
// the v2 vocabulary, so these two calls would have been rejected at runtime —
// TypeScript could not see it while the parameter was a loose union of both.
export const completePlan = (id: string) => setRecoveryPlanStatus(id, 'completed');
export const skipPlan = (id: string) => setRecoveryPlanStatus(id, 'cancelled');
export const removePlan = (id: string) => deleteRecoveryPlan(id);

/** True when a plan's target day has passed without completion. */
export function isOverdue(plan: Pick<RecoveryPlan, 'target_date' | 'status'>, today: string): boolean {
  return plan.status === 'planned' && plan.target_date < today;
}

/**
 * Does a make-up for this habit need an AMOUNT from the user?
 *
 * KD-12: it does for every measurable habit with a target, and the amount is
 * asked for rather than invented (owner decision, 2026-10-07). The old code
 * wrote `done` with no value, which every ratio reader scores 0% -- the user
 * caught up and their completion rate counted it as nothing.
 */
export function makeupNeedsValue(
  habit: Pick<Habit, 'tracking_type' | 'daily_goal'> | undefined,
): boolean {
  return !!(habit && isMeasurableTracking(habit.tracking_type) && habit.daily_goal);
}

/**
 * What to prefill the amount prompt with. A reduced strategy suggests half the
 * target -- a suggestion the user can overwrite, not a number written on their
 * behalf. `null` when the habit needs no amount.
 */
export function makeupSuggestedValue(
  plan: Pick<RecoveryPlan, 'strategy'>,
  habit: Pick<Habit, 'tracking_type' | 'daily_goal'> | undefined,
): number | null {
  if (!makeupNeedsValue(habit)) return null;
  const goal = habit!.daily_goal as number;
  return plan.strategy === 'split_two_days' ? Math.max(1, Math.round(goal * 0.5)) : goal;
}

/**
 * What a make-up logs for a habit that carries NO amount (boolean/abstinence).
 *
 * `split_two_days` is deliberately a PARTIAL completion — the point of the
 * recovery engine is that a reduced version still counts, so recording it as
 * `done` would inflate the streak and the XP for work that was not done.
 *
 * KD-12 — measurable habits no longer come through here. They used to, and it
 * produced rows that contradicted themselves: `done` with no value (0% to
 * `completionRatio`), and `partial` with `value = round(goal * 0.5)` which for
 * a goal of 1 is the whole goal (`stateForValue` says `done`). For those,
 * `completePlanWithMakeup` asks for the amount and derives the state from it,
 * so the two can never disagree. `makeupNeedsValue` is the gate.
 */
export function makeupFor(
  plan: Pick<RecoveryPlan, 'strategy'>,
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'> | undefined,
): { state: 'done' | 'partial'; value?: number } {
  // Only `split_two_days` is a REDUCED make-up: the day's work is spread
  // over two days, so completing one of them is a partial. The legacy
  // spelling of this rule was `half || mini`, where `mini` meant "a 2-minute
  // token effort" -- a third size that v2 does not have. Reading `skip` as
  // reduced would be worse than wrong: `skip` means the user declined, so
  // there is no make-up to size at all.
  const reduced = plan.strategy === 'split_two_days';
  if (!reduced) return { state: 'done' };

  const measurable = habit && isMeasurableTracking(habit.tracking_type) && habit.daily_goal;
  if (!measurable) return { state: 'partial' };

  const share = 0.5;
  return { state: 'partial', value: Math.max(1, Math.round((habit!.daily_goal as number) * share)) };
}

export type CompleteWithMakeupResult =
  | { ok: true }
  | { ok: false; error: string; stage: 'log' | 'plan' };

/**
 * Completes a plan by logging the make-up FIRST, then marking the plan done.
 *
 * The order is the invariant. Marking the plan complete without a log leaves
 * the two permanently contradicting each other — the plan says the user
 * caught up, and there is no completion anywhere to show for it (finding
 * N-04). So the log is written first and the plan is only closed if it
 * succeeded; the reverse failure is recoverable, this one is not.
 */
export async function completePlanWithMakeup(params: {
  plan: Pick<RecoveryPlan, 'id' | 'habit_id' | 'strategy' | 'target_date'>;
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'> | undefined;
  writeLog: (input: {
    habitId: string;
    date: Date;
    // `miss` is reachable on the measurable path and is deliberately not
    // narrowed away: a ceiling habit made up with an amount OVER its limit
    // was a missed day, and saying otherwise is the contradiction KD-12 is
    // about. `skip` is in the union only because `CompletionIntent` carries the
    // full log-state type; neither make-up path can produce it.
    // The non-measurable path still only ever produces done/partial.
    state: 'done' | 'partial' | 'miss' | 'skip';
    value?: number;
    targetValue?: number;
    targetDirection?: 'at_least' | 'at_most';
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * KD-12 — the amount the user entered for a measurable habit, and the value
   * already on the target day's row. Required when `makeupNeedsValue(habit)`;
   * ignored otherwise. `enteredValue` is an ADDITION to `priorDayValue`, the
   * same contract the measurable modal and `timeline` use (R01.03-a).
   */
  enteredValue?: number;
  priorDayValue?: number | null;
}): Promise<CompleteWithMakeupResult> {
  const needsValue = makeupNeedsValue(params.habit);
  if (needsValue && typeof params.enteredValue !== 'number') {
    // Caller bug, not a user error: the screen must ask first. Failing here
    // beats inventing a number, which is exactly what KD-12 was.
    return { ok: false, error: 'Bu alışkanlık için miktar gerekiyor.', stage: 'log' };
  }

  // Measurable: the amount decides the state (`measuredEntryFor` -> `stateForValue`),
  // so the row can never say `done` while its value reads 0%. Non-measurable:
  // `makeupFor`, where `split_two_days` is still a deliberate `partial`.
  const { state, value } = needsValue
    ? measuredEntryFor(params.habit!, params.priorDayValue ?? null, params.enteredValue as number)
    : makeupFor(params.plan, params.habit);
  const [y, mo, d] = params.plan.target_date.split('-').map(Number);

  const logged = await params.writeLog({
    habitId: params.plan.habit_id,
    date: new Date(y, mo - 1, d),
    state,
    value,
    targetValue: params.habit?.daily_goal ?? undefined,
    targetDirection: params.habit?.target_direction ?? undefined,
  });
  if (!logged.ok) return { ok: false, error: logged.error ?? 'Kayıt oluşturulamadı.', stage: 'log' };

  const closed = await completePlan(params.plan.id);
  if (!closed.ok) return { ok: false, error: closed.error, stage: 'plan' };
  return { ok: true };
}
