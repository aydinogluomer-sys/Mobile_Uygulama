import { registerAccountScoped } from '../lib/accountScope';
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
import type { Cursor, Page } from '../repositories/shared';
import { hasPending, newOperationId, overlay } from '../lib/outbox';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type { GoalKind };
export type Goal = GoalRow;

export const GOAL_ENTITY = 'goal';
const GOALS_CACHE_KEY = 'goals:p1';

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

const withPendingGoals = (rows: Goal[]): Goal[] => {
  const box = coreOutbox.state();
  if (!box) return rows;
  return overlay(box, GOAL_ENTITY, rows).filter((g) => !g.archived);
};

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
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY) : null;
    if (cached) {
      set({
        goals: withPendingGoals(cached.data.rows),
        cursor: cached.data.nextCursor,
        hasMore: cached.data.hasMore,
        loading: false,
        error: null,
      });
    } else {
      set({ loading: true, error: null });
    }

    const res = await fetchGoalsPage(null);
    if (!res.ok) {
      if (cached) {
        set({ loading: false, error: res.offline ? null : res.error });
      } else {
        set({ loading: false, error: res.error });
      }
      return;
    }
    if (uid) {
      void setCachedSnapshot(uid, GOALS_CACHE_KEY, res.data);
    }
    set({
      goals: withPendingGoals(res.data.rows),
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
      error: null,
    });
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
    const clampedProgress = Math.max(0, Math.min(100, Math.round(g.progress ?? 0)));
    const res = await insertGoal(g);
    if (res.ok) {
      set((s) => {
        const nextGoals = [res.data, ...s.goals];
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { goals: nextGoals, error: null };
      });
      return true;
    }
    if (res.offline) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const payload = {
        kind: g.kind,
        title: g.title,
        progress: clampedProgress,
        year: g.year ?? null,
        quarter: g.quarter ?? null,
        month: g.month ?? null,
        archived: false,
      };
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'create', payload });
      if (queued.ok) {
        const optimistic: Goal = {
          id,
          user_id: uid,
          ...payload,
          created_at: new Date().toISOString(),
        };
        set((s) => {
          const nextGoals = [optimistic, ...s.goals];
          if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
          return { goals: nextGoals, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  updateProgress: async (id, progress) => {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, GOAL_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'update', payload: { progress: clamped } });
      if (!queued.ok) { set({ error: 'Çevrimdışı hedef güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, progress: clamped } : g)), error: null }));
      return true;
    }

    const res = await updateGoalProgress(id, clamped);
    if (res.ok) {
      set((s) => {
        const nextGoals = s.goals.map((g) => (g.id === id ? res.data : g));
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { goals: nextGoals, error: null };
      });
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'update', payload: { progress: clamped } });
      if (queued.ok) {
        set((s) => {
          const nextGoals = s.goals.map((g) => (g.id === id ? { ...g, progress: clamped } : g));
          void safeUserId().then((uid) => {
            if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
          });
          return { goals: nextGoals, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  archiveGoal: async (id) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, GOAL_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'update', payload: { archived: true } });
      if (!queued.ok) { set({ error: 'Çevrimdışı hedef arşivlenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error: null }));
      return true;
    }

    const res = await repoArchive(id);
    if (res.ok) {
      set((s) => {
        const nextGoals = s.goals.filter((g) => g.id !== id);
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { goals: nextGoals, error: null };
      });
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'update', payload: { archived: true } });
      if (queued.ok) {
        set((s) => {
          const nextGoals = s.goals.filter((g) => g.id !== id);
          void safeUserId().then((uid) => {
            if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
          });
          return { goals: nextGoals, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  removeGoal: async (id) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, GOAL_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'delete' });
      if (!queued.ok) { set({ error: 'Çevrimdışı hedef silinemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error: null }));
      return true;
    }

    const res = await repoDelete(id);
    if (res.ok) {
      set((s) => {
        const nextGoals = s.goals.filter((g) => g.id !== id);
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { goals: nextGoals, error: null };
      });
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: GOAL_ENTITY, entityId: id, kind: 'delete' });
      if (queued.ok) {
        set((s) => {
          const nextGoals = s.goals.filter((g) => g.id !== id);
          void safeUserId().then((uid) => {
            if (uid) void setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, { rows: nextGoals, nextCursor: s.cursor, hasMore: s.hasMore });
          });
          return { goals: nextGoals, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'goal', store: useGoalStore });
