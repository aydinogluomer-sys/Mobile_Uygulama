import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type DeepWorkSession = {
  id: string;
  user_id: string;
  subject: string;
  duration_minutes: number;
  date: string;
  created_at: string;
};

type DeepWorkStore = {
  sessions: DeepWorkSession[];
  loading: boolean;
  loadSessions: () => Promise<void>;
  addSession: (subject: string, minutes: number, date?: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  todayMinutes: () => number;
  weekMinutes: () => number;
};

export const useDeepWorkStore = create<DeepWorkStore>((set, get) => ({
  sessions: [],
  loading: false,

  loadSessions: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data } = await supabase
      .from('deep_work_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    if (data) set({ sessions: data as DeepWorkSession[] });
    set({ loading: false });
  },

  addSession: async (subject, minutes, date) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const row = { user_id: user.id, subject, duration_minutes: minutes, date: date ?? today };
    const { data } = await supabase.from('deep_work_sessions').insert(row).select().single();
    if (data) set((s) => ({ sessions: [data as DeepWorkSession, ...s.sessions] }));
  },

  removeSession: async (id) => {
    await supabase.from('deep_work_sessions').delete().eq('id', id);
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
  },

  todayMinutes: () => {
    const today = new Date().toISOString().split('T')[0];
    return get().sessions
      .filter((s) => s.date === today)
      .reduce((acc, s) => acc + s.duration_minutes, 0);
  },

  weekMinutes: () => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = monday.toISOString().split('T')[0];
    return get().sessions
      .filter((s) => s.date >= weekStart)
      .reduce((acc, s) => acc + s.duration_minutes, 0);
  },
}));
