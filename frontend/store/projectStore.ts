import { create } from 'zustand';
import {
  archiveProject,
  fetchProjectsPage,
  insertProject,
  updateProject as repoUpdate,
  type ProjectRow,
} from '../repositories/projectRepository';
import type { Cursor, Page } from '../repositories/shared';
import { hasPending, newOperationId, overlay } from '../lib/outbox';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type Project = ProjectRow & { status: 'active' | 'completed' | 'archived' };

export const PROJECT_ENTITY = 'project';
const PROJECTS_CACHE_KEY = 'projects:p1';

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

const withPendingProjects = (rows: Project[]): Project[] => {
  const box = coreOutbox.state();
  if (!box) return rows;
  return overlay(box, PROJECT_ENTITY, rows).filter((p) => p.status !== 'archived');
};

/**
 * Projects.
 *
 * Direct `supabase.from('projects')` calls moved to
 * `repositories/projectRepository`. The list is keyset-paginated and the two
 * mutations are owner-scoped and result-checked; previously both matched on
 * `id` alone and discarded the outcome.
 *
 * `removeProject` archives rather than deletes, exactly as before — the name
 * is kept so no call site changes meaning, and the doc says which it is.
 */
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
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY) : null;
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
      error: null,
    });
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    const res = await fetchProjectsPage(cursor);
    if (!res.ok) return set({ loadingMore: false, error: res.error });
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
  },

  addProject: async ({ name, color, description }) => {
    const res = await insertProject({ name, color, description });
    if (res.ok) {
      const row = res.data as Project;
      set((s) => {
        const nextProjects = [row, ...s.projects];
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { projects: nextProjects, error: null };
      });
      return row;
    }
    if (res.offline) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const payload = {
        name,
        color,
        description: description ?? null,
        status: 'active' as const,
      };
      const queued = await coreOutbox.write({ entity: PROJECT_ENTITY, entityId: id, kind: 'create', payload });
      if (queued.ok) {
        const optimistic: Project = {
          id,
          user_id: uid,
          ...payload,
          created_at: new Date().toISOString(),
        };
        set((s) => {
          const nextProjects = [optimistic, ...s.projects];
          if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
          return { projects: nextProjects, error: null };
        });
        return optimistic;
      }
    }
    set({ error: res.error });
    return null;
  },

  updateProject: async (id, patch) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, PROJECT_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: PROJECT_ENTITY, entityId: id, kind: 'update', payload: patch as Record<string, unknown> });
      if (!queued.ok) { set({ error: 'Çevrimdışı proje güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({
        projects: s.projects
          .map((p) => (p.id === id ? ({ ...p, ...patch } as Project) : p))
          .filter((p) => p.status !== 'archived'),
        error: null,
      }));
      return true;
    }

    const res = await repoUpdate(id, patch as Partial<ProjectRow>);
    if (res.ok) {
      set((s) => {
        const nextProjects = s.projects.map((p) => (p.id === id ? (res.data as Project) : p));
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { projects: nextProjects, error: null };
      });
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: PROJECT_ENTITY, entityId: id, kind: 'update', payload: patch as Record<string, unknown> });
      if (queued.ok) {
        set((s) => {
          const nextProjects = s.projects
            .map((p) => (p.id === id ? ({ ...p, ...patch } as Project) : p))
            .filter((p) => p.status !== 'archived');
          void safeUserId().then((uid) => {
            if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
          });
          return { projects: nextProjects, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  removeProject: async (id) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, PROJECT_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: PROJECT_ENTITY, entityId: id, kind: 'update', payload: { status: 'archived' } });
      if (!queued.ok) { set({ error: 'Çevrimdışı proje arşivlenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ projects: s.projects.filter((p) => p.id !== id), error: null }));
      return true;
    }

    const res = await archiveProject(id);
    if (res.ok) {
      set((s) => {
        const nextProjects = s.projects.filter((p) => p.id !== id);
        void safeUserId().then((uid) => {
          if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
        });
        return { projects: nextProjects, error: null };
      });
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: PROJECT_ENTITY, entityId: id, kind: 'update', payload: { status: 'archived' } });
      if (queued.ok) {
        set((s) => {
          const nextProjects = s.projects.filter((p) => p.id !== id);
          void safeUserId().then((uid) => {
            if (uid) void setCachedSnapshot<Page<Project>>(uid, PROJECTS_CACHE_KEY, { rows: nextProjects, nextCursor: s.cursor, hasMore: s.hasMore });
          });
          return { projects: nextProjects, error: null };
        });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },
}));
