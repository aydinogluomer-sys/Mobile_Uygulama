import { create } from 'zustand';
import {
  archiveProject,
  fetchProjectsPage,
  insertProject,
  updateProject as repoUpdate,
  type ProjectRow,
} from '../repositories/projectRepository';
import type { Cursor } from '../repositories/shared';

export type Project = ProjectRow & { status: 'active' | 'completed' | 'archived' };

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
    set({ loading: true, error: null });
    const res = await fetchProjectsPage(null);
    if (!res.ok) return set({ loading: false, error: res.error });
    set({
      projects: res.data.rows as Project[],
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
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
    if (!res.ok) {
      set({ error: res.error });
      return null;
    }
    const row = res.data as Project;
    set((s) => ({ projects: [row, ...s.projects], error: null }));
    return row;
  },

  updateProject: async (id, patch) => {
    const res = await repoUpdate(id, patch as Partial<ProjectRow>);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? (res.data as Project) : p)),
      error: null,
    }));
    return true;
  },

  removeProject: async (id) => {
    const res = await archiveProject(id);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id), error: null }));
    return true;
  },
}));
