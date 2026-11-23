// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockFetchRecent = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../repositories/lifeAreaRepository', () => ({
  fetchRecentLifeAreaLogs: (...args: unknown[]) => mockFetchRecent(...args),
  upsertLifeAreaLogs: (...args: unknown[]) => mockUpsert(...args),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));

import { LIFE_AREA_ENTITY, useLifeAreasStore } from '../../store/lifeAreasStore';

describe('lifeAreasStore — STO-18 empty server state, date-aware overlay, and save error surface', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetAccountMemory('signed_out');
    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  it('resets values to default 5s and lastSavedDate: null when server succeeds with 0 rows', async () => {
    useLifeAreasStore.setState({
      values: { saglik: 9, kariyer: 8, egitim: 7, finans: 8, aile: 9, sosyal: 8, ruhsal: 9, hobiler: 7 },
      lastSavedDate: '2026-10-01',
    });

    mockFetchRecent.mockResolvedValueOnce({ ok: true, data: [] });
    await useLifeAreasStore.getState().loadLatest();

    expect(useLifeAreasStore.getState().lastSavedDate).toBeNull();
    expect(Object.values(useLifeAreasStore.getState().values)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(useLifeAreasStore.getState().error).toBeNull();
  });

  it('does NOT let an older pending outbox entry overwrite newer server values, but overlays a newer pending entry', async () => {
    await coreOutbox.write({
      entity: LIFE_AREA_ENTITY,
      entityId: '2026-10-29',
      kind: 'update',
      payload: { saglik: 2 },
    });

    mockFetchRecent.mockResolvedValueOnce({
      ok: true,
      data: [{ area: 'saglik', value: 9, date: '2026-10-30' }],
    });
    await useLifeAreasStore.getState().loadLatest();

    expect(useLifeAreasStore.getState().lastSavedDate).toBe('2026-10-30');
    expect(useLifeAreasStore.getState().values.saglik).toBe(9);

    // Newer pending entry DOES overlay
    await coreOutbox.write({
      entity: LIFE_AREA_ENTITY,
      entityId: '2026-10-31',
      kind: 'update',
      payload: { saglik: 10 },
    });
    mockFetchRecent.mockResolvedValueOnce({
      ok: true,
      data: [{ area: 'saglik', value: 9, date: '2026-10-30' }],
    });
    await useLifeAreasStore.getState().loadLatest();

    expect(useLifeAreasStore.getState().lastSavedDate).toBe('2026-10-31');
    expect(useLifeAreasStore.getState().values.saglik).toBe(10);
  });

  it('returns boolean from save() and surfaces error on server rejection or failed offline queue write', async () => {
    useLifeAreasStore.getState().setValue('kariyer', 8);

    // Server rejection
    mockUpsert.mockResolvedValueOnce({ ok: false, error: 'Sunucu reddetti' });
    expect(await useLifeAreasStore.getState().save()).toBe(false);
    expect(useLifeAreasStore.getState().error).toBe('Sunucu reddetti');

    // Offline + outbox write fails
    mockUpsert.mockResolvedValueOnce({ ok: false, error: 'offline', offline: true });
    const writeSpy = jest.spyOn(coreOutbox, 'write').mockResolvedValueOnce({ ok: false, error: 'disk_full' });
    expect(await useLifeAreasStore.getState().save()).toBe(false);
    expect(useLifeAreasStore.getState().error).toBeTruthy();
    writeSpy.mockRestore();

    // Success clears error and returns true
    mockUpsert.mockResolvedValueOnce({ ok: true, data: true });
    expect(await useLifeAreasStore.getState().save()).toBe(true);
    expect(useLifeAreasStore.getState().error).toBeNull();
  });

  it('honours latestOnly when two loadLatest() calls overlap, and loads normal server rows (negative case)', async () => {
    const first = deferred<{ ok: true; data: { area: string; value: number; date: string }[] }>();
    const second = deferred<{ ok: true; data: { area: string; value: number; date: string }[] }>();

    mockFetchRecent.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const p1 = useLifeAreasStore.getState().loadLatest();
    await new Promise((r) => setTimeout(r, 0));
    const p2 = useLifeAreasStore.getState().loadLatest();

    second.resolve({ ok: true, data: [{ area: 'egitim', value: 9, date: '2026-11-21' }] });
    await p2;

    first.resolve({ ok: true, data: [{ area: 'egitim', value: 3, date: '2026-11-01' }] });
    await p1;

    expect(useLifeAreasStore.getState().values.egitim).toBe(9);
    expect(useLifeAreasStore.getState().lastSavedDate).toBe('2026-11-21');
    expect(useLifeAreasStore.getState().loading).toBe(false);
  });
});
