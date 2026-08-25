/**
 * `habit_logs` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Four call shapes existed inline across app/**, each with its own column
 * list and filter set (§3 of docs/ARCHITECTURE_V2.md). They are kept as four
 * distinct functions here rather than folded into one parametrised query --
 * collapsing them would risk silently changing a filter or a column list at
 * one of the four call sites, which is exactly the class of regression this
 * migration must not introduce.
 */
import { supabase } from '../lib/supabase';
import type { HabitLog } from '../lib/supabase';
import { currentUserId, RepoResult } from './shared';

export type ReviewLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
export type HeatmapLogRow = Pick<HabitLog, 'completed_at' | 'state'>;
export type HabitIdLogRow = { habit_id: string | null };
export type StreakLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
export type HabitDetailLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

/**
 * `habit_id, completed_at, state, value` for a date range -- source for
 * `reportMetrics.calculateHabitCompletionRate` / `summarizeHabitProgress` on
 * the weekly and monthly review screens. `end` is padded to end-of-day, same
 * as both screens did inline.
 */
export async function fetchHabitLogsForReview(params: {
  start: string;
  end: string;
}): Promise<RepoResult<ReviewLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habit_logs')
    .select('habit_id, completed_at, state, value')
    .eq('user_id', u.userId)
    .gte('completed_at', params.start)
    .lte('completed_at', `${params.end}T23:59:59`)
    .in('state', ['done', 'partial', 'miss', 'skip']);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ReviewLogRow[] };
}

/**
 * `completed_at, state` since a date, restricted to `done`/`partial` --
 * source for the 365-day heatmap on `app/tabs/stats.tsx`.
 */
export async function fetchHabitLogsHeatmap(params: {
  since: string;
}): Promise<RepoResult<HeatmapLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habit_logs')
    .select('completed_at, state')
    .eq('user_id', u.userId)
    .in('state', ['done', 'partial'])
    .gte('completed_at', params.since);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as HeatmapLogRow[] };
}

/**
 * `habit_id` only, since a date, restricted to `done`/`partial` -- source
 * for the 30-day life-area completion counts on `app/tabs/stats.tsx`.
 */
export async function fetchHabitIdsCompletedSince(params: {
  since: string;
}): Promise<RepoResult<HabitIdLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habit_logs')
    .select('habit_id')
    .eq('user_id', u.userId)
    .in('state', ['done', 'partial'])
    .gte('completed_at', params.since);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as HabitIdLogRow[] };
}

/**
 * `habit_id, completed_at, state` for a specific set of habits since a date,
 * newest first -- source for `app/screens/recovery.tsx`'s streak/backlog
 * computation.
 */
export async function fetchHabitLogsForHabitsSince(params: {
  habitIds: string[];
  since: string;
}): Promise<RepoResult<StreakLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habit_logs')
    // `value` is required, not cosmetic: without it `recovery.deficitFor` has
    // nothing to subtract on a `partial` day and reports the FULL target as
    // owed -- 10.000 instead of plan §9's 2.000.
    .select('habit_id, completed_at, state, value')
    .eq('user_id', u.userId)
    .in('habit_id', params.habitIds)
    .gte('completed_at', params.since)
    .in('state', ['done', 'partial'])
    .order('completed_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as StreakLogRow[] };
}

/**
 * `habit_id, completed_at, state, value` for ONE habit over a date range, in
 * ALL FOUR states -- source for `app/screens/habit-detail.tsx` (plan §11,
 * Phase 2 CODER-H). Added rather than reused because no existing shape here
 * matches: `fetchHabitLogsForReview` returns every habit in the range (this
 * screen wants exactly one, to avoid transferring the whole user's log
 * volume for a single-habit view), and `fetchHabitLogsForHabitsSince`
 * restricts to `done`/`partial` only (recovery's own need), which would
 * silently hide `miss`/`skip` days from the Habit Detail calendar and from
 * `lib/behaviorIntelligence.ts`'s streak/fragility/trend math -- both of
 * which read `miss` and `skip` as meaningful, distinct states (see that
 * file's doc). Ascending order (oldest first) matches how the screen walks
 * the range forward to build its calendar/history views, the opposite of
 * `fetchHabitLogsForHabitsSince`'s newest-first order for its own reason.
 */
export async function fetchHabitLogsForHabit(params: {
  habitId: string;
  start: string;
  end: string;
}): Promise<RepoResult<HabitDetailLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('habit_logs')
    .select('habit_id, completed_at, state, value')
    .eq('user_id', u.userId)
    .eq('habit_id', params.habitId)
    .gte('completed_at', params.start)
    .lte('completed_at', `${params.end}T23:59:59`)
    .in('state', ['done', 'partial', 'miss', 'skip'])
    .order('completed_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as HabitDetailLogRow[] };
}
