import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type Project = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  description?: string | null;
  status: 'active' | 'completed' | 'archived';
  created_at: string;
};

type ProjectStore = {
  projects: Project[];
  loading: boolean;
  fetchProjects: () => Promise<void>;
  addProject: (p: { name: string; color: string; description?: string }) => Promise<Project | null>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
};

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  loading: false,

  fetchProjects: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ loading: false });
      return;
    }
    const { data } = await supabase
      .from('projects')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false });
    if (data) set({ projects: data as Project[] });
    set({ loading: false });
  },

  addProject: async ({ name, color, description }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name, color, description: description ?? null })
      .select()
      .single();
    if (error || !data) return null;
    set((s) => ({ projects: [data as Project, ...s.projects] }));
    return data as Project;
  },

  updateProject: async (id, patch) => {
    await supabase.from('projects').update(patch).eq('id', id);
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  },

  removeProject: async (id) => {
    await supabase.from('projects').update({ status: 'archived' }).eq('id', id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));
