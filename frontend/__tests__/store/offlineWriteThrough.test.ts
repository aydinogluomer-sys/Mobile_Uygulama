import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockNet = { online: true, permanentError: null as string | null };
const mockBaseSupabase = makeSupabaseMock(mockDb);

function mockWrapTable(table: string) {
  if (!mockNet.online) {
    const offlineAns = {
      data: null,
      count: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    };
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(offlineAns).then(onFulfilled);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  if (mockNet.permanentError) {
    const rejectedAns = {
      data: null,
      count: null,
      error: { message: mockNet.permanentError, code: '42501' },
      status: 403,
    };
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(rejectedAns).then(onFulfilled);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  return mockBaseSupabase.from(table);
}

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSession.userId
            ? { user: { id: mockSession.userId, email: 'u1@aderyth.app' }, access_token: 'tok' }
            : null,
        },
        error: null,
      }),
      getUser: async () => ({
        data: {
          user: mockSession.userId ? { id: mockSession.userId, email: 'u1@aderyth.app' } : null,
        },
        error: null,
      }),
    },
    from: (table: string) => mockWrapTable(table),
  },
}));

import { resetAccountMemory } from '../../lib/accountScope';
import * as localReadCache from '../../lib/localReadCache';
import { settle } from '../../lib/outbox';
import { namespacedOutboxKey } from '../../lib/outboxStorage';
import { coreOutbox } from '../../services/coreOutbox';
import { pendingJournalCommands, resolveJournalConflict } from '../../services/journalService';
import { useGoalStore } from '../../store/goalStore';
import { useLifeAreasStore } from '../../store/lifeAreasStore';
import { useOKRStore } from '../../store/okrStore';
import { useProjectStore } from '../../store/projectStore';
import { useReadingListStore } from '../../store/readingListStore';

const flushTicks = () => new Promise((r) => setTimeout(r, 15));

describe('F46 (5.2-g & Stage E) — 5-store writeThrough & atomic conflict replace rollback', () => {
  beforeEach(async () => {
    for (const k of Object.keys(mockDb.rows)) delete mockDb.rows[k];
    mockDb.inserts.length = 0;
    mockDb.idSeq = 0;
    mockDb.failNext = null;
    mockDb.failNextRead = null;
    mockSession.userId = 'u1';
    mockNet.online = true;
    mockNet.permanentError = null;

    resetAccountMemory('signed_out');
    coreOutbox.reset();
    localReadCache.clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  it('(+) all 5 stores succeed online (cache written outside set updater), queue offline with single command, surface permanent errors without queueing, and warn on savedOnDevice: false', async () => {
    let insideUpdater = false;
    let cacheInsideUpdater = false;
    const origGoalSet = useGoalStore.setState;
    const realSetCachedSnapshot = localReadCache.setCachedSnapshot;
    const setSpy = jest.spyOn(localReadCache, 'setCachedSnapshot').mockImplementation(async (...args) => {
      if (insideUpdater) cacheInsideUpdater = true;
      return realSetCachedSnapshot(...args);
    });
    const goalSetSpy = jest.spyOn(useGoalStore, 'setState').mockImplementation(((updater: unknown, replace?: boolean) => {
      if (typeof updater === 'function') {
        insideUpdater = true;
        try {
          return origGoalSet(updater as Parameters<typeof origGoalSet>[0], replace as false);
        } finally {
          insideUpdater = false;
        }
      }
      return origGoalSet(updater as Parameters<typeof origGoalSet>[0], replace as false);
    }) as typeof useGoalStore.setState);

    // 1. Online success across all 5 stores
    setSpy.mockClear();
    expect(await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Hedef 1' })).toBe(true);
    await flushTicks();
    expect(cacheInsideUpdater).toBe(false);
    expect(setSpy).toHaveBeenCalledTimes(1);

    expect(await useProjectStore.getState().addProject({ name: 'Proje 1', color: '#336699' })).not.toBeNull();
    useLifeAreasStore.getState().setValue('saglik', 8);
    expect(await useLifeAreasStore.getState().save()).toBe(true);
    expect(await useOKRStore.getState().addObjective('OKR 1', 2026, 4)).toBe(true);
    expect(await useReadingListStore.getState().addItem({ title: 'Kitap 1', type: 'book' })).toBe(true);
    await flushTicks();

    // Unloaded readingList tabs never write tab cache keys
    const writtenCacheKeys = setSpy.mock.calls.map((c) => c[1]);
    expect(writtenCacheKeys).not.toContain('reading:want_to_read:p1');
    expect(writtenCacheKeys).not.toContain('reading:reading:p1');
    expect(writtenCacheKeys).not.toContain('reading:completed:p1');

    // 2. Permanent non-offline failure -> error set, outbox stays empty
    mockNet.permanentError = 'RLS denied';
    expect(await useGoalStore.getState().addGoal({ kind: 'monthly', title: 'Reddedilen' })).toBe(false);
    expect(useGoalStore.getState().error).toContain('RLS denied');
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);
    mockNet.permanentError = null;

    // 3. Offline -> single outbox command per entity (create + update collapse to 1 command once idle)
    mockNet.online = false;
    expect(await useGoalStore.getState().addGoal({ kind: 'monthly', title: 'Çevrimdışı Hedef' })).toBe(true);
    await coreOutbox.flush();
    const offGoalId = useGoalStore.getState().goals[0].id;
    expect(await useGoalStore.getState().updateProgress(offGoalId, 45)).toBe(true);
    const goalCmds = (coreOutbox.state()?.commands ?? []).filter((c) => c.entity === 'goal' && c.entityId === offGoalId);
    expect(goalCmds).toHaveLength(1);
    expect(goalCmds[0].payload).toMatchObject({ title: 'Çevrimdışı Hedef', progress: 45 });

    // 4. savedOnDevice: false -> warning set while optimistic row remains visible
    await coreOutbox.flush();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('QuotaExceeded'));
    expect(await useProjectStore.getState().addProject({ name: 'Disk Dolu Proje', color: '#224466' })).not.toBeNull();
    expect(useProjectStore.getState().projects.some((p) => p.name === 'Disk Dolu Proje')).toBe(true);
    expect(useProjectStore.getState().error).toContain('cihaza kaydedilemedi');

    goalSetSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('(+) Stage E: when coreOutbox.replace disk save fails during conflict resolution, memory rolls back and conflict command stays intact', async () => {
    mockNet.online = false;
    await coreOutbox.ensure();
    const w = await coreOutbox.write({
      entity: 'journal_entry',
      entityId: '2026-08-04',
      kind: 'update',
      payload: { content: 'yerel metin', mood: 'good', baseContent: 'eski' },
    });
    expect(w.ok).toBe(true);
    if (!w.ok) return;

    // Put command into conflict state on disk & memory
    const conflicted = settle(coreOutbox.state()!, w.operationId, { kind: 'conflict', error: 'cas' }, Date.now());
    await AsyncStorage.setItem(namespacedOutboxKey('core', 'u1'), JSON.stringify({ v: 1, state: conflicted }));
    coreOutbox.reset();
    await coreOutbox.ensure();
    expect(pendingJournalCommands()).toHaveLength(1);
    expect(pendingJournalCommands()[0].status).toBe('conflict');

    // Seed server journal entry so resolveJournalConflict('2026-08-04', 'both') reads 'sunucu metni'
    mockDb.rows.journal_entries = [
      {
        id: 'j1',
        user_id: 'u1',
        date: '2026-08-04',
        content: 'sunucu metni',
        mood: 4,
        ai_summary: false,
        created_at: '2026-08-04T10:00:00Z',
        updated_at: '2026-08-04T10:00:00Z',
      },
    ];
    mockNet.online = true;

    // Simulate storage failure during `both` conflict resolution
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('QuotaExceeded'));
    const failedRes = await resolveJournalConflict('2026-08-04', 'both');
    expect(failedRes).toEqual({
      ok: false,
      error: 'Çakışma çözümü cihaza kaydedilemedi; çakışma korunuyor.',
    });
    // Conflict command is STILL in memory and on disk!
    expect(pendingJournalCommands()).toHaveLength(1);
    expect(pendingJournalCommands()[0].operationId).toBe(w.operationId);
    expect(pendingJournalCommands()[0].status).toBe('conflict');

    // Subsequent retry when disk succeeds replaces atomically to a single command (and delivers it)
    const replaceSpy = jest.spyOn(coreOutbox, 'replace');
    const okRes = await resolveJournalConflict('2026-08-04', 'both');
    expect(okRes.ok).toBe(true);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0][0]).toBe(w.operationId);
    expect(String(replaceSpy.mock.calls[0][1].payload?.content)).toContain('yerel metin');
    expect(String(replaceSpy.mock.calls[0][1].payload?.content)).toContain('sunucu metni');
    expect(pendingJournalCommands()).toHaveLength(0);
    expect(String(mockDb.rows.journal_entries[0].content)).toContain('yerel metin');
    expect(String(mockDb.rows.journal_entries[0].content)).toContain('sunucu metni');
    replaceSpy.mockRestore();
  });
});
