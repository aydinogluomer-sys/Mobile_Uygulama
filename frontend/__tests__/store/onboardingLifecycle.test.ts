/**
 * A failed install returns the user to where they were — not to first-run.
 *
 * ## The defect this replaces
 *
 * Onboarding is not only a first run. An existing user opens it deliberately
 * from Settings → Kişiselleştirme, and at that moment their lifecycle status
 * is already `completed`, `legacy` or `skipped`. `saveProgress` was careful
 * to preserve those. The install was not — its rollback wrote a literal:
 *
 *     completed  →  installing  →  the habit insert fails  →  pending
 *
 * `pending` is the one status that means "this account still owes us a first
 * run". So a dropped connection while inserting three habits — a failure that
 * wrote nothing at all — demoted a settled account, and the next launch sent
 * it into mandatory onboarding with no way out.
 *
 * The literal was invisible in the obvious test: a first-run user rolls back
 * to `pending` whether the code preserves the status or hardcodes it, so the
 * bug read as correct in exactly the case anyone writes first. Only the three
 * OTHER starting statuses can tell the two apart, which is why C and D exist
 * alongside B.
 *
 * ## Why the answer had to be durable
 *
 * The status the claim displaces cannot live in this module. The install
 * protocol is explicitly recoverable after process death — that is the whole
 * point of writing `installing` to the server before any habit exists — so a
 * rollback that reads a variable in a dead process's memory is not a
 * rollback. `user_onboarding.install_return_status` is written in the SAME
 * upsert as the claim, so a claim can never exist without the status it
 * displaced. See `022_onboarding_install_return_status.sql`.
 *
 * CASE A  pending   → installing → insert fails → pending
 * CASE B  completed → installing → insert fails → completed, and a restart
 *                                                 routes to Today
 * CASE C  legacy    → installing → insert fails → legacy
 * CASE D  skipped   → installing → insert fails → skipped
 * CASE E  completed → installing → insert succeeds → completed, rows once
 * CASE F  the process dies holding the claim; the displaced status is still
 *         recoverable from the SERVER, with no client memory at all
 */
import { createMockDb, makeSupabaseMock, type MockDb, type MockRow } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockClient = makeSupabaseMock(mockDb);

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
    from: (table: string) => mockClient.from(table),
  },
}));

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => true),
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  syncAllReminders: jest.fn(),
}));

import {
  resolveOnboardingRouting,
  resolveReturnStatus,
  useOnboardingStore,
  type RoutingInput,
} from '../../store/onboardingStore';
import { useHabitStore } from '../../store/habitStore';
import type { OnboardingAnswers, OnboardingStatus } from '../../lib/onboarding';

const ANSWERS: OnboardingAnswers = {
  goals: ['sleep'],
  primaryBarrier: 'consistency',
  pace: 'balanced',
  preferredDayparts: ['bedtime'],
  reminderIntent: null,
};

/**
 * A settled account: a real lifecycle status, and no install in flight.
 *
 * `install_return_status` is null here for the same reason it is null for all
 * six live rows — nothing is being installed, so there is nowhere to return
 * to. Every value the rollback later reads has to have been written by the
 * code under test, not seeded by the test that checks it.
 */
function seedSettled(status: OnboardingStatus) {
  mockDb.rows.user_onboarding = [{
    id: 'r1', user_id: 'u1', onboarding_version: 1,
    goals: ANSWERS.goals, primary_barrier: ANSWERS.primaryBarrier, pace: ANSWERS.pace,
    preferred_dayparts: ANSWERS.preferredDayparts, reminder_intent: null,
    status, completed_at: status === 'completed' ? 'then' : null,
    install_id: null, install_expected_habits: null, install_return_status: null,
    created_at: 'now', updated_at: 'now',
  } as never];
}

/** Habits the user already had. Nothing to do with any onboarding install. */
function seedExistingHabits(count: number) {
  mockDb.rows.habits ??= [];
  for (let i = 0; i < count; i++) {
    mockDb.rows.habits.push({
      id: `old-${i}`, user_id: 'u1', name: `Eski alışkanlık ${i}`,
      status: 'active', install_id: null,
    } as never);
  }
}

/** A signed-in user standing somewhere, asking the router what happens. */
function routing(
  status: OnboardingStatus | 'unknown',
  over: Partial<RoutingInput> = {},
): RoutingInput {
  return {
    hasSupabaseSession: true,
    hasAnySession: true,
    hydrationState: 'ready',
    status,
    inAuthGroup: false,
    inPasswordRecovery: false,
    inOnboarding: false,
    // A restart is not a personalization: whatever the user had opened before
    // the crash, the new process carries no such intent.
    personalizing: false,
    ...over,
  };
}

function reset() {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockDb.failNextRead = null;
  mockDb.failTable = null;
  mockSession.userId = 'u1';
  useHabitStore.setState({ habits: [] });
  useOnboardingStore.getState().resetForAccount();
}

beforeEach(reset);

const store = () => useOnboardingStore.getState();
const habitRows = () => mockDb.rows.habits ?? [];
const onboardingRow = () => (mockDb.rows.user_onboarding ?? [])[0];

/** The whole flow an existing user takes out of Settings → Kişiselleştirme. */
async function personalizeAndFailTheInsert(): Promise<number> {
  store().beginPersonalization();
  store().generatePlan();
  const planned = store().plan!.habits.length;
  expect(planned).toBeGreaterThan(0);
  // Only the habits table refuses. The claim before it lands for real, which
  // is what puts the account into `installing` and makes the rollback matter.
  mockDb.failTable = { table: 'habits', error: 'network request failed' };
  expect(await store().installPlan()).toBe(false);
  mockDb.failTable = null;
  return planned;
}

/** Everything the rollback must leave behind, whatever the starting status. */
function expectRolledBackTo(status: OnboardingStatus) {
  // In memory...
  expect(store().status).toBe(status);
  expect(store().installPhase).toBe('idle');
  expect(store().installId).toBeNull();
  expect(store().installExpectedHabits).toBe(0);
  expect(store().installReturnStatus).toBeNull();
  // ...and on the server, which is the copy that survives the process.
  expect(onboardingRow().status).toBe(status);
  expect(onboardingRow().install_id).toBeNull();
  expect(onboardingRow().install_expected_habits).toBeNull();
  expect(onboardingRow().install_return_status).toBeNull();
  // The failure wrote nothing, so nothing is left to clean up or duplicate.
  expect(habitRows().filter((h) => h.install_id != null)).toHaveLength(0);
  // The error is reported rather than swallowed: the user is told the install
  // failed, which is the difference between a retry and a silent no-op.
  expect(store().installError).toBeTruthy();
}

// ---------------------------------------------------------------------------
describe('CASE A — first run: pending survives a failed install', () => {
  it('returns to pending, which is where this account genuinely was', async () => {
    seedSettled('pending');
    await store().hydrate();
    expect(store().status).toBe('pending');

    store().generatePlan();
    mockDb.failTable = { table: 'habits', error: 'network request failed' };
    expect(await store().installPlan()).toBe(false);
    mockDb.failTable = null;

    expectRolledBackTo('pending');
    // Still owed a first run — the fix must not overshoot and promote them.
    expect(resolveOnboardingRouting(routing('pending', { inOnboarding: true })))
      .toEqual({ kind: 'stay' });
  });

  it('the plan is kept so the retry is one tap, not the whole flow again', async () => {
    seedSettled('pending');
    await store().hydrate();
    store().generatePlan();
    const planned = store().plan!.habits.length;

    mockDb.failTable = { table: 'habits', error: 'network request failed' };
    expect(await store().installPlan()).toBe(false);
    mockDb.failTable = null;

    expect(store().plan!.habits).toHaveLength(planned);
    expect(await store().installPlan()).toBe(true);
    expect(store().status).toBe('completed');
    expect(habitRows().filter((h) => h.install_id != null)).toHaveLength(planned);
  });
});

// ---------------------------------------------------------------------------
describe('CASE B — a completed user personalizes and the insert fails', () => {
  it('returns to completed, not to first-run pending', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();
    expect(store().status).toBe('completed');

    await personalizeAndFailTheInsert();

    expectRolledBackTo('completed');
    // The eight habits they already had are untouched by any of this.
    expect(habitRows()).toHaveLength(8);
  });

  it('a restart routes them to Today, never into mandatory onboarding', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();
    await personalizeAndFailTheInsert();

    // A cold start: a new process with no memory of any of the above. The
    // only thing carried across is the row the rollback wrote.
    store().resetForAccount();
    expect(store().status).toBe('unknown');
    await store().hydrate();

    expect(store().status).toBe('completed');
    // Standing in the onboarding group after a restart, they are sent OUT.
    expect(resolveOnboardingRouting(routing('completed', { inOnboarding: true })))
      .toEqual({ kind: 'redirect', to: '/tabs/today' });
    // And nothing pulls them back in from anywhere else.
    expect(resolveOnboardingRouting(routing('completed', { inOnboarding: false })))
      .toEqual({ kind: 'stay' });

    // What the defect did instead, from the identical restart: the router
    // read `pending` and made onboarding mandatory again.
    expect(resolveOnboardingRouting(routing('pending', { inOnboarding: false })))
      .toEqual({ kind: 'redirect', to: '/onboarding/needs' });
  });
});

// ---------------------------------------------------------------------------
describe('CASE C — a legacy user personalizes and the insert fails', () => {
  it('returns to legacy: they predate onboarding and still do', async () => {
    seedSettled('legacy');
    seedExistingHabits(5);
    await store().hydrate();
    expect(store().status).toBe('legacy');

    await personalizeAndFailTheInsert();

    expectRolledBackTo('legacy');
    expect(habitRows()).toHaveLength(5);
  });

  it('a restart still keeps them out of the first-run flow', async () => {
    seedSettled('legacy');
    await store().hydrate();
    await personalizeAndFailTheInsert();

    store().resetForAccount();
    await store().hydrate();
    expect(store().status).toBe('legacy');
    expect(resolveOnboardingRouting(routing('legacy', { inOnboarding: true })))
      .toEqual({ kind: 'redirect', to: '/tabs/today' });
  });
});

// ---------------------------------------------------------------------------
describe('CASE D — a skipped user personalizes and the insert fails', () => {
  it('returns to skipped: they said no, and a failure is not a retraction', async () => {
    seedSettled('skipped');
    await store().hydrate();
    expect(store().status).toBe('skipped');

    await personalizeAndFailTheInsert();

    expectRolledBackTo('skipped');
  });

  it('a restart still keeps them out of the first-run flow', async () => {
    seedSettled('skipped');
    await store().hydrate();
    await personalizeAndFailTheInsert();

    store().resetForAccount();
    await store().hydrate();
    expect(store().status).toBe('skipped');
    expect(resolveOnboardingRouting(routing('skipped', { inOnboarding: true })))
      .toEqual({ kind: 'redirect', to: '/tabs/today' });
  });
});

// ---------------------------------------------------------------------------
describe('CASE E — a completed user personalizes and it works', () => {
  it('ends at completed and the new habits exist exactly once', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();

    store().beginPersonalization();
    store().generatePlan();
    const planned = store().plan!.habits.length;
    expect(await store().installPlan()).toBe(true);

    expect(store().status).toBe('completed');
    expect(onboardingRow().status).toBe('completed');
    // The install is over, so there is nowhere to return to. Leaving this set
    // would arm the NEXT failure with an answer from this install.
    expect(onboardingRow().install_return_status).toBeNull();

    const installed = habitRows().filter((h) => h.install_id != null);
    expect(installed).toHaveLength(planned);
    // Exactly once: one row per planned habit, one id for the whole batch.
    expect(new Set(installed.map((h) => h.name)).size).toBe(planned);
    expect(new Set(installed.map((h) => h.install_id)).size).toBe(1);
    expect(habitRows()).toHaveLength(8 + planned);
    // A second call cannot insert them again.
    expect(await store().installPlan()).toBe(false);
    expect(habitRows()).toHaveLength(8 + planned);
  });

  it('a first-run user also ends at completed — the fix is not a passthrough', async () => {
    seedSettled('pending');
    await store().hydrate();
    store().generatePlan();
    expect(await store().installPlan()).toBe(true);
    expect(store().status).toBe('completed');
    expect(onboardingRow().status).toBe('completed');
    expect(onboardingRow().install_return_status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('CASE F — the process dies holding the claim', () => {
  /**
   * The state a crash leaves is captured from the database at the instant the
   * insert is refused, not hand-written. A seeded row would only prove that
   * the recovery reads what the test wrote; this proves the claim itself
   * carries the displaced status.
   */
  async function crashHoldingTheClaim(): Promise<MockRow> {
    let atCrash: MockRow | undefined;
    store().beginPersonalization();
    store().generatePlan();
    mockDb.failTable = {
      table: 'habits',
      error: 'process died',
      onAttempt: () => { atCrash = { ...onboardingRow() }; },
    };
    await store().installPlan();
    mockDb.failTable = null;
    expect(atCrash).toBeDefined();
    return atCrash as MockRow;
  }

  it('the claim on the server already carries the status it displaced', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();
    store().beginPersonalization();
    store().generatePlan();
    const planned = store().plan!.habits.length;

    const atCrash = await crashHoldingTheClaim();

    expect(atCrash.status).toBe('installing');
    expect(atCrash.install_id).toBeTruthy();
    expect(atCrash.install_expected_habits).toBe(planned);
    // The load-bearing field: written WITH the claim, before any habit
    // existed, so no later process has to have been there to know it.
    expect(atCrash.install_return_status).toBe('completed');
  });

  it('a new process recovers it from the row, with no client memory', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();
    const atCrash = await crashHoldingTheClaim();

    // The dead process never got to roll back: the row is left exactly as the
    // crash found it.
    mockDb.rows.user_onboarding = [atCrash];
    store().resetForAccount();
    expect(store().installReturnStatus).toBeNull();   // nothing is remembered
    expect(store().status).toBe('unknown');

    await store().hydrate();
    expect(store().status).toBe('installing');
    // Zero rows carry the claimed id, so the insert provably never landed and
    // a full retry is safe — the 021_onboarding_install_identity semantics,
    // unchanged.
    expect(store().installedHabitCount).toBe(0);
    expect(store().installPhase).toBe('idle');
    // Recovered from the SERVER.
    expect(store().installReturnStatus).toBe('completed');
  });

  it('the retry can fail again without losing where the user belongs', async () => {
    seedSettled('completed');
    seedExistingHabits(8);
    await store().hydrate();
    const atCrash = await crashHoldingTheClaim();
    mockDb.rows.user_onboarding = [atCrash];
    store().resetForAccount();
    await store().hydrate();

    // A second attempt, in the new process, that also fails. The status it
    // must return to is `completed` — NOT `installing`, which is the value
    // the second claim is displacing and is not a place to return to.
    store().generatePlan();
    mockDb.failTable = { table: 'habits', error: 'network request failed' };
    expect(await store().installPlan()).toBe(false);
    mockDb.failTable = null;

    expectRolledBackTo('completed');
  });

  it('the retry can also succeed, ending at completed', async () => {
    seedSettled('legacy');
    await store().hydrate();
    const atCrash = await crashHoldingTheClaim();
    mockDb.rows.user_onboarding = [atCrash];
    expect(atCrash.install_return_status).toBe('legacy');

    store().resetForAccount();
    await store().hydrate();
    store().generatePlan();
    const planned = store().plan!.habits.length;
    expect(await store().installPlan()).toBe(true);

    expect(store().status).toBe('completed');
    expect(onboardingRow().install_return_status).toBeNull();
    expect(habitRows().filter((h) => h.install_id != null)).toHaveLength(planned);
  });
});

// ---------------------------------------------------------------------------
describe('resolveReturnStatus — the two inputs with no screen', () => {
  it('a settled status is its own destination', () => {
    expect(resolveReturnStatus('pending', null)).toBe('pending');
    expect(resolveReturnStatus('completed', null)).toBe('completed');
    expect(resolveReturnStatus('legacy', null)).toBe('legacy');
    expect(resolveReturnStatus('skipped', null)).toBe('skipped');
  });

  it('a claim already in flight defers to what that claim recorded', () => {
    expect(resolveReturnStatus('installing', 'completed')).toBe('completed');
    expect(resolveReturnStatus('installing', 'legacy')).toBe('legacy');
    // `installing` is never returned: it is the value being displaced, so
    // recovering into it would leave the user in the state the rollback
    // exists to get them out of.
    expect(resolveReturnStatus('installing', 'skipped')).not.toBe('installing');
  });

  it('a claim written before the column existed falls back to pending', () => {
    // The old rows: `installing` with no recorded return status. `pending` is
    // exactly what the previous code always did, so nothing regresses.
    expect(resolveReturnStatus('installing', null)).toBe('pending');
  });

  it('an unread row cannot promote anybody', () => {
    // `unknown` means hydration has not answered yet. Guessing `completed`
    // here would mark an account finished on the strength of a failure.
    expect(resolveReturnStatus('unknown', null)).toBe('pending');
  });
});

