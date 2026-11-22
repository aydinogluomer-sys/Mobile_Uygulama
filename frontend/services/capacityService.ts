/**
 * Willpower capacity — the rule that decides whether a habit may be active.
 * (plan §8 service layer, §10 capacity engine; F14 REP-09, STO-15, INT-05)
 *
 * ## Why this is a service and not "just the store"
 *
 * Activation is a cross-aggregate decision: it reads today's willpower row,
 * the set of currently-active habits, and the load of the habit being
 * activated, and only then does it write to two different tables.
 *
 * The store keeps today's row for rendering. The DECISION and the atomic
 * `spend_willpower` contract live here.
 */
import {
  canActivate as capacityCanActivate,
  dailyLoad,
  habitsInRangeOn,
  habitLoadPoints,
  CAPACITY_CEILING_DEFAULT,
  type HabitLoadInput,
} from '../lib/capacity';
import { isPausedOn, type PauseInterval } from '../lib/habitPauses';
import {
  fetchOrCreateWillpowerState,
  spendWillpower,
  updateWillpowerState,
  type WillpowerStateRow,
} from '../repositories/willpowerRepository';

export const WILLPOWER_CONTRACT = {
  resetsDaily: true,
  chargedOn: ['activate', 'install'],
  refundedOn: ['pause-same-day'],
  copy: {
    overBudgetHow:
      'Yarın bütçe yenilenir. Bugün etkinleştirdiğin bir alışkanlığı beklemeye alırsan harcanan irade geri döner.',
    writeFailedWhy: 'Kaydedilemedi; bütçen değişmedi.',
    writeFailedHow: 'Bağlantını kontrol edip tekrar dene.',
  },
} as const;

export type WillpowerSpendOutcome =
  | { ok: true; data: WillpowerStateRow }
  | { ok: false; error: string; reason: 'over_budget' | 'write_failed' };

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
    habits: habitsInRangeOn(input.activeHabits ?? [], asOf).filter(
      (h) => !isPausedOn(h as { pause_intervals?: readonly PauseInterval[] }, asOf),
    ),
  }).normalised;
}

export type ActivationVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'no_state' | 'stale' | 'over_budget' | 'over_capacity' | 'write_failed';
    };

/**
 * May a habit costing `cost` be activated right now?
 *
 * Two independent ceilings, checked in order:
 *  1. the daily willpower BUDGET — a hard spend limit for the day;
 *  2. the concurrent LOAD ceiling — how much can be carried at once.
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
  const incoming = params.capacityInput
    ? Math.round(habitLoadPoints(params.capacityInput.habit))
    : null;
  const base = { verdict, ceiling, currentLoad, incoming };
  if (verdict.allowed) {
    return {
      ...base,
      canOverride: false,
      why: 'Bugünkü kapasiten bunu taşıyabilir.',
      how: "Etkinleştir'e dokun.",
    };
  }
  const s = params.state;
  switch (verdict.reason) {
    case 'stale':
    case 'no_state':
      return {
        ...base,
        canOverride: false,
        why: 'Bugünün irade verisi henüz yüklenmedi.',
        how: 'Sayfayı yenileyip tekrar dene.',
      };
    case 'over_budget':
      return {
        ...base,
        canOverride: false,
        why: `Bugünkü irade bütçesi yetmiyor: ${s!.used} + ${params.cost} > ${s!.daily_budget}.`,
        how: WILLPOWER_CONTRACT.copy.overBudgetHow,
      };
    case 'over_capacity':
      return {
        ...base,
        canOverride: true,
        why:
          currentLoad !== null
            ? `Bugünkü yük ${currentLoad}/100; bu alışkanlık +${incoming} ekler, önerilen sınır ${ceiling}.`
            : `Aktif alışkanlık sınırı dolu (${s!.active_count}/${s!.focus_capacity}).`,
        how: 'Aktif bir alışkanlığı beklemeye al — ya da istersen yine de etkinleştir.',
      };
    case 'write_failed':
      return {
        ...base,
        canOverride: false,
        why: WILLPOWER_CONTRACT.copy.writeFailedWhy,
        how: WILLPOWER_CONTRACT.copy.writeFailedHow,
      };
  }
}

export async function loadToday(date: string) {
  return fetchOrCreateWillpowerState(date);
}

/** Charges `cost` atomically via `spend_willpower` (with pre-042 fallback). */
export async function spend(
  state: WillpowerStateRow,
  cost: number,
  options?: { activations?: number; clamp?: boolean },
): Promise<WillpowerSpendOutcome> {
  const rpc = await spendWillpower({
    day: state.state_date,
    amount: cost,
    activeDelta: options?.activations,
    clamp: options?.clamp,
  });
  if (rpc.ok) return { ok: true, data: rpc.data };

  if (rpc.kind === 'missing_rpc') {
    const slots = options?.activations ?? 1;
    if (!options?.clamp && cost > 0 && state.used + cost > state.daily_budget) {
      return { ok: false, reason: 'over_budget', error: WILLPOWER_CONTRACT.copy.overBudgetHow };
    }
    const nextUsed =
      options?.clamp && cost > 0
        ? Math.max(state.used, Math.min(state.daily_budget, state.used + cost))
        : Math.max(0, state.used + cost);
    const legacy = await updateWillpowerState(state.state_date, {
      used: nextUsed,
      active_count: Math.max(0, state.active_count + slots),
    });
    return legacy.ok
      ? { ok: true, data: legacy.data }
      : { ok: false, reason: 'write_failed', error: legacy.error };
  }

  if (rpc.kind === 'budget_exceeded') {
    return { ok: false, reason: 'over_budget', error: rpc.error };
  }
  return { ok: false, reason: 'write_failed', error: rpc.error };
}

/** Returns `cost` and releases slots atomically, never going below zero. */
export async function refund(
  state: WillpowerStateRow,
  cost: number,
  options?: { activations?: number },
): Promise<WillpowerSpendOutcome> {
  const deltaSlots = -(options?.activations ?? 1);
  const absCost = Math.abs(cost);
  const rpc = await spendWillpower({
    day: state.state_date,
    amount: -absCost,
    activeDelta: deltaSlots,
  });
  if (rpc.ok) return { ok: true, data: rpc.data };

  if (rpc.kind === 'missing_rpc') {
    const legacy = await updateWillpowerState(state.state_date, {
      used: Math.max(0, state.used - absCost),
      active_count: Math.max(0, state.active_count + deltaSlots),
    });
    return legacy.ok
      ? { ok: true, data: legacy.data }
      : { ok: false, reason: 'write_failed', error: legacy.error };
  }

  return { ok: false, reason: 'write_failed', error: rpc.error };
}
