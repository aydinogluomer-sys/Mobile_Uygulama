import { create } from 'zustand';
import {
  archiveGoal as repoArchive,
  deleteGoal as repoDelete,
  fetchGoalsPage,
  insertGoal,
  updateGoalProgress,
  type GoalKind,
  type GoalRow,
} from '../repositories/goalRepository';
import type { Cursor } from '../repositories/shared';

export type { GoalKind };
export type Goal = GoalRow;

/**
 * Goals.
 *
 * Direct `supabase.from('goals')` calls moved to
 * `repositories/goalRepository`. The three mutations were previously keyed on
 * `id` alone with their results discarded; they are now owner-scoped and
 * report failure instead of updating the list regardless. `progress` is also
 * clamped in the repository to the 0..100 the live `goals_progress_check`
 * enforces, so an out-of-range value becomes a sane one rather than a
 * silently rejected write.
 */
type GoalStore = {
  goals: Goal[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  cursor: Cursor | null;
  loadGoals: () => Promise<void>;
  loadMore: () => Promise<void>;
  addGoal: (g: { kind: GoalKind; title: string; progress?: number; year?: number | null; quarter?: number | null; month?: number | null }) => Promise<boolean>;
  updateProgress: (id: string, progress: number) => Promise<boolean>;
  archiveGoal: (id: string) => Promise<boolean>;
  removeGoal: (id: string) => Promise<boolean>;
};

export const useGoalStore = create<GoalStore>((set, get) => ({
  goals: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
  cursor: null,

  loadGoals: async () => {
    set({ loading: true, error: null });
    const res = await fetchGoalsPage(null);
    if (!res.ok) return set({ loading: false, error: res.error });
    set({ goals: res.data.rows, cursor: res.data.nextCursor, hasMore: res.data.hasMore, loading: false });
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    const res = await fetchGoalsPage(cursor);
    if (!res.ok) return set({ loadingMore: false, error: res.error });
    set((s) => {
      const seen = new Set(s.goals.map((g) => g.id));
      const fresh = res.data.rows.filter((g) => !seen.has(g.id));
      return { goals: [...s.goals, ...fresh], cursor: res.data.nextCursor, hasMore: res.data.hasMore, loadingMore: false };
    });
  },

  addGoal: async (g) => {
    const res = await insertGoal(g);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ goals: [res.data, ...s.goals], error: null }));
    return true;
  },

  updateProgress: async (id, progress) => {
    const res = await updateGoalProgress(id, progress);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ goals: s.goals.map((g) => (g.id === id ? res.data : g)), error: null }));
    return true;
  },

  archiveGoal: async (id) => {
    const res = await repoArchive(id);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error: null }));
    return true;
  },

  removeGoal: async (id) => {
    const res = await repoDelete(id);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error: null }));
    return true;
  },
}));
