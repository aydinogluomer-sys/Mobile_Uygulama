import { create } from 'zustand';
import {
  fetchJournalInsight,
  upsertJournalInsight,
} from '../repositories/journalInsightRepository';
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
    const res = await fetchJournalInsight<JournalInsight>(period, key);
    if (res.ok && res.data) {
      set((s) => ({ cache: { ...s.cache, [ck(period, key)]: res.data as JournalInsight } }));
    }
  },

  saveInsight: async (period, key, content, entryCount) => {
    const res = await upsertJournalInsight<JournalInsight>({ period, key, content, entryCount });
    if (!res.ok) return;
    set((s) => ({ cache: { ...s.cache, [ck(period, key)]: res.data } }));
  },
}));
