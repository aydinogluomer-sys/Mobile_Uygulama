/**
 * R08.01 — the export covers the whole account (plus this device's own data,
 * never its sessions), every collection is in the manifest, a table whose
 * migration has not run is skipped (not failed), and restore holds back
 * what the server cannot take yet and children of a parent that failed.
 */
const mockOwned: Record<string, { ok: boolean; rows?: Record<string, unknown>[]; code?: string; error?: string }> = {};
const mockInserts: { table: string; rows: Record<string, unknown>[] }[] = [];
const mockExisting: Record<string, { ok: boolean; code?: string }> = {};
const mockInsertFail = new Set<string>();

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../repositories/habitRepository', () => ({ fetchHabits: jest.fn(async () => ({ ok: true, data: [{ id: 'h1', user_id: 'u1', name: 'Su' }] })) }));
jest.mock('../../repositories/taskRepository', () => ({ fetchTasksPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/noteRepository', () => ({ fetchNotesPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/projectRepository', () => ({ fetchProjectsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/goalRepository', () => ({ fetchGoalsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/badHabitRepository', () => ({ fetchBadHabitsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/journalRepository', () => ({ fetchJournalEntries: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/focusSessionRepository', () => ({ fetchAllFocusSessions: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/webhookRepository', () => ({ fetchWebhooks: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/habitLogRepository', () => ({ fetchHabitLogsForHabitsSince: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/restoreRepository', () => ({
  ...jest.requireActual('../../repositories/restoreRepository'),
  fetchOwnedTable: jest.fn(async (t: string) => {
    const o = mockOwned[t] ?? { ok: true, rows: [] };
    return o.ok ? { ok: true, data: { rows: o.rows ?? [], truncated: false } } : { ok: false, error: o.error ?? 'x', code: o.code };
  }),
  fetchExistingRows: jest.fn(async (t: string) => {
    const e = mockExisting[t];
    return e && !e.ok ? { ok: false, error: 'no table', code: e.code } : { ok: true, data: [] };
  }),
  insertRestoredRows: jest.fn(async (table: string, rows: Record<string, unknown>[]) => {
    if (mockInsertFail.has(table)) return { ok: false, error: 'denied' };
    mockInserts.push({ table, rows });
    return { ok: true, data: rows.length };
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildBackup } from '../../services/exportService';
import { verifyBackupText } from '../../lib/backupFormat';
import { dryRunRestore, executeRestore } from '../../services/restoreService';

beforeEach(async () => {
  for (const k of Object.keys(mockOwned)) delete mockOwned[k];
  for (const k of Object.keys(mockExisting)) delete mockExisting[k];
  mockInserts.length = 0; mockInsertFail.clear();
  await AsyncStorage.clear();
});

describe('export', () => {
  it('includes the rest of the account, each collection in the manifest', async () => {
    mockOwned.okrs = { ok: true, rows: [{ id: 'o1', user_id: 'u1', objective: 'Kitap' }] };
    mockOwned.key_results = { ok: true, rows: [{ id: 'k1', user_id: 'u1', okr_id: 'o1' }] };
    mockOwned.ai_messages = { ok: true, rows: [{ id: 'm1', user_id: 'u1', conversation_id: 'c1' }] };
    const b = await buildBackup(new Date(2026, 9, 8), { userId: 'u1' });
    expect(b.okrs).toHaveLength(1);
    expect(b.key_results).toHaveLength(1);
    expect(b.manifest!.collections.okrs.count).toBe(1);
    expect(Object.keys(b.manifest!.collections)).toEqual(expect.arrayContaining([
      'okrs', 'key_results', 'reading_list', 'focus_tasks', 'recovery_plans', 'weekly_reviews', 'monthly_reviews',
      'life_area_logs', 'deep_work_sessions', 'ai_conversations', 'ai_messages', 'device',
    ]));
    expect(b.failed).toEqual([]);
    // and the file it makes verifies
    expect(verifyBackupText(JSON.stringify(b), 'u1').ok).toBe(true);
  });

  it('a table whose migration has not run is skipped, any other error is reported', async () => {
    mockOwned.habit_pauses = { ok: false, code: 'PGRST205', error: 'relation does not exist' };
    mockOwned.reading_list = { ok: false, code: '500', error: 'boom' };
    const b = await buildBackup(new Date(), { userId: 'u1' });
    expect(b.failed).toEqual([{ collection: 'reading_list', error: 'boom' }]);
    expect(b.habit_pauses).toEqual([]);
  });

  it('device data: this account\'s settings and local data, never sessions, queues or other accounts', async () => {
    await AsyncStorage.multiSet([
      ['moods.v1.u1', JSON.stringify({ v: 1, checkins: [{ id: 'c' }] })],
      ['routine.v1.u1', JSON.stringify({ v: 1, history: [] })],
      // F04: focus settings are per user; the old unscoped key and another account's key stay out
      ['focus.settings.v1.u1', JSON.stringify({ work: 25 })],
      ['focus.settings.v1', JSON.stringify({ work: 50 })],
      ['focus.settings.v1.u2', JSON.stringify({ work: 45 })],
      ['journal.draft.v1.u1.2026-10-08', JSON.stringify({ content: 'taslak' })],
      ['moods.v1.u2', JSON.stringify({ v: 1 })],
      ['journal.draft.v1.u2.2026-10-08', JSON.stringify({ content: 'başkasının taslağı' })],
      ['atlas_notion_login_session', JSON.stringify({ access_token: 'SECRET' })],
      ['outbox.v1.core.u1', JSON.stringify({ v: 1 })],
      ['focus.session.v1', '{}'],
      ['focus.session.v1.u1', '{}'],
    ]);
    const b = await buildBackup(new Date(), { userId: 'u1' });
    expect(b.device.map((d) => d.key)).toEqual(['focus.settings.v1.u1', 'journal.draft.v1.u1.2026-10-08', 'moods.v1.u1', 'routine.v1.u1']);
    expect(JSON.stringify(b)).not.toMatch(/SECRET/);
  });
});

describe('restore', () => {
  async function fileWith(extra: Record<string, unknown[]>) {
    Object.entries(extra).forEach(([t, rows]) => { mockOwned[t] = { ok: true, rows: rows as Record<string, unknown>[] }; });
    return JSON.stringify(await buildBackup(new Date(), { userId: 'u1' }));
  }

  it('OKRs then key results; a collection without a server table is held back, the rest goes ahead', async () => {
    const text = await fileWith({
      okrs: [{ id: 'o1', user_id: 'u1', objective: 'Kitap' }],
      key_results: [{ id: 'k1', user_id: 'u1', okr_id: 'o1', title: '12 kitap' }],
      habit_pauses: [{ id: 'p1', user_id: 'u1', habit_id: null, kind: 'holiday', start_date: '2026-08-01', end_date: '2026-08-10' }],
    });
    mockExisting.habit_pauses = { ok: false, code: '42P01' };
    const dry = await dryRunRestore(text);
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.plan.collections.find((c) => c.name === 'habit_pauses')!.blocked).toMatch(/sunucu tablosu henüz yok/);
    const report = await executeRestore(dry.plan);
    expect(mockInserts.map((i) => i.table)).toEqual(expect.arrayContaining(['habits', 'okrs', 'key_results']));
    expect(mockInserts.findIndex((i) => i.table === 'okrs')).toBeLessThan(mockInserts.findIndex((i) => i.table === 'key_results'));
    expect(report.failed).toEqual([]);
  });

  it('when a parent fails, its children are held back (not only tasks)', async () => {
    const text = await fileWith({
      okrs: [{ id: 'o1', user_id: 'u1', objective: 'Kitap' }],
      key_results: [{ id: 'k1', user_id: 'u1', okr_id: 'o1', title: '12 kitap' }],
    });
    mockInsertFail.add('okrs');
    const dry = await dryRunRestore(text);
    if (!dry.ok) throw new Error(dry.reason);
    const report = await executeRestore(dry.plan);
    expect(report.failed).toEqual(expect.arrayContaining([
      { collection: 'okrs', error: 'denied' },
      { collection: 'key_results', error: 'okrs eklenemediği için key_results eklenmedi.' },
    ]));
    expect(mockInserts.some((i) => i.table === 'key_results')).toBe(false);
  });

  it('the coach\'s conversations and device data are never written back', async () => {
    const text = await fileWith({ ai_conversations: [{ id: 'c1', user_id: 'u1' }] });
    const dry = await dryRunRestore(text);
    if (!dry.ok) throw new Error(dry.reason);
    await executeRestore(dry.plan);
    expect(mockInserts.some((i) => ['ai_conversations', 'ai_messages', 'device'].includes(i.table))).toBe(false);
  });
});
