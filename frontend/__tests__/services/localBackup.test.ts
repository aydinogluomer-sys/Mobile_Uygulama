/**
 * R08.02 — "Koleksiyon sayısı, ilişki kimliği, format sürümü ve checksum
 * içeren manifest ... Eşzamanlı değişim için tutarlı snapshot/pencere kuralı
 * ... Son başarılı yedeği koruyan sınırlı otomatik yerel rotasyon ve son
 * başarı durumu ekle; OS çalıştırmadığında yedek alınmış gibi gösterme."
 */
const mockFail = { collection: null as string | null };
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../repositories/habitRepository', () => ({ fetchHabits: jest.fn(async () => ({ ok: true, data: [{ id: 'h1', user_id: 'u1' }] })) }));
jest.mock('../../repositories/taskRepository', () => ({ fetchTasksPage: jest.fn(async () => ({ ok: true, data: { rows: [{ id: 't1', user_id: 'u1', project_id: 'p1' }], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/noteRepository', () => ({ fetchNotesPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/projectRepository', () => ({ fetchProjectsPage: jest.fn(async () => ({ ok: true, data: { rows: [{ id: 'p1', user_id: 'u1' }], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/goalRepository', () => ({ fetchGoalsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/badHabitRepository', () => ({ fetchBadHabitsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/journalRepository', () => ({ fetchJournalEntries: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/focusSessionRepository', () => ({ fetchAllFocusSessions: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/webhookRepository', () => ({ fetchWebhooks: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/habitLogRepository', () => ({ fetchHabitLogsForHabitsSince: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../repositories/restoreRepository', () => ({
  ...jest.requireActual('../../repositories/restoreRepository'),
  fetchOwnedTable: jest.fn(async (t: string) => (mockFail.collection === t ? { ok: false, error: 'timeout', code: '57014' } : { ok: true, data: { rows: [], truncated: false } })),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'fs';
import * as path from 'path';
import { runLocalBackup, maybeRunDailyLocalBackup, loadLocalBackupStatus, latestCompleteLocalBackup } from '../../services/localBackupService';
import { buildBackup } from '../../services/exportService';
import { rotate, shouldRun, statusText, EMPTY_STATUS, LOCAL_BACKUP_KEEP } from '../../lib/backupRotation';
import { verifyBackupText } from '../../lib/backupFormat';

beforeEach(async () => { await AsyncStorage.clear(); mockFail.collection = null; });

describe('manifest', () => {
  it('names every relation and the consistency window', async () => {
    let t = Date.parse('2026-10-08T09:00:00Z');
    const b = await buildBackup(new Date(t), { userId: 'u1', clock: () => new Date((t += 1000)) });
    expect(b.manifest!.relations!.tasks).toEqual({ project_id: 'projects' });
    expect(b.manifest!.relations!.key_results).toEqual({ okr_id: 'okrs' });
    expect(b.manifest!.snapshot).toMatchObject({ started_at: '2026-10-08T09:00:01.000Z' });
    expect(b.manifest!.snapshot!.finished_at > b.manifest!.snapshot!.started_at).toBe(true);
    expect(b.manifest!.snapshot!.rule).toMatch(/birebir/);
    expect(b.manifest!.format).toBe(3);
    expect(b.manifest!.collections.tasks).toMatchObject({ count: 1 });
    expect(verifyBackupText(JSON.stringify(b), 'u1').ok).toBe(true);
  });
});

describe('rotation rules', () => {
  const slot = (iso: string, complete = true) => ({ key: `k-${iso}`, created_at: iso, complete, bytes: 1 });
  it('keeps the newest N', () => {
    let slots = [slot('2026-10-01'), slot('2026-10-02'), slot('2026-10-03')];
    const r = rotate(slots, slot('2026-10-04'));
    expect(r.slots.map((s) => s.created_at)).toEqual(['2026-10-04', '2026-10-03', '2026-10-02']);
    expect(r.drop).toEqual(['k-2026-10-01']);
    slots = r.slots;
    expect(slots).toHaveLength(LOCAL_BACKUP_KEEP);
  });
  it('the last COMPLETE copy survives newer incomplete ones', () => {
    const slots = [slot('2026-10-03', false), slot('2026-10-02', false), slot('2026-10-01', true)];
    const r = rotate(slots, slot('2026-10-04', false));
    expect(r.slots.map((s) => s.created_at)).toContain('2026-10-01');
    expect(r.slots).toHaveLength(LOCAL_BACKUP_KEEP);
    expect(r.drop).toEqual(['k-2026-10-02']);
  });
  it('due once a day; a failed try waits an hour before the next one', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(shouldRun(EMPTY_STATUS, now)).toBe(true);
    expect(shouldRun({ ...EMPTY_STATUS, lastSuccessAt: '2026-10-08T01:00:00Z' }, now)).toBe(false);
    expect(shouldRun({ ...EMPTY_STATUS, lastSuccessAt: '2026-10-07T11:00:00Z' }, now)).toBe(true);
    expect(shouldRun({ ...EMPTY_STATUS, lastAttemptAt: '2026-10-08T11:30:00Z', lastError: 'x' }, now)).toBe(false);
  });
  it('the status never claims a copy that was not made', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(statusText(EMPTY_STATUS, now)).toBe('Henüz tam bir yerel yedek yok.');
    expect(statusText({ ...EMPTY_STATUS, lastSuccessAt: '2026-10-05T12:00:00Z', slots: [{ key: 'a', created_at: 'x', complete: true, bytes: 1 }] }, now))
      .toBe('Son tam yerel yedek: 3 gün önce (cihazda 1 tam kopya).');
    expect(statusText({ ...EMPTY_STATUS, lastSuccessAt: '2026-10-05T12:00:00Z', lastAttemptAt: '2026-10-08T11:00:00Z', lastError: 'depolama dolu', slots: [] }, now))
      .toMatch(/Son deneme başarısız: depolama dolu$/);
  });
});

describe('the local copy', () => {
  it('a complete copy is written, read back, verified, and becomes the last success', async () => {
    const r = await runLocalBackup(new Date('2026-10-08T09:00:00Z'));
    expect(r.ok && r.complete).toBe(true);
    const status = await loadLocalBackupStatus('u1');
    expect(status.lastSuccessAt).toBe('2026-10-08T09:00:00.000Z');
    const latest = await latestCompleteLocalBackup();
    expect(verifyBackupText(latest!.text, 'u1').ok).toBe(true);
  });

  it('an incomplete copy is kept but does NOT move the last success', async () => {
    await runLocalBackup(new Date('2026-10-07T09:00:00Z'));
    mockFail.collection = 'okrs';
    const r = await runLocalBackup(new Date('2026-10-08T09:00:00Z'));
    expect(r.ok && !r.complete).toBe(true);
    const status = await loadLocalBackupStatus('u1');
    expect(status.lastSuccessAt).toBe('2026-10-07T09:00:00.000Z');
    expect(status.lastError).toMatch(/okrs/);
    expect((await latestCompleteLocalBackup())!.created_at).toBe('2026-10-07T09:00:00.000Z');
  });

  it('runs on open only when due; old copies are removed from the device', async () => {
    expect(await maybeRunDailyLocalBackup(new Date('2026-10-01T09:00:00Z'))).not.toBeNull();
    expect(await maybeRunDailyLocalBackup(new Date('2026-10-01T20:00:00Z'))).toBeNull(); // same day
    for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) await maybeRunDailyLocalBackup(new Date(`${d}T09:00:00Z`));
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('backup.local.v1.u1.') && !k.endsWith('.status'));
    expect(keys).toHaveLength(LOCAL_BACKUP_KEEP);
    expect(keys.some((k) => k.includes('2026-10-01'))).toBe(false);
  });
});

it('the manual export says when a collection hit the 5.000-row ceiling (no silent cut)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/tabs/settings.tsx'), 'utf8');
  expect(src).toMatch(/if \(backup\.truncated\.length > 0\) \{\s*Alert\.alert\(\s*'Dışa aktarım tam değil'/);
});
