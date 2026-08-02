import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type KeyResult = {
  id: string;
  okr_id: string;
  title: string;
  current_value: number;
  target_value: number;
  unit: string | null;
  created_at: string;
};

export type OKR = {
  id: string;
  user_id: string;
  objective: string;
  year: number;
  quarter: number;
  created_at: string;
  key_results: KeyResult[];
};

type OKRStore = {
  okrs: OKR[];
  loading: boolean;
  loadOKRs: () => Promise<void>;
  addObjective: (objective: string, year: number, quarter: number) => Promise<void>;
  addKeyResult: (okrId: string, title: string, target: number, unit: string | null) => Promise<void>;
  updateKRValue: (krId: string, current: number) => Promise<void>;
  removeObjective: (id: string) => Promise<void>;
  removeKR: (id: string) => Promise<void>;
};

export const useOKRStore = create<OKRStore>((set, get) => ({
  okrs: [],
  loading: false,

  loadOKRs: async () => {
    set({ loading: true });
    const [{ data: objs }, { data: krs }] = await Promise.all([
      supabase.from('okrs').select('*').order('year', { ascending: false }).order('quarter', { ascending: false }),
      supabase.from('key_results').select('*').order('created_at', { ascending: true }),
    ]);
    const byOkr: Record<string, KeyResult[]> = {};
    (krs ?? []).forEach((k) => {
      (byOkr[k.okr_id] ??= []).push(k as KeyResult);
    });
    const merged: OKR[] = (objs ?? []).map((o) => ({ ...(o as any), key_results: byOkr[o.id] ?? [] }));
    set({ okrs: merged, loading: false });
  },

  addObjective: async (objective, year, quarter) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !objective.trim()) return;
    const { data } = await supabase
      .from('okrs')
      .insert({ user_id: user.id, objective: objective.trim(), year, quarter })
      .select()
      .single();
    if (data) set((s) => ({ okrs: [{ ...(data as any), key_results: [] }, ...s.okrs] }));
  },

  addKeyResult: async (okrId, title, target, unit) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !title.trim() || !(target > 0)) return;
    const { data } = await supabase
      .from('key_results')
      .insert({ okr_id: okrId, user_id: user.id, title: title.trim(), target_value: target, unit: unit?.trim() || null })
      .select()
      .single();
    if (data) {
      set((s) => ({
        okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, data as KeyResult] } : o)),
      }));
    }
  },

  updateKRValue: async (krId, current) => {
    const val = Math.max(0, current);
    await supabase.from('key_results').update({ current_value: val }).eq('id', krId);
    set((s) => ({
      okrs: s.okrs.map((o) => ({
        ...o,
        key_results: o.key_results.map((k) => (k.id === krId ? { ...k, current_value: val } : k)),
      })),
    }));
  },

  removeObjective: async (id) => {
    await supabase.from('okrs').delete().eq('id', id);
    set((s) => ({ okrs: s.okrs.filter((o) => o.id !== id) }));
  },

  removeKR: async (id) => {
    await supabase.from('key_results').delete().eq('id', id);
    set((s) => ({
      okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
    }));
  },
}));

export function krProgress(kr: KeyResult): number {
  if (!(kr.target_value > 0)) return 0;
  return Math.min(100, Math.round((kr.current_value / kr.target_value) * 100));
}

export function objectiveProgress(okr: OKR): number {
  if (okr.key_results.length === 0) return 0;
  const sum = okr.key_results.reduce((a, k) => a + krProgress(k), 0);
  return Math.round(sum / okr.key_results.length);
}
