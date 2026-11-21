/**
 * R08.03 / R08.04 — the account's current rows (for the dry run) and the
 * inserts a confirmed restore makes. Only the collections the registry marks
 * restorable are reachable from here; `user_id` is always the signed-in
 * account's, never the file's.
 */
import { supabase } from '../lib/supabase';
import { keysetAll } from './pagedSelect';
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
// Bu listeye `id` sütunu olmayan tablo eklenemez; `exportCompleteness.test.ts` canlı şemadan doğrular.
export const EXPORT_EXTRA_TABLES: readonly ExportTable[] = [
  'okrs', 'key_results', 'reading_list', 'focus_tasks', 'recovery_plans', 'weekly_reviews', 'monthly_reviews',
  'life_area_logs', 'deep_work_sessions', 'ai_conversations', 'ai_messages',
  'ai_conversation_actions', 'journal_insights', 'routines', 'habit_deletions',
  'habit_pauses', 'habit_goal_versions', 'habit_checklist_items', 'habit_checklist_checks',
];

/** A table that does not exist yet (its migration has not run): skipped, not failed. */
export { isMissingTable } from '../lib/pgErrors';

/** Upper bound on rows read per collection for the dry run; matches the export's MAX_ROWS. */
export const MAX_EXISTING = 20_000;

/**
 * R08.01 — every row of one owned table, keyset-paged by id so nothing is
 * skipped or repeated, up to `max` (the export's per-collection ceiling).
 */
export async function fetchOwnedTable(
  table: ExportTable,
  max = MAX_EXISTING,
  page = 500,
): Promise<RepoResult<{ rows: Record<string, unknown>[]; truncated: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return keysetAll<Record<string, unknown>>((after, limit) => {
    let q = supabase.from(table).select('*').eq('user_id', u.userId).order('id', { ascending: true }).limit(limit);
    if (after !== null) q = q.gt('id', after);
    return q;
  }, { maxRows: max, pageSize: page });
}

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

type ResilientResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string; code?: string; status?: number; offline?: boolean; inserted: number };

async function insertResilient(
  table: RestoreTable,
  rows: readonly Record<string, unknown>[],
  uid: string,
): Promise<ResilientResult> {
  const { data, error, status } = await supabase
    .from(table)
    .insert(rows.map((r) => ({ ...r, user_id: uid })))
    .select('id');
  if (!error) return { ok: true, inserted: (data ?? []).length, skipped: 0 };
  if (error.code !== '23505') {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status,
      offline: isTransportFailure(status, error),
      inserted: 0,
    };
  }
  // Başka bir cihaz veya önceki parça bu kimliği/anahtarı zaten eklemiş: tek satırda atlanır.
  if (rows.length === 1) return { ok: true, inserted: 0, skipped: 1 };
  const mid = Math.ceil(rows.length / 2);
  const left = await insertResilient(table, rows.slice(0, mid), uid);
  if (!left.ok) return left;
  const right = await insertResilient(table, rows.slice(mid), uid);
  return right.ok
    ? { ok: true, inserted: left.inserted + right.inserted, skipped: left.skipped + right.skipped }
    : { ...right, inserted: left.inserted + right.inserted };
}

/** Insert rows with their own ids, owned by the signed-in account, verified against `expectedUserId`. */
export async function insertRestoredRows(
  table: RestoreTable,
  rows: readonly Record<string, unknown>[],
  expectedUserId: string,
): Promise<RepoResult<number> & { skipped?: number; partial?: number }> {
  const u = await currentUserId();
  if (!u.ok) return u;
  if (u.userId !== expectedUserId) {
    return {
      ok: false,
      error: 'Oturum değişti; bu işlem başka bir hesap için hazırlanmıştı.',
      code: 'WRONG_ACCOUNT',
    };
  }
  if (rows.length === 0) return { ok: true, data: 0 };
  const res = await insertResilient(table, rows, u.userId);
  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      offline: res.offline,
      status: res.status,
      code: res.code,
      ...(res.inserted > 0 ? { partial: res.inserted } : {}),
    };
  }
  return {
    ok: true,
    data: res.inserted,
    ...(res.skipped > 0 ? { skipped: res.skipped } : {}),
  };
}
