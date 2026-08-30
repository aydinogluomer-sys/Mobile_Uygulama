import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  deleteTask as repoDeleteTask,
  fetchTasksPage,
  insertTask,
  updateTask as repoUpdateTask,
} from '../repositories/taskRepository';
import type { Cursor } from '../repositories/shared';
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
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  cursor: Cursor | null;
  fetchTasks: () => Promise<void>;
  loadMore: () => Promise<void>;
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
  loadingMore: false,
  hasMore: false,
  error: null,
  cursor: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    const res = await fetchTasksPage(null);
    if (!res.ok) return set({ loading: false, error: res.error });
    set({
      tasks: res.data.rows,
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
    });
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    const res = await fetchTasksPage(cursor);
    if (!res.ok) return set({ loadingMore: false, error: res.error });
    set((s) => {
      const seen = new Set(s.tasks.map((t) => t.id));
      const fresh = res.data.rows.filter((t) => !seen.has(t.id));
      return {
        tasks: [...s.tasks, ...fresh],
        cursor: res.data.nextCursor,
        hasMore: res.data.hasMore,
        loadingMore: false,
      };
    });
  },

  addTask: async (t) => {
    const res = await insertTask(t);
    if (!res.ok) { set({ error: res.error }); return null; }
    set((s) => ({ tasks: [res.data, ...s.tasks], error: null }));
    return res.data;
  },

  updateTask: async (id, patch) => {
    const res = await repoUpdateTask(id, patch);
    if (!res.ok) { set({ error: res.error }); return; }
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? res.data : t)), error: null }));
  },

  removeTask: async (id) => {
    const res = await repoDeleteTask(id);
    // A failed delete leaves the row on screen; removing it regardless is how
    // the previous version reported something that had not happened.
    if (!res.ok) { set({ error: res.error }); return; }
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), error: null }));
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
