// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  clearAllReadCache,
  clearReadCacheMemory,
  clearUserReadCache,
  getCachedSnapshot,
  invalidateCachedSnapshot,
  setCachedSnapshot,
} from '../../lib/localReadCache';
import type { ExpoSqliteFakeModule } from '../helpers/sqliteAdapter';

const sqliteFake = SQLite as unknown as ExpoSqliteFakeModule;

describe('localReadCache (SQLite + Web KV read-through cache)', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
    clearReadCacheMemory();
    await AsyncStorage.clear();
    sqliteFake.__resetForTests();
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('(+) creates read_cache table in sqlite_master on first native access and survives L1 memory clear (cold restart)', async () => {
    expect(sqliteFake.__tables('aderyth_read_cache.db')).toEqual([]);

    const items = [{ id: 'n1', title: 'Offline Not', tags: ['odak'] }];
    await setCachedSnapshot('user-a', 'notes:p1', items);

    expect(sqliteFake.__tables('aderyth_read_cache.db')).toEqual(['read_cache']);

    // Cold boot simulation: wipe L1 memory, read directly from SQLite L2
    clearReadCacheMemory();

    const snap = await getCachedSnapshot<typeof items>('user-a', 'notes:p1');
    expect(snap).not.toBeNull();
    expect(snap?.data).toEqual(items);
    expect(typeof snap?.updatedAt).toBe('number');
  });

  it('strictly isolates cached snapshots across accounts (User A vs User B) via real SQL WHERE user_id = ? AND cache_key = ?', async () => {
    await setCachedSnapshot('user-a', 'goals:p1', [{ id: 'g-a', title: 'A Hedefi' }]);
    await setCachedSnapshot('user-b', 'goals:p1', [{ id: 'g-b', title: 'B Hedefi' }]);
    await setCachedSnapshot('user-a', 'only-a:key', { secret: 'a-only' });

    clearReadCacheMemory();

    // (-) Account B cannot read Account A's exclusive key
    expect(await getCachedSnapshot('user-b', 'only-a:key')).toBeNull();

    const snapA = await getCachedSnapshot<{ id: string; title: string }[]>('user-a', 'goals:p1');
    const snapB = await getCachedSnapshot<{ id: string; title: string }[]>('user-b', 'goals:p1');
    const snapEmpty = await getCachedSnapshot('' as string, 'goals:p1');

    expect(snapA?.data).toEqual([{ id: 'g-a', title: 'A Hedefi' }]);
    expect(snapB?.data).toEqual([{ id: 'g-b', title: 'B Hedefi' }]);
    expect(snapEmpty).toBeNull();

    // Clearing User A leaves User B untouched
    await clearUserReadCache('user-a');
    expect(await getCachedSnapshot('user-a', 'goals:p1')).toBeNull();
    expect((await getCachedSnapshot('user-b', 'goals:p1'))?.data).toEqual([
      { id: 'g-b', title: 'B Hedefi' },
    ]);
  });

  it('(-) corrupted non-JSON payload in SQLite read_cache returns null without throwing', async () => {
    await setCachedSnapshot('user-a', 'notes:p1', [{ id: 'ok' }]);
    const db = await sqliteFake.openDatabaseAsync('aderyth_read_cache.db');
    await db.runAsync(
      'INSERT OR REPLACE INTO read_cache (user_id, cache_key, payload, updated_at) VALUES (?, ?, ?, ?)',
      ['user-a', 'corrupt:key', '{not-valid-json', Date.now()],
    );
    clearReadCacheMemory();

    await expect(getCachedSnapshot('user-a', 'corrupt:key')).resolves.toBeNull();
    expect((await getCachedSnapshot('user-a', 'notes:p1'))?.data).toEqual([{ id: 'ok' }]);
  });

  it("(-) clearUserReadCache('') is a no-op and touches zero rows in SQLite", async () => {
    await setCachedSnapshot('user-a', 'notes:p1', [{ id: 'a1' }]);
    await setCachedSnapshot('user-b', 'notes:p1', [{ id: 'b1' }]);

    await clearUserReadCache('');
    clearReadCacheMemory();

    expect((await getCachedSnapshot('user-a', 'notes:p1'))?.data).toEqual([{ id: 'a1' }]);
    expect((await getCachedSnapshot('user-b', 'notes:p1'))?.data).toEqual([{ id: 'b1' }]);
  });

  it('supports key invalidation and web AsyncStorage fallback cleanly', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    await setCachedSnapshot('user-web', 'reading:counts', {
      want_to_read: 4,
      reading: 2,
      completed: 9,
    });
    clearReadCacheMemory();

    const hit = await getCachedSnapshot<{ want_to_read: number; reading: number; completed: number }>(
      'user-web',
      'reading:counts',
    );
    expect(hit?.data).toEqual({ want_to_read: 4, reading: 2, completed: 9 });

    await invalidateCachedSnapshot('user-web', 'reading:counts');
    expect(await getCachedSnapshot('user-web', 'reading:counts')).toBeNull();
  });

  it('F04 (SYN-07): clearAllReadCache removes every user, on native and in the web store', async () => {
    await setCachedSnapshot('user-a', 'notes:p1', [{ id: 'a' }]);
    await setCachedSnapshot('user-b', 'notes:p1', [{ id: 'b' }]);
    await AsyncStorage.setItem('aderyth.rcache.v1:user-c:tasks:p1', '{"data":[],"updatedAt":1}');
    await AsyncStorage.setItem('app_theme_dark', '1');

    await clearAllReadCache();
    clearReadCacheMemory();

    expect(await getCachedSnapshot('user-a', 'notes:p1')).toBeNull();
    expect(await getCachedSnapshot('user-b', 'notes:p1')).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual(['app_theme_dark']); // only the cache prefix goes
  });

  it('F04: clearAllReadCache never throws during web SSR (no window)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const g = globalThis as { window?: unknown };
    const saved = g.window;
    delete g.window;
    try {
      await expect(clearAllReadCache()).resolves.toBeUndefined();
    } finally {
      g.window = saved;
    }
  });
});
