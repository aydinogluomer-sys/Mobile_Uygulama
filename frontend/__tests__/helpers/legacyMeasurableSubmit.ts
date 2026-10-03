/**
 * R01.03-a — `app/tabs/timeline.tsx`'s `handleMeasurableSubmit` decision as it
 * was at HEAD `5ef17bd` (lines 116-141), BEFORE this card.
 *
 * It was a closure over screen state, so it could not be called from a test.
 * The state expression and the `logHabit` argument object below are verbatim;
 * only the closure's inputs became parameters (`measureHabit`, the entered
 * `value`, and the day's prior logged value that `getRemainingValue` read --
 * `getRemainingValue` itself is inlined from store/logStore.ts:590-594,
 * `Math.max(0, targetValue - (log?.value ?? 0))`). Checked against
 * `git show 5ef17bd:frontend/app/tabs/timeline.tsx` when written.
 */
import type { Habit } from '../../lib/supabase';
import { adaptTrackingType, deriveState } from '../../lib/habitEngine';

export type LegacySubmitHabit = Pick<Habit, 'id' | 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>;

export function legacyMeasurableSubmit(
  measureHabit: LegacySubmitHabit,
  value: number,
  priorLoggedValue: number | null | undefined,
) {
  const getRemainingValue = (_id: string, targetValue: number) => Math.max(0, targetValue - (priorLoggedValue ?? 0));
  const direction = measureHabit.target_direction ?? 'at_least';
  const state =
    direction === 'at_most'
      ? deriveState({
          trackingType: adaptTrackingType(measureHabit),
          value,
          target: measureHabit.daily_goal,
          direction,
        })
      : value >= getRemainingValue(measureHabit.id, measureHabit.daily_goal ?? 0)
        ? 'done'
        : 'partial';
  return {
    habitId: measureHabit.id,
    state,
    value,
    targetValue: measureHabit.daily_goal ?? 0,
    targetDirection: direction,
  };
}
