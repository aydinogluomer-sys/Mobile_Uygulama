/**
 * Willpower capacity — the rule that decides whether a habit may be active.
 * (plan §8 service layer, §10 capacity engine)
 *
 * ## Why this is a service and not "just the store"
 *
 * Activation is a cross-aggregate decision: it reads today's willpower row,
 * the set of currently-active habits, and the load of the habit being
 * activated, and only then does it write to two different tables. That is
 * domain orchestration by definition, and it was previously split across
 * `willpowerStore.canActivate` (the rule), `habitStore.activateHabit` (the
 * sequencing) and three screens (which supplied the capacity input, or
 * forgot to).
 *
 * The store keeps today's row for rendering. The DECISION lives here.
 */
import { canActivate as capacityCanActivate, dailyLoad, habitsInRangeOn, type HabitLoadInput } from '../lib/capacity';
import {
  fetchOrCreateWillpowerState,
  updateWillpowerState,
  type WillpowerStateRow,
} from '../repositories/willpowerRepository';

/**
 * Exactly what `lib/capacity` needs, no more. Deliberately NOT `Habit`: the
 * load rule reads four fields, and widening the parameter to the full row
 * would let a caller believe the others matter.
 */
export type CapacityInput = {
  habit: HabitLoadInput;
  activeHabits?: HabitLoadInput[];
  ceiling?: number;
  /** KD-08 — activation is about today; defaults to now. See `habitsInRangeOn`. */
  asOf?: Date;
};

export type ActivationVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'no_state' | 'stale' | 'over_budget' | 'over_capacity' };

/**
 * May a habit costing `cost` be activated right now?
 *
 * Two independent ceilings, checked in order, because they fail for different
 * reasons and the caller wants to know which:
 *
 *  1. the daily willpower BUDGET — a hard spend limit for the day;
 *  2. the concurrent LOAD ceiling — how much can be carried at once.
 *
 * Without `capacityInput` the second falls back to the legacy fixed-slot
 * rule. That fallback exists because a half-loaded habit list would
 * UNDER-report load and wrongly permit an activation; callers that cannot
 * yet supply the real active set get the conservative rule rather than a
 * confident wrong answer.
 */
export function evaluateActivation(params: {
  state: WillpowerStateRow | null;
  stale: boolean;
  cost: number;
  capacityInput?: CapacityInput;
}): ActivationVerdict {
  if (params.stale) return { allowed: false, reason: 'stale' };
  const s = params.state;
  if (!s) return { allowed: false, reason: 'no_state' };
  if (s.used + params.cost > s.daily_budget) return { allowed: false, reason: 'over_budget' };

  if (!params.capacityInput) {
    return s.active_count < s.focus_capacity
      ? { allowed: true }
      : { allowed: false, reason: 'over_capacity' };
  }

  const currentLoad = dailyLoad({
    habits: habitsInRangeOn(params.capacityInput.activeHabits ?? [], params.capacityInput.asOf ?? new Date()),
  }).normalised;
  const ok = capacityCanActivate({
    currentLoad,
    habit: params.capacityInput.habit,
    ceiling: params.capacityInput.ceiling,
  });
  return ok ? { allowed: true } : { allowed: false, reason: 'over_capacity' };
}

export async function loadToday(date: string) {
  return fetchOrCreateWillpowerState(date);
}

/** Charges `cost` against today's budget and takes one capacity slot. */
export async function spend(state: WillpowerStateRow, cost: number) {
  return updateWillpowerState(state.state_date, {
    used: state.used + cost,
    active_count: state.active_count + 1,
  });
}

/** Returns `cost` and releases one slot, never going below zero. */
export async function refund(state: WillpowerStateRow, cost: number) {
  return updateWillpowerState(state.state_date, {
    used: Math.max(0, state.used - cost),
    active_count: Math.max(0, state.active_count - 1),
  });
}
