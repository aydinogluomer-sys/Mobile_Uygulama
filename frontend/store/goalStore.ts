import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type GoalKind = 'yearly' | 'quarterly' | 'monthly';

export type Goal = {
  id: string;
  user_id: string;
  kind: GoalKind;
  title: string;
  progress: number;
  year?: number | null;
  quarter?: number | null;
  month?: number | null;
  archived: boolean;
  created_at: string;
};

type GoalStore = {
  goals: Goal[];
  loading: boolean;
  loadGoals: () => Promise<void>;
  addGoal: (g: Omit<Goal, 'id' | 'user_id' | 'created_at' | 'archived'>) => Promise<void>;
  updateProgress: (id: string, progress: number) => Promise<void>;
  archiveGoal: (id: string) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
};

export const useGoalStore = create<GoalStore>((set, get) => ({
  goals: [],
  loading: false,

  loadGoals: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }
    const { data } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('created_at', { ascending: false });
    if (data) set({ goals: data as Goal[] });
    set({ loading: false });
  },

  addGoal: async (g) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const row = { ...g, user_id: user.id, archived: false };
    const { data } = await supabase.from('goals').insert(row).select().single();
    if (data) set((s) => ({ goals: [data as Goal, ...s.goals] }));
  },

  updateProgress: async (id, progress) => {
    await supabase.from('goals').update({ progress }).eq('id', id);
    set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, progress } : g)) }));
  },

  archiveGoal: async (id) => {
    await supabase.from('goals').update({ archived: true }).eq('id', id);
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
  },

  removeGoal: async (id) => {
    await supabase.from('goals').delete().eq('id', id);
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
  },
}));
