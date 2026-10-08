/**
 * R08.04 — the confirmed merge: parents first, habits queued, a failed parent
 * holds its children back, cancel between chunks, the same file twice is one
 * effect.
 */
const mockDb: Record<string, Map<string, any>> = {};
const mockCalls: { table: string; ids: string[] }[] = [];
let mockFailTable: string | null = null;
let mockReadFail = false;

jest.mock('../../repositories/restoreRepository', () => ({
  RESTORE_TABLES: ['projects', 'habits', 'goals', 'tasks', 'notes', 'journal_entries', 'bad_habits'],
  // R08.01: the real "table not created yet" rule (migration 028/029).
  isMissingTable: jest.requireActual('../../lib/pgErrors').isMissingTable,
  fetchExistingRows: jest.fn(async (t: string) => (mockReadFail ? { ok: false, error: 'offline' } : { ok: true, data: [...(mockDb[t]?.values() ?? [])] })),
  insertRestoredRows: jest.fn(async (t: string, rows: any[]) => {
    if (t === mockFailTable) return { ok: false, error: 'refused' };
    mockCalls.push({ table: t, ids: rows.map((r) => r.id) });
    mockDb[t] = mockDb[t] ?? new Map();
    for (const r of rows) mockDb[t].set(r.id, { ...r, user_id: 'user-a' });
    return { ok: true, data: rows.length };
  }),
}));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'user-a', email: null })) }));

import { dryRunRestore, executeRestore, prepareRow } from '../../services/restoreService';
import { buildManifest } from '../../lib/backupFormat';

const U = 'user-a';
const data = {
  projects: [{ id: 'p1', user_id: U, name: 'Tez' }],
  tasks: Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, user_id: U, title: `g${i}`, project_id: 'p1' })),
  habits: [{ id: 'h1', user_id: U, name: 'Su', status: 'active' }],
  habit_logs: [{ id: 'l1', user_id: U, habit_id: 'h1' }],
};
const text = JSON.stringify({ format_version: 3, truncated: [], manifest: buildManifest(U, 'x', data), ...data });

beforeEach(() => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockCalls.length = 0; mockFailTable = null; mockReadFail = false; });

it('merges into an empty account, parents first, habits queued, logs never written', async () => {
  const d = await dryRunRestore(text);
  if (!d.ok) throw new Error(d.reason);
  const r = await executeRestore(d.plan);
  expect(r).toMatchObject({ inserted: { projects: 1, habits: 1, tasks: 120 }, failed: [], cancelled: false });
  expect(mockCalls[0].table === 'projects' || mockCalls[0].table === 'habits').toBe(true);
  expect(mockCalls.findIndex((c) => c.table === 'projects')).toBeLessThan(mockCalls.findIndex((c) => c.table === 'tasks'));
  expect(mockDb.habits.get('h1').status).toBe('waiting');
  expect(mockCalls.some((c) => c.table === 'habit_logs')).toBe(false);
  expect(mockCalls.filter((c) => c.table === 'tasks').map((c) => c.ids.length)).toEqual([50, 50, 20]);
});

it('the same file twice: the second dry run adds nothing', async () => {
  const d1 = await dryRunRestore(text);
  if (!d1.ok) throw new Error();
  await executeRestore(d1.plan);
  // the restored habit is now `waiting` -> a content difference, reported as a conflict, never re-inserted
  const d2 = await dryRunRestore(text);
  if (!d2.ok) throw new Error();
  expect(d2.plan.inserts).toBe(0);
});

it('a failed parent holds its children back', async () => {
  mockFailTable = 'projects';
  const d = await dryRunRestore(text);
  if (!d.ok) throw new Error();
  const r = await executeRestore(d.plan);
  expect(r.failed.map((f) => f.collection)).toEqual(['projects', 'tasks']);
  expect(mockCalls.some((c) => c.table === 'tasks')).toBe(false);
});

it('cancel stops between chunks; what was written is reported', async () => {
  const d = await dryRunRestore(text);
  if (!d.ok) throw new Error();
  let n = 0;
  const r = await executeRestore(d.plan, { shouldCancel: () => mockCalls.filter((c) => c.table === 'tasks').length >= 1 && ++n > 0 });
  expect(r.cancelled).toBe(true);
  expect(r.inserted.tasks).toBe(50);
});

it('only habits are changed on the way in, and only active -> waiting', () => {
  expect(prepareRow('habits', { status: 'active' })).toEqual({ status: 'waiting' });
  expect(prepareRow('habits', { status: 'paused' })).toEqual({ status: 'paused' });
  expect(prepareRow('tasks', { status: 'active' })).toEqual({ status: 'active' });
});

it('an account that cannot be read is not treated as empty: no plan, nothing written', async () => {
  mockReadFail = true;
  const d = await dryRunRestore(text);
  expect(d).toMatchObject({ ok: false, reason: expect.stringMatching(/okunamadı/) });
});
