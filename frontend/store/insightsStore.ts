import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { InsightPeriod } from '../lib/journalStats';

export type JournalInsight = {
  id: string;
  user_id: string;
  period: InsightPeriod;
  period_key: string;
  content: string;
  entry_count: number;
  created_at: string;
  updated_at: string;
};

const ck = (period: InsightPeriod, key: string) => `${period}:${key}`;

type InsightsStore = {
  cache: Record<string, JournalInsight>;
  get: (period: InsightPeriod, key: string) => JournalInsight | undefined;
  fetchInsight: (period: InsightPeriod, key: string) => Promise<void>;
  saveInsight: (period: InsightPeriod, key: string, content: string, entryCount: number) => Promise<void>;
};

export const useInsightsStore = create<InsightsStore>((set, get) => ({
  cache: {},

  get: (period, key) => get().cache[ck(period, key)],

  fetchInsight: async (period, key) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('journal_insights')
      .select('*')
      .eq('user_id', user.id)
      .eq('period', period)
      .eq('period_key', key)
      .maybeSingle();
    if (data) {
      set((s) => ({ cache: { ...s.cache, [ck(period, key)]: data as JournalInsight } }));
    }
  },

  saveInsight: async (period, key, content, entryCount) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('journal_insights')
      .upsert(
        { user_id: user.id, period, period_key: key, content, entry_count: entryCount, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,period,period_key' }
      )
      .select('*')
      .single();
    if (data) {
      set((s) => ({ cache: { ...s.cache, [ck(period, key)]: data as JournalInsight } }));
    }
  },
}));
