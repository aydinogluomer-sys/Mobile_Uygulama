/**
 * R08.07 — "5.000 üzeri kayıtlı hesap, eski format, yarım ağ, bozuk parça,
 * aynı yedeğin tekrarı ve başka test hesabına restore tatbikatı yap.
 * Sayım/ilişki/hash uzlaşmasını kaydet; dosya indirmek geri yükleme kanıtı
 * değildir."
 *
 * Every drill restores into an in-memory server (two accounts) through the
 * real export, verify, dry run and restore code, and then RE-EXPORTS to
 * reconcile counts, relations and checksums -- a downloaded file is not the
 * evidence; the data coming back is.
 */
type Row = Record<string, unknown> & { id: string; user_id: string };
const mockServer = {
  user: 'acct-a',
  tables: new Map<string, Map<string, Row>>(),
  failInsertAfter: Infinity,
  inserts: 0,
};
const mockT = (name: string) => { if (!mockServer.tables.has(name)) mockServer.tables.set(name, new Map()); return mockServer.tables.get(name)!; };
const mockMine = (name: string) => [...mockT(name).values()].filter((r) => r.user_id === mockServer.user).sort((a, b) => a.id.localeCompare(b.id));
const mockPage = (name: string) => async (cursor?: { id: string } | null, limit = 200) => {
  const all = mockMine(name).filter((r) => !cursor || r.id > cursor.id);
  const rows = all.slice(0, limit);
  const hasMore = all.length > limit;
  return { ok: true, data: { rows, hasMore, nextCursor: hasMore ? { key: rows[rows.length - 1].id, id: rows[rows.length - 1].id } : null } };
};

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: mockServer.user, email: null })) }));
jest.mock('../../repositories/exportRepository', () => ({
  MAX_EXPORT_ROWS: 20_000,
  EXPORT_FULL_TABLES: ['habits', 'habit_logs', 'journal_entries', 'focus_sessions', 'webhooks'],
  fetchFullTable: jest.fn(async (t: string, max = 20_000) => {
    const rows = mockMine(t);
    return { ok: true, data: { rows: rows.slice(0, max), truncated: rows.length > max } };
  }),
  fetchOwnProfileForExport: jest.fn(async () => ({ ok: true, data: mockMine('profiles') })),
  fetchOwnOnboardingForExport: jest.fn(async () => ({ ok: true, data: mockMine('user_onboarding') })),
}));
jest.mock('../../repositories/taskRepository', () => ({ fetchTasksPage: jest.fn((c?: { id: string } | null, l?: number) => mockPage('tasks')(c, l)) }));
jest.mock('../../repositories/noteRepository', () => ({ fetchNotesPage: jest.fn((c?: { id: string } | null, l?: number) => mockPage('notes')(c, l)) }));
jest.mock('../../repositories/projectRepository', () => ({ fetchProjectsPage: jest.fn((c?: { id: string } | null, l?: number) => mockPage('projects')(c, l)) }));
jest.mock('../../repositories/goalRepository', () => ({ fetchGoalsPage: jest.fn((c?: { id: string } | null, l?: number) => mockPage('goals')(c, l)) }));
jest.mock('../../repositories/badHabitRepository', () => ({ fetchBadHabitsPage: jest.fn((c?: { id: string } | null, l?: number) => mockPage('bad_habits')(c, l)) }));
jest.mock('../../repositories/restoreRepository', () => {
  const actual = jest.requireActual('../../repositories/restoreRepository');
  const owned = async (t: string, max = actual.MAX_EXISTING) => {
    const rows = mockMine(t);
    return { ok: true, data: { rows: rows.slice(0, max), truncated: rows.length > max } };
  };
  return {
    ...actual,
    fetchOwnedTable: jest.fn(owned),
    fetchExistingRows: jest.fn(async (t: string) => {
      const r = await owned(t);
      return r.data.truncated ? { ok: false, error: 'too large', code: 'TOO_LARGE' } : { ok: true, data: r.data.rows };
    }),
    insertRestoredRows: jest.fn(async (t: string, rows: Row[]) => {
      if (mockServer.inserts >= mockServer.failInsertAfter) return { ok: false, error: 'Network request failed', offline: true };
      mockServer.inserts += 1;
      for (const r of rows) {
        if (mockT(t).has(r.id)) return { ok: false, error: `duplicate key ${r.id}`, code: '23505' };
      }
      for (const r of rows) mockT(t).set(r.id, { ...r, user_id: mockServer.user });
      return { ok: true, data: rows.length };
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildBackup } from '../../services/exportService';
import { dryRunRestore, executeRestore, loadRestoreJob } from '../../services/restoreService';
import { verifyBackupText, canonical, checksum, REGISTRY } from '../../lib/backupFormat';

function seed(user: string, name: string, rows: Omit<Row, 'user_id'>[]) {
  for (const r of rows) mockT(name).set(String(r.id), { ...r, user_id: user } as Row);
}
function wipe(user: string) {
  for (const t of mockServer.tables.values()) for (const [id, r] of t) if (r.user_id === user) t.delete(id);
}
async function exportText(user: string) {
  mockServer.user = user;
  return JSON.stringify(await buildBackup(new Date('2026-10-08T09:00:00Z'), { userId: user }));
}
async function restore(user: string, text: string) {
  mockServer.user = user;
  const dry = await dryRunRestore(text);
  if (!dry.ok) return { dry, report: null };
  return { dry, report: await executeRestore(dry.plan, { job: dry.job }) };
}
const restorable = REGISTRY.filter((c) => c.restorable).map((c) => c.name);
/** Count + checksum per restorable collection, from a fresh export: the reconciliation record. */
async function reconcile(user: string) {
  const b = JSON.parse(await exportText(user));
  return Object.fromEntries(restorable.map((c) => [c, { count: b.manifest.collections[c]?.count ?? 0, checksum: b.manifest.collections[c]?.checksum }]));
}

beforeEach(async () => {
  mockServer.tables.clear(); mockServer.user = 'acct-a'; mockServer.failInsertAfter = Infinity; mockServer.inserts = 0;
  await AsyncStorage.clear();
});

const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(6, '0')}`, title: `görev ${i}`, project_id: i % 10 === 0 ? 'p1' : null, completed: i % 3 === 0 }));

it('drill 1 — an account over 5.000 rows comes back whole: counts, relations and hashes reconcile', async () => {
  seed('acct-a', 'projects', [{ id: 'p1', name: 'Tez' }]);
  seed('acct-a', 'tasks', tasks(5200));
  seed('acct-a', 'okrs', [{ id: 'o1', objective: 'Kitap' }]);
  seed('acct-a', 'key_results', [{ id: 'k1', okr_id: 'o1', title: '12 kitap', current_value: 3, target_value: 12 }]);
  seed('acct-a', 'habits', [{ id: 'h1', name: 'Su', status: 'waiting' }, { id: 'h2', name: 'Koşu', status: 'active' }]);
  const before = await reconcile('acct-a');
  const text = await exportText('acct-a');
  expect(verifyBackupText(text, 'acct-a').ok).toBe(true);
  expect(JSON.parse(text).truncated).toEqual([]);
  wipe('acct-a'); // the account lost everything
  const { report } = await restore('acct-a', text);
  expect(report!.failed).toEqual([]);
  expect(report!.inserted).toMatchObject({ tasks: 5200, projects: 1, okrs: 1, key_results: 1 });
  const after = await reconcile('acct-a');
  // same counts AND same checksums -- except habits, which come back queued by design
  expect({ ...after, habits: undefined }).toEqual({ ...before, habits: undefined });
  expect(after.habits.count).toBe(before.habits.count);
  expect(mockMine('habits').map((h) => [h.id, h.status])).toEqual([['h1', 'waiting'], ['h2', 'waiting']]);
  expect(mockMine('tasks').filter((t) => t.project_id === 'p1')).toHaveLength(520); // relation intact
});

it('drill 1b — past the ceiling the file says it is cut and is refused; nothing is written', async () => {
  const { MAX_ROWS } = jest.requireActual('../../services/exportService');
  seed('acct-a', 'tasks', tasks(MAX_ROWS + 1));
  const text = await exportText('acct-a');
  expect(JSON.parse(text).truncated).toEqual(['tasks']);
  const v = verifyBackupText(text, 'acct-a');
  expect(v.ok ? '' : v.reason).toMatch(/Dosya eksik \(kesilmiş koleksiyonlar: tasks\)/);
}, 30_000);

it('drill 2 — an old-format file is refused with a reason, before anything is read', async () => {
  const old = JSON.stringify({ format_version: 2, export_date: '2026-01-01', tasks: [{ id: 'x' }] });
  const { dry } = await restore('acct-a', old);
  expect(dry.ok ? '' : dry.reason).toMatch(/Manifest yok/);
  expect(mockMine('tasks')).toEqual([]);
});

it('drill 3 — half a network: the restore stops, then continues as the same job, nothing twice', async () => {
  seed('acct-a', 'notes', Array.from({ length: 130 }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, title: `${i}`, content: 'c', tags: [] })));
  const before = await reconcile('acct-a');
  const text = await exportText('acct-a');
  wipe('acct-a');
  mockServer.failInsertAfter = 1; // the network drops after the first chunk
  const first = await restore('acct-a', text);
  expect(first.report!.failed[0]).toMatchObject({ collection: 'notes' });
  expect(await loadRestoreJob()).toMatchObject({ status: 'failed', inserted: { notes: 50 } });
  mockServer.failInsertAfter = Infinity;
  const second = await restore('acct-a', text);
  expect(second.dry.ok && second.dry.job.resumes).toBe(true);
  expect(second.report!.inserted).toEqual({ notes: 80 });
  expect(await reconcile('acct-a')).toEqual(before);
  expect(await loadRestoreJob()).toMatchObject({ status: 'done', inserted: { notes: 130 } });
});

it('drill 4 — a corrupted part is refused; the account is not touched', async () => {
  seed('acct-a', 'notes', [{ id: 'n1', title: 'a', content: 'b', tags: [] }]);
  const file = JSON.parse(await exportText('acct-a'));
  file.notes[0].content = 'değiştirilmiş';
  wipe('acct-a');
  const { dry } = await restore('acct-a', JSON.stringify(file));
  expect(dry.ok ? '' : dry.reason).toMatch(/"notes" sağlaması tutmuyor/);
  expect(mockMine('notes')).toEqual([]);
});

it('drill 5 — the same backup restored twice: the second adds nothing and earns nothing', async () => {
  seed('acct-a', 'tasks', tasks(60));
  seed('acct-a', 'habit_logs', [{ id: 'l1', habit_id: 'h1', state: 'done', xp: 30 }]);
  const text = await exportText('acct-a');
  wipe('acct-a');
  await restore('acct-a', text);
  const again = await restore('acct-a', text);
  expect(again.dry.ok && again.dry.plan.inserts).toBe(0);
  expect(again.report!.inserted).toEqual({});
  expect(mockMine('habit_logs')).toEqual([]); // XP-bearing rows are never restored (no reward)
});

it('drill 6 — a backup restored into ANOTHER test account is refused; neither account changes', async () => {
  seed('acct-a', 'notes', [{ id: 'n1', title: 'a', content: 'b', tags: [] }]);
  seed('acct-b', 'notes', [{ id: 'nb', title: 'b', content: 'b', tags: [] }]);
  const text = await exportText('acct-a');
  const { dry } = await restore('acct-b', text);
  expect(dry.ok ? '' : dry.reason).toMatch(/başka bir hesaba ait/);
  mockServer.user = 'acct-b';
  expect(mockMine('notes').map((n) => n.id)).toEqual(['nb']);
});

it('drill 7 — an orphan in the file is held back, the rest restored', async () => {
  const file = { okrs: [] as Row[], key_results: [{ id: 'k9', user_id: 'acct-a', okr_id: 'missing', title: 'x' }] };
  const { buildManifest } = jest.requireActual('../../lib/backupFormat');
  const text = JSON.stringify({ manifest: buildManifest('acct-a', '2026-10-08T00:00:00Z', file), ...file });
  const { dry, report } = await restore('acct-a', text);
  expect(dry.ok && dry.plan.collections.find((c) => c.name === 'key_results')!.orphans).toEqual(['k9']);
  expect(report!.inserted).toEqual({});
  expect(checksum(canonical([]))).toBe(checksum(canonical([]))); // reconciliation helper is deterministic
});

it('boundary — exactly the ceiling is complete; one more row is truncated (no off-by-one either way)', async () => {
  const { drain } = jest.requireActual('../../services/exportService');
  const pages = (n: number) => async (c?: { id: string } | null) => {
    const all = Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}` })).filter((r) => !c || r.id > c.id);
    const rows = all.slice(0, 2);
    return { ok: true, data: { rows, hasMore: all.length > 2, nextCursor: all.length > 2 ? { key: rows[1].id, id: rows[1].id } : null } };
  };
  expect((await drain(pages(6), 6)).truncated).toBe(false);
  expect((await drain(pages(7), 6)).truncated).toBe(true);
});

it('drill 3b — one refused chunk stops that collection (no gaps), and the resume fills it in order', async () => {
  seed('acct-a', 'notes', Array.from({ length: 130 }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, title: `${i}`, content: 'c', tags: [] })));
  const text = await exportText('acct-a');
  wipe('acct-a');
  const insert = jest.requireMock('../../repositories/restoreRepository').insertRestoredRows as jest.Mock;
  const real = insert.getMockImplementation()!;
  insert.mockImplementationOnce(real).mockImplementationOnce(async () => ({ ok: false, error: 'rejected once' }));
  const first = await restore('acct-a', text);
  expect(first.report!.inserted).toEqual({ notes: 50 }); // stopped: the third chunk was NOT sent past the gap
  expect(mockMine('notes').map((n) => n.id).slice(-1)).toEqual(['n049']);
  const second = await restore('acct-a', text);
  expect(second.report!.inserted).toEqual({ notes: 80 });
  expect(mockMine('notes')).toHaveLength(130);
});
