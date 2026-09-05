/**
 * The full-account backup.  (plan §8; replaces `exportAPI` in utils/api.ts)
 *
 * ## What this replaces, and why it had to move
 *
 * `GET /api/export` on the retired FastAPI service read the whole database
 * and returned it:
 *
 *     habits      = await db.habits.find().to_list(1000)
 *     tasks       = await db.tasks.find().to_list(1000)
 *     completions = await db.completions.find().to_list(10000)
 *     ...
 *
 * No user filter, on a service with no authentication. It did not export
 * "your data"; it exported everyone's, to anyone. `/api/data/export/excel`
 * and `/api/data/export/csv` did the same, and settings.tsx opened those two
 * with `Linking.openURL` — in the system browser, carrying no session, from
 * a URL every copy of the app knows.
 *
 * Assembled here instead, from the repositories, which are owner-scoped by
 * an explicit filter and by RLS. All three formats are produced on the
 * device; nothing leaves it except through the share sheet the user picks.
 *
 * ## Two decisions worth stating
 *
 * **Pages are drained, not sampled.** Several repositories are keyset
 * paginated. Calling them once would produce a backup holding the most
 * recent 30 notes and quietly calling itself complete — the failure mode of
 * a backup is that you find out at restore time. `drain` follows the cursor
 * to the end, and if it hits the safety cap it says so in `truncated`
 * instead of pretending.
 *
 * ## Why there is NO import, and why the word "backup" was removed
 *
 * This produces a document to read, not a snapshot to restore. It was being
 * presented as a "yedek" (backup), which promises the opposite — and four
 * properties of the file make a faithful restore impossible to write from it:
 *
 *  1. **It is not the account.** Ten collections are exported. The account
 *     also has `okrs`, `key_results`, `recovery_plans`, `reading_list`,
 *     `life_area_logs`, `deep_work_sessions`, `weekly_reviews`,
 *     `monthly_reviews`, `focus_tasks` and `willpower_state`. Restoring this
 *     file would produce an account missing most of its data while reporting
 *     success — which is a fake restore, not a partial one.
 *
 *  2. **Re-inserting `habit_logs` would corrupt XP.** `habit_logs.xp` is
 *     server-owned: a trigger awards it on insert and rolls it into
 *     `profiles.total_xp`. Importing logs re-fires that trigger, inflating a
 *     total the schema has three migrations defending
 *     (`20260831_xp_integrity`, `_ceiling_xp`, `_xp_drift_survives_purge`).
 *     An import would have to suppress a trigger it cannot see from the
 *     client.
 *
 *  3. **Webhook rows are exported without their headers** — deliberately, see
 *     above. Restoring them recreates registrations that look configured and
 *     cannot authenticate.
 *
 *  4. **The file may be `truncated`.** A collection over `MAX_ROWS` is cut and
 *     says so. Importing it would silently establish the truncated set as the
 *     new reality.
 *
 * Any one of those makes "restore" a lie; together they make it a data-loss
 * feature. The honest fix was to stop claiming it: the UI says "Verileri Dışa
 * Aktar" and states in plain words that there is no import.
 *
 * A real restore is a separate piece of work: it needs the full collection
 * set, id remapping across the foreign keys (`habit_logs.habit_id`,
 * `tasks.project_id`, `key_results.okr_id`), a server-side path that can
 * insert logs without re-awarding XP, an idempotency key so a re-run does not
 * duplicate, and an explicit destructive-overwrite confirmation. None of that
 * is started here, and pretending otherwise in the UI was the actual defect.
 *
 * **Webhook headers are excluded.** A registration may carry an
 * authorization header for the user's own automation. The export is handed
 * to `Share.share()`, i.e. to whatever application the user taps — mail,
 * notes, a chat. A credential does not belong in a document that leaves by
 * that route, and its absence is recorded in the file.
 */
import { fetchHabits } from '../repositories/habitRepository';
import { fetchTasksPage } from '../repositories/taskRepository';
import { fetchNotesPage } from '../repositories/noteRepository';
import { fetchProjectsPage } from '../repositories/projectRepository';
import { fetchGoalsPage } from '../repositories/goalRepository';
import { fetchJournalEntries } from '../repositories/journalRepository';
import { fetchAllFocusSessions } from '../repositories/focusSessionRepository';
import { fetchHabitLogsForHabitsSince } from '../repositories/habitLogRepository';
import { fetchBadHabitsPage } from '../repositories/badHabitRepository';
import { fetchWebhooks } from '../repositories/webhookRepository';
import type { Cursor, Page, RepoResult } from '../repositories/shared';
import { toExcelXML, type ExcelSheet, type ExcelCell } from '../lib/focusReport';

export const EXPORT_FORMAT_VERSION = 2;

/** Hard ceiling per collection, so one huge account cannot exhaust memory. */
const MAX_ROWS = 5_000;

export type Backup = {
  format_version: number;
  export_date: string;
  /** Collections that hit `MAX_ROWS` and are therefore incomplete. */
  truncated: string[];
  /** Collections that failed to read, with the reason. Never silently empty. */
  failed: { collection: string; error: string }[];
  habits: unknown[];
  habit_logs: unknown[];
  tasks: unknown[];
  projects: unknown[];
  goals: unknown[];
  notes: unknown[];
  journal_entries: unknown[];
  focus_sessions: unknown[];
  bad_habits: unknown[];
  webhooks: unknown[];
  notes_on_contents: string[];
};

/**
 * Follows a keyset cursor to the end of a collection.
 *
 * Returns `truncated` rather than throwing at the cap: a partial backup that
 * announces itself is useful, one that lies is not.
 */
export async function drain<T extends { id: string }>(
  page: (cursor?: Cursor | null) => Promise<RepoResult<Page<T>>>,
  max: number = MAX_ROWS,
): Promise<{ rows: T[]; truncated: boolean; error?: string }> {
  const rows: T[] = [];
  let cursor: Cursor | null | undefined = null;
  // A cursor that stops advancing would spin forever; the row cap bounds the
  // loop independently of the server's behaviour.
  for (let guard = 0; guard < 500; guard++) {
    const res = await page(cursor);
    if (!res.ok) return { rows, truncated: false, error: res.error };
    rows.push(...res.data.rows);
    if (rows.length >= max) return { rows: rows.slice(0, max), truncated: true };
    if (!res.data.hasMore || !res.data.nextCursor) return { rows, truncated: false };
    cursor = res.data.nextCursor;
  }
  return { rows, truncated: true };
}

/** Everything the signed-in user owns, as one object. */
export async function buildBackup(now: Date = new Date()): Promise<Backup> {
  const truncated: string[] = [];
  const failed: { collection: string; error: string }[] = [];

  const collect = async <T extends { id: string }>(
    name: string,
    page: (cursor?: Cursor | null) => Promise<RepoResult<Page<T>>>,
  ): Promise<T[]> => {
    const r = await drain(page);
    if (r.error) failed.push({ collection: name, error: r.error });
    if (r.truncated) truncated.push(name);
    return r.rows;
  };

  const flat = async <T>(name: string, get: () => Promise<RepoResult<T[]>>): Promise<T[]> => {
    const r = await get();
    if (!r.ok) {
      failed.push({ collection: name, error: r.error });
      return [];
    }
    return r.data;
  };

  const [habits, tasks, projects, goals, notes, journal, focus, badHabits, webhooks] =
    await Promise.all([
      flat('habits', () => fetchHabits(2000)),
      collect('tasks', (c) => fetchTasksPage(c, 200)),
      collect('projects', (c) => fetchProjectsPage(c, 200)),
      collect('goals', (c) => fetchGoalsPage(c, 200)),
      collect('notes', (c) => fetchNotesPage(c, 200)),
      flat('journal_entries', () => fetchJournalEntries(1000)),
      flat('focus_sessions', () => fetchAllFocusSessions()),
      collect('bad_habits', (c) => fetchBadHabitsPage(c, 200)),
      flat('webhooks', () => fetchWebhooks()),
    ]);

  // Logs are fetched per habit id, so they must wait for the habit list.
  // 1970 is not a magic date: it is "no lower bound", spelled in the shape
  // the repository already takes, so the backup is not silently a window.
  const habitIds = (habits as { id: string }[]).map((h) => h.id);
  const habitLogs = habitIds.length
    ? await flat('habit_logs', () =>
        fetchHabitLogsForHabitsSince({ habitIds, since: '1970-01-01' }),
      )
    : [];

  return {
    format_version: EXPORT_FORMAT_VERSION,
    export_date: now.toISOString(),
    truncated,
    failed,
    habits,
    habit_logs: habitLogs,
    tasks,
    projects,
    goals,
    notes,
    journal_entries: journal,
    focus_sessions: focus,
    bad_habits: badHabits,
    // Registrations without their headers -- see the module note.
    webhooks: (webhooks as { headers?: unknown }[]).map(({ headers: _omitted, ...rest }) => rest),
    notes_on_contents: [
      'Yalnızca bu hesaba ait kayıtlar. Webhook başlıkları (headers) güvenlik gerekçesiyle dışarıda bırakıldı.',
      truncated.length ? `Sınıra takılan ve eksik kalan bölümler: ${truncated.join(', ')}.` : 'Tüm bölümler eksiksiz.',
      failed.length ? `Okunamayan bölümler: ${failed.map((f) => f.collection).join(', ')}.` : 'Okuma hatası yok.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const COLLECTIONS: (keyof Backup)[] = [
  'habits', 'habit_logs', 'tasks', 'projects', 'goals',
  'notes', 'journal_entries', 'focus_sessions', 'bad_habits', 'webhooks',
];

/** Union of the keys present across rows, so a sparse column is not dropped. */
function columnsOf(rows: unknown[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === 'object') for (const k of Object.keys(r)) seen.add(k);
  }
  return [...seen];
}

function cell(v: unknown): ExcelCell {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return String(v);
}

export function backupToSheets(backup: Backup): ExcelSheet[] {
  return COLLECTIONS.filter((name) => (backup[name] as unknown[]).length > 0).map((name) => {
    const rows = backup[name] as unknown[];
    const headers = columnsOf(rows);
    return {
      name: String(name),
      headers,
      rows: rows.map((r) => headers.map((h) => cell((r as Record<string, unknown>)[h]))),
    };
  });
}

export function backupToExcelXML(backup: Backup): string {
  return toExcelXML(backupToSheets(backup));
}

/**
 * One CSV holding every collection, each under its own header block.
 *
 * CSV has no concept of multiple tables, and the alternative — ten files —
 * cannot travel through a single share sheet. A labelled block per
 * collection keeps it one document without pretending the shapes match.
 */
export function backupToCSV(backup: Backup): string {
  const esc = (v: ExcelCell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [`# Aderyth dışa aktarım,${backup.export_date},format v${backup.format_version}`];
  for (const sheet of backupToSheets(backup)) {
    out.push('', `## ${sheet.name}`, sheet.headers.map(esc).join(','));
    for (const row of sheet.rows) out.push(row.map(esc).join(','));
  }
  if (backup.truncated.length) out.push('', `# EKSİK: ${backup.truncated.join(', ')}`);
  if (backup.failed.length) out.push('', `# OKUNAMADI: ${backup.failed.map((f) => `${f.collection} (${f.error})`).join('; ')}`);
  return out.join('\n');
}

export function backupToJSON(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

export type ExportFormat = 'json' | 'excel' | 'csv';

export function renderBackup(backup: Backup, format: ExportFormat): string {
  if (format === 'excel') return backupToExcelXML(backup);
  if (format === 'csv') return backupToCSV(backup);
  return backupToJSON(backup);
}
