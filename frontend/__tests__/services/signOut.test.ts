/**
 * F04 (NAV-02, SYN-22, TST-05, STO-03) — signing out of this device.
 *
 * `signOutLocal` ends the session on this device only and then clears what the account left in
 * memory, in the read cache and in its transient keys. Unsent work is never removed: it waits under
 * the account's own key for the same account. A failed sign-out clears nothing (no false success).
 */
const mockAuth = { uid: 'A' as string | null, signOutError: null as null | { message: string }, signOutCalls: [] as unknown[] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: async () => ({ data: { session: mockAuth.uid ? { user: { id: mockAuth.uid }, access_token: 't' } : null } }),
      getUser: async () => ({ data: { user: mockAuth.uid ? { id: mockAuth.uid } : null } }),
      signOut: async (opts?: unknown) => { mockAuth.signOutCalls.push(opts); return { error: mockAuth.signOutError }; },
    },
  },
}));
const mockScheduled = { ids: [] as string[] };
jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => mockScheduled.ids.map((identifier) => ({ identifier, data: null })),
  cancelScheduled: async (ids: readonly string[]) => { mockScheduled.ids = mockScheduled.ids.filter((i) => !ids.includes(i)); },
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
}));
const mockReadCache = { userCleared: [] as string[], allCleared: 0 };
jest.mock('../../lib/localReadCache', () => ({
  ...jest.requireActual('../../lib/localReadCache'),
  clearUserReadCache: async (uid: string) => { mockReadCache.userCleared.push(uid); },
  clearAllReadCache: async () => { mockReadCache.allCleared += 1; },
}));
const mockFlush = { calls: 0, hang: false };
jest.mock('../../services/unifiedOutbox', () => ({
  flushAllOutboxes: () => {
    mockFlush.calls += 1;
    return mockFlush.hang ? new Promise(() => undefined) : Promise.resolve({ pending: 0, dead: 0, conflict: 0 });
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOutCurrentAccount, signOutLocal, signOutNotice } from '../../services/accountService';
import { endAccountScope } from '../../lib/accountScope';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useFocusStore, sessionKey } from '../../store/focusStore';
import { useAiConversationStore, lastActiveKey } from '../../store/aiConversationStore';
import { urgeStorageKey } from '../../components/BadHabitsTracker';

/** A's device state: two transient keys, the rest must survive a sign-out. */
const A_KEYS = {
  transient: [sessionKey('A'), lastActiveKey('A')],
  kept: ['outbox.v1.core.A', 'atlas_sync_queue_v1:A', urgeStorageKey('A'), 'moods.v1.A', 'app_theme_dark', 'focus.settings.v1.A'],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  Object.assign(mockAuth, { uid: 'A', signOutError: null, signOutCalls: [] });
  mockScheduled.ids = [];
  mockReadCache.userCleared = [];
  mockReadCache.allCleared = 0;
  Object.assign(mockFlush, { calls: 0, hang: false });
  useLogStore.setState({ pendingSyncCount: 0, deadSyncCount: 0 });
});

async function seedA(): Promise<void> {
  useHabitStore.setState({ habits: [{ id: 'h-A', name: 'A habit' } as never] });
  useFocusStore.setState({ focusTasks: [{ id: 'f-A' } as never], sessionsCompleted: 3 });
  useAiConversationStore.setState({ activeId: 'conv-A', messages: [{ id: 'm', content: 'A gizli' } as never] });
  await AsyncStorage.multiSet([...A_KEYS.transient, ...A_KEYS.kept].map((k) => [k, '1'] as [string, string]));
  mockScheduled.ids = ['h:h-A:2026-11-02:09:00', 'recovery-p1'];
}

describe('signOutLocal', () => {
  it('ends the local session, wipes this user\'s read cache, cancels reminders, returns ok', async () => {
    await seedA();
    expect(await signOutLocal()).toEqual({ ok: true, data: true });
    expect(mockAuth.signOutCalls).toEqual([{ scope: 'local' }]);
    expect(mockReadCache.userCleared).toEqual(['A']);
    expect(mockReadCache.allCleared).toBe(0); // a sign-out is not a deletion
    expect(mockScheduled.ids).toEqual([]);
  });

  it("TST-05: A's memory and transient keys are gone; A's unsent work, settings and counters stay", async () => {
    await seedA();
    await signOutLocal();
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(useFocusStore.getState().focusTasks).toEqual([]);
    expect(useFocusStore.getState().sessionsCompleted).toBe(0);
    expect(useAiConversationStore.getState().messages).toEqual([]);
    expect(useAiConversationStore.getState().activeId).toBeNull();
    const keys = await AsyncStorage.getAllKeys();
    for (const k of A_KEYS.transient) expect({ k, present: keys.includes(k) }).toEqual({ k, present: false });
    for (const k of A_KEYS.kept) expect({ k, present: keys.includes(k) }).toEqual({ k, present: true });

    // B signs in: nothing of A is in memory
    mockAuth.uid = 'B';
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(useAiConversationStore.getState().activeId).toBeNull();
  });

  it('no outbox key of any account is ever removed by a sign-out', async () => {
    await AsyncStorage.multiSet([['outbox.v1.core.A', '1'], ['outbox.v1.core.B', '1'], ['atlas_sync_queue_v1:A', '1'], ['atlas_sync_queue_v1:B', '1']]);
    await signOutLocal();
    await endAccountScope('user_changed', 'B');
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(['atlas_sync_queue_v1:A', 'atlas_sync_queue_v1:B', 'outbox.v1.core.A', 'outbox.v1.core.B']);
  });

  it('a failed sign-out clears nothing and says so (no false success)', async () => {
    await seedA();
    mockAuth.signOutError = { message: 'network' };
    expect(await signOutLocal()).toEqual({ ok: false, error: 'Oturum kapatılamadı, lütfen tekrar dene.' });
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(mockReadCache.userCleared).toEqual([]);
    expect(await AsyncStorage.getItem(sessionKey('A'))).not.toBeNull();
    expect(mockScheduled.ids).toHaveLength(2);
  });

  it('without a session it still works, and wipes no user cache', async () => {
    mockAuth.uid = null;
    await expect(signOutLocal()).resolves.toEqual({ ok: true, data: true });
    expect(mockReadCache.userCleared).toEqual([]);
  });
});

describe('signOutCurrentAccount', () => {
  it('with unsent changes it tries one delivery first, then signs out', async () => {
    useLogStore.setState({ pendingSyncCount: 2 });
    expect((await signOutCurrentAccount()).ok).toBe(true);
    expect(mockFlush.calls).toBe(1);
    expect(mockAuth.signOutCalls).toHaveLength(1);
  });

  it('with nothing unsent, or syncFirst: false, it does not try to deliver', async () => {
    await signOutCurrentAccount();
    useLogStore.setState({ pendingSyncCount: 2 });
    await signOutCurrentAccount({ syncFirst: false });
    expect(mockFlush.calls).toBe(0);
    expect(mockAuth.signOutCalls).toHaveLength(2);
  });

  it('a delivery that hangs (offline) does not hold the sign-out longer than six seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'Date', 'hrtime', 'performance'] });
    try {
      useLogStore.setState({ pendingSyncCount: 1 });
      mockFlush.hang = true;
      let done = false;
      const p = signOutCurrentAccount().then((r) => { done = true; return r; });
      await jest.advanceTimersByTimeAsync(5999);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect((await p).ok).toBe(true);
      expect(mockAuth.signOutCalls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('signOutNotice', () => {
  it('nothing unsent: no notice', () => {
    expect(signOutNotice(0)).toBeNull();
    expect(signOutNotice(-1)).toBeNull();
    expect(signOutNotice(Number.NaN)).toBeNull();
  });

  it('states the number and that the changes stay on this device, without alarm', () => {
    const n = signOutNotice(3)!;
    expect(n).toContain('3 değişiklik');
    expect(n).toContain('bu cihazda kalır');
    expect(n).toMatch(/aynı hesapla tekrar girince gönderilir/);
    expect(n).not.toMatch(/kaybol|silinir|hata|!/i);
  });
});
