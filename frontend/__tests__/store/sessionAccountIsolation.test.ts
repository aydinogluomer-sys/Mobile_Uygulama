/**
 * F04 (STO-01, SYN-08, STO-20, TST-05) — every account-scoped store forgets the previous account at
 * an account boundary; device-level stores do not.
 *
 * Every file in `store/` is loaded for real (its registration runs as a side effect of the import)
 * and every Zustand hook it exports is found by shape, so a store added later is covered without
 * this file being edited: either it resets with the others, or it is one of the three device-level
 * stores, or this test is red. `__tests__/repo/accountScopeRegistry.test.ts` holds the same rule
 * statically.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

const mockAuth = { uid: 'user-A' as string | null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: async () => ({ data: { session: mockAuth.uid ? { user: { id: mockAuth.uid }, access_token: 't' } : null } }),
      getUser: async () => ({ data: { user: mockAuth.uid ? { id: mockAuth.uid } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => ({ error: null }),
    },
  },
}));
jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
  registerReminderReconciler: jest.fn(),
}));
jest.mock('../../lib/localReadCache', () => ({
  clearReadCacheMemory: jest.fn(),
  clearUserReadCache: jest.fn(async () => undefined),
  clearAllReadCache: jest.fn(async () => undefined),
  getCachedSnapshot: jest.fn(async () => null),
  readCachedSnapshot: jest.fn(async () => null),
  setCachedSnapshot: jest.fn(async () => undefined),
  invalidateCachedSnapshot: jest.fn(async () => undefined),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `atlas://${p}`, parse: () => ({ queryParams: {} }) }));
// the journal's conflict base is observed where the store hands it over
const mockJournal = { serverRows: [] as { date: string; content: string }[], saved: [] as { date: string; baseContent: string | null }[] };
jest.mock('../../services/journalService', () => ({
  ...jest.requireActual('../../services/journalService'),
  listJournalEntries: async () => ({ ok: true, data: mockJournal.serverRows.map((r) => ({ id: `j-${r.date}`, user_id: 'x', date: r.date, content: r.content, mood: null, ai_summary: null, created_at: '' })) }),
  saveJournalEntry: async (input: { date: string; baseContent: string | null }) => {
    mockJournal.saved.push({ date: input.date, baseContent: input.baseContent });
    return { ok: true, savedOnDevice: true, delivered: true };
  },
}));

import {
  accountEpoch, endAccountScope, registerAccountScoped, registeredAccountScopes, resetAccountMemory,
  type AccountResetReason,
} from '../../lib/accountScope';

type Hook = {
  getState: () => Record<string, unknown>;
  getInitialState: () => Record<string, unknown>;
  setState: (s: Record<string, unknown>, replace?: boolean) => void;
};

const STORE_DIR = join(__dirname, '..', '..', 'store');
const DEVICE_LEVEL = ['themeStore.ts', 'drawerStore.ts', 'commandStore.ts'];

/** file -> the Zustand hooks it exports (found by shape, not by name lists) */
const hooks: { file: string; name: string; hook: Hook }[] = [];
for (const file of readdirSync(STORE_DIR).filter((f) => f.endsWith('.ts')).sort()) {
  const mod = jest.requireActual(join(STORE_DIR, file)) as Record<string, unknown>;
  for (const [name, value] of Object.entries(mod)) {
    const v = value as { getInitialState?: unknown } | undefined;
    if (/^use[A-Z]\w*Store$/.test(name) && typeof value === 'function' && typeof v?.getInitialState === 'function') {
      hooks.push({ file, name, hook: v as unknown as Hook });
    }
  }
}
const accountScoped = hooks.filter((h) => !DEVICE_LEVEL.includes(h.file));
const deviceLevel = hooks.filter((h) => DEVICE_LEVEL.includes(h.file));
const hookOf = (name: string): Hook => {
  const h = hooks.find((x) => x.name === name);
  if (!h) throw new Error(`no hook ${name}`);
  return h.hook;
};

beforeEach(() => {
  mockAuth.uid = 'user-A';
  mockJournal.serverRows = [];
  mockJournal.saved = [];
  resetAccountMemory('signed_out');
});

describe('the scan sees every store', () => {
  it('29 store files, one hook each; 26 account-scoped and 3 device-level', () => {
    expect(readdirSync(STORE_DIR).filter((f) => f.endsWith('.ts')).length).toBeGreaterThanOrEqual(29);
    expect(new Set(hooks.map((h) => h.file)).size).toBe(hooks.length);
    expect(deviceLevel.map((h) => h.file).sort()).toEqual([...DEVICE_LEVEL].sort());
    expect(accountScoped.length).toBe(hooks.length - 3);
    expect(accountScoped.length).toBeGreaterThanOrEqual(26);
  });
});

describe('every account-scoped store is replaced by its initial state', () => {
  it.each(accountScoped.map((h) => [h.file, h]))('%s', (_file, h) => {
    const { hook } = h as (typeof hooks)[number];
    hook.setState({ __isaret: 'A' });
    expect(hook.getState().__isaret).toBe('A');
    resetAccountMemory('signed_out');
    expect('__isaret' in hook.getState()).toBe(false);
    expect(Object.keys(hook.getState()).sort()).toEqual(Object.keys(hook.getInitialState()).sort());
  });
});

describe('device-level stores are not account data and keep their state', () => {
  it.each(deviceLevel.map((h) => [h.file, h]))('%s', (_file, h) => {
    const { hook } = h as (typeof hooks)[number];
    hook.setState({ __isaret: 'cihaz' });
    resetAccountMemory('signed_out');
    expect(hook.getState().__isaret).toBe('cihaz');
    hook.setState(hook.getInitialState(), true);
  });
});

describe("A's data does not reach B, whatever the reason of the boundary", () => {
  const FIELDS: [string, string, unknown][] = [
    ['useHabitStore', 'habits', [{ id: 'h-A' }]],
    ['useGoalStore', 'goals', [{ id: 'g-A' }]],
    ['useProjectStore', 'projects', [{ id: 'p-A' }]],
    ['useReadingListStore', 'counts', { want_to_read: 9, reading: 9, completed: 9 }],
    ['useAiConversationStore', 'messages', [{ id: 'm-A', content: 'A gizli' }]],
    ['useAiConversationStore', 'activeId', 'conv-A'],
    ['useFocusStore', 'focusTasks', [{ id: 'f-A' }]],
    ['useFocusStore', 'sessionsCompleted', 7],
    ['useJournalStore', 'entries', [{ date: '2026-10-08', content: 'A günlüğü' }]],
    ['useNoteStore', 'notes', [{ id: 'n-A' }]],
    ['useRecoveryStore', 'plans', [{ id: 'rp-A' }]],
    ['useLogStore', 'logs', [{ id: 'l-A' }]],
    ['useTaskStore', 'tasks', [{ id: 't-A' }]],
  ];

  it.each(['signed_out', 'user_changed', 'account_deleted'] as AccountResetReason[])('%s', (reason) => {
    for (const [name, field, value] of FIELDS) {
      const hook = hookOf(name);
      expect({ name, field, known: field in hook.getInitialState() }).toEqual({ name, field, known: true });
      hook.setState({ [field]: value });
    }
    resetAccountMemory(reason);
    for (const [name, field] of FIELDS) {
      const hook = hookOf(name);
      expect({ name, field, value: hook.getState()[field] }).toEqual({ name, field, value: hook.getInitialState()[field] });
    }
  });
});

describe('STO-20: module maps go with the account', () => {
  it("B's journal save on the same date carries no conflict base of A's text", async () => {
    const journal = hookOf('useJournalStore') as unknown as { getState: () => { fetchEntries: () => Promise<void>; saveEntry: (d: string, c: string, m: number) => Promise<unknown> } };
    mockJournal.serverRows = [{ date: '2026-10-08', content: 'A gizli günlük' }];
    await journal.getState().fetchEntries();

    // control: without a boundary the base IS A's server copy (the probe is not vacuous)
    await journal.getState().saveEntry('2026-10-08', 'A ekler', 3);
    expect(mockJournal.saved.at(-1)).toEqual({ date: '2026-10-08', baseContent: 'A gizli günlük' });

    resetAccountMemory('signed_out');
    mockAuth.uid = 'user-B';
    await journal.getState().saveEntry('2026-10-08', 'B yazar', 3);
    expect(mockJournal.saved.at(-1)).toEqual({ date: '2026-10-08', baseContent: null });
  });
});

describe('the registry core', () => {
  it('the epoch moves on every reset', () => {
    const e = accountEpoch();
    resetAccountMemory('signed_out');
    resetAccountMemory('user_changed');
    expect(accountEpoch()).toBe(e + 2);
  });

  it('an entry that throws does not stop the others, and the epoch still moves', () => {
    let after = 0;
    registerAccountScoped({ name: 'zz_test_throws', onReset: () => { throw new Error('broken'); } });
    registerAccountScoped({ name: 'zz_test_after', onReset: () => { after += 1; } });
    const habit = hookOf('useHabitStore');
    habit.setState({ habits: [{ id: 'h-A' }] });
    const e = accountEpoch();
    expect(() => resetAccountMemory('signed_out')).not.toThrow();
    expect(after).toBe(1);
    expect(accountEpoch()).toBe(e + 1);
    expect(habit.getState().habits).toEqual([]);
  });

  it('the same name registered twice is one entry (Fast Refresh)', () => {
    registerAccountScoped({ name: 'zz_test_twice', onReset: () => undefined });
    registerAccountScoped({ name: 'zz_test_twice', onReset: () => undefined });
    expect(registeredAccountScopes().filter((n) => n === 'zz_test_twice')).toHaveLength(1);
  });

  it('every account-scoped store and the core outbox are registered by name', () => {
    const names = registeredAccountScopes();
    for (const n of [
      'habit', 'goal', 'project', 'okr', 'readingList', 'lifeAreas', 'routine', 'profile', 'subscription', 'insights',
      'deepWork', 'notion', 'googleCalendar', 'spotify', 'willpower', 'task', 'mood', 'routineRunner', 'notionSession',
      'journal', 'note', 'recovery', 'log', 'onboarding', 'focus', 'aiConversation', 'disclosure', 'coreOutbox',
    ]) expect({ n, registered: names.includes(n) }).toEqual({ n, registered: true });
  });

  it('endAccountScope never throws, even when device cleanup fails', async () => {
    await expect(endAccountScope('signed_out', 'user-A')).resolves.toBeUndefined();
    await expect(endAccountScope('account_deleted', null)).resolves.toBeUndefined();
  });
});
