import { create } from 'zustand';
import { supabase, HabitLog } from '../lib/supabase';
import { format } from 'date-fns';

type LogStore = {
  logs: HabitLog[];
  loading: boolean;
  fetchLogsForDate: (date: Date | string) => Promise<void>;
  logHabit: (params: {
    habitId: string;
    date: Date;
    state: HabitLog['state'];
    value?: number;
    targetValue?: number;
    baseXp?: number;
  }) => Promise<void>;
  getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined;
  getRemainingValue: (habitId: string, targetValue: number, date: Date) => number;
};

function calcXp(baseXp: number, value: number | undefined, targetValue: number | undefined, state: HabitLog['state']): number {
  if (state === 'done') return baseXp;
  if (state === 'partial' && value != null && targetValue != null && targetValue > 0) {
    return Math.round(baseXp * (value / targetValue));
  }
  return 0;
}

export const useLogStore = create<LogStore>((set, get) => ({
  logs: [],
  loading: false,

  fetchLogsForDate: async (date) => {
    set({ loading: true });
    const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }

    const { data, error } = await supabase
      .from('habit_logs')
      .select('id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at')
      .eq('user_id', user.id)
      .eq('completed_at', dateStr);

    if (!error && data) set({ logs: data as HabitLog[] });
    set({ loading: false });
  },

  logHabit: async ({ habitId, date, state, value, targetValue, baseXp = 30 }) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const xp = calcXp(baseXp, value, targetValue, state);
    const isDone = state === 'done';
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existing = get().getLogForHabit(habitId, date);

    if (existing) {
      const { data } = await supabase
        .from('habit_logs')
        .update({ state, value: value ?? null, xp, is_completed: isDone })
        .eq('id', existing.id)
        .select('id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at')
        .single();
      if (data) {
        set((s) => ({
          logs: s.logs.map((l) => (l.id === existing.id ? (data as HabitLog) : l)),
        }));
      }
    } else {
      const { data } = await supabase
        .from('habit_logs')
        .insert({
          habit_id: habitId,
          user_id: user.id,
          completed_at: dateStr,
          state,
          value: value ?? null,
          xp,
          is_completed: isDone,
        })
        .select('id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at')
        .single();
      if (data) {
        set((s) => ({ logs: [...s.logs, data as HabitLog] }));
      }
    }
  },

  getLogForHabit: (habitId, date) => {
    if (!date) {
      return get().logs.find((l) => l.habit_id === habitId);
    }
    const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
    return get().logs.find((l) => l.habit_id === habitId && l.completed_at === dateStr);
  },

  getRemainingValue: (habitId, targetValue, date) => {
    const log = get().getLogForHabit(habitId, date);
    const done = log?.value ?? 0;
    return Math.max(0, targetValue - done);
  },
}));
