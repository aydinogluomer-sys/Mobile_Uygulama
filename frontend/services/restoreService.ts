/**
 * R08.03 / R08.04 / F20 (SYN-18, SYN-19) — check a pasted export, show what a
 * restore would do, and do exactly that when the user confirms.
 *
 * Account-bound on both dry run and execution, resilient to individual
 * duplicate rows within a 50-row chunk, and explicit about non-restorable
 * collections (`notices`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { specFor, verifyBackupText } from '../lib/backupFormat';
import { jobIdFor, type RestoreJob } from '../lib/restoreJob';
import { planNotices, planRestore, planSummary, type RestorePlan } from '../lib/restorePlan';
import { currentUser } from '../lib/session';
import {
  RESTORE_TABLES,
  fetchExistingRows,
  insertRestoredRows,
  isMissingTable,
  type RestoreTable,
} from '../repositories/restoreRepository';

/** R08.04 — one job record per account: the last restore and how it ended. */
export const restoreJobKey = (uid: string) => `restore.job.v1.${uid}`;

async function loadRestoreJobFor(uid: string): Promise<RestoreJob | null> {
  try {
    const raw = await AsyncStorage.getItem(restoreJobKey(uid));
    return raw ? (JSON.parse(raw) as RestoreJob) : null;
  } catch {
    return null;
  }
}

export async function loadRestoreJob(): Promise<RestoreJob | null> {
  const user = await currentUser();
  if (!user) return null;
  return loadRestoreJobFor(user.id);
}

async function saveJob(uid: string, job: RestoreJob): Promise<void> {
  try {
    await AsyncStorage.setItem(restoreJobKey(uid), JSON.stringify(job));
  } catch {
    /* the rows themselves are the truth; the record is a convenience */
  }
}

export type DryRun =
  | {
      ok: true;
      plan: RestorePlan;
      summary: string[];
      notices: string[];
      job: { id: string; fileCreatedAt: string; resumes: boolean };
    }
  | { ok: false; reason: string };

export async function dryRunRestore(text: string): Promise<DryRun> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, reason: 'Oturum bulunamadı.' };
    const check = verifyBackupText(text, user.id);
    if (!check.ok) return check;
    const existing: Record<string, Map<string, Record<string, unknown>>> = {};
    const notOnServer: string[] = [];
    for (const t of RESTORE_TABLES) {
      if (!check.collections[t] || check.collections[t].length === 0) continue;
      const r = await fetchExistingRows(t);
      if (!r.ok && isMissingTable(r.code)) {
        notOnServer.push(t);
        continue;
      }
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
    const id = jobIdFor(check.file.manifest);
    const prev = await loadRestoreJobFor(user.id);
    return {
      ok: true,
      plan,
      summary: planSummary(plan),
      notices: planNotices(plan),
      job: { id, fileCreatedAt: check.file.manifest.created_at, resumes: !!prev && prev.id === id && prev.status !== 'done' },
    };
  } catch {
    return { ok: false, reason: 'Dosya okunamadı; yapıştırdığın metin tam bir dışa aktarım olmayabilir.' };
  }
}

export type RestoreReport = {
  inserted: Record<string, number>;
  skipped: Record<string, number>;
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
  const report: RestoreReport = { inserted: {}, skipped: {}, failed: [], cancelled: false };
  const me = await currentUser();
  if (!me || me.id !== plan.userId) {
    return {
      inserted: {},
      skipped: {},
      failed: [{ collection: '*', error: 'WRONG_ACCOUNT: Oturum değişti; bu plan başka bir hesap için hazırlanmıştı. Dosyayı yeniden doğrula.' }],
      cancelled: false,
    };
  }
  const now = opts.now ?? (() => new Date());
  const prev = opts.job ? await loadRestoreJobFor(me.id) : null;
  const carried = prev && opts.job && prev.id === opts.job.id && prev.status !== 'done' ? prev.inserted : {};
  const job: RestoreJob | null = opts.job
    ? {
        id: opts.job.id,
        fileCreatedAt: opts.job.fileCreatedAt,
        startedAt: prev && prev.id === opts.job.id && prev.status !== 'done' ? prev.startedAt : now().toISOString(),
        updatedAt: now().toISOString(),
        status: 'running',
        inserted: { ...carried },
        planned: plan.inserts,
      }
    : null;
  const persist = async (patch: Partial<RestoreJob>) => {
    if (!job) return;
    Object.assign(job, patch, { updatedAt: now().toISOString() });
    await saveJob(me.id, job);
  };
  await persist({});
  for (const c of plan.collections) {
    if (c.blocked || c.insert.length === 0) continue;
    const table = c.name as RestoreTable;
    if (!RESTORE_TABLES.includes(table)) continue;
    const parents = Object.values(specFor(table)?.relations ?? {});
    const failedParent = parents.find((p) => report.failed.some((f) => f.collection === p));
    if (failedParent) {
      report.failed.push({ collection: table, error: `${failedParent} eklenemediği için ${table} eklenmedi.` });
      continue;
    }
    for (let i = 0; i < c.insert.length; i += CHUNK) {
      if (opts.shouldCancel?.()) {
        report.cancelled = true;
        await persist({ status: 'cancelled' });
        return report;
      }
      const chunk = c.insert.slice(i, i + CHUNK).map((r) => prepareRow(table, r));
      const res = await insertRestoredRows(table, chunk, plan.userId);
      if (!res.ok) {
        if (res.partial) {
          report.inserted[table] = (report.inserted[table] ?? 0) + res.partial;
          if (job) await persist({ inserted: { ...job.inserted, [table]: (job.inserted[table] ?? 0) + res.partial } });
        }
        report.failed.push({ collection: table, error: res.error });
        break;
      }
      report.inserted[table] = (report.inserted[table] ?? 0) + res.data;
      if (res.skipped) report.skipped[table] = (report.skipped[table] ?? 0) + res.skipped;
      if (job) await persist({ inserted: { ...job.inserted, [table]: (job.inserted[table] ?? 0) + res.data } });
    }
  }
  await persist(
    report.failed.length > 0
      ? { status: 'failed', error: report.failed.map((f) => f.collection).join(', ') }
      : { status: 'done', error: undefined },
  );
  return report;
}
