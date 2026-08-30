import { create } from 'zustand';
import {
  deleteKeyResult,
  deleteObjective,
  fetchOkrs,
  insertKeyResult,
  insertObjective,
  updateKeyResultValue,
  type KeyResultRow,
  type OkrRow,
} from '../repositories/okrRepository';

export type KeyResult = KeyResultRow;
export type OKR = OkrRow & { key_results: KeyResult[] };

/**
 * OKRs.
 *
 * ## What the move fixed
 *
 * This store had the most direct database calls of any (5) and the loosest
 * ones. `loadOKRs` fetched both `okrs` and `key_results` with **no user
 * filter and no bound** — every row RLS would hand back, forever. The four
 * mutations matched on `id` alone and discarded their results.
 *
 * `addKeyResult` also attached a key result to an arbitrary `okrId` without
 * checking that the objective belonged to the caller. That is the same shape
 * of gap the live RLS audit found on `habit_logs`, and the repository now
 * verifies ownership before inserting.
 *
 * The two tables load together because they are one aggregate; the objective
 * list is bounded by quarter count, which is the natural window for this
 * screen (there is no "load more objectives" gesture).
 */
type OKRStore = {
  okrs: OKR[];
  loading: boolean;
  error: string | null;
  loadOKRs: (quarters?: number) => Promise<void>;
  addObjective: (objective: string, year: number, quarter: number) => Promise<boolean>;
  addKeyResult: (okrId: string, title: string, target: number, unit: string | null) => Promise<boolean>;
  updateKRValue: (krId: string, current: number) => Promise<boolean>;
  removeObjective: (id: string) => Promise<boolean>;
  removeKR: (id: string) => Promise<boolean>;
};

export const useOKRStore = create<OKRStore>((set) => ({
  okrs: [],
  loading: false,
  error: null,

  loadOKRs: async (quarters) => {
    set({ loading: true, error: null });
    const res = await fetchOkrs({ quarters });
    if (!res.ok) return set({ loading: false, error: res.error });
    const byOkr: Record<string, KeyResult[]> = {};
    for (const kr of res.data.keyResults) (byOkr[kr.okr_id] ??= []).push(kr);
    set({
      okrs: res.data.okrs.map((o) => ({ ...o, key_results: byOkr[o.id] ?? [] })),
      loading: false,
    });
  },

  addObjective: async (objective, year, quarter) => {
    const text = objective.trim();
    if (!text) return false;
    const res = await insertObjective({ objective: text, year, quarter });
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ okrs: [{ ...res.data, key_results: [] }, ...s.okrs], error: null }));
    return true;
  },

  addKeyResult: async (okrId, title, target, unit) => {
    const text = title.trim();
    if (!text || !(target > 0)) return false;
    const res = await insertKeyResult({ okrId, title: text, targetValue: target, unit: unit?.trim() || null });
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({
      okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, res.data] } : o)),
      error: null,
    }));
    return true;
  },

  updateKRValue: async (krId, current) => {
    const res = await updateKeyResultValue(krId, current);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({
      okrs: s.okrs.map((o) => ({
        ...o,
        key_results: o.key_results.map((k) => (k.id === krId ? res.data : k)),
      })),
      error: null,
    }));
    return true;
  },

  removeObjective: async (id) => {
    const res = await deleteObjective(id);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ okrs: s.okrs.filter((o) => o.id !== id), error: null }));
    return true;
  },

  removeKR: async (id) => {
    const res = await deleteKeyResult(id);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({
      okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
      error: null,
    }));
    return true;
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
