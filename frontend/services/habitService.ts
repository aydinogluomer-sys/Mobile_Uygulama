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
import {
  deletePause, fetchGoalVersions, fetchPauses, insertPause, setPauseEnd, upsertGoalVersions,
} from '../repositories/habitPauseRepository';
import {
  deleteCheck, fetchChecklistChecks, fetchChecklistItems, insertCheck, insertChecklistItem, patchChecklistItem,
} from '../repositories/habitChecklistRepository';
import { nextPosition, validateItem, type ChecklistCheck, type ChecklistItem } from '../lib/habitChecklist';
import {
  endPauseOn, validatePause, versionRowsForEdit,
  type GoalVersion, type PauseDraft, type PauseInterval,
} from '../lib/habitPauses';

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

// ── R01.05 — dated time off (pause / holiday) and goal versions ────────────

export type TimeOff = { available: boolean; pauses: PauseInterval[]; versions: GoalVersion[] };

/**
 * Both lists, or `available: false` while migration 028 has not run. A
 * failed read (refused, offline) is an error, never "no pauses".
 */
export async function loadTimeOff(): Promise<{ ok: true; data: TimeOff } | { ok: false; error: string }> {
  const [p, v] = await Promise.all([fetchPauses(), fetchGoalVersions()]);
  if (!p.ok) return { ok: false, error: p.error };
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, data: { available: p.data.available && v.data.available, pauses: p.data.rows, versions: v.data.rows } };
}

/** A pause for one habit, or a holiday (`habitId` null), checked before it is written. */
export async function addTimeOff(params: {
  habitId: string | null;
  draft: PauseDraft;
  today: string;
  existing: readonly PauseInterval[];
}): Promise<{ ok: true; pause: PauseInterval } | { ok: false; error: string }> {
  const mine = params.existing.filter((x) => x.habit_id === params.habitId);
  const check = validatePause(params.draft, params.today, mine);
  if (!check.ok) return { ok: false, error: check.reason };
  const res = await insertPause(params.habitId, params.draft);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, pause: res.data };
}

/** End a pause today: it covered up to yesterday, or never started and is removed. */
export async function endTimeOff(pause: PauseInterval, today: string): Promise<{ ok: true; pause: PauseInterval | null } | { ok: false; error: string }> {
  const step = endPauseOn(pause, today);
  if (step.action === 'delete') {
    const res = await deletePause(pause.id);
    return res.ok ? { ok: true, pause: null } : { ok: false, error: res.error };
  }
  const res = await setPauseEnd(pause.id, step.end_date);
  return res.ok ? { ok: true, pause: res.data } : { ok: false, error: res.error };
}

/**
 * The version rows a schedule/goal edit writes. Called AFTER the habit patch
 * succeeded: a version written for a patch that then failed would claim a
 * goal the habit never had. A failed version write is reported, not fatal --
 * the habit change stands and the past is scored as it was before R01.05.
 */
export async function recordGoalVersion(
  habit: Pick<Habit, 'id' | 'created_at' | 'frequency_config' | 'daily_goal' | 'target_direction' | 'goal_versions'>,
  next: Pick<GoalVersion, 'frequency_config' | 'daily_goal' | 'target_direction'>,
  today: string,
): Promise<{ ok: true; versions: GoalVersion[] } | { ok: false; error: string }> {
  const rows = versionRowsForEdit(habit, next, today);
  const res = await upsertGoalVersions(rows);
  return res.ok ? { ok: true, versions: res.data } : { ok: false, error: res.error };
}

// ── R01.04 — habit checklists ───────────────────────────────────────────────

export type Checklists = { available: boolean; items: ChecklistItem[]; checks: ChecklistCheck[] };

/** Items and recent checks, or `available: false` while migration 029 has not run. */
export async function loadChecklists(sinceDay: string): Promise<{ ok: true; data: Checklists } | { ok: false; error: string }> {
  const [i, c] = await Promise.all([fetchChecklistItems(), fetchChecklistChecks(sinceDay)]);
  if (!i.ok) return { ok: false, error: i.error };
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, data: { available: i.data.available && c.data.available, items: i.data.rows, checks: c.data.rows } };
}

/** A new step at the end of the habit's list, checked against the limits first. */
export async function addChecklistItem(params: {
  habitId: string; title: string; required: boolean; existing: readonly ChecklistItem[];
}): Promise<{ ok: true; item: ChecklistItem } | { ok: false; error: string }> {
  const check = validateItem(params.title, params.existing, params.habitId);
  if (!check.ok) return { ok: false, error: check.reason };
  const res = await insertChecklistItem({
    habit_id: params.habitId, title: check.title, required: params.required,
    position: nextPosition(params.existing, params.habitId),
  });
  return res.ok ? { ok: true, item: res.data } : { ok: false, error: res.error };
}

/** Required/optional, or archive (never delete: past days keep the steps they had). */
export async function editChecklistItem(id: string, patch: { required?: boolean; archived_at?: string }) {
  return patchChecklistItem(id, patch);
}

/** Tick or untick one step for one day. */
export async function setCheck(check: ChecklistCheck, on: boolean) {
  return on ? insertCheck(check) : deleteCheck(check);
}
