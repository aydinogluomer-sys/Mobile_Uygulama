/**
 * R08.02 — "Koleksiyon sayısı, ilişki kimliği, format sürümü ve checksum
 * içeren manifest ... Eşzamanlı değişim için tutarlı snapshot/pencere kuralı
 * ... Son başarılı yedeği koruyan sınırlı otomatik yerel rotasyon ve son
 * başarı durumu ekle; OS çalıştırmadığında yedek alınmış gibi gösterme."
 */
const mockFail = { collection: null as string | null, truncated: null as string | null, hugeBytes: 0 };
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../repositories/exportRepository', () => ({
  MAX_EXPORT_ROWS: 20_000,
  EXPORT_FULL_TABLES: ['habits', 'habit_logs', 'journal_entries', 'focus_sessions', 'webhooks'],
  fetchFullTable: jest.fn(async (t: string) => {
    if (mockFail.collection === t) return { ok: false, error: 'timeout', code: '57014' };
    if (t === 'habits') {
      const rows = mockFail.hugeBytes > 0
        ? [{ id: 'h1', user_id: 'u1', pad: 'x'.repeat(mockFail.hugeBytes) }]
        : [{ id: 'h1', user_id: 'u1' }];
      return { ok: true, data: { rows, truncated: mockFail.truncated === t } };
    }
    return { ok: true, data: { rows: [], truncated: mockFail.truncated === t } };
  }),
  fetchOwnProfileForExport: jest.fn(async () => ({ ok: true, data: [] })),
  fetchOwnOnboardingForExport: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../repositories/taskRepository', () => ({ fetchTasksPage: jest.fn(async () => ({ ok: true, data: { rows: [{ id: 't1', user_id: 'u1', project_id: 'p1' }], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/noteRepository', () => ({ fetchNotesPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/projectRepository', () => ({ fetchProjectsPage: jest.fn(async () => ({ ok: true, data: { rows: [{ id: 'p1', user_id: 'u1' }], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/goalRepository', () => ({ fetchGoalsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/badHabitRepository', () => ({ fetchBadHabitsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/restoreRepository', () => ({
  ...jest.requireActual('../../repositories/restoreRepository'),
  fetchOwnedTable: jest.fn(async (t: string) => (
    mockFail.collection === t
      ? { ok: false, error: 'timeout', code: '57014' }
      : { ok: true, data: { rows: [], truncated: mockFail.truncated === t } }
  )),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'fs';
import * as path from 'path';
import { rendersKey } from '../helpers/catalog';
import { runLocalBackup, maybeRunDailyLocalBackup, loadLocalBackupStatus, latestCompleteLocalBackup } from '../../services/localBackupService';
import { buildBackup } from '../../services/exportService';
import {
  rotate, shouldRun, statusText, planEviction, utf8Bytes,
  EMPTY_STATUS, LOCAL_BACKUP_KEEP, LOCAL_BACKUP_MAX_BYTES, LOCAL_BACKUP_TOTAL_BYTES,
} from '../../lib/backupRotation';
import { verifyBackupText } from '../../lib/backupFormat';

beforeEach(async () => { await AsyncStorage.clear(); mockFail.collection = null; mockFail.truncated = null; mockFail.hugeBytes = 0; });

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

  it('F20 (SYN-11) — refuses a copy over 1 MB without writing to AsyncStorage, marks truncated copies incomplete, and protects the newest complete copy during budget eviction', async () => {
    expect(utf8Bytes('çğıöşü')).toBe(12);

    // 1 MB üstü kopya AsyncStorage'a hiç yazılmaz
    mockFail.hugeBytes = LOCAL_BACKUP_MAX_BYTES;
    const tooBig = await runLocalBackup(new Date('2026-10-08T09:00:00Z'));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toMatch(/çok büyük/);
    const storedAfterBig = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('backup.local.v1.u1.') && !k.endsWith('.status'));
    expect(storedAfterBig).toEqual([]);

    // Kırpılmış kopya complete=false olur
    mockFail.hugeBytes = 0;
    mockFail.truncated = 'habit_logs';
    const cutRes = await runLocalBackup(new Date('2026-10-08T10:00:00Z'));
    expect(cutRes.ok && !cutRes.complete).toBe(true);
    mockFail.truncated = null;

    // planEviction en yeni TAM kopyayı korur, daha yeni bile olsa eksik olanları siler
    const slots = [
      { key: 'k-new-incomplete', created_at: '2026-10-04T00:00:00Z', complete: false, bytes: 900_000 },
      { key: 'k-mid-incomplete', created_at: '2026-10-03T00:00:00Z', complete: false, bytes: 900_000 },
      { key: 'k-old-complete', created_at: '2026-10-01T00:00:00Z', complete: true, bytes: 900_000 },
    ];
    const ev = planEviction(slots, 900_000, LOCAL_BACKUP_TOTAL_BYTES);
    expect(ev.fits).toBe(true);
    expect(ev.drop).not.toContain('k-old-complete');
    expect(ev.drop).toEqual(['k-mid-incomplete', 'k-new-incomplete']);

    // Tek korumalı kopyayla bile bütçeye sığmıyorsa fits=false döner
    const tight = planEviction(
      [{ key: 'k-protected', created_at: '2026-10-01T00:00:00Z', complete: true, bytes: 900_000 }],
      900_000,
      1_500_000,
    );
    expect(tight).toEqual({ drop: [], fits: false });
  });
});

it('the manual export says when a collection hit the row ceiling (no silent cut)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/tabs/settings.tsx'), 'utf8');
  expect(rendersKey(src, 'settings.export.truncated.title', 'Dışa aktarım tam değil')).toBe(true);
  expect(src).toMatch(/if \(backup\.truncated\.length > 0\) \{[\s\S]*?void notify\(\s*t\(\s*'settings\.export\.truncated\.title'\s*\)/);
});
