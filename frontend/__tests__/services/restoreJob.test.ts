/**
 * R08.04 — "Yetkili kontrollü restore: güvenli birleştirme, devam etme/iptal,
 * tekrar aynı dosya dedup'ı ve tutarlı son durum."
 *
 * A restore killed after its first chunk is continued as the SAME job: the
 * rest is inserted, nothing twice, the job ends `done`; the same file again
 * inserts nothing.
 */
const mockDb: Record<string, Map<string, Record<string, unknown>>> = {};
const mockKill = { afterInserts: Infinity, count: 0 };
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../repositories/restoreRepository', () => ({
  ...jest.requireActual('../../repositories/restoreRepository'),
  fetchExistingRows: jest.fn(async (t: string) => ({ ok: true, data: [...(mockDb[t]?.values() ?? [])] })),
  insertRestoredRows: jest.fn(async (t: string, rows: Record<string, unknown>[]) => {
    if (mockKill.count >= mockKill.afterInserts) throw new Error('app killed');
    mockKill.count += 1;
    mockDb[t] = mockDb[t] ?? new Map();
    for (const r of rows) {
      if (mockDb[t].has(String(r.id))) throw new Error(`duplicate ${String(r.id)}`);
      mockDb[t].set(String(r.id), { ...r, user_id: 'u1' });
    }
    return { ok: true, data: rows.length };
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildManifest } from '../../lib/backupFormat';
import { jobIdFor, isInterrupted, interruptedText } from '../../lib/restoreJob';
import { dryRunRestore, executeRestore, loadRestoreJob } from '../../services/restoreService';

const notes = Array.from({ length: 120 }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, user_id: 'u1', title: `not ${i}`, content: 'x', tags: [] }));
function file(rows = notes) {
  const data = { notes: rows };
  return JSON.stringify({ manifest: buildManifest('u1', '2026-10-01T10:00:00.000Z', data), ...data });
}

beforeEach(async () => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  Object.assign(mockKill, { afterInserts: Infinity, count: 0 });
  await AsyncStorage.clear();
});

it('the job id belongs to the file: same file same id, another file another', () => {
  const a = JSON.parse(file()).manifest;
  expect(jobIdFor(a)).toBe(jobIdFor(JSON.parse(file()).manifest));
  expect(jobIdFor(a)).not.toBe(jobIdFor(JSON.parse(file(notes.slice(1))).manifest));
});

it('killed after the first chunk: continued as the same job, every row once, ends done; again = nothing', async () => {
  // run 1 — dies after the first chunk of 50
  mockKill.afterInserts = 1;
  const d1 = await dryRunRestore(file());
  if (!d1.ok) throw new Error(d1.reason);
  expect(d1.job.resumes).toBe(false);
  await expect(executeRestore(d1.plan, { job: d1.job })).rejects.toThrow('app killed');
  const cut = await loadRestoreJob();
  expect(cut).toMatchObject({ id: d1.job.id, status: 'running', inserted: { notes: 50 } });
  expect(isInterrupted(cut)).toBe(true);
  expect(interruptedText(cut!)).toMatch(/2026-10-01 tarihli dosya, 50 kayıt eklendikten sonra yarıda kaldı/);

  // run 2 — the same file resumes the same job, inserts only the rest
  mockKill.afterInserts = Infinity;
  const d2 = await dryRunRestore(file());
  if (!d2.ok) throw new Error(d2.reason);
  expect(d2.job).toMatchObject({ id: d1.job.id, resumes: true });
  expect(d2.plan.inserts).toBe(70);
  await executeRestore(d2.plan, { job: d2.job });
  expect(mockDb.notes.size).toBe(120);
  expect(await loadRestoreJob()).toMatchObject({ id: d1.job.id, status: 'done', inserted: { notes: 120 }, startedAt: cut!.startedAt });

  // run 3 — the same file once more: nothing to add, not a resume
  const d3 = await dryRunRestore(file());
  if (!d3.ok) throw new Error(d3.reason);
  expect(d3.plan.inserts).toBe(0);
  expect(d3.job.resumes).toBe(false);
});

it('a cancelled run is recorded as cancelled and can be continued', async () => {
  const d = await dryRunRestore(file());
  if (!d.ok) throw new Error(d.reason);
  let chunks = 0;
  await executeRestore(d.plan, { job: d.job, shouldCancel: () => chunks++ >= 1 });
  expect(await loadRestoreJob()).toMatchObject({ status: 'cancelled', inserted: { notes: 50 } });
  const again = await dryRunRestore(file());
  if (!again.ok) throw new Error(again.reason);
  expect(again.job.resumes).toBe(true);
  expect(again.plan.inserts).toBe(70);
});

it('killed before the first chunk landed: the job is still on record as interrupted', async () => {
  mockKill.afterInserts = 0;
  const d = await dryRunRestore(file());
  if (!d.ok) throw new Error(d.reason);
  await expect(executeRestore(d.plan, { job: d.job })).rejects.toThrow('app killed');
  expect(await loadRestoreJob()).toMatchObject({ id: d.job.id, status: 'running', inserted: {} });
});
