import { create } from 'zustand';
import { supabase, type RecoveryPlan, type RecoveryStrategy, type HabitLog } from '../lib/supabase';
import { scheduleRecoveryReminder, cancelRecoveryReminder } from '../lib/notifications';
import {
  deleteRecoveryPlan,
  fetchPlannedRecoveryPlans,
  insertRecoveryPlan,
  setRecoveryPlanStatus,
} from '../repositories/recoveryRepository';
import {
  deficitFor,
  recoveryOptions,
  toLegacyRecoveryPlan,
  fromLegacyRecoveryPlan,
  type TrackingTypeV2,
  type RecoveryOption,
} from '../lib/recovery';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';

/**
 * §22 analytics emission seam (task Phase-4 CODER-O) -- see the identical
 * wrapper in `store/habitStore.ts` for the full rationale. In short: run the
 * payload through `buildEvent` (which drops free text by shape, here, at the
 * call site), hand the result to `lib/analytics.ts`'s sink funnel, and never
 * let `buildEvent`'s deliberate throw escape into the user action.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

type AddPlanInput = {
  habitId: string;
  habitName: string;
  sourceDate: string;   // 'yyyy-MM-dd'
  targetDate: string;   // 'yyyy-MM-dd'
  strategy: RecoveryStrategy;
  note?: string | null;
  reminderTime?: string | null; // 'HH:mm'
};

type RecoveryStore = {
  plans: RecoveryPlan[];
  loading: boolean;
  fetchPlans: () => Promise<void>;
  addPlan: (input: AddPlanInput) => Promise<RecoveryPlan | null>;
  completePlan: (id: string) => Promise<void>;
  skipPlan: (id: string) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  planForHabit: (habitId: string) => RecoveryPlan | undefined;
  /**
   * W3 (task 1-D, Phase 1 wiring): a pure, additive read that hands a caller
   * the plan's four recovery strategies (Plan §9) computed via
   * `lib/recovery.ts`'s `deficitFor` + `recoveryOptions`, instead of a
   * screen re-deriving them ad-hoc. New action -- does not change or
   * replace any of the six actions above, and does no I/O.
   */
  recoveryOptionsFor: (input: {
    trackingType: TrackingTypeV2;
    target?: number | null;
    value?: number | null;
    state?: HabitLog['state'] | null;
    fromDate: string;
  }) => RecoveryOption[];
};

const SELECT = 'id,user_id,habit_id,source_date,target_date,strategy,note,reminder_time,status,created_at';

/**
 * Round-trips a persisted row through the `RecoveryPlanV2` model at the
 * read/write boundary (task 1-D, W3): `fromLegacyRecoveryPlan` widens it to
 * the plan's full V2 shape, `toLegacyRecoveryPlan` narrows it back to
 * exactly today's real columns. `toLegacyRecoveryPlan` deliberately does not
 * carry `id`/`created_at` (the DB assigns those, see its own doc), so they
 * are re-attached from the original row here.
 *
 * This makes the store genuinely SPEAK `RecoveryPlanV2` at every boundary
 * where a DB row becomes store/caller-facing data, while every persisted
 * field -- and therefore every existing external behaviour -- is unchanged:
 * the adapter pair is a verified bijection, so this round trip is a no-op on
 * the data, not a silent transformation. `source_log_id`, `deficit_type`,
 * `deficit_value`, `distributed_days` and `completed_at` are NOT written
 * here -- the live `recovery_plans` table has no columns for them (that
 * migration is authored but unapplied), and `toLegacyRecoveryPlan` already
 * omits them for exactly that reason.
 */
function roundTripLegacy(row: RecoveryPlan): RecoveryPlan {
  const v2 = fromLegacyRecoveryPlan(row);
  return { id: row.id, created_at: row.created_at, ...toLegacyRecoveryPlan(v2) };
}

export const useRecoveryStore = create<RecoveryStore>((set, get) => ({
  plans: [],
  loading: false,

  fetchPlans: async () => {
    set({ loading: true });
    const res = await fetchPlannedRecoveryPlans();
    if (res.ok) set({ plans: res.data.map(roundTripLegacy) });
    set({ loading: false });
  },

  addPlan: async (input) => {
    const res = await insertRecoveryPlan({
      habitId: input.habitId,
      sourceDate: input.sourceDate,
      targetDate: input.targetDate,
      strategy: input.strategy,
      note: input.note ?? null,
      reminderTime: input.reminderTime ?? null,
    });
    if (!res.ok) return null;
    const plan = roundTripLegacy(res.data);
    set((s) => ({ plans: [...s.plans, plan].sort((a, b) => a.target_date.localeCompare(b.target_date)) }));
    if (plan.reminder_time) {
      scheduleRecoveryReminder(plan.id, input.habitName, plan.target_date, plan.reminder_time);
    }
    // §22 `recovery_created`. Placed after the `error || !data` bail-out, so
    // only a row that really exists is reported. `input.habitName` and
    // `input.note` are deliberately NOT passed -- both are user prose.
    emitAnalytics('recovery_created', {
      plan_id: plan.id,
      habit_id: plan.habit_id,
      strategy: plan.strategy,
      source_date: plan.source_date,
      target_date: plan.target_date,
      has_reminder: !!plan.reminder_time,
    });
    return plan;
  },

  completePlan: async (id) => {
    // Read the plan BEFORE the local state drops it -- the event's habit_id
    // and strategy come from here, never from a caller-supplied argument.
    const plan = get().plans.find((p) => p.id === id);
    const res = await setRecoveryPlanStatus(id, 'done');
    const error = res.ok ? null : { message: res.error };
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
    // §22 `recovery_completed`, gated on the update actually succeeding.
    // (The local-state/reminder behaviour above is unchanged and still runs
    // regardless -- only the event is new, and only the event is gated.)
    if (!error) {
      emitAnalytics('recovery_completed', {
        plan_id: id,
        habit_id: plan?.habit_id ?? null,
        strategy: plan?.strategy ?? null,
        target_date: plan?.target_date ?? null,
      });
    }
  },

  skipPlan: async (id) => {
    const res = await setRecoveryPlanStatus(id, 'skipped');
    // A failed write leaves the plan in place rather than clearing it from
    // the list and cancelling its reminder for a change that did not happen.
    if (!res.ok) return;
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  deletePlan: async (id) => {
    const res = await deleteRecoveryPlan(id);
    if (!res.ok) return;
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  planForHabit: (habitId) => get().plans.find((p) => p.habit_id === habitId && p.status === 'planned'),

  recoveryOptionsFor: ({ trackingType, target, value, state, fromDate }) => {
    const deficit = deficitFor({ trackingType, target, value, state });
    return recoveryOptions(deficit, { fromDate });
  },
}));
