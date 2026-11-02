/**
 * F06 (NAV-04, PRF-06, STO-04) — opening the app without a connection, and refreshing without
 * tearing the screen down.
 *
 *   NAV-04 / PRF-06  a signed-in user whose onboarding status was already known (completed, legacy,
 *                    skipped) opens on Today when the server cannot be reached; the router stays
 *                    fail-closed for everyone else (no cache, another user's cache, a non-network
 *                    error, a non-terminal or corrupt record).
 *   STO-04           `hydrate()` on a `ready` store never passes through `loading` (the root layout
 *                    swaps the whole navigator for a spinner on `loading`), and a failed silent
 *                    refresh keeps `ready` and marks the status stale.
 *   account race     A's late answer is not written into B's state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null; error: unknown } = { userId: 'u1', error: null };
const mockClient = makeSupabaseMock(mockDb);
const mockFromCalls: string[] = [];
/** When set, the next `user_onboarding` read waits for it (an answer still on the wire). */
const mockHold: { gate: Promise<void> | null } = { gate: null };
/** When set, the next `habits` read fails like a dropped connection. */
const mockFailHabits = { armed: false };

function mockDelayed<T extends object>(target: T, gate: Promise<void>): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      if (prop === 'maybeSingle') return async (...a: unknown[]) => { await gate; return (v as (...x: unknown[]) => unknown).apply(t, a); };
      return (...a: unknown[]) => {
        const r = (v as (...x: unknown[]) => unknown).apply(t, a);
        return r && typeof r === 'object' && prop !== 'then' ? mockDelayed(r as object, gate) : r;
      };
    },
  });
}

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: mockSession.userId ? { user: { id: mockSession.userId }, access_token: 't' } : null },
        error: mockSession.error,
      }),
    },
    from: (table: string) => {
      mockFromCalls.push(table);
      if (table === 'habits' && mockFailHabits.armed) {
        mockFailHabits.armed = false;
        mockDb.failNextRead = { error: 'TypeError: Network request failed', status: 0 };
      }
      const b = mockClient.from(table);
      if (table === 'user_onboarding' && mockHold.gate) {
        const gate = mockHold.gate;
        mockHold.gate = null;
        return mockDelayed(b as object, gate);
      }
      return b;
    },
  },
}));

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => true),
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  syncAllReminders: jest.fn(),
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));

import { resolveOnboardingRouting, useOnboardingStore, type RoutingInput } from '../../store/onboardingStore';
import { onboardingCacheKey, readCachedOnboardingStatus, writeCachedOnboardingStatus } from '../../lib/onboardingCache';
import { authStorage, __resetAuthStorageForTests } from '../../lib/authStorage';
import { AUTH_STORAGE_KEY } from '../../lib/authStorageKey';
import { endAccountScope } from '../../lib/accountScope';
import type { OnboardingStatus } from '../../lib/onboarding';

const store = () => useOnboardingStore.getState();

function row(userId: string, status: OnboardingStatus, extra: Record<string, unknown> = {}) {
  return {
    id: `r-${userId}`, user_id: userId, onboarding_version: 1,
    goals: ['sleep'], primary_barrier: 'consistency', pace: 'balanced',
    preferred_dayparts: ['morning'], reminder_intent: null,
    status, completed_at: status === 'completed' ? 'then' : null,
    install_id: null, install_expected_habits: null, install_return_status: null,
    created_at: 'now', updated_at: 'now', ...extra,
  } as never;
}

function routing(over: Partial<RoutingInput> = {}) {
  const s = store();
  return resolveOnboardingRouting({
    hasSupabaseSession: true, hasAnySession: true,
    hydrationState: s.hydrationState, status: s.status,
    inAuthGroup: false, inPasswordRecovery: false, inOnboarding: false, personalizing: false,
    ...over,
  });
}

const OFFLINE = { error: 'TypeError: Network request failed', status: 0 };

beforeEach(async () => {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.failNext = null;
  mockDb.failNextRead = null;
  mockSession.userId = 'u1';
  mockSession.error = null;
  mockFromCalls.length = 0;
  mockHold.gate = null;
  mockFailHabits.armed = false;
  await AsyncStorage.clear();
  __resetAuthStorageForTests();
  store().resetForAccount();
});

describe('NAV-04 / PRF-06: a known status opens Today offline', () => {
  it('(+) cached `completed` + no connection (status 0): ready, completed, stale, and the router stays', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate(); // online once: the status is cached
    expect(await readCachedOnboardingStatus('u1')).toMatchObject({ userId: 'u1', status: 'completed' });

    store().resetForAccount(); // a new process
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();

    const s = store();
    expect({ h: s.hydrationState, status: s.status, stale: s.staleStatus, owner: s.ownerId })
      .toEqual({ h: 'ready', status: 'completed', stale: true, owner: 'u1' });
    expect(routing()).toEqual({ kind: 'stay' });
  });

  it.each(['legacy', 'skipped'] as const)('(+) cached `%s` opens the same way', async (status) => {
    await writeCachedOnboardingStatus('u1', status);
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();
    expect({ h: store().hydrationState, status: store().status, stale: store().staleStatus })
      .toEqual({ h: 'ready', status, stale: true });
    expect(routing()).toEqual({ kind: 'stay' });
  });

  it('(+) a 503 is "unreachable" too', async () => {
    await writeCachedOnboardingStatus('u1', 'completed');
    mockDb.failNextRead = { error: 'upstream connect error', status: 503 };
    await store().hydrate();
    expect(store().hydrationState).toBe('ready');
    expect(store().status).toBe('completed');
  });

  it('(+) offline with an EXPIRED token (getSession: AuthRetryableFetchError): the stored session and the cache open Today', async () => {
    await authStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } }));
    await writeCachedOnboardingStatus('u1', 'completed');
    mockSession.userId = null;
    mockSession.error = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };

    await store().hydrate();
    expect({ h: store().hydrationState, status: store().status, owner: store().ownerId })
      .toEqual({ h: 'ready', status: 'completed', owner: 'u1' });
    expect(mockFromCalls).toEqual([]); // the repository knew it was offline; no request was attempted
  });

  it('(+) the answers do NOT come from the cache (they stay empty until the server answers)', async () => {
    await writeCachedOnboardingStatus('u1', 'completed');
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();
    expect(store().answers.goals).toEqual([]);
  });
});

describe('fail-closed everywhere else', () => {
  it('(-) no cache + no connection: error, and the router shows the gate', async () => {
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
    expect(routing()).toEqual({ kind: 'gate' });
  });

  it("(-) another user's cache is ignored", async () => {
    await writeCachedOnboardingStatus('u2', 'completed');
    // and a record under u1's key that names u2 (hand-edited) is ignored as well
    await AsyncStorage.setItem(onboardingCacheKey('u1'), JSON.stringify({ v: 1, userId: 'u2', status: 'completed', at: 'x' }));
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
  });

  it.each([
    ['a 401', { error: 'JWT expired', status: 401 }],
    ['RLS (42501)', { error: 'permission denied for table user_onboarding', status: 403, code: '42501' }],
    ['a 400', { error: 'bad request', status: 400 }],
  ])('(-) %s is not "unreachable": the gate, even with a cached `completed`', async (_label, failure) => {
    await writeCachedOnboardingStatus('u1', 'completed');
    mockDb.failNextRead = failure;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
  });

  it('(-) "Oturum bulunamadı." (no session at all) is the gate, even with a cached `completed`', async () => {
    await writeCachedOnboardingStatus('u1', 'completed');
    mockSession.userId = null;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
    expect(store().loadError).toBe('Oturum bulunamadı.');
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['an unknown version', JSON.stringify({ v: 2, userId: 'u1', status: 'completed', at: 'x' })],
    ['a hand-written pending', JSON.stringify({ v: 1, userId: 'u1', status: 'pending', at: 'x' })],
    ['a hand-written installing', JSON.stringify({ v: 1, userId: 'u1', status: 'installing', at: 'x' })],
  ])('(-) %s in the cache is ignored', async (_label, raw) => {
    await AsyncStorage.setItem(onboardingCacheKey('u1'), raw);
    mockDb.failNextRead = OFFLINE;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
  });
});

describe('the cache follows the server', () => {
  it('(+) a successful hydrate writes a terminal status; a later `pending` REMOVES it', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'skipped')];
    await store().hydrate();
    expect((await readCachedOnboardingStatus('u1'))?.status).toBe('skipped');

    mockDb.rows.user_onboarding = [row('u1', 'pending')];
    await store().hydrate();
    expect(store().status).toBe('pending');
    expect(await AsyncStorage.getItem(onboardingCacheKey('u1'))).toBeNull();
  });

  it('(+) no row at all (a new account) is `pending`: nothing is cached', async () => {
    await store().hydrate();
    expect(store().status).toBe('pending');
    expect(await AsyncStorage.getItem(onboardingCacheKey('u1'))).toBeNull();
  });

  it('(+) the key is user-scoped and leaves with the account (sign-out)', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate();
    expect(await AsyncStorage.getItem(onboardingCacheKey('u1'))).not.toBeNull();
    await endAccountScope('signed_out', 'u1');
    expect(await AsyncStorage.getItem(onboardingCacheKey('u1'))).toBeNull();
    expect(store().ownerId).toBeNull();
    expect(store().staleStatus).toBe(false);
  });
});

describe('STO-04: a refresh never tears the screen down', () => {
  it('(+) a second hydrate on a ready store never passes through `loading`', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate();
    const seen: string[] = [];
    const unsub = useOnboardingStore.subscribe((s) => { seen.push(s.hydrationState); });
    await store().hydrate();
    unsub();
    expect(seen).not.toContain('loading');
    expect(store().hydrationState).toBe('ready');
  });

  it('(+) a failed silent refresh keeps `ready` and marks the status stale; a later success clears it', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate();
    mockDb.failNextRead = { error: 'JWT expired', status: 401 }; // not even "unreachable": still no tear-down
    await store().hydrate();
    expect({ h: store().hydrationState, stale: store().staleStatus, status: store().status })
      .toEqual({ h: 'ready', stale: true, status: 'completed' });
    await store().hydrate();
    expect(store().staleStatus).toBe(false);
  });

  it('(-) while saving, a ready store does not even fetch', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate();
    mockFromCalls.length = 0;
    useOnboardingStore.setState({ saving: true });
    await store().hydrate();
    expect(mockFromCalls).toEqual([]);
    useOnboardingStore.setState({ saving: false });
  });

  it('(-) an `installing` row whose habit count cannot be read keeps a ready screen', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'completed')];
    await store().hydrate();
    mockDb.rows.user_onboarding = [row('u1', 'installing', { install_id: 'inst-1', install_expected_habits: 3, install_return_status: 'completed' })];
    mockFailHabits.armed = true;
    await store().hydrate();
    expect({ h: store().hydrationState, stale: store().staleStatus }).toEqual({ h: 'ready', stale: true });
  });

  it('... and on a first load the same failure is still the gate', async () => {
    mockDb.rows.user_onboarding = [row('u1', 'installing', { install_id: 'inst-1', install_expected_habits: 3, install_return_status: 'completed' })];
    mockFailHabits.armed = true;
    await store().hydrate();
    expect(store().hydrationState).toBe('error');
  });
});

describe('account race', () => {
  it("(-) A's answer arriving after resetForAccount() does not touch B", async () => {
    mockDb.rows.user_onboarding = [row('uA', 'completed'), row('uB', 'pending', { goals: ['finance'] })];
    mockSession.userId = 'uA';
    let release!: () => void;
    mockHold.gate = new Promise<void>((r) => { release = r; });
    const late = store().hydrate(); // A's read is now on the wire

    for (let i = 0; i < 50 && mockFromCalls.length === 0; i += 1) await Promise.resolve();
    expect(mockFromCalls).toEqual(['user_onboarding']);
    store().resetForAccount(); // A signs out, B signs in
    mockSession.userId = 'uB';
    await store().hydrate();
    expect(store().status).toBe('pending');

    release();
    await late;
    expect({ status: store().status, goals: store().answers.goals, owner: store().ownerId })
      .toEqual({ status: 'pending', goals: ['finance'], owner: 'uB' });
  });

  it('(-) a store that last served A is reset before it serves B', async () => {
    mockDb.rows.user_onboarding = [row('uA', 'completed')];
    mockSession.userId = 'uA';
    await store().hydrate();
    useOnboardingStore.setState({ personalizing: true });
    mockSession.userId = 'uB';
    await store().hydrate();
    expect({ owner: store().ownerId, status: store().status, personalizing: store().personalizing })
      .toEqual({ owner: 'uB', status: 'pending', personalizing: false });
  });
  it("(-) A's answer arriving after a sign-out (no new hydrate) leaves the store empty", async () => {
    mockDb.rows.user_onboarding = [row('uA', 'completed')];
    mockSession.userId = 'uA';
    let release!: () => void;
    mockHold.gate = new Promise<void>((r) => { release = r; });
    const late = store().hydrate();
    for (let i = 0; i < 50 && mockFromCalls.length === 0; i += 1) await Promise.resolve();
    expect(mockFromCalls).toEqual(['user_onboarding']);

    store().resetForAccount();
    release();
    await late;
    expect({ h: store().hydrationState, status: store().status, owner: store().ownerId })
      .toEqual({ h: 'idle', status: 'unknown', owner: null });
  });

  it('... and the same through the account registry (the real sign-out path)', async () => {
    mockDb.rows.user_onboarding = [row('uA', 'completed')];
    mockSession.userId = 'uA';
    let release!: () => void;
    mockHold.gate = new Promise<void>((r) => { release = r; });
    const late = store().hydrate();
    for (let i = 0; i < 50 && mockFromCalls.length === 0; i += 1) await Promise.resolve();

    await endAccountScope('signed_out', 'uA');
    release();
    await late;
    expect({ h: store().hydrationState, status: store().status, owner: store().ownerId })
      .toEqual({ h: 'idle', status: 'unknown', owner: null });
  });
});
