import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  clearReadCacheMemory,
  clearUserReadCache,
  getCachedSnapshot,
  invalidateCachedSnapshot,
  setCachedSnapshot,
} from '../../lib/localReadCache';

describe('localReadCache (SQLite + Web KV read-through cache)', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('persists snapshots in expo-sqlite on native and survives L1 memory clear (cold restart)', async () => {
    const items = [{ id: 'n1', title: 'Offline Not', tags: ['odak'] }];
    await setCachedSnapshot('user-a', 'notes:p1', items);

    // Cold boot simulation: wipe L1 memory, read directly from SQLite L2
    clearReadCacheMemory();

    const snap = await getCachedSnapshot<typeof items>('user-a', 'notes:p1');
    expect(snap).not.toBeNull();
    expect(snap?.data).toEqual(items);
    expect(typeof snap?.updatedAt).toBe('number');
  });

  it('strictly isolates cached snapshots across accounts (User A vs User B)', async () => {
    await setCachedSnapshot('user-a', 'goals:p1', [{ id: 'g-a', title: 'A Hedefi' }]);
    await setCachedSnapshot('user-b', 'goals:p1', [{ id: 'g-b', title: 'B Hedefi' }]);

    clearReadCacheMemory();

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
});

