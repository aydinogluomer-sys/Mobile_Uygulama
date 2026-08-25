import { create } from 'zustand';
import { supabase, type RecoveryPlan, type RecoveryStrategy, type HabitLog } from '../lib/supabase';
import { scheduleRecoveryReminder, cancelRecoveryReminder } from '../lib/notifications';
import {
  deficitFor,
  recoveryOptions,
  toLegacyRecoveryPlan,
  fromLegacyRecoveryPlan,
  type TrackingTypeV2,
  type RecoveryOption,
} from '../lib/recovery';

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }
    const { data, error } = await supabase
      .from('recovery_plans')
      .select(SELECT)
      .eq('user_id', user.id)
      .eq('status', 'planned')
      .order('target_date', { ascending: true });
    if (!error && data) set({ plans: (data as RecoveryPlan[]).map(roundTripLegacy) });
    set({ loading: false });
  },

  addPlan: async (input) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('recovery_plans')
      .insert({
        user_id: user.id,
        habit_id: input.habitId,
        source_date: input.sourceDate,
        target_date: input.targetDate,
        strategy: input.strategy,
        note: input.note ?? null,
        reminder_time: input.reminderTime ?? null,
        status: 'planned',
      })
      .select(SELECT)
      .single();
    if (error || !data) return null;
    const plan = roundTripLegacy(data as RecoveryPlan);
    set((s) => ({ plans: [...s.plans, plan].sort((a, b) => a.target_date.localeCompare(b.target_date)) }));
    if (plan.reminder_time) {
      scheduleRecoveryReminder(plan.id, input.habitName, plan.target_date, plan.reminder_time);
    }
    return plan;
  },

  completePlan: async (id) => {
    await supabase.from('recovery_plans').update({ status: 'done' }).eq('id', id);
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  skipPlan: async (id) => {
    await supabase.from('recovery_plans').update({ status: 'skipped' }).eq('id', id);
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  deletePlan: async (id) => {
    await supabase.from('recovery_plans').delete().eq('id', id);
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  planForHabit: (habitId) => get().plans.find((p) => p.habit_id === habitId && p.status === 'planned'),

  recoveryOptionsFor: ({ trackingType, target, value, state, fromDate }) => {
    const deficit = deficitFor({ trackingType, target, value, state });
    return recoveryOptions(deficit, { fromDate });
  },
}));
