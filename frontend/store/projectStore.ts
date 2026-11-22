import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { serialByKey } from '../lib/serialByKey';
import { create } from 'zustand';
import {
  archiveProject,
  fetchProjectsPage,
  insertProjectWithId,
  updateProject as repoUpdate,
  type ProjectRow,
} from '../repositories/projectRepository';
import type { Cursor, Page } from '../repositories/shared';
import { newOperationId, overlay } from '../lib/outbox';
import { safeUserIdOf, writeThrough } from '../lib/outboxEngine';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type Project = ProjectRow & { status: 'active' | 'completed' | 'archived' };

export const PROJECT_ENTITY = 'project';
const PROJECTS_CACHE_KEY = 'projects:p1';
const DEVICE_SAVE_WARNING = 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.';
const loadLatest = createLatest();

const safeUserId = (): Promise<string | null> => safeUserIdOf(currentUser);

const withPendingProjects = (rows: Project[]): Project[] => {
  const box = coreOutbox.state();
  if (!box) return rows;
  return overlay(box, PROJECT_ENTITY, rows).filter((p) => p.status !== 'archived');
};

async function persistProjectsCache(
  uid: string | null,
  state: Pick<ProjectStore, 'projects' | 'cursor' | 'hasMore'>,
): Promise<void> {
  if (!uid) return;
  await setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, {
    rows: state.projects,
    nextCursor: state.cursor,
    hasMore: state.hasMore,
  });
}

type ProjectStore = {
  projects: Project[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  cursor: Cursor | null;
  fetchProjects: () => Promise<void>;
  loadMore: () => Promise<void>;
  addProject: (p: { name: string; color: string; description?: string }) => Promise<Project | null>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<boolean>;
  /** Archives the project (soft delete), matching the previous behaviour. */
  removeProject: (id: string) => Promise<boolean>;
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
  cursor: null,

  fetchProjects: async () => {
    const run = loadLatest.begin();
    try {
      await coreOutbox.ensure();
      if (!run.isCurrent()) return;
      const uid = await safeUserId();
      if (!run.isCurrent()) return;
      const cached = uid ? await readCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY) : null;
      if (!run.isCurrent()) return;
      if (cached) {
        set({
          projects: withPendingProjects(cached.data.rows),
          cursor: cached.data.nextCursor,
          hasMore: cached.data.hasMore,
          loading: false,
          error: null,
        });
      } else {
        set({ loading: true, error: null });
      }

      const res = await fetchProjectsPage(null);
      if (!run.isCurrent()) return;
      if (!res.ok) {
        if (cached) {
          set({ loading: false, error: res.offline ? null : res.error });
        } else {
          set({ loading: false, error: res.error });
        }
        return;
      }
      const page: Page<Project> = {
        rows: res.data.rows as Project[],
        nextCursor: res.data.nextCursor,
        hasMore: res.data.hasMore,
      };
      if (uid) {
        void setCachedSnapshot(uid, PROJECTS_CACHE_KEY, page);
      }
      set({
        projects: withPendingProjects(page.rows),
        cursor: page.nextCursor,
        hasMore: page.hasMore,
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
      const res = await fetchProjectsPage(cursor);
      if (!run.isCurrent()) return;
      if (!res.ok) {
        set({ loadingMore: false, error: res.error });
        return;
      }
      set((s) => {
        const seen = new Set(s.projects.map((p) => p.id));
        const fresh = (res.data.rows as Project[]).filter((p) => !seen.has(p.id));
        return {
          projects: [...s.projects, ...fresh],
          cursor: res.data.nextCursor,
          hasMore: res.data.hasMore,
          loadingMore: false,
        };
      });
    } finally {
      run.done();
    }
  },

  addProject: async ({ name, color, description }) => {
    const id = newOperationId();
    const payload = {
      name,
      color,
      description: description ?? null,
      status: 'active' as const,
    };
    const res = await writeThrough({
      channel: coreOutbox,
      entity: PROJECT_ENTITY,
      entityId: id,
      kind: 'create',
      payload,
      online: () => insertProjectWithId({ id, ...payload }),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return null;
    }

    const row: Project =
      res.via === 'online'
        ? (res.row as Project)
        : {
            id,
            user_id: res.userId ?? '',
            ...payload,
            created_at: new Date().toISOString(),
          };
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set((s) => ({ projects: [row, ...s.projects], error }));
    void persistProjectsCache(res.userId, get());
    return row;
  },

  updateProject: (id, patch) =>
    serialByKey(`project:${id}`, async () => {
      const res = await writeThrough({
        channel: coreOutbox,
        entity: PROJECT_ENTITY,
        entityId: id,
        kind: 'update',
        payload: patch as Record<string, unknown>,
        online: () => repoUpdate(id, patch as Partial<ProjectRow>),
        userId: safeUserId,
      });
      if (!res.ok) {
        set({ error: res.error });
        return false;
      }

      const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
      set((s) => ({
        projects: s.projects
          .map((p) => (p.id === id ? (res.via === 'online' ? (res.row as Project) : ({ ...p, ...patch } as Project)) : p))
          .filter((p) => p.status !== 'archived'),
        error,
      }));
      void persistProjectsCache(res.userId, get());
      return true;
    }),

  /** Projeyi arşivler (`status: 'archived'`); kalıcı silmez, görevleri korur. */
  removeProject: async (id) => {
    const res = await writeThrough({
      channel: coreOutbox,
      entity: PROJECT_ENTITY,
      entityId: id,
      kind: 'update',
      payload: { status: 'archived' },
      online: () => archiveProject(id),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }

    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id), error }));
    void persistProjectsCache(res.userId, get());
    return true;
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'project', store: useProjectStore });
