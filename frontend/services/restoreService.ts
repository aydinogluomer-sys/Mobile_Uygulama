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
import { verifyBackupText } from '../lib/backupFormat';
import { planRestore, planSummary, type RestorePlan } from '../lib/restorePlan';
import { fetchExistingRows, insertRestoredRows, RESTORE_TABLES, type RestoreTable } from '../repositories/restoreRepository';
import { currentUser } from '../lib/session';

export type DryRun =
  | { ok: true; plan: RestorePlan; summary: string[] }
  | { ok: false; reason: string };

export async function dryRunRestore(text: string): Promise<DryRun> {
  const user = await currentUser();
  if (!user) return { ok: false, reason: 'Oturum bulunamadı.' };
  const check = verifyBackupText(text, user.id);
  if (!check.ok) return check;
  const existing: Record<string, Map<string, Record<string, unknown>>> = {};
  for (const t of RESTORE_TABLES) {
    if (!check.collections[t]) continue;
    const r = await fetchExistingRows(t);
    // An unreadable account is not "empty": refuse rather than plan duplicates.
    if (!r.ok) return { ok: false, reason: `Mevcut ${t} okunamadı: ${r.error}` };
    existing[t] = new Map(r.data.map((row) => [String(row.id), row]));
  }
  const plan = planRestore({ userId: user.id, file: check.collections, existing });
  return { ok: true, plan, summary: planSummary(plan) };
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

export async function executeRestore(plan: RestorePlan, opts: { shouldCancel?: () => boolean } = {}): Promise<RestoreReport> {
  const report: RestoreReport = { inserted: {}, failed: [], cancelled: false };
  for (const c of plan.collections) {
    if (c.blocked || c.insert.length === 0) continue;
    const table = c.name as RestoreTable;
    if (!RESTORE_TABLES.includes(table)) continue;
    // A parent that failed holds its children back: they would be orphans.
    if (table === 'tasks' && report.failed.some((f) => f.collection === 'projects')) {
      report.failed.push({ collection: 'tasks', error: 'Projeler eklenemediği için görevler eklenmedi.' });
      continue;
    }
    for (let i = 0; i < c.insert.length; i += CHUNK) {
      if (opts.shouldCancel?.()) { report.cancelled = true; return report; }
      const chunk = c.insert.slice(i, i + CHUNK).map((r) => prepareRow(table, r));
      const res = await insertRestoredRows(table, chunk);
      if (!res.ok) { report.failed.push({ collection: table, error: res.error }); break; }
      report.inserted[table] = (report.inserted[table] ?? 0) + res.data;
    }
  }
  return report;
}
