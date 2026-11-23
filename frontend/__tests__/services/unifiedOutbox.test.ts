// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockTransport: { online: boolean } = { online: true };
const mockBaseClient = makeSupabaseMock(mockDb);

function mockWrapOfflineFrom(table: string) {
  const realBuilder = mockBaseClient.from(table);
  if (mockTransport.online) return realBuilder;

  const offlineResponse = {
    data: null,
    count: null,
    error: { message: 'TypeError: Network request failed', code: '' },
    status: 0,
  };

  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve(offlineResponse).then(onFulfilled);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
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
    from: (table: string) => mockWrapOfflineFrom(table),
  },
}));

import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import { flushAllOutboxes, getUnifiedOutboxSummary } from '../../services/unifiedOutbox';
import { useGoalStore } from '../../store/goalStore';
import { LIFE_AREAS, useLifeAreasStore } from '../../store/lifeAreasStore';
import { useLogStore } from '../../store/logStore';
import { useOKRStore } from '../../store/okrStore';
import { useProjectStore } from '../../store/projectStore';
import { useReadingListStore } from '../../store/readingListStore';
import { useTaskStore } from '../../store/taskStore';

describe('Unified Offline Outbox + Local-First SWR Read-Through Cache', () => {
  beforeEach(async () => {
    for (const k of Object.keys(mockDb.rows)) delete mockDb.rows[k];
    mockDb.inserts.length = 0;
    mockDb.idSeq = 0;
    mockDb.failNext = null;
    mockSession.userId = 'u1';
    mockTransport.online = true;

    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();

    useGoalStore.setState({ goals: [], loading: false, loadingMore: false, hasMore: false, error: null, cursor: null });
    useProjectStore.setState({ projects: [], loading: false, loadingMore: false, hasMore: false, error: null, cursor: null });
    useOKRStore.setState({ okrs: [], loading: false, error: null });
    useLifeAreasStore.setState({ lastSavedDate: null, loading: false, saving: false });
    useTaskStore.getState().resetForAccount();
    await useLogStore.getState().rebindSyncQueue(null);
    useReadingListStore.setState({
      tabs: {
        want_to_read: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
        reading: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
        completed: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
      },
      counts: { want_to_read: 0, reading: 0, completed: 0 },
      error: null,
    });
  });

  it('queues offline goal, project, reading-item, OKR+KR, and life-area mutations and flushes them via flushAllOutboxes', async () => {
    mockTransport.online = false;

    expect(await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Çevrimdışı Hedef', progress: 20, year: 2026 })).toBe(true);
    const goalId = useGoalStore.getState().goals[0].id;
    expect(await useGoalStore.getState().updateProgress(goalId, 55)).toBe(true);
    expect(useGoalStore.getState().goals[0].progress).toBe(55);

    const proj = await useProjectStore.getState().addProject({ name: 'Uçak Modu Projesi', color: '#6366f1' });
    expect(proj).not.toBeNull();

    expect(await useReadingListStore.getState().addItem({ title: 'Deep Work', type: 'book', author: 'Cal Newport' })).toBe(true);
    expect(useReadingListStore.getState().byStatus('want_to_read')).toHaveLength(1);

    expect(await useOKRStore.getState().addObjective('Q4 Büyüme', 2026, 4)).toBe(true);
    const okrId = useOKRStore.getState().okrs[0].id;
    expect(await useOKRStore.getState().addKeyResult(okrId, '10 sürüm çıkar', 10, 'sürüm')).toBe(true);
    expect(useOKRStore.getState().okrs[0].key_results).toHaveLength(1);

    useLifeAreasStore.getState().setValue('saglik', 9);
    await useLifeAreasStore.getState().save();
    expect(useLifeAreasStore.getState().lastSavedDate).not.toBeNull();

    // Server has received nothing yet while offline, and unifiedOutbox sees all pending commands:
    // 2 (goal create in-flight + queued progress update) + 1 project + 1 reading + 1 okr + 1 kr + 1 life_area = 7
    expect(mockDb.rows.goals ?? []).toHaveLength(0);
    expect(mockDb.rows.projects ?? []).toHaveLength(0);
    const expectedCorePending = 2 + 1 + 1 + 1 + 1 + 1;
    const beforeSummary = getUnifiedOutboxSummary();
    expect(beforeSummary.pending).toBe(expectedCorePending);

    // Reconnect and flush all channels
    mockTransport.online = true;
    const afterSummary = await flushAllOutboxes();
    expect(afterSummary.pending).toBe(0);
    expect(afterSummary.dead).toBe(0);
    expect(afterSummary).not.toHaveProperty('errors');

    expect(mockDb.rows.goals).toHaveLength(1);
    expect(mockDb.rows.goals[0].progress).toBe(55);
    expect(mockDb.rows.projects).toHaveLength(1);
    expect(mockDb.rows.reading_list).toHaveLength(1);
    expect(mockDb.rows.okrs).toHaveLength(1);
    expect(mockDb.rows.key_results).toHaveLength(1);
    expect(mockDb.rows.life_area_logs ?? []).toHaveLength(LIFE_AREAS.length);
  });

  it('F19 (TST-15): drains all three channels (habitLogs, tasks, core) when reconnecting and sets no errors on healthy flush', async () => {
    await useLogStore.getState().rebindSyncQueue('u1');
    mockDb.rows.habits = [{ id: 'h-1', user_id: 'u1', name: 'Su iç', status: 'active' }];

    mockTransport.online = false;
    await useLogStore.getState().logHabit({ habitId: 'h-1', date: new Date(), state: 'done' });
    await useTaskStore.getState().addTask({ title: 'Çevrimdışı Görev' });
    await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Üçlü Kanal Hedef', year: 2026 });

    const before = getUnifiedOutboxSummary();
    expect(before.channels.habitLogs.pending).toBe(1);
    expect(before.channels.tasks.pending).toBe(1);
    expect(before.channels.core.pending).toBe(1);
    expect(before.pending).toBe(3);

    mockTransport.online = true;
    const after = await flushAllOutboxes();
    expect(after.channels.habitLogs.pending).toBe(0);
    expect(after.channels.tasks.pending).toBe(0);
    expect(after.channels.core.pending).toBe(0);
    expect(after.pending).toBe(0);
    expect(after).not.toHaveProperty('errors');
    expect(mockDb.rows.habit_logs).toHaveLength(1);
    expect(mockDb.rows.tasks).toHaveLength(1);
    expect(mockDb.rows.goals).toHaveLength(1);
  });

  it('F19 (TST-15): one rejecting channel does not abort the others and reports its error in summary.errors', async () => {
    mockTransport.online = false;
    await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Core Hâlâ Gider', year: 2026 });
    expect(getUnifiedOutboxSummary().channels.core.pending).toBe(1);

    const originalFlush = useLogStore.getState().flushPendingSync;
    useLogStore.setState({
      flushPendingSync: async () => {
        throw new Error('habit_channel_boom');
      },
    });

    try {
      mockTransport.online = true;
      const after = await flushAllOutboxes();
      expect(after.errors).toEqual({ habitLogs: 'habit_channel_boom' });
      expect(after.channels.core.pending).toBe(0);
      expect(mockDb.rows.goals).toHaveLength(1);
    } finally {
      useLogStore.setState({ flushPendingSync: originalFlush });
    }
  });

  it('serves cached SQLite snapshots immediately when offline (SWR) without wiping the screen to an error state', async () => {
    // 1. Seed online and populate SQLite read cache via loadGoals()
    await useGoalStore.getState().addGoal({ kind: 'quarterly', title: 'Önbellekli Hedef', progress: 40, year: 2026, quarter: 4 });
    await useGoalStore.getState().loadGoals();
    expect(useGoalStore.getState().goals).toHaveLength(1);

    // 2. Simulate cold restart in airplane mode: clear in-memory Zustand state & L1 cache
    clearReadCacheMemory();
    useGoalStore.setState({ goals: [], error: null, loading: false });
    mockTransport.online = false;

    await useGoalStore.getState().loadGoals();

    // Instant SQLite hit keeps the user's goal visible offline with zero error banner
    expect(useGoalStore.getState().goals.map((g) => g.title)).toEqual(['Önbellekli Hedef']);
    expect(useGoalStore.getState().error).toBeNull();
  });
});
