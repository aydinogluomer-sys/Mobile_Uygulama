/**
 * `habit_pauses` + `habit_goal_versions` data access.  (R01.05)
 *
 * Both tables come from `supabase/migrations/028_habit_pauses_and_goal_versions.sql`,
 * which is WRITTEN BUT NOT APPLIED while the canonical project is frozen
 * (STATE.md db_state). Reads are therefore fail-open on a MISSING TABLE only:
 * the result says `available: false` with no rows, every habit behaves as it
 * did before R01.05, and the UI says the server update is pending. Any other
 * error is an error -- a refused or offline read is not silently "no pauses".
 */
import { supabase } from '../lib/supabase';
import type { PauseInterval, GoalVersion, PauseDraft } from '../lib/habitPauses';
import { requireComplete, selectAllPages } from './pagedSelect';
import { currentUserId, deleteOwned, isTransportFailure, updateOwned, type RepoResult } from './shared';

const PAUSE_COLS = 'id,habit_id,kind,start_date,end_date';
const VERSION_COLS = 'habit_id,effective_from,frequency_config,daily_goal,target_direction';

export type Optional<T> = { available: boolean; rows: T[] };

/**
 * PostgREST's "table not in the schema cache" (PGRST205) and Postgres's
 * "relation does not exist" (42P01): the migration has not run. Nothing else.
 */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01');
}

export async function fetchPauses(): Promise<RepoResult<Optional<PauseInterval>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_pauses')
    .select(PAUSE_COLS)
    .eq('user_id', u.userId)
    .order('start_date', { ascending: true })
    .limit(1000);
  if (isMissingTable(error)) return { ok: true, data: { available: false, rows: [] } };
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: { available: true, rows: (data ?? []) as PauseInterval[] } };
}

export async function fetchGoalVersions(): Promise<RepoResult<Optional<GoalVersion>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const r = await selectAllPages<GoalVersion>((from, to) =>
    supabase
      .from('habit_goal_versions')
      .select(VERSION_COLS)
      .eq('user_id', u.userId)
      .order('effective_from', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!r.ok && isMissingTable(r)) return { ok: true, data: { available: false, rows: [] } };
  const complete = requireComplete(r, 'Hedef sürümleri');
  if (!complete.ok) return complete;
  return { ok: true, data: { available: true, rows: complete.data } };
}

/** A pause (habitId set) or a holiday (habitId null). The DB CHECK pins the pairing. */
export async function insertPause(habitId: string | null, draft: PauseDraft): Promise<RepoResult<PauseInterval>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_pauses')
    .insert({ user_id: u.userId, habit_id: habitId, kind: draft.kind, start_date: draft.start_date, end_date: draft.end_date })
    .select(PAUSE_COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: data as PauseInterval };
}

export async function setPauseEnd(id: string, endDate: string): Promise<RepoResult<PauseInterval>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<PauseInterval>({ table: 'habit_pauses', id, userId: u.userId, patch: { end_date: endDate }, columns: PAUSE_COLS });
}

export async function deletePause(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'habit_pauses', id, userId: u.userId });
}

/** Upsert on (habit_id, effective_from): a second edit the same day replaces the first. */
export async function upsertGoalVersions(rows: GoalVersion[]): Promise<RepoResult<GoalVersion[]>> {
  if (rows.length === 0) return { ok: true, data: [] };
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_goal_versions')
    .upsert(rows.map((r) => ({ ...r, user_id: u.userId })), { onConflict: 'habit_id,effective_from' })
    .select(VERSION_COLS);
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: (data ?? []) as GoalVersion[] };
}
