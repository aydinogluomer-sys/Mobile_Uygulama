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
 * device; nothing leaves it except through the share sheet or download the user picks.
 *
 * ## Two decisions worth stating
 *
 * **Pages are drained, not sampled.** Several repositories are keyset
 * paginated. Calling them once would produce a backup holding the most
 * recent 30 notes and quietly calling itself complete — the failure mode of
 * a backup is that you find out at restore time. `drain` and `fetchFullTable`
 * follow cursors to the empty page, and if they hit the safety cap they say so
 * in `truncated` instead of pretending.
 *
 * ## Why there is NO full import, and why the word "backup" was removed
 *
 * This produces a document to read, not a snapshot to restore. It was being
 * presented as a "yedek" (backup), which promises the opposite — and four
 * properties of the file make a faithful restore impossible to write from it:
 *
 *  1. **It is not the entire server state.** Every table the registry names is
 *     exported (`lib/backupFormat.REGISTRY`); the account also has server-owned
 *     tables listed in `NOT_BACKED_UP` (`willpower_state`, `credit_transactions`,
 *     `user_subscriptions`, etc.).
 *
 *  2. **Re-inserting `habit_logs` would corrupt XP.** `habit_logs` is now
 *     exported with ALL states and columns (including notes), yet it is still
 *     never restored from a file: `habit_logs.xp` is server-owned, a trigger
 *     awards it on insert and rolls it into `profiles.total_xp`. Importing logs
 *     re-fires that trigger, inflating a total defended by migrations
 *     (`012_xp_integrity`, `015_ceiling_xp`, `016_xp_drift_survives_purge`).
 *
 *  3. **Webhook rows are exported without their headers** — deliberately, see
 *     below. Restoring them recreates registrations that look configured and
 *     cannot authenticate.
 *
 *  4. **The file may be `truncated`.** A collection over `MAX_ROWS` is cut and
 *     says so. Importing it would silently establish the truncated set as the
 *     new reality.
 *
 * Any one of those makes "full restore" a lie; together they make it a data-loss
 * feature. The UI says "Verileri Dışa Aktar" and states plainly what is never
 * restored.
 *
 * R08 (2026-10-07) added a CHECKED, PARTIAL merge next to it, in
 * `services/restoreService.ts` -- never in this file, which still only goes one
 * way. Format 3 carries a manifest (account, per-collection count + checksum);
 * a dry run verifies it and shows what would be added; only collections whose
 * insert has no side effect are ever written (`lib/backupFormat.REGISTRY`) --
 * never `habit_logs`, never focus sessions, never webhooks -- and nothing
 * existing is overwritten.
 *
 * **Webhook headers are excluded.** A registration may carry an authorization
 * header for the user's own automation. A credential does not belong in a
 * document that leaves the device, and its absence is recorded in the file.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildManifest, type Manifest } from '../lib/backupFormat';
import { escapeCsvCell } from '../lib/csvImport';
import { deviceEntries, isDeviceExportKey, type DeviceEntry } from '../lib/deviceExport';
import { toExcelXML, type ExcelCell, type ExcelSheet } from '../lib/focusReport';
import { fetchBadHabitsPage } from '../repositories/badHabitRepository';
import {
  MAX_EXPORT_ROWS,
  fetchFullTable,
  fetchOwnOnboardingForExport,
  fetchOwnProfileForExport,
  type ExportFullTable,
} from '../repositories/exportRepository';
import { fetchGoalsPage } from '../repositories/goalRepository';
import { fetchNotesPage } from '../repositories/noteRepository';
import { fetchProjectsPage } from '../repositories/projectRepository';
import { EXPORT_EXTRA_TABLES, fetchOwnedTable, isMissingTable, type ExportTable } from '../repositories/restoreRepository';
import type { Cursor, Page, RepoResult } from '../repositories/shared';
import { fetchTasksPage } from '../repositories/taskRepository';

/** 3: adds `manifest`. */
export const EXPORT_FORMAT_VERSION = 3;

/** Hard ceiling per collection, so one huge account cannot exhaust memory. */
export const MAX_ROWS = MAX_EXPORT_ROWS;

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
  // R08.01
  okrs: unknown[];
  key_results: unknown[];
  reading_list: unknown[];
  focus_tasks: unknown[];
  recovery_plans: unknown[];
  weekly_reviews: unknown[];
  monthly_reviews: unknown[];
  life_area_logs: unknown[];
  deep_work_sessions: unknown[];
  ai_conversations: unknown[];
  ai_messages: unknown[];
  ai_conversation_actions: unknown[];
  journal_insights: unknown[];
  routines: unknown[];
  habit_deletions: unknown[];
  habit_pauses: unknown[];
  habit_goal_versions: unknown[];
  habit_checklist_items: unknown[];
  habit_checklist_checks: unknown[];
  // F20 (SYN-20)
  profiles: unknown[];
  user_onboarding: unknown[];
  /** This device's settings and local-only data (allowlisted keys, see lib/deviceExport). */
  device: DeviceEntry[];
  notes_on_contents: string[];
  /** Absent only when no account could be resolved; such a file can never be read back. */
  manifest?: Manifest;
};

export const isBackupComplete = (b: Pick<Backup, 'failed' | 'truncated'>): boolean =>
  b.failed.length === 0 && b.truncated.length === 0;

export type NoteRecord = {
  id: string;
  title: string | null;
  content: string;
  created_at: string | null;
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
  for (let guard = 0; guard < 500; guard++) {
    const res = await page(cursor);
    if (!res.ok) return { rows, truncated: false, error: res.error };
    rows.push(...res.data.rows);
    if (rows.length > max || (rows.length === max && res.data.hasMore)) return { rows: rows.slice(0, max), truncated: true };
    if (!res.data.hasMore || !res.data.nextCursor) return { rows, truncated: false };
    cursor = res.data.nextCursor;
  }
  return { rows, truncated: true };
}

export async function collectAllNotes(
  opts: { max?: number } = {},
): Promise<RepoResult<{ rows: NoteRecord[]; truncated: boolean }>> {
  const r = await drain((c) => fetchNotesPage(c, 200), opts.max ?? MAX_ROWS);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, data: { rows: r.rows, truncated: r.truncated } };
}

/** Everything the signed-in user owns, as one object. */
export async function buildBackup(
  now: Date = new Date(),
  opts: { userId?: string | null; clock?: () => Date } = {},
): Promise<Backup> {
  const clock = opts.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
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

  const readFull = async (table: ExportFullTable): Promise<Record<string, unknown>[]> => {
    const r = await fetchFullTable(table, MAX_ROWS);
    if (!r.ok) {
      failed.push({ collection: table, error: r.error });
      return [];
    }
    if (r.data.truncated) truncated.push(table);
    return r.data.rows;
  };

  const readSingle = async (
    name: string,
    get: () => Promise<RepoResult<Record<string, unknown>[]>>,
  ): Promise<Record<string, unknown>[]> => {
    const r = await get();
    if (!r.ok) {
      failed.push({ collection: name, error: r.error });
      return [];
    }
    return r.data;
  };

  const [
    habits,
    habitLogs,
    journal,
    focus,
    webhooks,
    tasks,
    projects,
    goals,
    notes,
    badHabits,
    profiles,
    onboarding,
  ] = await Promise.all([
    readFull('habits'),
    readFull('habit_logs'),
    readFull('journal_entries'),
    readFull('focus_sessions'),
    readFull('webhooks'),
    collect('tasks', (c) => fetchTasksPage(c, 200)),
    collect('projects', (c) => fetchProjectsPage(c, 200)),
    collect('goals', (c) => fetchGoalsPage(c, 200)),
    collect('notes', (c) => fetchNotesPage(c, 200)),
    collect('bad_habits', (c) => fetchBadHabitsPage(c, 200)),
    readSingle('profiles', fetchOwnProfileForExport),
    readSingle('user_onboarding', fetchOwnOnboardingForExport),
  ]);

  const safeWebhooks = (webhooks as { headers?: unknown }[]).map(({ headers: _omitted, ...rest }) => rest);
  const userId = opts.userId ?? null;

  // R08.01 — every other owned table, in full (keyset-paged, same ceiling).
  const extra = {} as Record<ExportTable, Record<string, unknown>[]>;
  for (const t of EXPORT_EXTRA_TABLES) {
    const r = await fetchOwnedTable(t, MAX_ROWS);
    if (!r.ok) {
      if (!isMissingTable(r.code)) failed.push({ collection: t, error: r.error });
      extra[t] = [];
      continue;
    }
    if (r.data.truncated) truncated.push(t);
    extra[t] = r.data.rows;
  }

  // R08.01 / F20 (SYN-11) — filter keys BEFORE multiGet so local backup blobs and outbox queues are never read into memory.
  let device: DeviceEntry[] = [];
  if (userId) {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const keys = allKeys.filter((k) => isDeviceExportKey(k, userId));
      device = deviceEntries(await AsyncStorage.multiGet(keys), userId);
    } catch (e) {
      failed.push({ collection: 'device', error: e instanceof Error ? e.message : 'cihaz verisi okunamadı' });
    }
  }

  const manifest = userId
    ? buildManifest(
        userId,
        now.toISOString(),
        {
          habits,
          habit_logs: habitLogs,
          tasks,
          projects,
          goals,
          notes,
          journal_entries: journal,
          focus_sessions: focus,
          bad_habits: badHabits,
          webhooks: safeWebhooks,
          ...(Object.fromEntries(EXPORT_EXTRA_TABLES.map((t) => [t, extra[t]])) as Record<string, unknown[]>),
          profiles,
          user_onboarding: onboarding,
          device,
        },
        { startedAt, finishedAt: clock().toISOString() },
      )
    : undefined;

  return {
    format_version: EXPORT_FORMAT_VERSION,
    export_date: now.toISOString(),
    truncated,
    failed,
    ...(manifest ? { manifest } : {}),
    habits,
    habit_logs: habitLogs,
    tasks,
    projects,
    goals,
    notes,
    journal_entries: journal,
    focus_sessions: focus,
    bad_habits: badHabits,
    webhooks: safeWebhooks,
    okrs: extra.okrs,
    key_results: extra.key_results,
    reading_list: extra.reading_list,
    focus_tasks: extra.focus_tasks,
    recovery_plans: extra.recovery_plans,
    weekly_reviews: extra.weekly_reviews,
    monthly_reviews: extra.monthly_reviews,
    life_area_logs: extra.life_area_logs,
    deep_work_sessions: extra.deep_work_sessions,
    ai_conversations: extra.ai_conversations,
    ai_messages: extra.ai_messages,
    ai_conversation_actions: extra.ai_conversation_actions,
    journal_insights: extra.journal_insights,
    routines: extra.routines,
    habit_deletions: extra.habit_deletions,
    habit_pauses: extra.habit_pauses,
    habit_goal_versions: extra.habit_goal_versions,
    habit_checklist_items: extra.habit_checklist_items,
    habit_checklist_checks: extra.habit_checklist_checks,
    profiles,
    user_onboarding: onboarding,
    device,
    notes_on_contents: [
      'Yalnızca bu hesaba ait kayıtlar. Webhook başlıkları (headers) güvenlik gerekçesiyle dışarıda bırakıldı.',
      'Cihaz bölümü: bu cihazdaki ayarlar ve yerel veriler; oturum ve erişim anahtarları asla dahil edilmez.',
      'habit_logs: tüm durumlar (yapıldı, kısmen, atlandı, kaçırıldı) ve tüm sütunlar, notlar dahil; arşivlenmiş alışkanlıklar da dosyadadır. Bu uygulama habit_logs kayıtlarını geri yükleyemez (sunucu her kayıt için XP veriyor).',
      'profiles ve user_onboarding: hesap kimliğin (e-posta, kullanıcı adı, AI kişiliği, son AI bağlamı) ve kurulum yanıtların bilgi için dosyadadır; bildirim belirteci ve kurulum kimlikleri dahil değildir. XP ve sayaçlar sunucu otoritesidir; XP, habit_logs içindeki xp sütunundan yeniden türetilebilir.',
      'Sunucu otoritesi olan (XP, Focus Point, abonelik, AI istek kaydı), sağlayıcı belirteci taşıyan ve kullanılmayan tablolar dışa aktarılmaz; liste ve nedenleri lib/backupFormat.ts NOT_BACKED_UP içindedir.',
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
  'okrs', 'key_results', 'reading_list', 'focus_tasks', 'recovery_plans', 'weekly_reviews', 'monthly_reviews',
  'life_area_logs', 'deep_work_sessions', 'ai_conversations', 'ai_messages',
  'ai_conversation_actions', 'journal_insights', 'routines', 'habit_deletions',
  'habit_pauses', 'habit_goal_versions', 'habit_checklist_items', 'habit_checklist_checks',
  'profiles', 'user_onboarding', 'device',
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
 */
export function backupToCSV(backup: Backup): string {
  const out: string[] = [`# Aderyth dışa aktarım,${backup.export_date},format v${backup.format_version}`];
  for (const sheet of backupToSheets(backup)) {
    out.push('', `## ${sheet.name}`, sheet.headers.map(escapeCsvCell).join(','));
    for (const row of sheet.rows) out.push(row.map(escapeCsvCell).join(','));
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
