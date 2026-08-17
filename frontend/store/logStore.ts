import { create } from 'zustand';
import { supabase, HabitLog } from '../lib/supabase';
import { ymd } from '../lib/date';

/**
 * What a write actually did. The previous signature was `Promise<void>` and
 * both branches destructured only `data`, so every failure -- RLS denial,
 * network drop, constraint violation -- was indistinguishable from success.
 */
export type LogResult =
  | { ok: true; log: HabitLog }
  | { ok: false; error: string };

const COLS = 'id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at';

type LogStore = {
  logs: HabitLog[];
  loading: boolean;
  fetchLogsForDate: (date: Date | string) => Promise<void>;
  logHabit: (params: {
    habitId: string;
    date: Date;
    state: HabitLog['state'];
    value?: number;
    targetValue?: number;
    baseXp?: number;
  }) => Promise<LogResult>;
  getLogForHabit: (habitId: string, date?: Date | string) => HabitLog | undefined;
  getRemainingValue: (habitId: string, targetValue: number, date: Date) => number;
};

function calcXp(baseXp: number, value: number | undefined, targetValue: number | undefined, state: HabitLog['state']): number {
  if (state === 'done') return baseXp;
  if (state === 'partial' && value != null && targetValue != null && targetValue > 0) {
    return Math.round(baseXp * (value / targetValue));
  }
  return 0;
}

/**
 * One promise chain per (habit, day). A second tap on the same habit waits for
 * the first write to settle, so it observes the row the first one created and
 * takes the update branch instead of inserting again. Different habits keep
 * independent chains and remain concurrent.
 *
 * SCOPE, stated rather than implied: this closes the double-tap window *within
 * one client*. It is not a lock. Two devices, or a reinstalled app, can still
 * race. Only a UNIQUE (habit_id, completed_at) constraint makes a duplicate
 * impossible -- so the insert path below also handles the 23505 that such a
 * constraint raises, without depending on it being present.
 */
const chains = new Map<string, Promise<unknown>>();

function serialise<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const result = prev.then(run, run);
  // Drop the entry once this link is the last one, so the map cannot grow
  // without bound over a long session.
  const holder: { tail?: Promise<void> } = {};
  holder.tail = result.then(() => undefined, () => undefined).then(() => {
    if (chains.get(key) === holder.tail) chains.delete(key);
  });
  chains.set(key, holder.tail);
  return result;
}

type Patch = {
  state: HabitLog['state'];
  value: number | null;
  xp: number;
  is_completed: boolean;
};

type SetState = (fn: (s: { logs: HabitLog[] }) => Partial<{ logs: HabitLog[] }>) => void;

async function applyUpdate(set: SetState, id: string, patch: Patch): Promise<LogResult> {
  const { data, error } = await supabase
    .from('habit_logs')
    .update(patch)
    .eq('id', id)
    .select(COLS)
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Kayıt güncellenemedi.' };
  }
  const log = data as HabitLog;
  set((s) => ({
    logs: s.logs.some((l) => l.id === id)
      ? s.logs.map((l) => (l.id === id ? log : l))
      : [...s.logs, log],
  }));
  return { ok: true, log };
}

export const useLogStore = create<LogStore>((set, get) => ({
  logs: [],
  loading: false,

  fetchLogsForDate: async (date) => {
    set({ loading: true });
    const dateStr = typeof date === 'string' ? date : ymd(date);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }

    const { data, error } = await supabase
      .from('habit_logs')
      .select(COLS)
      .eq('user_id', user.id)
      .eq('completed_at', dateStr);

    if (!error && data) set({ logs: data as HabitLog[] });
    set({ loading: false });
  },

  logHabit: ({ habitId, date, state, value, targetValue, baseXp = 30 }) => {
    const dateStr = ymd(date);

    return serialise(`${habitId}|${dateStr}`, async (): Promise<LogResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { ok: false, error: 'Oturum bulunamadı.' };

      const patch: Patch = {
        state,
        value: value ?? null,
        xp: calcXp(baseXp, value, targetValue, state),
        is_completed: state === 'done',
      };

      const existing = get().getLogForHabit(habitId, dateStr);
      if (existing) return applyUpdate(set, existing.id, patch);

      const { data, error } = await supabase
        .from('habit_logs')
        .insert({ habit_id: habitId, user_id: user.id, completed_at: dateStr, ...patch })
        .select(COLS)
        .single();

      if (!error && data) {
        const log = data as HabitLog;
        set((s) => ({ logs: [...s.logs.filter((l) => l.id !== log.id), log] }));
        return { ok: true, log };
      }

      // 23505 = unique_violation. The row exists in the database but not in
      // local state -- another device wrote it, or this date was never
      // fetched. Recover the row and update it rather than dropping the tap.
      if (error?.code === '23505') {
        const { data: found } = await supabase
          .from('habit_logs')
          .select(COLS)
          .eq('habit_id', habitId)
          .eq('user_id', user.id)
          .eq('completed_at', dateStr)
          .maybeSingle();
        if (found) return applyUpdate(set, (found as HabitLog).id, patch);
      }

      return { ok: false, error: error?.message ?? 'Kayıt oluşturulamadı.' };
    });
  },

  getLogForHabit: (habitId, date) => {
    if (!date) {
      return get().logs.find((l) => l.habit_id === habitId);
    }
    const dateStr = typeof date === 'string' ? date : ymd(date);
    return get().logs.find((l) => l.habit_id === habitId && l.completed_at === dateStr);
  },

  getRemainingValue: (habitId, targetValue, date) => {
    const log = get().getLogForHabit(habitId, date);
    const done = log?.value ?? 0;
    return Math.max(0, targetValue - done);
  },
}));
