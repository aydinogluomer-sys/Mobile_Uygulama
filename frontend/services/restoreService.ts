/**
 * R08.03 / R08.04 — check a pasted export, show what a restore would do,
 * and do exactly that when the user confirms.
 *
 * This is NOT a full restore and never says it is: the registry decides what
 * can come back (lib/backupFormat), the dry run says per collection what will
 * be added, what is already there, what conflicts (the account's version is
 * kept) and what will not be restored and why. The write is a safe merge --
 * missing ids are added, nothing is overwritten or deleted -- so running the
 * same file twice adds nothing the second time.
 *
 * Two rules on the write, stated where they apply:
 *   - habits come back QUEUED (`waiting`), not active: activation goes
 *     through the capacity gate, never around it;
 *   - parents first (projects before tasks), in chunks, and the user can
 *     cancel between chunks; what was written stays written and is reported.
 */
import { verifyBackupText, specFor } from '../lib/backupFormat';
import { planRestore, planSummary, type RestorePlan } from '../lib/restorePlan';
import { fetchExistingRows, insertRestoredRows, isMissingTable, RESTORE_TABLES, type RestoreTable } from '../repositories/restoreRepository';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jobIdFor, type RestoreJob } from '../lib/restoreJob';

/** R08.04 — one job record per account: the last restore and how it ended. */
export const restoreJobKey = (uid: string) => `restore.job.v1.${uid}`;

export async function loadRestoreJob(): Promise<RestoreJob | null> {
  const user = await currentUser();
  if (!user) return null;
  try { const raw = await AsyncStorage.getItem(restoreJobKey(user.id)); return raw ? (JSON.parse(raw) as RestoreJob) : null; } catch { return null; }
}
async function saveJob(uid: string, job: RestoreJob): Promise<void> {
  try { await AsyncStorage.setItem(restoreJobKey(uid), JSON.stringify(job)); } catch { /* the rows themselves are the truth; the record is a convenience */ }
}

export type DryRun =
  | { ok: true; plan: RestorePlan; summary: string[]; job: { id: string; fileCreatedAt: string; resumes: boolean } }
  | { ok: false; reason: string };

export async function dryRunRestore(text: string): Promise<DryRun> {
  const user = await currentUser();
  if (!user) return { ok: false, reason: 'Oturum bulunamadı.' };
  const check = verifyBackupText(text, user.id);
  if (!check.ok) return check;
  const existing: Record<string, Map<string, Record<string, unknown>>> = {};
  const notOnServer: string[] = [];
  for (const t of RESTORE_TABLES) {
    if (!check.collections[t] || check.collections[t].length === 0) continue;
    const r = await fetchExistingRows(t);
    // R08.01 — a table whose migration has not run (028/029) is not there to
    // restore into: that collection is held back, the rest goes ahead.
    if (!r.ok && isMissingTable(r.code)) { notOnServer.push(t); continue; }
    // An unreadable account is not "empty": refuse rather than plan duplicates.
    if (!r.ok) return { ok: false, reason: `Mevcut ${t} okunamadı: ${r.error}` };
    existing[t] = new Map(r.data.map((row) => [String(row.id), row]));
  }
  const plan = planRestore({ userId: user.id, file: check.collections, existing });
  for (const c of plan.collections) {
    if (notOnServer.includes(c.name)) {
      c.blocked = 'Bu bölüm için sunucu tablosu henüz yok (migration uygulanmadı); dosyada saklı kalır.';
      c.insert = [];
    }
  }
  plan.inserts = plan.collections.reduce((n, c) => n + c.insert.length, 0);
  // R08.04 — the same file is the same job: an interrupted one is continued, not restarted.
  const id = jobIdFor(check.file.manifest);
  const prev = await loadRestoreJob();
  return {
    ok: true, plan, summary: planSummary(plan),
    job: { id, fileCreatedAt: check.file.manifest.created_at, resumes: !!prev && prev.id === id && prev.status !== 'done' },
  };
}

export type RestoreReport = {
  inserted: Record<string, number>;
  failed: { collection: string; error: string }[];
  cancelled: boolean;
};

const CHUNK = 50;

/** Habits return queued; nothing else is altered beyond the authority strip the plan already did. */
export function prepareRow(table: RestoreTable, row: Record<string, unknown>): Record<string, unknown> {
  if (table === 'habits' && row.status === 'active') return { ...row, status: 'waiting' };
  return row;
}

export async function executeRestore(
  plan: RestorePlan,
  opts: { shouldCancel?: () => boolean; job?: { id: string; fileCreatedAt: string }; now?: () => Date } = {},
): Promise<RestoreReport> {
  const report: RestoreReport = { inserted: {}, failed: [], cancelled: false };
  // R08.04 — the job record is written BEFORE the first insert and after every
  // chunk, so a kill at any point leaves `running` with what was done so far.
  const user = opts.job ? await currentUser() : null;
  const now = opts.now ?? (() => new Date());
  const prev = user && opts.job ? await loadRestoreJob() : null;
  const carried = prev && opts.job && prev.id === opts.job.id && prev.status !== 'done' ? prev.inserted : {};
  const job: RestoreJob | null = user && opts.job ? {
    id: opts.job.id, fileCreatedAt: opts.job.fileCreatedAt,
    startedAt: prev && prev.id === opts.job.id && prev.status !== 'done' ? prev.startedAt : now().toISOString(),
    updatedAt: now().toISOString(), status: 'running', inserted: { ...carried }, planned: plan.inserts,
  } : null;
  const persist = async (patch: Partial<RestoreJob>) => {
    if (!job || !user) return;
    Object.assign(job, patch, { updatedAt: now().toISOString() });
    await saveJob(user.id, job);
  };
  await persist({});
  for (const c of plan.collections) {
    if (c.blocked || c.insert.length === 0) continue;
    const table = c.name as RestoreTable;
    if (!RESTORE_TABLES.includes(table)) continue;
    // A parent that failed holds its children back: they would be orphans.
    // (R08.01: every registered relation, not only tasks -> projects.)
    const parents = Object.values(specFor(table)?.relations ?? {});
    const failedParent = parents.find((p) => report.failed.some((f) => f.collection === p));
    if (failedParent) {
      report.failed.push({ collection: table, error: `${failedParent} eklenemediği için ${table} eklenmedi.` });
      continue;
    }
    for (let i = 0; i < c.insert.length; i += CHUNK) {
      if (opts.shouldCancel?.()) { report.cancelled = true; await persist({ status: 'cancelled' }); return report; }
      const chunk = c.insert.slice(i, i + CHUNK).map((r) => prepareRow(table, r));
      const res = await insertRestoredRows(table, chunk);
      if (!res.ok) { report.failed.push({ collection: table, error: res.error }); break; }
      report.inserted[table] = (report.inserted[table] ?? 0) + res.data;
      if (job) await persist({ inserted: { ...job.inserted, [table]: (job.inserted[table] ?? 0) + res.data } });
    }
  }
  await persist(report.failed.length > 0
    ? { status: 'failed', error: report.failed.map((f) => f.collection).join(', ') }
    : { status: 'done', error: undefined });
  return report;
}
