import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

type StoredRow = {
  user_id: string;
  cache_key: string;
  payload: string;
  updated_at: number;
};

const mockSqliteState = {
  rows: new Map<string, StoredRow>(),
  failSelect: false,
  openCalls: 0,
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    mockSqliteState.openCalls += 1;
    return {
      execAsync: jest.fn(async (sql: string) => {
        if (/DELETE\s+FROM\s+read_cache\s*;?\s*$/i.test(sql.trim())) {
          mockSqliteState.rows.clear();
        }
      }),
      closeAsync: jest.fn(async () => undefined),
      runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/INSERT\s+OR\s+REPLACE\s+INTO\s+read_cache/i.test(sql)) {
          const [user_id, cache_key, payload, updated_at] = params as [string, string, string, number];
          mockSqliteState.rows.set(`${user_id}::${cache_key}`, { user_id, cache_key, payload, updated_at });
          return { changes: 1, lastInsertRowId: 1 };
        }
        if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+updated_at\s*<\s*\?\s+AND\s+user_id\s*=\s*\?/i.test(sql)) {
          const [cutoff, user_id] = params as [number, string];
          let changes = 0;
          for (const [k, row] of mockSqliteState.rows.entries()) {
            if (row.user_id === user_id && row.updated_at < cutoff) {
              mockSqliteState.rows.delete(k);
              changes += 1;
            }
          }
          return { changes, lastInsertRowId: 0 };
        }
        if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+substr\(cache_key/i.test(sql)) {
          const len = params[0] as number;
          const prefix = params[1] as string;
          const user_id = params[2] as string;
          const keep = params[6] as number;
          const matching = [...mockSqliteState.rows.values()]
            .filter((r) => r.user_id === user_id && r.cache_key.slice(0, len) === prefix)
            .sort((a, b) => b.updated_at - a.updated_at);
          const keepKeys = new Set(matching.slice(0, keep).map((r) => r.cache_key));
          let changes = 0;
          for (const r of matching) {
            if (!keepKeys.has(r.cache_key)) {
              mockSqliteState.rows.delete(`${user_id}::${r.cache_key}`);
              changes += 1;
            }
          }
          return { changes, lastInsertRowId: 0 };
        }
        if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+user_id\s*=\s*\?\s+AND\s+cache_key\s*=\s*\?/i.test(sql)) {
          const [user_id, cache_key] = params as [string, string];
          return { changes: mockSqliteState.rows.delete(`${user_id}::${cache_key}`) ? 1 : 0, lastInsertRowId: 0 };
        }
        if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+user_id\s*=\s*\?/i.test(sql)) {
          const [user_id] = params as [string];
          let changes = 0;
          for (const [k, r] of mockSqliteState.rows.entries()) {
            if (r.user_id === user_id) {
              mockSqliteState.rows.delete(k);
              changes += 1;
            }
          }
          return { changes, lastInsertRowId: 0 };
        }
        return { changes: 0, lastInsertRowId: 0 };
      }),
      getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (mockSqliteState.failSelect) throw new Error('sqlite read disabled');
        if (/substr\(cache_key,\s*1,\s*\?\)\s*=\s*\?\s+ORDER\s+BY\s+updated_at\s+DESC\s+LIMIT\s+1/i.test(sql)) {
          const [user_id, len, prefix] = params as [string, number, string];
          const best = [...mockSqliteState.rows.values()]
            .filter((r) => r.user_id === user_id && r.cache_key.slice(0, len) === prefix)
            .sort((a, b) => b.updated_at - a.updated_at)[0];
          return best ? { cache_key: best.cache_key, payload: best.payload, updated_at: best.updated_at } : null;
        }
        const [user_id, cache_key] = params as [string, string];
        const hit = mockSqliteState.rows.get(`${user_id}::${cache_key}`);
        return hit ? { payload: hit.payload, updated_at: hit.updated_at } : null;
      }),
    };
  }),
}));

import {
  READ_CACHE_MEMORY_MAX,
  clearReadCacheMemory,
  getCachedSnapshot,
  getLatestSnapshot,
  pruneReadCache,
  setCachedSnapshot,
} from '../../lib/localReadCache';

describe('localReadCachePrune — SYN-21 & GAP2-12', () => {
  const originalOS = Platform.OS;
  let now = 1_700_000_000_000;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(async () => {
    clearReadCacheMemory();
    await AsyncStorage.clear();
    mockSqliteState.rows.clear();
    mockSqliteState.failSelect = false;
    mockSqliteState.openCalls = 0;
    now = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('prunes prefix entries down to keepLatestPerPrefix, removes entries older than maxAgeMs, leaves other users intact, and returns getLatestSnapshot', async () => {
    // 10 daily bootstrap keys for u1
    for (let d = 1; d <= 10; d += 1) {
      now += 1_000;
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      await setCachedSnapshot('u1', `today_bootstrap:v1:${day}`, { day });
    }
    // Very old note snapshot for u1 + another user u2 snapshot
    const veryOldNow = now - 40 * 86_400_000;
    nowSpy.mockReturnValueOnce(veryOldNow);
    await setCachedSnapshot('u1', 'notes:old', { old: true });
    await setCachedSnapshot('u2', 'today_bootstrap:v1:2026-10-01', { day: 'u2-day' });

    const latestBefore = await getLatestSnapshot<{ day: string }>('u1', 'today_bootstrap:v1:');
    expect(latestBefore?.key).toBe('today_bootstrap:v1:2026-10-10');
    expect(latestBefore?.data).toEqual({ day: '2026-10-10' });

    const removed = await pruneReadCache('u1', {
      maxAgeMs: 30 * 86_400_000,
      keepLatestPerPrefix: { 'today_bootstrap:v1:': 3 },
    });
    expect(removed).toBe(8); // 1 old note + 7 excess bootstrap days

    clearReadCacheMemory();
    expect(await getCachedSnapshot('u1', 'notes:old')).toBeNull();
    expect(await getCachedSnapshot('u1', 'today_bootstrap:v1:2026-10-07')).toBeNull();
    expect((await getCachedSnapshot<{ day: string }>('u1', 'today_bootstrap:v1:2026-10-08'))?.data).toEqual({
      day: '2026-10-08',
    });
    expect((await getCachedSnapshot<{ day: string }>('u1', 'today_bootstrap:v1:2026-10-10'))?.data).toEqual({
      day: '2026-10-10',
    });
    // u2 untouched
    expect((await getCachedSnapshot<{ day: string }>('u2', 'today_bootstrap:v1:2026-10-01'))?.data).toEqual({
      day: 'u2-day',
    });
  });

  it('caps L1 memoryCache at READ_CACHE_MEMORY_MAX (200) entries, evicting the oldest', async () => {
    expect(READ_CACHE_MEMORY_MAX).toBe(200);
    for (let i = 0; i < 250; i += 1) {
      now += 10;
      await setCachedSnapshot('u1', `k-${i}`, { i });
    }

    // Disable SQLite reads (and AsyncStorage has nothing because native write succeeded): only L1 answers
    mockSqliteState.failSelect = true;
    expect(await getCachedSnapshot('u1', 'k-0')).toBeNull();
    expect(await getCachedSnapshot('u1', 'k-49')).toBeNull();
    expect((await getCachedSnapshot<{ i: number }>('u1', 'k-249'))?.data).toEqual({ i: 249 });
  });

  it('does not touch openDatabaseAsync on web and prunes/reads latest from AsyncStorage', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    for (let d = 1; d <= 5; d += 1) {
      now += 1_000;
      await setCachedSnapshot('u-web', `today_bootstrap:v1:2026-11-0${d}`, { d });
    }
    expect(mockSqliteState.openCalls).toBe(0);

    await pruneReadCache('u-web', {
      maxAgeMs: 30 * 86_400_000,
      keepLatestPerPrefix: { 'today_bootstrap:v1:': 2 },
    });

    clearReadCacheMemory();
    expect(await getCachedSnapshot('u-web', 'today_bootstrap:v1:2026-11-03')).toBeNull();
    const latest = await getLatestSnapshot<{ d: number }>('u-web', 'today_bootstrap:v1:');
    expect(latest?.key).toBe('today_bootstrap:v1:2026-11-05');
    expect(latest?.data).toEqual({ d: 5 });
    expect(mockSqliteState.openCalls).toBe(0);
  });

  it('loads expo-sqlite lazily on first native DB access rather than at module import time, and preserves native round-trip (negative case)', async () => {
    let factoryEvaluated = false;

    jest.resetModules();
    jest.doMock('expo-sqlite', () => {
      factoryEvaluated = true;
      return {
        openDatabaseAsync: jest.fn(async () => ({
          execAsync: jest.fn(async () => undefined),
          closeAsync: jest.fn(async () => undefined),
          runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
          getFirstAsync: jest.fn(async () => ({ payload: '{"ok":true}', updated_at: 123 })),
        })),
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const isolatedRN = require('react-native') as { Platform: { OS: string } };
    Object.defineProperty(isolatedRN.Platform, 'OS', { value: 'ios', configurable: true });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const isolated = require('../../lib/localReadCache') as typeof import('../../lib/localReadCache');
    expect(factoryEvaluated).toBe(false);

    await isolated.setCachedSnapshot('u-lazy', 'k1', { ok: true });
    expect(factoryEvaluated).toBe(true);
    isolated.clearReadCacheMemory();
    const roundTrip = await isolated.getCachedSnapshot<{ ok: boolean }>('u-lazy', 'k1');
    expect(roundTrip?.data).toEqual({ ok: true });
    isolated.clearReadCacheMemory();
  });
});
