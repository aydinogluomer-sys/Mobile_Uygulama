import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { serialByKey } from '../lib/serialByKey';
import { create } from 'zustand';
import {
  archiveGoal as repoArchive,
  deleteGoal as repoDelete,
  fetchGoalsPage,
  insertGoalWithId,
  updateGoalProgress,
  type GoalKind,
  type GoalRow,
} from '../repositories/goalRepository';
import type { Cursor, Page } from '../repositories/shared';
import { newOperationId, overlay } from '../lib/outbox';
import { safeUserIdOf, writeThrough } from '../lib/outboxEngine';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type { GoalKind };
export type Goal = GoalRow;

export const GOAL_ENTITY = 'goal';
const GOALS_CACHE_KEY = 'goals:p1';
const DEVICE_SAVE_WARNING = 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.';
const loadLatest = createLatest();

const safeUserId = (): Promise<string | null> => safeUserIdOf(currentUser);

const withPendingGoals = (rows: Goal[]): Goal[] => {
  const box = coreOutbox.state();
  if (!box) return rows;
  return overlay(box, GOAL_ENTITY, rows).filter((g) => !g.archived);
};

async function persistGoalsCache(uid: string | null, state: Pick<GoalStore, 'goals' | 'cursor' | 'hasMore'>): Promise<void> {
  if (!uid) return;
  await setCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY, {
    rows: state.goals,
    nextCursor: state.cursor,
    hasMore: state.hasMore,
  });
}

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
    const run = loadLatest.begin();
    try {
      await coreOutbox.ensure();
      if (!run.isCurrent()) return;
      const uid = await safeUserId();
      if (!run.isCurrent()) return;
      const cached = uid ? await readCachedSnapshot<Page<Goal>>(uid, GOALS_CACHE_KEY) : null;
      if (!run.isCurrent()) return;
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
      if (!run.isCurrent()) return;
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
        loadingMore: false,
        error: null,
      });
    } finally {
      run.done();
      if (loadLatest.pending() === 0 && get().loading) set({ loading: false });
    }
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    const run = loadLatest.begin();
    set({ loadingMore: true });
    try {
      const res = await fetchGoalsPage(cursor);
      if (!run.isCurrent()) return;
      if (!res.ok) {
        set({ loadingMore: false, error: res.error });
        return;
      }
      set((s) => {
        const seen = new Set(s.goals.map((g) => g.id));
        const fresh = res.data.rows.filter((g) => !seen.has(g.id));
        return { goals: [...s.goals, ...fresh], cursor: res.data.nextCursor, hasMore: res.data.hasMore, loadingMore: false };
      });
    } finally {
      run.done();
    }
  },

  addGoal: async (g) => {
    const clampedProgress = Math.max(0, Math.min(100, Math.round(g.progress ?? 0)));
    const id = newOperationId();
    const payload = {
      kind: g.kind,
      title: g.title,
      progress: clampedProgress,
      year: g.year ?? null,
      quarter: g.quarter ?? null,
      month: g.month ?? null,
      archived: false,
    };

    const res = await writeThrough({
      channel: coreOutbox,
      entity: GOAL_ENTITY,
      entityId: id,
      kind: 'create',
      payload,
      online: () => insertGoalWithId({ id, ...payload }),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }

    const row: Goal =
      res.via === 'online'
        ? res.row
        : {
            id,
            user_id: res.userId ?? '',
            ...payload,
            created_at: new Date().toISOString(),
          };
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set((s) => ({ goals: [row, ...s.goals], error }));
    void persistGoalsCache(res.userId, get());
    return true;
  },

  updateProgress: (id, progress) =>
    serialByKey(`goal:${id}`, async () => {
      const clamped = Math.max(0, Math.min(100, Math.round(progress)));
      const res = await writeThrough({
        channel: coreOutbox,
        entity: GOAL_ENTITY,
        entityId: id,
        kind: 'update',
        payload: { progress: clamped },
        online: () => updateGoalProgress(id, clamped),
        userId: safeUserId,
      });
      if (!res.ok) {
        set({ error: res.error });
        return false;
      }

      const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
      set((s) => ({
        goals: s.goals.map((g) => (g.id === id ? (res.via === 'online' ? res.row : { ...g, progress: clamped }) : g)),
        error,
      }));
      void persistGoalsCache(res.userId, get());
      return true;
    }),

  archiveGoal: async (id) => {
    const res = await writeThrough({
      channel: coreOutbox,
      entity: GOAL_ENTITY,
      entityId: id,
      kind: 'update',
      payload: { archived: true },
      online: () => repoArchive(id),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error }));
    void persistGoalsCache(res.userId, get());
    return true;
  },

  removeGoal: async (id) => {
    const res = await writeThrough({
      channel: coreOutbox,
      entity: GOAL_ENTITY,
      entityId: id,
      kind: 'delete',
      online: () => repoDelete(id),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id), error }));
    void persistGoalsCache(res.userId, get());
    return true;
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'goal', store: useGoalStore });
