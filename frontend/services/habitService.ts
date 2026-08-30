/**
 * Habit lifecycle.  (plan §8 service layer)
 *
 * ## The orchestration that was scattered
 *
 * Activating a habit touches two tables and one domain rule, and it was
 * spread across three places: the capacity rule in `willpowerStore`, the
 * ordering in `habitStore.activateHabit`, and the decision about WHICH
 * capacity input to supply in each screen. A screen that forgot the input
 * silently got the weaker fixed-slot rule.
 *
 * Purging is the same shape: an audit row and a delete that must happen in
 * that order and must both be reported.
 */
import type { Habit } from '../lib/supabase';
import {
  archiveHabit as repoArchive,
  fetchHabits as repoFetchHabits,
  insertHabit as repoInsert,
  purgeHabit as repoPurge,
  searchHabits as repoSearch,
  updateHabit as repoUpdate,
} from '../repositories/habitRepository';
import {
  fetchHabitIdsCompletedSince,
  fetchHabitLogsForHabit,
  fetchHabitLogsForHabitsSince,
  fetchHabitLogsHeatmap,
  type HabitDetailLogRow,
} from '../repositories/habitLogRepository';
import { evaluateActivation, refund, spend, type ActivationVerdict } from './capacityService';
import type { WillpowerStateRow } from '../repositories/willpowerRepository';

export type { HabitDetailLogRow };

export type HabitInsert = Omit<Habit, 'id' | 'created_at' | 'user_id'>;

export const listHabits = () => repoFetchHabits();
export const searchHabits = (q: string, limit?: number) => repoSearch(q, limit);
export const createHabit = (data: HabitInsert) => repoInsert(data);
export const patchHabit = (id: string, updates: Partial<Habit>) => repoUpdate(id, updates);
export const archiveHabit = (id: string) => repoArchive(id);
export const purgeHabit = (habit: Pick<Habit, 'id' | 'name'>, reason: string | null) =>
  repoPurge(habit, reason);

/**
 * Activates a habit: checks capacity, writes the status, then charges the
 * willpower — in that order.
 *
 * The order is the point. Charging first and then failing the write would
 * debit a budget for a habit that never became active; the previous
 * implementation happened to get this right but nothing recorded that it
 * mattered, and the two steps lived in different files.
 *
 * The capacity check runs against the CURRENT active set, which the caller
 * supplies. Passing an incomplete set under-reports load and permits an
 * activation that should have been refused, so callers that cannot supply it
 * pass nothing and get the conservative fixed-slot rule instead.
 */
export async function activateHabit(params: {
  habit: Habit;
  cost: number;
  willpower: { state: WillpowerStateRow | null; stale: boolean };
  activeHabits: Habit[];
  /** Omit when the active set is not yet loaded — see above. */
  useCapacityRule: boolean;
}): Promise<{ ok: true; habit: Habit } | { ok: false; verdict: ActivationVerdict }> {
  const verdict = evaluateActivation({
    state: params.willpower.state,
    stale: params.willpower.stale,
    cost: params.cost,
    capacityInput: params.useCapacityRule
      ? { habit: params.habit, activeHabits: params.activeHabits }
      : undefined,
  });
  if (!verdict.allowed) return { ok: false, verdict };

  const updated = await repoUpdate(params.habit.id, { status: 'active' } as Partial<Habit>);
  if (!updated.ok) return { ok: false, verdict: { allowed: false, reason: 'no_state' } };

  // Only now is the budget charged: the habit is active, so the spend is
  // real. A failure here leaves an active habit and an uncharged budget,
  // which self-corrects on the next refresh; the inverse would not.
  if (params.willpower.state) await spend(params.willpower.state, params.cost);
  return { ok: true, habit: updated.data };
}

/** Moves a habit back to waiting and returns its willpower. */
export async function pauseHabit(params: {
  habitId: string;
  cost: number;
  willpower: { state: WillpowerStateRow | null };
}): Promise<{ ok: true; habit: Habit } | { ok: false; error: string }> {
  const updated = await repoUpdate(params.habitId, { status: 'waiting' } as Partial<Habit>);
  if (!updated.ok) return { ok: false, error: updated.error };
  if (params.willpower.state) await refund(params.willpower.state, params.cost);
  return { ok: true, habit: updated.data };
}

/**
 * Restores an archived habit to the status it had.
 *
 * Separate from `patchHabit` because it is an UNDO: if the write fails the
 * habit must stay archived rather than reappearing in the list as though it
 * had come back.
 */
export async function restoreHabit(habit: Habit) {
  return repoUpdate(habit.id, { status: habit.status } as Partial<Habit>);
}


// ── Read paths the habit screens need. They live here rather than being
// imported straight from the repository by a screen, so the UI has exactly
// one door into the data layer.
export const logsForHabit = (params: Parameters<typeof fetchHabitLogsForHabit>[0]) =>
  fetchHabitLogsForHabit(params);
export const logsForHabitsSince = (params: Parameters<typeof fetchHabitLogsForHabitsSince>[0]) =>
  fetchHabitLogsForHabitsSince(params);
export const heatmapLogs = (params: Parameters<typeof fetchHabitLogsHeatmap>[0]) =>
  fetchHabitLogsHeatmap(params);
export const habitIdsCompletedSince = (params: Parameters<typeof fetchHabitIdsCompletedSince>[0]) =>
  fetchHabitIdsCompletedSince(params);
