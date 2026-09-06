/**
 * An install is recognised by its own identity, never by how many habits the
 * account has.
 *
 * ## The defect this replaces
 *
 * Recovery asked `habits.length > 0` and read a non-zero answer as "the
 * install landed". That is true for a first-run user, whose account starts
 * empty, and wrong for the case the product actually has: an existing user
 * reopening onboarding from Settings → Kişiselleştirme.
 *
 *     8 habits already exist
 *     personalization opens, a plan is generated
 *     status = 'installing' is persisted
 *     the process dies BEFORE the new habits are inserted
 *     on restart the 8 OLD habits are counted as evidence
 *     completion is written — for a plan that was never installed
 *
 * The user is then marked finished, cannot re-enter the flow, and never
 * received the plan they asked for. Nothing throws; nothing is logged.
 *
 * `habits.install_id` is the fix. Every row an onboarding install produces
 * carries the id of that install, and every other habit in the app — manual,
 * Routine Pack, AI — carries null. Recovery counts rows matching THIS user
 * AND THIS install and compares against the expected count stored with the
 * claim, so all three outcomes are distinguishable and none is inferred.
 *
 * CASE 1  first run, crash before insert          -> full retry is safe
 * CASE 2  first run, insert landed, completion failed -> completion only
 * CASE 3  EXISTING USER, crash before insert      -> old habits are not evidence
 * CASE 4  existing user, insert landed            -> exactly those rows found
 * CASE 5  unrelated habits created meanwhile      -> classification unchanged
 */
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

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

import { useOnboardingStore } from '../../store/onboardingStore';
import { useHabitStore } from '../../store/habitStore';
import { newInstallId, type OnboardingAnswers } from '../../lib/onboarding';
import { installProposal } from '../../services/routineService';

const ANSWERS: OnboardingAnswers = {
  goals: ['sleep'],
  primaryBarrier: 'consistency',
  pace: 'balanced',
  preferredDayparts: ['bedtime'],
  reminderIntent: null,
};

/** Habits the user already had — nothing to do with onboarding. */
function seedUnrelatedHabits(count: number, userId = 'u1') {
  mockDb.rows.habits ??= [];
  for (let i = 0; i < count; i++) {
    mockDb.rows.habits.push({
      id: `old-${userId}-${i}`,
      user_id: userId,
      name: `Eski alışkanlık ${i}`,
      status: 'active',
      // The whole point: everything that did not come from an onboarding
      // install carries null here.
      install_id: null,
    } as never);
  }
}

/** Rows an onboarding install produced. */
function seedInstallHabits(installId: string, count: number) {
  mockDb.rows.habits ??= [];
  for (let i = 0; i < count; i++) {
    mockDb.rows.habits.push({
      id: `new-${i}`, user_id: 'u1', name: `Plan alışkanlığı ${i}`,
      status: 'active', install_id: installId,
    } as never);
  }
}

function seedClaim(opts: { installId: string | null; expected: number | null }) {
  mockDb.rows.user_onboarding = [{
    id: 'r1', user_id: 'u1', onboarding_version: 1, goals: ['sleep'],
    primary_barrier: 'consistency', pace: 'balanced', preferred_dayparts: ['bedtime'],
    reminder_intent: null, status: 'installing', completed_at: null,
    install_id: opts.installId, install_expected_habits: opts.expected,
    created_at: 'now', updated_at: 'now',
  } as never];
}

function reset() {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockDb.failNextRead = null;
  mockSession.userId = 'u1';
  useHabitStore.setState({ habits: [] });
  useOnboardingStore.getState().resetForAccount();
  useOnboardingStore.setState({ answers: ANSWERS });
}

beforeEach(reset);

const habitRows = () => mockDb.rows.habits ?? [];
const onboardingRow = () => (mockDb.rows.user_onboarding ?? [])[0];

// ---------------------------------------------------------------------------
describe('the identity is on the rows, and only on the right ones', () => {
  it('an onboarding install stamps every row it creates', async () => {
    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);

    const stamped = habitRows().filter((h) => h.install_id != null);
    expect(stamped).toHaveLength(planned);
    // One id for the whole batch, and it is the one on the claim.
    expect(new Set(stamped.map((h) => h.install_id)).size).toBe(1);
    expect(onboardingRow().install_id).toBe(stamped[0].install_id);
    expect(onboardingRow().install_expected_habits).toBe(planned);
  });

  it('a Routine Pack / AI install leaves install_id null', async () => {
    const res = await installProposal(
      [{ name: 'AI alışkanlığı', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }],
      ['AI alışkanlığı'],
      // no install id — the signature default
    );
    expect(res.ok).toBe(true);
    expect(habitRows()[0].install_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('CASE 1 — first run, crash before the insert', () => {
  it('0 old habits, claim written, nothing inserted -> full retry is safe', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    // No habits at all: the process died between the claim and the insert.

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('installing');
    expect(s.installedHabitCount).toBe(0);
    expect(s.installPhase).toBe('idle');      // not recovery — a clean re-run

    useOnboardingStore.getState().generatePlan();
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);
    expect(habitRows().length).toBeGreaterThan(0);
    expect(useOnboardingStore.getState().status).toBe('completed');
  });
});

describe('CASE 2 — first run, insert landed, completion failed', () => {
  it('only the completion retries, and nothing duplicates', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedInstallHabits(id, 3);

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.installedHabitCount).toBe(3);
    expect(s.installPhase).toBe('awaiting_completion');

    const before = mockDb.inserts.filter((i) => i.table === 'habits').length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);

    expect(mockDb.inserts.filter((i) => i.table === 'habits').length).toBe(before);
    expect(habitRows()).toHaveLength(3);
    expect(useOnboardingStore.getState().status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
describe('CASE 3 — existing user personalization, crash before insert', () => {
  it('eight pre-existing habits are NOT evidence that the install landed', async () => {
    // The exact reported failure. Under the old rule this account reported
    // `awaiting_completion` and was marked finished without ever receiving
    // the personalized plan.
    seedUnrelatedHabits(8);
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();

    // Counted by install id: none of the eight carries one.
    expect(s.installedHabitCount).toBe(0);
    expect(s.installPhase).toBe('idle');
    expect(s.installPhase).not.toBe('awaiting_completion');
    expect(s.status).toBe('installing');       // still owed a resolution
  });

  it('the new plan is not falsely marked completed', async () => {
    seedUnrelatedHabits(8);
    seedClaim({ installId: newInstallId(), expected: 3 });
    await useOnboardingStore.getState().hydrate();

    // Whatever happens next, the flow is not finished and the eight old
    // habits are untouched.
    expect(useOnboardingStore.getState().status).not.toBe('completed');
    expect(onboardingRow().status).toBe('installing');
    expect(habitRows()).toHaveLength(8);
  });

  it('re-running the install adds the plan on top, leaving the eight alone', async () => {
    seedUnrelatedHabits(8);
    seedClaim({ installId: newInstallId(), expected: 3 });
    await useOnboardingStore.getState().hydrate();

    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);

    expect(habitRows()).toHaveLength(8 + planned);
    expect(habitRows().filter((h) => h.install_id == null)).toHaveLength(8);
    expect(useOnboardingStore.getState().status).toBe('completed');
  });
});

describe('CASE 4 — existing user personalization, insert landed', () => {
  it('exactly the three new rows are detected, and the total stays 11', async () => {
    seedUnrelatedHabits(8);
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedInstallHabits(id, 3);

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.installedHabitCount).toBe(3);           // not 11
    expect(s.installExpectedHabits).toBe(3);
    expect(s.installPhase).toBe('awaiting_completion');

    const before = mockDb.inserts.filter((i) => i.table === 'habits').length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(true);

    expect(mockDb.inserts.filter((i) => i.table === 'habits').length).toBe(before);
    expect(habitRows()).toHaveLength(11);
    expect(useOnboardingStore.getState().status).toBe('completed');
  });
});

describe('CASE 5 — unrelated habits appearing while an install is pending', () => {
  it('habits created meanwhile do not change the classification', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedUnrelatedHabits(4);            // created by hand while the flow was open

    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().installedHabitCount).toBe(0);
    expect(useOnboardingStore.getState().installPhase).toBe('idle');

    // Now the install's own rows arrive.
    seedInstallHabits(id, 3);
    // ...and two more unrelated ones.
    seedUnrelatedHabits(2);

    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().installedHabitCount).toBe(3);
    expect(useOnboardingStore.getState().installPhase).toBe('awaiting_completion');
  });

  it('another account\'s install rows are never counted', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    // Same install id, different owner. Only the owner filter separates them.
    mockDb.rows.habits = [
      { id: 'x1', user_id: 'u2', name: 'a', status: 'active', install_id: id } as never,
      { id: 'x2', user_id: 'u2', name: 'b', status: 'active', install_id: id } as never,
      { id: 'x3', user_id: 'u2', name: 'c', status: 'active', install_id: id } as never,
    ];

    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().installedHabitCount).toBe(0);
    expect(useOnboardingStore.getState().installPhase).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
describe('states that cannot be resolved are explicit, not guessed', () => {
  it('a partial insert is reported as partial', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedInstallHabits(id, 2);          // one row short

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.installPhase).toBe('partial');
    expect(s.installedHabitCount).toBe(2);
    expect(s.installExpectedHabits).toBe(3);
  });

  it('installPlan refuses to act on a partial install', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedInstallHabits(id, 2);
    await useOnboardingStore.getState().hydrate();

    useOnboardingStore.getState().generatePlan();
    const before = habitRows().length;
    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    // Re-running would write the whole plan on top of the part that landed.
    expect(habitRows()).toHaveLength(before);
    expect(useOnboardingStore.getState().installError).toBeTruthy();
  });

  it('a claim with no identity is not resolved by counting anything', async () => {
    // A row from an older build. There is no id to ask about, so guessing
    // from the account is exactly what must not happen.
    seedUnrelatedHabits(8);
    seedClaim({ installId: null, expected: 3 });

    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.installPhase).toBe('partial');
    expect(s.installPhase).not.toBe('awaiting_completion');
    expect(s.installedHabitCount).toBe(0);
  });

  it('a failed count takes the hydration gate rather than a guess', async () => {
    const id = newInstallId();
    seedClaim({ installId: id, expected: 3 });
    seedInstallHabits(id, 3);

    // Fail the habits READ specifically. The onboarding row is read first
    // and must succeed, so the failure is armed on the second read.
    const original = mockClient.from;
    let reads = 0;
    (mockClient as { from: typeof original }).from = (table: string) => {
      reads += 1;
      if (reads === 2) mockDb.failNextRead = { error: 'sayım okunamadı' };
      return original(table);
    };
    await useOnboardingStore.getState().hydrate();
    (mockClient as { from: typeof original }).from = original;
    mockDb.failNextRead = null;

    const s = useOnboardingStore.getState();
    expect(s.hydrationState).toBe('error');
    expect(s.loadError).toBeTruthy();
    expect(s.status).not.toBe('completed');
  });
});
