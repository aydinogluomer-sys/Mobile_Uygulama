/**
 * `habits` writes for the validated Routine/AI install path.  (Phase 3,
 * CODER-J, plan §13 Rule 4 + the AI validation gate)
 *
 * The one function this task adds to the repository layer (see this task's
 * report). Before this change, `store/routineStore.ts`'s
 * `addGeneratedToHabits` wrote to `habits` with a bare
 * `supabase.from('habits').insert(inserts)` call sitting directly inside the
 * STORE, fed by the AI's JSON with only nullish-coalescing defaults — no
 * validation, no capacity check. `store/routineStore.ts`'s `confirmInstall`
 * (this task's W3) now calls THIS function instead, and only ever with rows
 * built from an already-validated `RoutineProposal` (see
 * `lib/routineProposal.ts`) — never with the AI's raw response.
 *
 * Every OTHER `habits` write in the app (manual add/edit/archive/restore/
 * purge via `store/habitStore.ts`) is unchanged and out of this task's
 * scope; this file exists narrowly for the Routine/AI install path so it
 * gets the same typed `RepoResult` convention every other repository uses,
 * instead of a second ad-hoc insert call site.
 */
import { todayLocal } from '../lib/date';
import { stampCreatedDay } from '../lib/habitCreatedDay';
import { stripTimeOff } from '../lib/habitPauses';
import { supabase } from '../lib/supabase';
import type { Habit, FrequencyConfig } from '../lib/supabase';
import { likeContains } from './likePattern';
import { SERVER_MAX_ROWS } from './pagedSelect';
import { currentUserId, deleteOwned, updateOwned, type RepoResult } from './shared';

/** Column list mirrors `store/habitStore.ts`'s `addHabit`/`fetchHabits` --
 *  same table, same shape, kept consistent rather than reinvented. */
const HABIT_COLUMNS =
  'id,user_id,name,icon,color,behavior_type,tracking_type,unit,daily_goal,target_direction,frequency_config,willpower_cost,status,impact_level,urgency,difficulty,estimated_minutes,reminders,cue_habit_id,cue_note,life_area,end_condition,created_at';

/** What `confirmInstall` (routineStore.ts) hands this repository per habit
 *  -- already-validated proposal fields, plus the install-time decisions
 *  (`status`) and app-level defaults (`icon`/`unit`/etc.) the AI-facing
 *  schema never carries. */
export type InstallHabitRow = {
  name: string;
  icon: string | null;
  tracking_type: 'boolean' | 'numeric';
  unit: string | null;
  daily_goal: number | null;
  target_direction: 'at_least' | 'at_most' | null;
  frequency_config: FrequencyConfig;
  willpower_cost: number;
  difficulty: number;
  estimated_minutes: number;
  /** Capacity-gated by `evaluateProposal` before this is ever called --
   *  'active' only for habits that fit under the ceiling, 'waiting'
   *  (queued) otherwise. Never any other status. */
  status: 'active' | 'waiting';
};

/**
 * Bulk-inserts already-validated, already-capacity-evaluated habit rows.
 * Empty input is a no-op success (not an error) so a caller never needs a
 * special case for "the proposal had zero habits that made it this far".
 */
/**
 * Inserts a routine/plan's habits, optionally stamping them with the install
 * that produced them.
 *
 * `installId` is OPTIONAL and defaults to null, so a Routine Pack, an AI
 * proposal or a hand-made habit is unchanged and stays invisible to install
 * recovery. Only the onboarding installer passes one, and only rows carrying
 * it can ever be counted as evidence that that install landed.
 */
export async function insertRoutineHabits(
  rows: InstallHabitRow[],
  installId?: string | null,
): Promise<RepoResult<Habit[]>> {
  if (rows.length === 0) return { ok: true, data: [] };

  const u = await currentUserId();
  if (!u.ok) return u;

  const today = todayLocal();
  const inserts = rows.map((r) => ({
    user_id: u.userId,
    name: r.name,
    icon: r.icon,
    behavior_type: 'positive' as const,
    tracking_type: r.tracking_type,
    unit: r.unit,
    daily_goal: r.daily_goal,
    target_direction: r.target_direction,
    frequency_config: stampCreatedDay(r.frequency_config, today),
    willpower_cost: r.willpower_cost,
    status: r.status,
    impact_level: 'medium' as const,
    urgency: 'not_urgent' as const,
    difficulty: r.difficulty,
    estimated_minutes: r.estimated_minutes,
    install_id: installId ?? null,
  }));

  const { data, error } = await supabase
    .from('habits')
    .insert(inserts)
    .select(HABIT_COLUMNS);
  if (error) {
    if (error.code === '23505' && installId) {
      const existing = await supabase
        .from('habits')
        .select(HABIT_COLUMNS)
        .eq('user_id', u.userId)
        .eq('install_id', installId)
        .limit(20);
      if (!existing.error && Array.isArray(existing.data) && existing.data.length > 0) {
        return { ok: true, data: existing.data as Habit[] };
      }
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, data: (data ?? []) as Habit[] };
}

// ---------------------------------------------------------------------------
// Habit mutations. (§8 — moved out of store/habitStore.ts, where all four
// matched on `id` alone and three discarded their result.)
// ---------------------------------------------------------------------------

export async function updateHabit(
  id: string,
  updates: Partial<Habit>,
): Promise<RepoResult<Habit>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<Habit>({
    table: 'habits', id, userId: u.userId,
    // R01.05 — pause_intervals / goal_versions are in-memory only.
    patch: stripTimeOff(updates) as Record<string, unknown>, columns: HABIT_COLUMNS,
  });
}

/** Soft delete — archiving, which is what `removeHabit` always did. */
export async function archiveHabit(id: string): Promise<RepoResult<Habit>> {
  return updateHabit(id, { status: 'archived' } as Partial<Habit>);
}

/**
 * Permanent delete, with the reason recorded first.
 *
 * Order matters and is deliberate: the audit row is written BEFORE the habit
 * is removed. `habit_deletions.habit_id` references a row that is about to
 * disappear, so writing it afterwards would either fail or record nothing —
 * and the previous version ignored the insert's result entirely, so a failed
 * audit write was invisible while the delete went ahead regardless.
 */
export async function purgeHabit(
  habit: Pick<Habit, 'id' | 'name'>,
  reason: string | null,
): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const audit = await supabase.from('habit_deletions').insert({
    user_id: u.userId,
    habit_id: habit.id,
    habit_name: habit.name,
    reason: reason || null,
  });
  if (audit.error) return { ok: false, error: `Silme kaydı yazılamadı: ${audit.error.message}` };

  return deleteOwned({ table: 'habits', id: habit.id, userId: u.userId });
}

/** All non-archived habits for the current user, newest first. */
export async function fetchHabits(limit = 500): Promise<RepoResult<Habit[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habits')
    .select(HABIT_COLUMNS)
    .eq('user_id', u.userId)
    .not('status', 'eq', 'archived')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, SERVER_MAX_ROWS)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as Habit[] };
}

/** Creates one habit, attaching `user_id` here rather than from the caller. */
export async function insertHabit(
  rawHabit: Omit<Habit, 'id' | 'created_at' | 'user_id'>,
): Promise<RepoResult<Habit>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const habit = {
    ...rawHabit,
    frequency_config: stampCreatedDay(rawHabit.frequency_config, todayLocal()),
  };
  const { data, error } = await supabase
    .from('habits')
    .insert({ ...stripTimeOff(habit), user_id: u.userId })
    .select(HABIT_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as Habit };
}

/** Server-side name search — see `taskRepository.searchTasks` for why. */
export async function searchHabits(query: string, limit = 8): Promise<RepoResult<Habit[]>> {
  const pattern = likeContains(query);
  if (pattern === null) return { ok: true, data: [] };
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habits')
    .select(HABIT_COLUMNS)
    .eq('user_id', u.userId)
    .not('status', 'eq', 'archived')
    .ilike('name', pattern)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 25));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as Habit[] };
}

/**
 * How many habits THIS install produced, for THIS user.
 *
 * The question install recovery has to answer, and the one the previous
 * implementation could not ask. It counted the account's habits instead, so
 * an existing user with eight unrelated habits who reopened onboarding and
 * crashed before the insert was told their new plan had landed — and the
 * completion was written for habits that were never created.
 *
 * `install_id` is null on every habit that did not come from an onboarding
 * install, so those rows cannot be counted here however many of them there
 * are. `user_id` is filtered explicitly as well as by RLS, the same
 * defence-in-depth as every other read in this layer.
 *
 * `head: true` asks Postgres for the count and no rows: recovery needs a
 * number, and shipping the habits back to compare lengths would be a page of
 * data fetched to be discarded.
 */
export async function countHabitsForInstall(installId: string): Promise<RepoResult<number>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { count, error } = await supabase
    .from('habits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', u.userId)
    .eq('install_id', installId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: count ?? 0 };
}
