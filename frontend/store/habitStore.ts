import { create } from 'zustand';
import { supabase, Habit } from '../lib/supabase';
import { scheduleHabitReminder, cancelHabitReminder } from '../lib/notifications';
// Static import (task Phase-1 CODER-F, W1). Was `await import('./willpowerStore')`
// -- no circular dependency requires deferring it (willpowerStore.ts has no
// import back on this file), and the dynamic form is unexecutable under this
// repo's Jest config (`caller.name: 'metro'` in jest-expo's babel setup keeps
// `import()` as a literal native dynamic import, which Node's Jest VM refuses
// without `--experimental-vm-modules` -- not present here, and out of this
// task's authority to add). Switching to a static import is behaviour-
// preserving (same module, same singleton store) and is what makes
// `activateHabit`'s W1 capacity wiring below provable by an executable test
// instead of only a source-level one.
import { useWillpowerStore } from './willpowerStore';

type HabitInsert = Omit<Habit, 'id' | 'created_at' | 'user_id'>;

type HabitStore = {
  habits: Habit[];
  loading: boolean;
  fetchHabits: () => Promise<void>;
  addHabit: (habit: HabitInsert) => Promise<Habit | null>;
  updateHabit: (id: string, updates: Partial<Habit>) => Promise<void>;
  removeHabit: (id: string) => Promise<void>;
  restoreHabit: (habit: Habit) => Promise<void>;
  purgeHabit: (habit: Habit, reason: string) => Promise<void>;
  activateHabit: (id: string, willpowerCost: number) => Promise<void>;
  pauseHabit: (id: string, willpowerCost: number) => Promise<void>;
};

export const useHabitStore = create<HabitStore>((set, get) => ({
  habits: [],
  loading: false,

  fetchHabits: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ loading: false });
      return;
    }
    const { data, error } = await supabase
      .from('habits')
      .select('id,user_id,name,icon,color,behavior_type,tracking_type,unit,daily_goal,target_direction,frequency_config,willpower_cost,status,impact_level,urgency,difficulty,estimated_minutes,reminders,cue_habit_id,cue_note,life_area,end_condition,created_at')
      .not('status', 'eq', 'archived')
      .order('created_at', { ascending: false });
    if (!error && data) set({ habits: data as Habit[] });
    set({ loading: false });
  },

  addHabit: async (habitData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('habits')
      .insert({ ...habitData, user_id: user.id })
      .select('id,user_id,name,icon,color,behavior_type,tracking_type,unit,daily_goal,target_direction,frequency_config,willpower_cost,status,impact_level,urgency,difficulty,estimated_minutes,reminders,cue_habit_id,cue_note,life_area,end_condition,created_at')
      .single();
    if (!error && data) {
      const h = data as Habit;
      set((state) => ({ habits: [h, ...state.habits] }));
      if (h.reminders?.enabled && (h.status === 'active' || h.status === 'waiting')) {
        scheduleHabitReminder(h);
      }
      return h;
    }
    return null;
  },

  updateHabit: async (id, updates) => {
    const { error } = await supabase.from('habits').update(updates).eq('id', id);
    if (!error) {
      let merged: Habit | undefined;
      set((state) => ({
        habits: state.habits.map((h) => {
          if (h.id !== id) return h;
          merged = { ...h, ...updates };
          return merged;
        }),
      }));
      // Durum/hatırlatıcı değişiminde bildirim senkronu
      if (merged && (updates.status !== undefined || updates.reminders !== undefined)) {
        const active = merged.status === 'active' || merged.status === 'waiting';
        if (merged.reminders?.enabled && active) scheduleHabitReminder(merged);
        else cancelHabitReminder(merged.id);
      }
    }
  },

  removeHabit: async (id) => {
    await supabase.from('habits').update({ status: 'archived' }).eq('id', id);
    cancelHabitReminder(id);
    set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
  },

  // Geri al — arşivden çıkar, orijinal duruma döndür, listeye geri koy
  restoreHabit: async (habit) => {
    await supabase.from('habits').update({ status: habit.status }).eq('id', habit.id);
    set((state) => ({ habits: [habit, ...state.habits.filter((h) => h.id !== habit.id)] }));
    if (habit.reminders?.enabled && (habit.status === 'active' || habit.status === 'waiting')) {
      scheduleHabitReminder(habit);
    }
  },

  // Kalıcı sil — sebebi logla, satırı (ve cascade ile loglarını) kalıcı sil
  purgeHabit: async (habit, reason) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('habit_deletions').insert({
        user_id: user.id,
        habit_id: habit.id,
        habit_name: habit.name,
        reason: reason || null,
      });
    }
    await supabase.from('habits').delete().eq('id', habit.id);
    cancelHabitReminder(habit.id);
    set((state) => ({ habits: state.habits.filter((h) => h.id !== habit.id) }));
  },

  // W1 (task Phase-1 CODER-F): passes the real capacity input (this habit +
  // the currently active ones) into `canActivate` so the load-ceiling rule
  // (Plan §10) gates activation here too, not just the legacy fixed-slot
  // rule. `loading` gates it: while a fetch is in flight, `habits` may not
  // yet reflect the true active set, and a half-populated `activeHabits`
  // would UNDER-report load and wrongly permit an activation it shouldn't --
  // so this falls back to the legacy single-argument call in that case,
  // exactly as every other call site in this task does.
  activateHabit: async (id, willpowerCost) => {
    const wp = useWillpowerStore.getState();
    const { habits, loading } = get();
    const target = habits.find((h) => h.id === id);
    const capacityInput = !loading && target ? { habit: target, activeHabits: habits.filter((h) => h.status === 'active') } : undefined;
    if (!wp.canActivate(willpowerCost, capacityInput)) return;
    await get().updateHabit(id, { status: 'active' });
    await wp.spend(willpowerCost);
  },

  pauseHabit: async (id, willpowerCost) => {
    await get().updateHabit(id, { status: 'waiting' });
    await useWillpowerStore.getState().refund(willpowerCost);
  },
}));
