/**
 * `focus_sessions` reads/deletes.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import { supabase } from '../lib/supabase';
import type { FocusSessionRow } from '../lib/focusReport';
import { requireComplete, selectAllPages } from './pagedSelect';
import { currentUserId, RepoResult, insertOwnedWithId } from './shared';

export type FocusSessionFullRow = FocusSessionRow & { user_id: string; created_at?: string };

const REPORT_COLS = 'id,task_id,task_title,mode,started_at,ended_at,planned_seconds,completed_seconds,completed';
export const FOCUS_SESSION_EXPORT_COLUMNS =
  'id,user_id,task_id,task_title,mode,started_at,ended_at,planned_seconds,completed_seconds,completed,created_at';

/**
 * Report-shaped columns since a given ISO instant, newest first -- shared by
 * `FocusSessionCompleteModal` (last week) and `FocusReportModal` (last year).
 */
export async function fetchFocusSessionsSince(params: {
  sinceIso: string;
}): Promise<RepoResult<FocusSessionRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const r = await selectAllPages<FocusSessionRow>((from, to) =>
    supabase
      .from('focus_sessions')
      .select(REPORT_COLS)
      .eq('user_id', u.userId)
      .gte('started_at', params.sinceIso)
      .order('started_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Odak seansları');
}

/**
 * Every column, newest session first -- source for `FocusSettingsModal`'s
 * full data export (JSON/CSV/Excel).
 */
export async function fetchAllFocusSessions(): Promise<RepoResult<FocusSessionFullRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const r = await selectAllPages<FocusSessionFullRow>(
    (from, to) =>
      supabase
        .from('focus_sessions')
        .select(FOCUS_SESSION_EXPORT_COLUMNS)
        .eq('user_id', u.userId)
        .order('started_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    { maxRows: 20_000 },
  );
  return requireComplete(r, 'Odak seansları');
}

/**
 * Deletes every `focus_sessions` row owned by the current user -- backs
 * `FocusSettingsModal`'s "clear report data" action.
 */
export async function deleteAllFocusSessions(): Promise<RepoResult<void>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error } = await supabase.from('focus_sessions').delete().eq('user_id', u.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Records one completed focus session. (§8 — moved out of store/focusStore.ts.)
 *
 * `user_id` is attached here rather than trusted from the caller, matching
 * every other write in this layer.
 */
// R02.03 — outbox delivery: a session with a client-made id (re-delivery = 23505 = one session).
export const insertFocusSessionRow = (row: Record<string, unknown> & { id: string }, expectedUserId?: string) =>
  insertOwnedWithId<{ id: string }>({ table: 'focus_sessions', row, columns: 'id', expectedUserId });
