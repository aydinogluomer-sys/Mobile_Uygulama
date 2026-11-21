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
import { requireComplete, selectAllPages } from './pagedSelect';
import { currentUserId, isTransportFailure, updateOwned, type RepoResult } from './shared';

export type ReviewLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
export type HeatmapLogRow = Pick<HabitLog, 'completed_at' | 'state'>;
export type HabitIdLogRow = { habit_id: string | null };
export type StreakLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
export type HabitDetailLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

const HABIT_ID_BATCH = 100;

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
  const r = await selectAllPages<ReviewLogRow>((from, to) =>
    supabase
      .from('habit_logs')
      .select('habit_id, completed_at, state, value')
      .eq('user_id', u.userId)
      .gte('completed_at', params.start)
      .lte('completed_at', `${params.end}T23:59:59`)
      .in('state', ['done', 'partial', 'miss', 'skip'])
      .order('completed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Değerlendirme kayıtları');
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
  const r = await selectAllPages<HeatmapLogRow>((from, to) =>
    supabase
      .from('habit_logs')
      .select('completed_at, state')
      .eq('user_id', u.userId)
      .in('state', ['done', 'partial'])
      .gte('completed_at', params.since)
      .order('completed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Isı haritası');
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
  const r = await selectAllPages<HabitIdLogRow>((from, to) =>
    supabase
      .from('habit_logs')
      .select('habit_id')
      .eq('user_id', u.userId)
      .in('state', ['done', 'partial'])
      .gte('completed_at', params.since)
      .order('completed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Alışkanlık tamamlamaları');
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
  if (params.habitIds.length === 0) return { ok: true, data: [] };

  const all: StreakLogRow[] = [];
  for (let i = 0; i < params.habitIds.length; i += HABIT_ID_BATCH) {
    const ids = params.habitIds.slice(i, i + HABIT_ID_BATCH);
    const r = await selectAllPages<StreakLogRow>((from, to) =>
      supabase
        .from('habit_logs')
        // `value` is required, not cosmetic: without it `recovery.deficitFor` has
        // nothing to subtract on a `partial` day and reports the FULL target as
        // owed -- 10.000 instead of plan §9's 2.000.
        .select('habit_id, completed_at, state, value')
        .eq('user_id', u.userId)
        .in('habit_id', ids)
        .gte('completed_at', params.since)
        .in('state', ['done', 'partial'])
        .order('completed_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    const checked = requireComplete(r, 'Alışkanlık geçmişi');
    if (!checked.ok) return checked;
    all.push(...checked.data);
  }
  if (params.habitIds.length > HABIT_ID_BATCH) {
    all.sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  }
  return { ok: true, data: all };
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
  const r = await selectAllPages<HabitDetailLogRow>((from, to) =>
    supabase
      .from('habit_logs')
      .select('habit_id, completed_at, state, value')
      .eq('user_id', u.userId)
      .eq('habit_id', params.habitId)
      .gte('completed_at', params.start)
      .lte('completed_at', `${params.end}T23:59:59`)
      .in('state', ['done', 'partial', 'miss', 'skip'])
      .order('completed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Alışkanlık detayı');
}

// ---------------------------------------------------------------------------
// Write path. (§8 — moved out of store/logStore.ts.)
//
// These are the queries only; the ORCHESTRATION around them — optimistic
// state, the offline queue, the serialise() chain, the 23505 recovery
// decision — stays in the store, because that is genuine domain logic rather
// than data access. Splitting it out would have produced a repository that
// knew about Zustand.
// ---------------------------------------------------------------------------

const WRITE_COLS = 'id,habit_id,user_id,completed_at,value,is_completed,state,xp,created_at';

/** Every log for one local day. */
export async function fetchLogsForDate(dateStr: string): Promise<RepoResult<HabitLog[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // One local day, so the row count is bounded by how many habits the user
  // has. The explicit cap exists anyway: "bounded in practice" is not a bound,
  // and a query that relies on the shape of today's data is one schema change
  // from being unbounded.
  const { data, error } = await supabase
    .from('habit_logs')
    .select(WRITE_COLS)
    .eq('user_id', u.userId)
    .eq('completed_at', dateStr)
    .limit(500);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as HabitLog[] };
}

/**
 * Inserts a log. The caller needs to distinguish a unique-violation from any
 * other failure — that is what drives the recovery branch — so the error
 * CODE is carried through rather than flattened to a message.
 */
export async function insertHabitLog(params: {
  habitId: string;
  dateStr: string;
  patch: Record<string, unknown>;
}): Promise<RepoResult<HabitLog> & { code?: string }> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_logs')
    .insert({
      habit_id: params.habitId,
      user_id: u.userId,
      completed_at: params.dateStr,
      ...params.patch,
    })
    .select(WRITE_COLS)
    .single();
  if (error) {
    return {
      ok: false, error: error.message, code: error.code,
      offline: isTransportFailure(status, error),
      // F05 (SYN-03): the status lets the service tell a transient server failure from a refusal
      status,
    };
  }
  return { ok: true, data: data as unknown as HabitLog };
}

/** The existing row for a (habit, day), used to recover from a 23505. */
export async function findHabitLog(params: {
  habitId: string;
  dateStr: string;
}): Promise<RepoResult<HabitLog | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_logs')
    .select(WRITE_COLS)
    .eq('habit_id', params.habitId)
    .eq('user_id', u.userId)
    .eq('completed_at', params.dateStr)
    .maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status };
  return { ok: true, data: (data ?? null) as HabitLog | null };
}

export async function updateHabitLog(
  id: string,
  patch: Record<string, unknown>,
): Promise<RepoResult<HabitLog>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<HabitLog>({
    table: 'habit_logs', id, userId: u.userId, patch, columns: WRITE_COLS,
  });
}
