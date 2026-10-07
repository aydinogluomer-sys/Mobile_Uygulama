import { create } from 'zustand';
import type { Habit } from '../lib/supabase';
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
  loadTimeOff, addTimeOff as addTimeOffOp, endTimeOff as endTimeOffOp, recordGoalVersion,
  loadChecklists, addChecklistItem as addChecklistItemOp, editChecklistItem, setCheck,
} from '../services/habitService';
// R01.04 — checklists: template steps + per-day checks.
import { progressOn, type ChecklistCheck, type ChecklistItem, type ChecklistProgress } from '../lib/habitChecklist';
import { addDaysLocal, todayLocal, ymd } from '../lib/date';
// R01.05 — dated pauses/holidays and goal versions, attached to each habit.
import { attachTimeOff, changesGoal, type GoalVersion, type PauseDraft, type PauseInterval } from '../lib/habitPauses';
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
  /** R01.05 — every pause and holiday of this user. */
  pauses: PauseInterval[];
  goalVersions: GoalVersion[];
  /** R01.05 — false while migration 028 has not run; null until known. */
  timeOffAvailable: boolean | null;
  addTimeOff: (habitId: string | null, draft: PauseDraft) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** R01.04 */
  checklistItems: ChecklistItem[];
  checklistChecks: ChecklistCheck[];
  checklistAvailable: boolean | null;
  addChecklistItem: (habitId: string, title: string, required: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
  setChecklistItemRequired: (itemId: string, required: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
  archiveChecklistItem: (itemId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Tick/untick; returns the day's progress after the write. */
  toggleCheck: (habitId: string, itemId: string, day: string) => Promise<{ ok: true; progress: ChecklistProgress } | { ok: false; error: string }>;
  endTimeOff: (pauseId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  pauses: [],
  goalVersions: [],
  timeOffAvailable: null,
  checklistItems: [],
  checklistChecks: [],
  checklistAvailable: null,

  fetchHabits: async () => {
    set({ loading: true });
    const since = ymd(addDaysLocal(new Date(), -35));
    const [res, off, lists] = await Promise.all([repoFetchHabits(), loadTimeOff(), loadChecklists(since)]);
    if (lists.ok) {
      set({ checklistItems: lists.data.items, checklistChecks: lists.data.checks, checklistAvailable: lists.data.available });
    }
    if (off.ok) {
      set({ pauses: off.data.pauses, goalVersions: off.data.versions, timeOffAvailable: off.data.available });
    }
    // A failed time-off read keeps what was loaded before (and stays unknown
    // the first time) rather than presenting "no pauses" as a fact.
    if (res.ok) {
      const { pauses, goalVersions } = get();
      set({ habits: attachTimeOff(res.data, pauses, goalVersions) });
    }
    set({ loading: false });
  },

  addTimeOff: async (habitId, draft) => {
    if (get().timeOffAvailable !== true) return { ok: false, error: 'Bu özellik sunucu güncellemesini bekliyor.' };
    const res = await addTimeOffOp({ habitId, draft, today: todayLocal(), existing: get().pauses });
    if (!res.ok) return res;
    const pauses = [...get().pauses, res.pause];
    set((st) => ({ pauses, habits: attachTimeOff(st.habits, pauses, st.goalVersions) }));
    return { ok: true };
  },

  addChecklistItem: async (habitId, title, required) => {
    if (get().checklistAvailable !== true) return { ok: false, error: 'Bu özellik sunucu güncellemesini bekliyor.' };
    const res = await addChecklistItemOp({ habitId, title, required, existing: get().checklistItems });
    if (!res.ok) return res;
    set((st) => ({ checklistItems: [...st.checklistItems, res.item] }));
    return { ok: true };
  },

  setChecklistItemRequired: async (itemId, required) => {
    const res = await editChecklistItem(itemId, { required });
    if (!res.ok) return { ok: false, error: res.error };
    set((st) => ({ checklistItems: st.checklistItems.map((i) => (i.id === itemId ? { ...i, required } : i)) }));
    return { ok: true };
  },

  archiveChecklistItem: async (itemId) => {
    const at = new Date().toISOString();
    const res = await editChecklistItem(itemId, { archived_at: at });
    if (!res.ok) return { ok: false, error: res.error };
    set((st) => ({ checklistItems: st.checklistItems.map((i) => (i.id === itemId ? { ...i, archived_at: at } : i)) }));
    return { ok: true };
  },

  toggleCheck: async (habitId, itemId, day) => {
    if (get().checklistAvailable !== true) return { ok: false, error: 'Bu özellik sunucu güncellemesini bekliyor.' };
    const on = !get().checklistChecks.some((c) => c.item_id === itemId && c.day === day);
    const check: ChecklistCheck = { item_id: itemId, habit_id: habitId, day };
    const res = await setCheck(check, on);
    // A refused write leaves the tick as it was -- never shown as saved.
    if (!res.ok) return { ok: false, error: res.error };
    const checks = on
      ? [...get().checklistChecks, check]
      : get().checklistChecks.filter((c) => !(c.item_id === itemId && c.day === day));
    set({ checklistChecks: checks });
    return { ok: true, progress: progressOn(get().checklistItems, checks, habitId, day) };
  },

  endTimeOff: async (pauseId) => {
    const target = get().pauses.find((p) => p.id === pauseId);
    if (!target) return { ok: false, error: 'Kayıt bulunamadı.' };
    const res = await endTimeOffOp(target, todayLocal());
    if (!res.ok) return res;
    const pauses = res.pause
      ? get().pauses.map((p) => (p.id === pauseId ? res.pause! : p))
      : get().pauses.filter((p) => p.id !== pauseId);
    set((st) => ({ pauses, habits: attachTimeOff(st.habits, pauses, st.goalVersions) }));
    return { ok: true };
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
    const before = get().habits.find((h) => h.id === id);
    const res = await repoUpdateHabit(id, updates);
    // R01.05 — a schedule/goal edit takes effect from today; the past keeps
    // the goal it had. Only once the habit write is accepted, and only when
    // the versions table exists.
    if (res.ok && before && changesGoal(updates) && get().timeOffAvailable === true) {
      const v = await recordGoalVersion(before, {
        frequency_config: updates.frequency_config ?? before.frequency_config,
        daily_goal: updates.daily_goal !== undefined ? updates.daily_goal : before.daily_goal,
        target_direction: updates.target_direction !== undefined ? updates.target_direction : before.target_direction,
      }, todayLocal());
      if (v.ok) {
        const keys = new Set(v.versions.map((x) => `${x.habit_id}|${x.effective_from}`));
        const goalVersions = [...get().goalVersions.filter((x) => !keys.has(`${x.habit_id}|${x.effective_from}`)), ...v.versions];
        set((st) => ({ goalVersions, habits: attachTimeOff(st.habits, st.pauses, goalVersions) }));
      }
    }
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
