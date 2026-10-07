/**
 * R08.03 / R08.04 — the account's current rows (for the dry run) and the
 * inserts a confirmed restore makes. Only the collections the registry marks
 * restorable are reachable from here; `user_id` is always the signed-in
 * account's, never the file's.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, type RepoResult } from './shared';

export type RestoreTable = 'projects' | 'habits' | 'goals' | 'tasks' | 'notes' | 'journal_entries' | 'bad_habits';
export const RESTORE_TABLES: readonly RestoreTable[] = ['projects', 'habits', 'goals', 'tasks', 'notes', 'journal_entries', 'bad_habits'];

/** Upper bound on rows read per collection for the dry run; matches the export's MAX_ROWS. */
export const MAX_EXISTING = 5000;

export async function fetchExistingRows(table: RestoreTable): Promise<RepoResult<Record<string, unknown>[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', u.userId)
    .limit(MAX_EXISTING);
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status) };
  return { ok: true, data: (data ?? []) as Record<string, unknown>[] };
}

/** Insert rows with their own ids, owned by the signed-in account. */
export async function insertRestoredRows(table: RestoreTable, rows: readonly Record<string, unknown>[]): Promise<RepoResult<number>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  if (rows.length === 0) return { ok: true, data: 0 };
  const { data, error, status } = await supabase
    .from(table)
    .insert(rows.map((r) => ({ ...r, user_id: u.userId })))
    .select('id');
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status), status, code: error.code };
  return { ok: true, data: (data ?? []).length };
}
