import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { todayLocal } from '../lib/date';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low' | 'none';
export type ListType = 'inbox' | 'this_week' | 'someday';

export type QuadrantType = 'UI' | 'NI' | 'UN' | 'NN' | null;

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string | null;
  project_id?: string | null;
  list_type: ListType;
  notes_text?: string | null;
  completed: boolean;
  completed_at?: string | null;
  quadrant?: QuadrantType;
  created_at: string;
  updated_at?: string | null;
};

type TaskStore = {
  tasks: Task[];
  loading: boolean;
  fetchTasks: () => Promise<void>;
  addTask: (t: Partial<Task>) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  moveToList: (id: string, list: ListType) => Promise<void>;
  archiveTask: (id: string) => Promise<void>;
  updateQuadrant: (id: string, quadrant: QuadrantType) => Promise<void>;
  // Selectors
  byList: (list: ListType) => Task[];
  overdue: () => Task[];
  dueToday: () => Task[];
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,

  fetchTasks: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ loading: false });
      return;
    }
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    if (data) set({ tasks: data as Task[] });
    set({ loading: false });
  },

  addTask: async (t) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const row = {
      user_id: user.id,
      title: t.title ?? '',
      status: t.status ?? 'pending',
      priority: t.priority ?? 'none',
      list_type: t.list_type ?? 'inbox',
      due_date: t.due_date ?? null,
      project_id: t.project_id ?? null,
      description: t.description ?? null,
      notes_text: t.notes_text ?? null,
      completed: false,
    };
    const { data, error } = await supabase.from('tasks').insert(row).select().single();
    if (error || !data) return null;
    set((s) => ({ tasks: [data as Task, ...s.tasks] }));
    return data as Task;
  },

  updateTask: async (id, patch) => {
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (!error) {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    }
  },

  removeTask: async (id) => {
    await supabase.from('tasks').delete().eq('id', id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  toggleDone: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const done = !task.completed;
    const patch: Partial<Task> = {
      completed: done,
      status: done ? 'completed' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
    };
    await get().updateTask(id, patch);
  },

  moveToList: async (id, list) => {
    await get().updateTask(id, { list_type: list });
  },

  archiveTask: async (id) => {
    await get().updateTask(id, { status: 'cancelled' });
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  updateQuadrant: async (id, quadrant) => {
    await get().updateTask(id, { quadrant });
  },

  byList: (list) => {
    return get().tasks.filter(
      (t) => t.list_type === list && t.status !== 'cancelled' && !t.completed
    );
  },

  overdue: () => {
    const today = todayLocal();
    return get().tasks.filter(
      (t) => t.due_date && t.due_date < today && !t.completed && t.status !== 'cancelled'
    );
  },

  dueToday: () => {
    const today = todayLocal();
    return get().tasks.filter(
      (t) => t.due_date === today && !t.completed && t.status !== 'cancelled'
    );
  },
}));
