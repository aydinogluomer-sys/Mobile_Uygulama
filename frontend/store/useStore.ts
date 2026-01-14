import { create } from 'zustand';
import { Habit, Task, Completion, Stats } from '../types';

interface AppState {
  habits: Habit[];
  tasks: Task[];
  completions: Completion[];
  stats: Stats | null;
  selectedDate: Date;
  
  setHabits: (habits: Habit[]) => void;
  setTasks: (tasks: Task[]) => void;
  setCompletions: (completions: Completion[]) => void;
  setStats: (stats: Stats) => void;
  setSelectedDate: (date: Date) => void;
  
  addHabit: (habit: Habit) => void;
  updateHabit: (id: string, updates: Partial<Habit>) => void;
  removeHabit: (id: string) => void;
  
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  
  addCompletion: (completion: Completion) => void;
}

export const useStore = create<AppState>((set) => ({
  habits: [],
  tasks: [],
  completions: [],
  stats: null,
  selectedDate: new Date(),
  
  setHabits: (habits) => set({ habits }),
  setTasks: (tasks) => set({ tasks }),
  setCompletions: (completions) => set({ completions }),
  setStats: (stats) => set({ stats }),
  setSelectedDate: (date) => set({ selectedDate: date }),
  
  addHabit: (habit) => set((state) => ({ habits: [...state.habits, habit] })),
  updateHabit: (id, updates) => set((state) => ({
    habits: state.habits.map((h) => h._id === id ? { ...h, ...updates } : h)
  })),
  removeHabit: (id) => set((state) => ({
    habits: state.habits.filter((h) => h._id !== id)
  })),
  
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map((t) => t._id === id ? { ...t, ...updates } : t)
  })),
  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter((t) => t._id !== id)
  })),
  
  addCompletion: (completion) => set((state) => ({
    completions: [...state.completions, completion]
  })),
}));
