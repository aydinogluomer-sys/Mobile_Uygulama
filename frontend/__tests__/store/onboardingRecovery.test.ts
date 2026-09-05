/**
 * The two reliability defects, and the exact sequences that used to fail.
 *
 * ## DEFECT 1 — a half-finished install could not be finished
 *
 * The old order was: insert habits, then write completion. When the second
 * write failed the store cleared the in-memory plan, so every retry answered
 * "Kurulacak alışkanlık yok." and the account was left with habits, an
 * unfinished flow, and no way back. The source comment claiming a retry
 * re-ran only the completion write was simply false.
 *
 * The fix is a durable claim written BEFORE the habits exist
 * (`status: 'installing'`), which a later process can read. Recovery counts
 * the account's habits: zero means the insert provably never landed and the
 * whole install may re-run; more than zero means only the completion write is
 * missing. No habit names are matched and nothing is guessed.
 *
 * ## DEFECT 2 — a failed read let a new user reach Today
 *
 * `hydrate` set `hydrated = true` on failure. The router stopped waiting,
 * `needsOnboarding('unknown')` answered false, and a brand-new account landed
 * on an empty Today — because "we could not find out" and "you do not need
 * it" were the same value. Failure now has its own state and its own screen.
 *
 * AC-R01  the exact required sequence: insert ok, completion fails, retry finishes
 * AC-R02  recovery after process death, from the durable status alone
 * AC-R03  a claim written with no habits behind it is not stuck in recovery
 * AC-R04  the routing decision, behaviourally, for every hydration outcome
 * AC-R05  account A's transient state does not leak to account B
 */
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockClient = makeSupabaseMock(mockDb);

/** Tables whose next write must fail, by name. */
const failTable: { name: string | null } = { name: null };

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSession.userId
            ? { user: { id: mockSession.userId }, access_token: 't' }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => {
      // Targeted failure: the sequence under test needs the habit insert to
      // SUCCEED and the completion write to FAIL, which a single global
      // `failNext` cannot express.
      if (failTable.name === table) {
        failTable.name = null;
        mockDb.failNext = { error: 'tamamlama yazılamadı' };
      }
      return mockClient.from(table);
    },
  },
}));

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => true),
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  syncAllReminders: jest.fn(),
}));

import {
  resolveOnboardingRouting, useOnboardingStore, type RoutingInput,
} from '../../store/onboardingStore';
import { useHabitStore } from '../../store/habitStore';
import type { OnboardingAnswers } from '../../lib/onboarding';

const ANSWERS: OnboardingAnswers = {
  goals: ['sleep'],
  primaryBarrier: 'consistency',
  pace: 'balanced',
  preferredDayparts: ['bedtime'],
  reminderIntent: null,
};

function reset() {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  failTable.name = null;
  mockSession.userId = 'u1';
  useHabitStore.setState({ habits: [] });
  useOnboardingStore.getState().resetForAccount();
  useOnboardingStore.setState({ answers: ANSWERS });
}

beforeEach(reset);

const habitRows = () => mockDb.rows.habits ?? [];
const onboardingRow = () => (mockDb.rows.user_onboarding ?? [])[0];

// ---------------------------------------------------------------------------
describe('AC-R01 insert succeeds, completion fails, retry finishes', () => {
  it('the exact sequence, end to end', async () => {
    const store = useOnboardingStore.getState();
    store.generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;
    expect(planned).toBeGreaterThan(0);

    // ── the completion write is the one that fails ──
    failTable.name = 'user_onboarding';
    // The claim is written to `user_onboarding` FIRST, so arm the failure for
    // the second visit to that table, not the first.
    let visits = 0;
    const armed = mockClient.from;
    (mockClient as { from: typeof armed }).from = (table: string) => {
      if (table === 'user_onboarding') {
        visits += 1;
        if (visits === 2) mockDb.failNext = { error: 'tamamlama yazılamadı' };
      }
      return armed(table);
    };
    failTable.name = null;

    // 1-3. first install attempt returns false
    const first = await useOnboardingStore.getState().installPlan();
    (mockClient as { from: typeof armed }).from = armed;
    expect(first).toBe(false);

    // 4. the habits exist exactly once
    expect(habitRows()).toHaveLength(planned);

    // ...and the flow knows it
    const mid = useOnboardingStore.getState();
    expect(mid.installPhase).toBe('awaiting_completion');
    expect(mid.status).not.toBe('completed');
    expect(mid.installError).toBeTruthy();
    // The durable claim survives on the server, which is what a later process
    // would read.
    expect(onboardingRow().status).toBe('installing');

    // 5-7. retry, with the completion write now working
    const second = await useOnboardingStore.getState().installPlan();
    expect(second).toBe(true);

    // 8. habits still exist exactly once
    expect(habitRows()).toHaveLength(planned);

    // 9. completed
    const done = useOnboardingStore.getState();
    expect(done.status).toBe('completed');
    expect(done.installPhase).toBe('idle');
    expect(onboardingRow().status).toBe('completed');
    expect(onboardingRow().completed_at).not.toBeNull();
  });

  it('a repeated retry still does not duplicate', async () => {
    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;

    let visits = 0;
    const armed = mockClient.from;
    (mockClient as { from: typeof armed }).from = (table: string) => {
      if (table === 'user_onboarding') {
        visits += 1;
        if (visits === 2 || visits === 3) mockDb.failNext = { error: 'yine olmadı' };
      }
      return armed(table);
    };

    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    (mockClient as { from: typeof armed }).from = armed;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);

    expect(habitRows()).toHaveLength(planned);
  });
});

// ---------------------------------------------------------------------------
describe('AC-R02 recovery after process death', () => {
  it('a fresh store recovers from the durable status alone', async () => {
    // Simulate the previous process: habits in the table, `installing` on the
    // server, and NOTHING in module memory.
    mockDb.rows.habits = [
      { id: 'h1', user_id: 'u1', name: 'Sabit yatış saati', status: 'active' } as never,
      { id: 'h2', user_id: 'u1', name: 'Işıkları kıs', status: 'active' } as never,
    ];
    mockDb.rows.user_onboarding = [{
      id: 'r1', user_id: 'u1', onboarding_version: 1, goals: ['sleep'],
      primary_barrier: 'consistency', pace: 'balanced', preferred_dayparts: ['bedtime'],
      reminder_intent: null, status: 'installing', completed_at: null,
      created_at: 'now', updated_at: 'now',
    } as never];
    useOnboardingStore.getState().resetForAccount();   // module memory is empty

    await useOnboardingStore.getState().hydrate();

    const s = useOnboardingStore.getState();
    expect(s.hydrationState).toBe('ready');
    expect(s.status).toBe('installing');
    // Decided by counting the account's habits, not by remembering anything.
    expect(s.installPhase).toBe('awaiting_completion');
    expect(s.installedHabitCount).toBe(2);
    // No plan is regenerated, so there is nothing an accidental tap could
    // install a second time.
    expect(s.plan).toBeNull();

    expect(await useOnboardingStore.getState().installPlan()).toBe(true);
    expect(habitRows()).toHaveLength(2);          // unchanged
    expect(useOnboardingStore.getState().status).toBe('completed');
  });

  it('installPlan from recovery cannot reach the insert path', async () => {
    mockDb.rows.habits = [{ id: 'h1', user_id: 'u1', name: 'x', status: 'active' } as never];
    mockDb.rows.user_onboarding = [{
      id: 'r1', user_id: 'u1', onboarding_version: 1, goals: [], primary_barrier: null,
      pace: 'balanced', preferred_dayparts: [], reminder_intent: null,
      status: 'installing', completed_at: null, created_at: 'now', updated_at: 'now',
    } as never];
    await useOnboardingStore.getState().hydrate();

    // A plan in memory as well — the worst case, where an insert IS possible.
    useOnboardingStore.getState().generatePlan();
    expect(useOnboardingStore.getState().plan).not.toBeNull();

    const before = mockDb.inserts.filter((i) => i.table === 'habits').length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);
    const after = mockDb.inserts.filter((i) => i.table === 'habits').length;

    expect(after).toBe(before);          // not one row was inserted
    expect(habitRows()).toHaveLength(1);
  });
});

describe('AC-R03 a claim with nothing behind it is not stuck', () => {
  it('installing + zero habits re-runs the whole install', async () => {
    // The crash happened between the claim and the insert: there is provably
    // nothing to duplicate, so recovery must NOT be the completion-only path.
    mockDb.rows.user_onboarding = [{
      id: 'r1', user_id: 'u1', onboarding_version: 1, goals: ['sleep'],
      primary_barrier: null, pace: 'balanced', preferred_dayparts: [],
      reminder_intent: null, status: 'installing', completed_at: null,
      created_at: 'now', updated_at: 'now',
    } as never];

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.installedHabitCount).toBe(0);
    expect(s.installPhase).toBe('idle');

    useOnboardingStore.getState().generatePlan();
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);
    expect(habitRows().length).toBeGreaterThan(0);
    expect(useOnboardingStore.getState().status).toBe('completed');
  });

  it('a failed habit insert retracts the claim rather than stranding it', async () => {
    useOnboardingStore.getState().generatePlan();

    let visits = 0;
    const armed = mockClient.from;
    (mockClient as { from: typeof armed }).from = (table: string) => {
      // Let the claim through, fail the habits.
      if (table === 'habits') {
        visits += 1;
        if (visits === 1) mockDb.failNext = { error: 'insert reddedildi' };
      }
      return armed(table);
    };

    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    (mockClient as { from: typeof armed }).from = armed;

    expect(habitRows()).toEqual([]);
    // Back to pending, not left claiming an install that never happened.
    expect(onboardingRow().status).toBe('pending');
    expect(useOnboardingStore.getState().installPhase).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
describe('AC-R04 the routing decision, for every hydration outcome', () => {
  const base: RoutingInput = {
    hasSupabaseSession: true,
    hasAnySession: true,
    hydrationState: 'ready',
    status: 'pending',
    inAuthGroup: false,
    inPasswordRecovery: false,
    inOnboarding: false,
    personalizing: false,
  };

  it('new user, row read, no row -> onboarding', () => {
    expect(resolveOnboardingRouting({ ...base, status: 'pending' }))
      .toEqual({ kind: 'redirect', to: '/onboarding/needs' });
  });

  it('an interrupted install goes to the plan screen, not back to question one', () => {
    expect(resolveOnboardingRouting({ ...base, status: 'installing' }))
      .toEqual({ kind: 'redirect', to: '/onboarding/plan' });
  });

  it.each(['legacy', 'completed', 'skipped'] as const)('%s user -> Today', (status) => {
    expect(resolveOnboardingRouting({ ...base, status, inOnboarding: true }))
      .toEqual({ kind: 'redirect', to: '/tabs/today' });
  });

  it('read failure -> the retry gate', () => {
    expect(resolveOnboardingRouting({ ...base, hydrationState: 'error', status: 'unknown' }))
      .toEqual({ kind: 'gate' });
  });

  it('read failure MUST NOT reach Today — the defect, asserted directly', () => {
    for (const inOnboarding of [true, false]) {
      for (const inAuthGroup of [true, false]) {
        const decision = resolveOnboardingRouting({
          ...base, hydrationState: 'error', status: 'unknown', inOnboarding, inAuthGroup,
        });
        expect(decision).toEqual({ kind: 'gate' });
      }
    }
  });

  it('a read still in flight waits rather than guessing', () => {
    for (const hydrationState of ['idle', 'loading'] as const) {
      expect(resolveOnboardingRouting({ ...base, hydrationState, status: 'unknown' }))
        .toEqual({ kind: 'wait' });
    }
  });

  it('retry succeeds with no row -> onboarding', () => {
    // 'error' then 'ready' + pending: exactly what a successful retry produces.
    expect(resolveOnboardingRouting({ ...base, hydrationState: 'error', status: 'unknown' }).kind).toBe('gate');
    expect(resolveOnboardingRouting({ ...base, hydrationState: 'ready', status: 'pending' }))
      .toEqual({ kind: 'redirect', to: '/onboarding/needs' });
  });

  it('retry succeeds with a completed row -> Today', () => {
    expect(resolveOnboardingRouting({
      ...base, hydrationState: 'ready', status: 'completed', inOnboarding: true,
    })).toEqual({ kind: 'redirect', to: '/tabs/today' });
  });

  it('password recovery is not hijacked, signed in or out', () => {
    expect(resolveOnboardingRouting({
      ...base, hasSupabaseSession: false, hasAnySession: false,
      inAuthGroup: true, inPasswordRecovery: true, status: 'unknown', hydrationState: 'idle',
    })).toEqual({ kind: 'stay' });

    expect(resolveOnboardingRouting({
      ...base, status: 'completed', inAuthGroup: true, inPasswordRecovery: true,
    })).toEqual({ kind: 'stay' });
  });

  it('a Notion-only session is never routed into onboarding', () => {
    // No Supabase session, so no onboarding row exists to read; hydration
    // stays idle and must not become a gate or a redirect into the flow.
    const decision = resolveOnboardingRouting({
      ...base, hasSupabaseSession: false, hasAnySession: true,
      hydrationState: 'idle', status: 'unknown',
    });
    expect(decision).toEqual({ kind: 'stay' });
  });

  it('signed out and outside auth -> login', () => {
    expect(resolveOnboardingRouting({
      ...base, hasSupabaseSession: false, hasAnySession: false, hydrationState: 'idle',
    })).toEqual({ kind: 'redirect', to: '/(auth)/login' });
  });

  it('deliberate personalization is not bounced out of the group', () => {
    expect(resolveOnboardingRouting({
      ...base, status: 'completed', inOnboarding: true, personalizing: true,
    })).toEqual({ kind: 'stay' });
  });
});

// ---------------------------------------------------------------------------
describe('AC-R05 nothing leaks between accounts', () => {
  it('signing out clears every routing-relevant value', async () => {
    // Account A gets as far as a failed install with an error on screen.
    useOnboardingStore.getState().generatePlan();
    useOnboardingStore.setState({
      status: 'installing',
      hydrationState: 'error',
      loadError: 'A hesabının hatası',
      installPhase: 'awaiting_completion',
      installedHabitCount: 4,
      installError: 'A hesabının kurulum hatası',
      personalizing: true,
      permission: 'denied',
      saveError: 'A hesabının kayıt hatası',
    });

    useOnboardingStore.getState().resetForAccount();

    const s = useOnboardingStore.getState();
    expect(s.status).toBe('unknown');
    expect(s.hydrationState).toBe('idle');
    expect(s.loadError).toBeNull();
    expect(s.installPhase).toBe('idle');
    expect(s.installedHabitCount).toBe(0);
    expect(s.installError).toBeNull();
    expect(s.saveError).toBeNull();
    expect(s.personalizing).toBe(false);
    expect(s.permission).toBe('unknown');
    expect(s.plan).toBeNull();
    expect(s.answers).toEqual({
      goals: [], primaryBarrier: null, pace: null, preferredDayparts: [], reminderIntent: null,
    });
  });

  it('account B is routed by B\'s row, not A\'s', async () => {
    // A finished.
    mockDb.rows.user_onboarding = [{
      id: 'a', user_id: 'u1', onboarding_version: 1, goals: ['sleep'],
      primary_barrier: null, pace: 'gentle', preferred_dayparts: [], reminder_intent: null,
      status: 'completed', completed_at: 'then', created_at: 'now', updated_at: 'now',
    } as never];
    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().status).toBe('completed');

    // Sign out, sign in as B — who has no row at all.
    useOnboardingStore.getState().resetForAccount();
    mockSession.userId = 'u2';
    await useOnboardingStore.getState().hydrate();

    const s = useOnboardingStore.getState();
    expect(s.status).toBe('pending');
    expect(s.answers.pace).toBeNull();          // not A's 'gentle'
    expect(resolveOnboardingRouting({
      hasSupabaseSession: true, hasAnySession: true,
      hydrationState: s.hydrationState, status: s.status,
      inAuthGroup: false, inPasswordRecovery: false, inOnboarding: false, personalizing: false,
    })).toEqual({ kind: 'redirect', to: '/onboarding/needs' });
  });
});
