/**
 * R08.04 — the confirmed merge: parents first, habits queued, a failed parent
 * holds its children back, cancel between chunks, the same file twice is one
 * effect.
 */
const mockDb: Record<string, Map<string, any>> = {};
const mockCalls: { table: string; ids: string[] }[] = [];
let mockFailTable: string | null = null;
let mockReadFail = false;
let mockCurrentUserId = 'user-a';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (t: string) => ({
      insert: (rows: any[]) => ({
        select: async () => {
          if (t === mockFailTable) {
            return { data: null, error: { message: 'refused', code: '42501' }, status: 403 };
          }
          const db = mockDb[t] ?? new Map();
          const dup = rows.find((r) => db.has(String(r.id)));
          if (dup) {
            return {
              data: null,
              error: { message: `duplicate key ${String(dup.id)}`, code: '23505' },
              status: 409,
            };
          }
          mockCalls.push({ table: t, ids: rows.map((r) => String(r.id)) });
          mockDb[t] = db;
          for (const r of rows) db.set(String(r.id), { ...r, user_id: mockCurrentUserId });
          return { data: rows.map((r) => ({ id: r.id })), error: null, status: 201 };
        },
      }),
    }),
  },
}));

jest.mock('../../repositories/shared', () => ({
  ...jest.requireActual('../../repositories/shared'),
  currentUserId: jest.fn(async () => ({ ok: true, userId: mockCurrentUserId })),
}));

jest.mock('../../repositories/restoreRepository', () => {
  const actual = jest.requireActual('../../repositories/restoreRepository');
  return {
    ...actual,
    RESTORE_TABLES: ['projects', 'habits', 'goals', 'tasks', 'notes', 'journal_entries', 'bad_habits'],
    fetchExistingRows: jest.fn(async (t: string) => (mockReadFail ? { ok: false, error: 'offline' } : { ok: true, data: [...(mockDb[t]?.values() ?? [])] })),
    insertRestoredRows: jest.fn((t: any, rows: any[], expectedUserId: string) => actual.insertRestoredRows(t, rows, expectedUserId)),
  };
});
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: mockCurrentUserId, email: null })) }));

import { dryRunRestore, executeRestore, prepareRow } from '../../services/restoreService';
import * as restoreRepo from '../../repositories/restoreRepository';
import { buildManifest } from '../../lib/backupFormat';

const U = 'user-a';
const data = {
  projects: [{ id: 'p1', user_id: U, name: 'Tez' }],
  tasks: Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, user_id: U, title: `g${i}`, project_id: 'p1' })),
  habits: [{ id: 'h1', user_id: U, name: 'Su', status: 'active' }],
  habit_logs: [{ id: 'l1', user_id: U, habit_id: 'h1' }],
};
const text = JSON.stringify({ format_version: 3, truncated: [], manifest: buildManifest(U, 'x', data), ...data });

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockCalls.length = 0;
  mockFailTable = null;
  mockReadFail = false;
  mockCurrentUserId = 'user-a';
  jest.clearAllMocks();
});

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

it('refuses executeRestore with WRONG_ACCOUNT without writing if the active session changed after dryRunRestore', async () => {
  const d = await dryRunRestore(text);
  if (!d.ok) throw new Error(d.reason);
  expect(d.notices[0]).toMatch(/^habit_logs: 1 kayıt/);
  mockCurrentUserId = 'user-b';
  const r = await executeRestore(d.plan);
  expect(r).toEqual({
    inserted: {},
    skipped: {},
    failed: [{ collection: '*', error: expect.stringMatching(/WRONG_ACCOUNT/) }],
    cancelled: false,
  });
  expect(restoreRepo.insertRestoredRows).not.toHaveBeenCalled();
  expect(mockCalls).toEqual([]);
});

it('a single 23505 duplicate inside a 50-row chunk is bisected and skipped while the other 49 rows succeed', async () => {
  const d = await dryRunRestore(text);
  if (!d.ok) throw new Error(d.reason);
  // Another device inserts t23 after dryRunRestore and before executeRestore
  mockDb.tasks = new Map([['t23', { id: 't23', user_id: U, title: 'g23', project_id: 'p1' }]]);
  const r = await executeRestore(d.plan);
  expect(r).toEqual({
    inserted: { projects: 1, habits: 1, tasks: 119 },
    skipped: { tasks: 1 },
    failed: [],
    cancelled: false,
  });
  expect(mockDb.tasks.size).toBe(120);
});
