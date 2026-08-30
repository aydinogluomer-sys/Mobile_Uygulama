import { create } from 'zustand';
import { supabase, Habit } from '../lib/supabase';
import { scheduleHabitReminder, cancelHabitReminder } from '../lib/notifications';
import {
  activateHabit as activateHabitOp,
  archiveHabit as repoArchiveHabit,
  createHabit as repoInsertHabit,
  listHabits as repoFetchHabits,
  pauseHabit as pauseHabitOp,
  patchHabit as repoUpdateHabit,
  purgeHabit as repoPurgeHabit,
  restoreHabit as repoRestoreHabit,
} from '../services/habitService';
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
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';

/**
 * §22 analytics emission seam (task Phase-4 CODER-O).
 *
 * `lib/analytics.ts` owns the vocabulary, the privacy filter and the sink;
 * this wrapper adds the one thing a CALL SITE owes on top of them:
 *
 *  - `buildEvent` is what actually enforces §22, and it runs HERE, in the
 *    store, before anything is handed on. A habit title or any other prose
 *    is dropped by shape at this line, so the guarantee holds regardless of
 *    what sink is attached later.
 *  - `buildEvent` also THROWS, by design, on an undeclared event name (see
 *    its doc -- `emitEvent`'s own guard deliberately does not cover that,
 *    because it happens before `emitEvent` is reached). Catching it here is
 *    what keeps a future rename from turning a successful habit creation
 *    into a thrown user action.
 *
 * This same four-line wrapper is repeated in `recoveryStore`, `routineStore`
 * and `focusStore` rather than shared, because a shared home for it belongs
 * in `lib/analytics.ts`, which another task owns this round.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

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
    const res = await repoFetchHabits();
    if (res.ok) set({ habits: res.data });
    set({ loading: false });
  },

  addHabit: async (habitData) => {
    const res = await repoInsertHabit(habitData);
    if (res.ok) {
      const h = res.data;
      set((state) => ({ habits: [h, ...state.habits] }));
      if (h.reminders?.enabled && (h.status === 'active' || h.status === 'waiting')) {
        scheduleHabitReminder(h);
      }
      // §22 `habit_created`. This is the store's single creation funnel --
      // every screen, and `routineStore.confirmInstall`'s bulk path aside
      // (which reports its own `routine_installed`), one habit row becomes
      // one event here. Emitted from inside the `!error && data` branch, so
      // a rejected insert can never be reported as a creation. `h.name` is
      // deliberately absent: a habit title is user prose.
      emitAnalytics('habit_created', {
        habit_id: h.id,
        behavior_type: h.behavior_type,
        tracking_type: h.tracking_type,
        status: h.status,
        difficulty: h.difficulty,
        estimated_minutes: h.estimated_minutes,
        willpower_cost: h.willpower_cost,
        has_reminder: !!h.reminders?.enabled,
      });
      return h;
    }
    return null;
  },

  updateHabit: async (id, updates) => {
    const res = await repoUpdateHabit(id, updates);
    if (res.ok) {
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
    const res = await repoArchiveHabit(id);
    if (!res.ok) return;
    cancelHabitReminder(id);
    set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
  },

  // Geri al — arşivden çıkar, orijinal duruma döndür, listeye geri koy
  restoreHabit: async (habit) => {
    const res = await repoRestoreHabit(habit);
    // Restoring is an undo: if the write fails the habit stays archived
    // rather than reappearing in the list as though it had come back.
    if (!res.ok) return;
    set((state) => ({ habits: [habit, ...state.habits.filter((h) => h.id !== habit.id)] }));
    if (habit.reminders?.enabled && (habit.status === 'active' || habit.status === 'waiting')) {
      scheduleHabitReminder(habit);
    }
  },

  // Kalıcı sil — sebebi logla, satırı (ve cascade ile loglarını) kalıcı sil
  purgeHabit: async (habit, reason) => {
    const res = await repoPurgeHabit(habit, reason || null);
    if (!res.ok) return;
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
  // Capacity check -> status write -> willpower charge, in that order, and
  // in one place: `services/habitService.activateHabit`. The ordering is a
  // domain rule (charging a budget for a habit that never activated is worse
  // than the inverse), and it used to be split between this store and
  // willpowerStore with each screen deciding whether to supply the capacity
  // input at all.
  activateHabit: async (id, willpowerCost) => {
    const wp = useWillpowerStore.getState();
    const { habits, loading } = get();
    const target = habits.find((h) => h.id === id);
    if (!target) return;
    const res = await activateHabitOp({
      habit: target,
      cost: willpowerCost,
      willpower: { state: wp.state as never, stale: wp.isStale() },
      activeHabits: habits.filter((h) => h.status === 'active'),
      // A half-loaded habit list under-reports load, so the strict rule is
      // only used once the set is known to be complete.
      useCapacityRule: !loading,
    });
    if (!res.ok) return;
    set((state) => ({ habits: state.habits.map((h) => (h.id === id ? res.habit : h)) }));
    await wp.fetchToday();
  },

  pauseHabit: async (id, willpowerCost) => {
    const wp = useWillpowerStore.getState();
    const res = await pauseHabitOp({
      habitId: id, cost: willpowerCost, willpower: { state: wp.state as never },
    });
    if (!res.ok) return;
    set((state) => ({ habits: state.habits.map((h) => (h.id === id ? res.habit : h)) }));
    await wp.fetchToday();
  },
}));
