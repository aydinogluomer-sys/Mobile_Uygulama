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
import { canActivate as capacityCanActivate, dailyLoad, habitsInRangeOn, habitLoadPoints, CAPACITY_CEILING_DEFAULT, type HabitLoadInput } from '../lib/capacity';
import { isPausedOn, type PauseInterval } from '../lib/habitPauses';
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

/**
 * R03.04 — today's load from the habits that actually carry one today: in
 * their date envelope (KD-08) and NOT on a dated break or holiday (R01.05),
 * the same rule Today uses to list them.
 */
function currentLoadOf(input: CapacityInput): number {
  const asOf = input.asOf ?? new Date();
  return dailyLoad({
    habits: habitsInRangeOn(input.activeHabits ?? [], asOf)
      .filter((h) => !isPausedOn(h as { pause_intervals?: readonly PauseInterval[] }, asOf)),
  }).normalised;
}

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
  /**
   * R03.04 — the user explicitly chose "Yine de etkinleştir". It overrides
   * the LOAD suggestion only; the day's willpower budget and missing/stale
   * data still refuse.
   */
  override?: boolean;
}): ActivationVerdict {
  if (params.stale) return { allowed: false, reason: 'stale' };
  const s = params.state;
  if (!s) return { allowed: false, reason: 'no_state' };
  if (s.used + params.cost > s.daily_budget) return { allowed: false, reason: 'over_budget' };

  if (params.override) return { allowed: true };

  if (!params.capacityInput) {
    return s.active_count < s.focus_capacity
      ? { allowed: true }
      : { allowed: false, reason: 'over_capacity' };
  }

  const currentLoad = currentLoadOf(params.capacityInput);
  const ok = capacityCanActivate({
    currentLoad,
    habit: params.capacityInput.habit,
    ceiling: params.capacityInput.ceiling,
  });
  return ok ? { allowed: true } : { allowed: false, reason: 'over_capacity' };
}

/**
 * R03.04 — why a habit is waiting, and how it can become active, in words the
 * waiting room shows. `canOverride` is true only for the load suggestion.
 */
export type ActivationExplanation = {
  verdict: ActivationVerdict;
  why: string;
  how: string;
  canOverride: boolean;
  /** 0..100 day-scale load, when the capacity rule was used. */
  currentLoad: number | null;
  incoming: number | null;
  ceiling: number;
};

export function explainActivation(params: {
  state: WillpowerStateRow | null;
  stale: boolean;
  cost: number;
  capacityInput?: CapacityInput;
}): ActivationExplanation {
  const verdict = evaluateActivation(params);
  const ceiling = params.capacityInput?.ceiling ?? CAPACITY_CEILING_DEFAULT;
  const currentLoad = params.capacityInput ? Math.round(currentLoadOf(params.capacityInput)) : null;
  const incoming = params.capacityInput ? Math.round(habitLoadPoints(params.capacityInput.habit)) : null;
  const base = { verdict, ceiling, currentLoad, incoming };
  if (verdict.allowed) {
    return { ...base, canOverride: false, why: 'Bugünkü kapasiten bunu taşıyabilir.', how: "Etkinleştir'e dokun." };
  }
  const s = params.state;
  switch (verdict.reason) {
    case 'stale':
    case 'no_state':
      return { ...base, canOverride: false, why: 'Bugünün irade verisi henüz yüklenmedi.', how: 'Sayfayı yenileyip tekrar dene.' };
    case 'over_budget':
      return {
        ...base, canOverride: false,
        why: `Bugünkü irade bütçesi yetmiyor: ${s!.used} + ${params.cost} > ${s!.daily_budget}.`,
        how: 'Yarın bütçe yenilenir; ya da aktif bir alışkanlığı beklemeye alarak irade geri kazan.',
      };
    case 'over_capacity':
      return {
        ...base, canOverride: true,
        why: currentLoad !== null
          ? `Bugünkü yük ${currentLoad}/100; bu alışkanlık +${incoming} ekler, önerilen sınır ${ceiling}.`
          : `Aktif alışkanlık sınırı dolu (${s!.active_count}/${s!.focus_capacity}).`,
        how: 'Aktif bir alışkanlığı beklemeye al — ya da istersen yine de etkinleştir.',
      };
  }
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
