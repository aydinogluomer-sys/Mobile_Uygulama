// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  READ_CACHE_MEMORY_MAX,
  clearReadCacheMemory,
  getCachedSnapshot,
  getLatestSnapshot,
  pruneReadCache,
  setCachedSnapshot,
} from '../../lib/localReadCache';
import type { ExpoSqliteFakeModule } from '../helpers/sqliteAdapter';

const sqliteFake = SQLite as unknown as ExpoSqliteFakeModule;

describe('localReadCachePrune — SYN-21 & GAP2-12 (real sql.js engine)', () => {
  const originalOS = Platform.OS;
  let now = 1_700_000_000_000;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(async () => {
    clearReadCacheMemory();
    await AsyncStorage.clear();
    sqliteFake.__resetForTests();
    sqliteFake.openDatabaseAsync.mockClear();
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

    // Close & drop the underlying SQLite DB without clearing L1 memoryCache so only L1 can answer
    sqliteFake.__resetForTests();
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
    expect(sqliteFake.openDatabaseAsync).not.toHaveBeenCalled();

    await pruneReadCache('u-web', {
      maxAgeMs: 30 * 86_400_000,
      keepLatestPerPrefix: { 'today_bootstrap:v1:': 2 },
    });

    clearReadCacheMemory();
    expect(await getCachedSnapshot('u-web', 'today_bootstrap:v1:2026-11-03')).toBeNull();
    const latest = await getLatestSnapshot<{ d: number }>('u-web', 'today_bootstrap:v1:');
    expect(latest?.key).toBe('today_bootstrap:v1:2026-11-05');
    expect(latest?.data).toEqual({ d: 5 });
    expect(sqliteFake.openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('loads expo-sqlite lazily on first native DB access rather than at module import time, and preserves native round-trip (negative case)', async () => {
    let factoryEvaluated = false;

    jest.resetModules();
    jest.doMock('expo-sqlite', () => {
      factoryEvaluated = true;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../helpers/sqliteAdapter').createExpoSqliteModule();
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
