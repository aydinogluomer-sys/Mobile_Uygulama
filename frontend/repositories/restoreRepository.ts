/**
 * R08.03 / R08.04 — the account's current rows (for the dry run) and the
 * inserts a confirmed restore makes. Only the collections the registry marks
 * restorable are reachable from here; `user_id` is always the signed-in
 * account's, never the file's.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, type RepoResult } from './shared';

export type RestoreTable =
  | 'projects' | 'habits' | 'goals' | 'tasks' | 'notes' | 'journal_entries' | 'bad_habits'
  // R08.01
  | 'okrs' | 'key_results' | 'reading_list' | 'focus_tasks' | 'recovery_plans' | 'weekly_reviews' | 'monthly_reviews'
  | 'habit_pauses' | 'habit_goal_versions' | 'habit_checklist_items' | 'habit_checklist_checks';
export const RESTORE_TABLES: readonly RestoreTable[] = [
  'projects', 'habits', 'goals', 'tasks', 'notes', 'journal_entries', 'bad_habits',
  'okrs', 'key_results', 'reading_list', 'focus_tasks', 'recovery_plans', 'weekly_reviews', 'monthly_reviews',
  'habit_pauses', 'habit_goal_versions', 'habit_checklist_items', 'habit_checklist_checks',
];

/** R08.01 — tables the export reads in full through `fetchOwnedTable` (bounded, keyset-paged). */
export type ExportTable = RestoreTable | 'life_area_logs' | 'deep_work_sessions' | 'ai_conversations' | 'ai_messages'
  | 'ai_conversation_actions' | 'journal_insights' | 'routines' | 'habit_deletions';
export const EXPORT_EXTRA_TABLES: readonly ExportTable[] = [
  'okrs', 'key_results', 'reading_list', 'focus_tasks', 'recovery_plans', 'weekly_reviews', 'monthly_reviews',
  'life_area_logs', 'deep_work_sessions', 'ai_conversations', 'ai_messages',
  'ai_conversation_actions', 'journal_insights', 'routines', 'habit_deletions',
  'habit_pauses', 'habit_goal_versions', 'habit_checklist_items', 'habit_checklist_checks',
];

/** A table that does not exist yet (its migration has not run): skipped, not failed. */
export { isMissingTable } from '../lib/pgErrors';

/**
 * R08.01 — every row of one owned table, keyset-paged by id so nothing is
 * skipped or repeated, up to `max` (the export's per-collection ceiling).
 */
export async function fetchOwnedTable(table: ExportTable, max = MAX_EXISTING, page = 500): Promise<RepoResult<{ rows: Record<string, unknown>[]; truncated: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    let q = supabase.from(table).select('*').eq('user_id', u.userId).order('id', { ascending: true }).limit(page);
    if (after !== null) q = q.gt('id', after);
    const { data, error, status } = await q;
    if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
    const got = (data ?? []) as Record<string, unknown>[];
    rows.push(...got);
    // Truncated only when a row BEYOND the ceiling exists (exactly `max` rows is complete).
    if (rows.length > max) return { ok: true, data: { rows: rows.slice(0, max), truncated: true } };
    if (got.length < page) return { ok: true, data: { rows, truncated: false } };
    after = String(got[got.length - 1].id);
  }
  return { ok: true, data: { rows, truncated: true } };
}

/** Upper bound on rows read per collection for the dry run; matches the export's MAX_ROWS. */
export const MAX_EXISTING = 20_000;

/**
 * The account's current rows of one table, for the dry run's comparison --
 * keyset-paged in full (R08.07: a single capped read left rows past the cap
 * unseen, so a restore could plan them again as missing). Past the ceiling
 * the comparison cannot be trusted and the dry run refuses.
 */
export async function fetchExistingRows(table: RestoreTable): Promise<RepoResult<Record<string, unknown>[]>> {
  const r = await fetchOwnedTable(table, MAX_EXISTING);
  if (!r.ok) return r;
  if (r.data.truncated) return { ok: false, error: `hesapta ${MAX_EXISTING} kayıttan fazla var; karşılaştırma eksik kalırdı`, code: 'TOO_LARGE' };
  return { ok: true, data: r.data.rows };
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
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: (data ?? []).length };
}
