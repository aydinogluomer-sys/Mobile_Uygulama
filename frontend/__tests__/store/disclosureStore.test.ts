import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));
jest.mock('../../lib/localReadCache', () => ({
  clearReadCacheMemory: jest.fn(),
  clearUserReadCache: jest.fn(async () => undefined),
  clearAllReadCache: jest.fn(async () => undefined),
}));

import { endAccountScope, resetAccountMemory } from '../../lib/accountScope';
import {
  DISCLOSURE_KEY_PREFIX,
  disclosureKey,
  useDisclosureStore,
} from '../../store/disclosureStore';

describe('F27 (NAV-13, F04) — store/disclosureStore', () => {
  beforeEach(async () => {
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
  });

  it('uses distinct per-user keys under DISCLOSURE_KEY_PREFIX', () => {
    expect(DISCLOSURE_KEY_PREFIX).toBe('aderyth:disclosure:v1:');
    expect(disclosureKey('u1')).toBe('aderyth:disclosure:v1:u1');
    expect(disclosureKey('u1')).not.toBe(disclosureKey('u2'));
  });

  it('isolates tool choices across accounts, keeps storage on sign-out, and wipes on account_deleted', async () => {
    await useDisclosureStore.getState().hydrate({ id: 'uA', createdAt: '2026-03-07T09:00:00Z' }, '2026-03-07');
    useDisclosureStore.getState().setTool('spark', 'on');
    expect(useDisclosureStore.getState().choices.spark).toBe('on');

    // Flush microtasks for AsyncStorage write
    await new Promise((r) => setTimeout(r, 0));
    expect(await AsyncStorage.getItem(disclosureKey('uA'))).not.toBeNull();

    // Sign out clears memory, preserves AsyncStorage
    resetAccountMemory('signed_out');
    expect(useDisclosureStore.getState().userId).toBeNull();
    expect(useDisclosureStore.getState().choices).toEqual({});
    expect(await AsyncStorage.getItem(disclosureKey('uA'))).not.toBeNull();

    // Hydrate user B -> never sees A's choice
    await useDisclosureStore.getState().hydrate({ id: 'uB', createdAt: '2026-03-07T09:00:00Z' }, '2026-03-07');
    expect(useDisclosureStore.getState().choices.spark).toBeUndefined();

    // Return to user A -> preference restored
    resetAccountMemory('user_changed');
    await useDisclosureStore.getState().hydrate({ id: 'uA', createdAt: '2026-03-07T09:00:00Z' }, '2026-03-07');
    expect(useDisclosureStore.getState().choices.spark).toBe('on');

    // Account deletion sweeps user A's storage key
    await endAccountScope('account_deleted', 'uA');
    expect(await AsyncStorage.getItem(disclosureKey('uA'))).toBeNull();
  });

  it('drops an in-flight hydrate result when accountEpoch moves mid-await', async () => {
    await AsyncStorage.setItem(
      disclosureKey('uA'),
      JSON.stringify({
        v: 1,
        firstSeenAt: '2026-03-01T08:00:00Z',
        activeDays: ['2026-03-01', '2026-03-02', '2026-03-03'],
        firstCloseAt: null,
        firstTodayMinutes: 5,
        choices: { metrics: 'on' },
        legacyNoticeSeen: true,
      }),
    );

    let releaseRead!: () => void;
    const rawGetItem = AsyncStorage.getItem;
    const origGetItem = rawGetItem.bind(AsyncStorage);
    AsyncStorage.getItem = ((key: string) =>
      new Promise((resolve) => {
        releaseRead = () => {
          resolve(origGetItem(key));
        };
      })) as typeof AsyncStorage.getItem;

    try {
      const pending = useDisclosureStore.getState().hydrate({ id: 'uA' }, '2026-03-07');
      // Account boundary crossed before AsyncStorage resolves
      resetAccountMemory('signed_out');
      releaseRead();
      await pending;
    } finally {
      AsyncStorage.getItem = rawGetItem;
    }

    expect(useDisclosureStore.getState().userId).toBeNull();
    expect(useDisclosureStore.getState().choices).toEqual({});
    expect(useDisclosureStore.getState().hydrated).toBe(false);
  });

  it('falls back safely on corrupt JSON, unsupported version, and malformed field types', async () => {
    for (const bad of [
      '{not-valid-json',
      JSON.stringify({ v: 2, activeDays: ['2026-03-01'], choices: { spark: 'on' } }),
      JSON.stringify({ v: 1, activeDays: 'not-an-array', choices: 'bad', legacyNoticeSeen: 'no' }),
    ]) {
      resetAccountMemory('signed_out');
      await AsyncStorage.setItem(disclosureKey('u1'), bad);
      await expect(
        useDisclosureStore.getState().hydrate({ id: 'u1', createdAt: null }, '2026-03-07'),
      ).resolves.toBeUndefined();
      expect(useDisclosureStore.getState().hydrated).toBe(true);
      expect(Array.isArray(useDisclosureStore.getState().activeDays)).toBe(true);
      expect(useDisclosureStore.getState().choices).toEqual({});
    }
  });

  it('recordActiveDay is idempotent per day, caps at 60 days dropping the oldest, and merges pre-hydrate days', async () => {
    // Record before hydrate completes
    useDisclosureStore.getState().recordActiveDay('2026-03-07');
    await AsyncStorage.setItem(
      disclosureKey('u1'),
      JSON.stringify({
        v: 1,
        firstSeenAt: '2026-03-01T08:00:00Z',
        activeDays: ['2026-03-05', '2026-03-06'],
        firstCloseAt: null,
        firstTodayMinutes: 20,
        choices: {},
        legacyNoticeSeen: true,
      }),
    );

    await useDisclosureStore.getState().hydrate({ id: 'u1', createdAt: null }, '2026-03-07');
    expect(useDisclosureStore.getState().activeDays).toEqual(['2026-03-05', '2026-03-06', '2026-03-07']);
    expect(useDisclosureStore.getState().stage).toBe('first_week');

    // Idempotent on same day
    useDisclosureStore.getState().recordActiveDay('2026-03-07');
    expect(useDisclosureStore.getState().activeDays).toHaveLength(3);

    // 61 unique days -> keeps newest 60, drops oldest
    for (let i = 1; i <= 61; i += 1) {
      const m = String(Math.floor((i - 1) / 28) + 4).padStart(2, '0');
      const d = String(((i - 1) % 28) + 1).padStart(2, '0');
      useDisclosureStore.getState().recordActiveDay(`2026-${m}-${d}`);
    }
    const days = useDisclosureStore.getState().activeDays;
    expect(days).toHaveLength(60);
    expect(days).not.toContain('2026-03-05');
    expect(useDisclosureStore.getState().stage).toBe('established');
  });

  it('sets legacyNoticeSeen=true on new accounts and false on >=7-day legacy accounts; setTool(x, null) deletes key; markFirstClose promotes stage', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T10:00:00Z'));
    try {
      await useDisclosureStore.getState().hydrate({ id: 'newU', createdAt: '2026-03-09T10:00:00Z' }, '2026-03-10');
      expect(useDisclosureStore.getState().legacyNoticeSeen).toBe(true);
      expect(useDisclosureStore.getState().stage).toBe('first_day');

      useDisclosureStore.getState().markFirstClose('2026-03-10');
      expect(useDisclosureStore.getState().firstCloseAt).not.toBeNull();
      expect(useDisclosureStore.getState().stage).toBe('first_week');

      useDisclosureStore.getState().setTool('metrics', 'on');
      expect(useDisclosureStore.getState().choices).toEqual({ metrics: 'on' });
      useDisclosureStore.getState().setTool('metrics', null);
      expect('metrics' in useDisclosureStore.getState().choices).toBe(false);

      resetAccountMemory('user_changed');
      await useDisclosureStore.getState().hydrate({ id: 'oldU', createdAt: '2026-02-01T10:00:00Z' }, '2026-03-10');
      expect(useDisclosureStore.getState().legacyNoticeSeen).toBe(false);
      expect(useDisclosureStore.getState().stage).toBe('established');

      useDisclosureStore.getState().dismissLegacyNotice();
      expect(useDisclosureStore.getState().legacyNoticeSeen).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
