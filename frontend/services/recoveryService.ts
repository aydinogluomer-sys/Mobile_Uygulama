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
import type { Habit, RecoveryPlan } from '../lib/supabase';
import { isMeasurableTracking } from '../lib/habitEngine';
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
  strategy: string;
  note?: string | null;
  reminderTime?: string | null;
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
export const completePlan = (id: string) => setRecoveryPlanStatus(id, 'done');
export const skipPlan = (id: string) => setRecoveryPlanStatus(id, 'skipped');
export const removePlan = (id: string) => deleteRecoveryPlan(id);

/** True when a plan's target day has passed without completion. */
export function isOverdue(plan: Pick<RecoveryPlan, 'target_date' | 'status'>, today: string): boolean {
  return plan.status === 'planned' && plan.target_date < today;
}

/**
 * What a make-up actually logs, given the strategy the user chose.
 *
 * `half` and `mini` are deliberately PARTIAL completions — the point of the
 * recovery engine is that a reduced version still counts, so recording them
 * as `done` would inflate the streak and the XP for work that was not done.
 * The value is derived from the habit's own target, never from the caller.
 */
export function makeupFor(
  plan: Pick<RecoveryPlan, 'strategy'>,
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'> | undefined,
): { state: 'done' | 'partial'; value?: number } {
  const reduced = plan.strategy === 'half' || plan.strategy === 'mini';
  if (!reduced) return { state: 'done' };

  const measurable = habit && isMeasurableTracking(habit.tracking_type) && habit.daily_goal;
  if (!measurable) return { state: 'partial' };

  const share = plan.strategy === 'half' ? 0.5 : 0.25;
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
    state: 'done' | 'partial';
    value?: number;
    targetValue?: number;
    targetDirection?: 'at_least' | 'at_most';
  }) => Promise<{ ok: boolean; error?: string }>;
}): Promise<CompleteWithMakeupResult> {
  const { state, value } = makeupFor(params.plan, params.habit);
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
