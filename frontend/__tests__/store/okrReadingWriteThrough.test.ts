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

import { resetAccountMemory } from '../../lib/accountScope';
import { clearReadCacheMemory, getCachedSnapshot, setCachedSnapshot } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import { useOKRStore } from '../../store/okrStore';
import { useReadingListStore } from '../../store/readingListStore';

const flushAsync = () => new Promise((r) => setTimeout(r, 15));

describe('okrReadingWriteThrough — STO-08 L2 cache write-through and reading list counts', () => {
  beforeEach(async () => {
    for (const k of Object.keys(mockDb.rows)) delete mockDb.rows[k];
    mockDb.inserts.length = 0;
    mockDb.idSeq = 0;
    mockDb.failNext = null;
    mockDb.failNextRead = null;
    mockSession.userId = 'u1';
    mockTransport.online = true;

    resetAccountMemory('signed_out');
    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  describe('okrStore L2 write-through', () => {
    it('persists online addObjective and removeKR into L2 cache so an offline cold start sees them without touching another user', async () => {
      await setCachedSnapshot('u2', 'okrs:q8', {
        okrs: [{ id: 'u2-obj', user_id: 'u2', objective: 'Başka kullanıcı', year: 2026, quarter: 4, created_at: 'now' }],
        keyResults: [],
      });

      await useOKRStore.getState().loadOKRs();
      expect(await useOKRStore.getState().addObjective('Yeni OKR Hedefi', 2026, 4)).toBe(true);
      const objId = useOKRStore.getState().okrs[0].id;
      expect(await useOKRStore.getState().addKeyResult(objId, 'KR 1', 100, '%')).toBe(true);
      const krId = useOKRStore.getState().okrs[0].key_results[0].id;

      await flushAsync();

      // Simulate cold restart offline: new objective + KR must hydrate from L2
      clearReadCacheMemory();
      useOKRStore.setState({ okrs: [] });
      mockTransport.online = false;
      await useOKRStore.getState().loadOKRs();

      expect(useOKRStore.getState().okrs).toHaveLength(1);
      expect(useOKRStore.getState().okrs[0].objective).toBe('Yeni OKR Hedefi');
      expect(useOKRStore.getState().okrs[0].key_results).toHaveLength(1);

      // Go back online, remove KR, then restart offline -> removed KR must stay gone
      mockTransport.online = true;
      expect(await useOKRStore.getState().removeKR(krId)).toBe(true);
      await flushAsync();

      clearReadCacheMemory();
      useOKRStore.setState({ okrs: [] });
      mockTransport.online = false;
      await useOKRStore.getState().loadOKRs();

      expect(useOKRStore.getState().okrs).toHaveLength(1);
      expect(useOKRStore.getState().okrs[0].key_results).toEqual([]);

      // Negative: u2's cache key is untouched
      const u2Snap = await getCachedSnapshot<{ okrs: { id: string }[] }>('u2', 'okrs:q8');
      expect(u2Snap?.data.okrs.map((o) => o.id)).toEqual(['u2-obj']);
    });
  });

  describe('readingListStore L2 write-through and count invariants', () => {
    it('shifts counts on offline updateStatus, decrements without going negative on removeItem, guards refreshCounts while pending, and skips unloaded tabs in L2', async () => {
      // Load only 'reading' tab (leave 'completed' unloaded at first)
      await useReadingListStore.getState().fetchItems('reading');
      expect(await useReadingListStore.getState().addItem({ title: 'Derin İş', type: 'book' })).toBe(true);
      await flushAsync();

      // Negative: 'completed' was never loaded, so reading:completed:p1 must NOT exist in L2
      clearReadCacheMemory();
      expect(await getCachedSnapshot('u1', 'reading:completed:p1')).toBeNull();

      // Load want_to_read and completed so both are marked loaded
      await useReadingListStore.getState().fetchItems('want_to_read');
      await useReadingListStore.getState().fetchItems('completed');
      const itemId = useReadingListStore.getState().tabs.want_to_read.items[0].id;

      // Move online to 'reading' first
      expect(await useReadingListStore.getState().updateStatus(itemId, 'reading')).toBe(true);
      expect(useReadingListStore.getState().counts).toEqual({ want_to_read: 0, reading: 1, completed: 0 });

      // Now go offline and move 'reading' -> 'completed'
      mockTransport.online = false;
      expect(await useReadingListStore.getState().updateStatus(itemId, 'completed')).toBe(true);
      expect(useReadingListStore.getState().counts).toEqual({ want_to_read: 0, reading: 0, completed: 1 });
      await flushAsync();

      // Pending reading_item command exists: refreshCounts even when server answers stale counts must NOT clobber local counts
      mockTransport.online = true;
      await useReadingListStore.getState().refreshCounts();
      expect(useReadingListStore.getState().counts).toEqual({ want_to_read: 0, reading: 0, completed: 1 });

      // Cold restart offline: moved item shows in 'completed' tab
      mockTransport.online = false;
      clearReadCacheMemory();
      useReadingListStore.setState({
        tabs: {
          want_to_read: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
          reading: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
          completed: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
        },
      });
      await useReadingListStore.getState().fetchItems('completed');
      expect(useReadingListStore.getState().tabs.completed.items.map((i) => i.id)).toEqual([itemId]);

      // Offline removeItem decrements count and never goes below 0
      useReadingListStore.setState({ counts: { want_to_read: 0, reading: 0, completed: 0 } });
      expect(await useReadingListStore.getState().removeItem(itemId)).toBe(true);
      expect(useReadingListStore.getState().counts.completed).toBe(0);
    });
  });
});
