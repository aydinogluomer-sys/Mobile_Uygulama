import { create } from 'zustand';
import { supabase, type RecoveryPlan, type RecoveryStrategy } from '../lib/supabase';
import { scheduleRecoveryReminder, cancelRecoveryReminder } from '../lib/notifications';

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
};

const SELECT = 'id,user_id,habit_id,source_date,target_date,strategy,note,reminder_time,status,created_at';

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
    if (!error && data) set({ plans: data as RecoveryPlan[] });
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
    const plan = data as RecoveryPlan;
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
}));
