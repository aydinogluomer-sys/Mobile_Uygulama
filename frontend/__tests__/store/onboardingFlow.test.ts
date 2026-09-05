/**
 * The onboarding flow: what is written, when, and what is never claimed.
 *
 * ## The three claims worth a test
 *
 *  1. Completion follows persistence. Marking the flow finished before the
 *     habits exist would strand the user: the redirect stops sending them to
 *     onboarding, and the plan they never received is unreachable.
 *  2. A second tap installs nothing extra. The install is a bulk insert with
 *     no natural key, so a duplicate is not caught by the database — the
 *     guard is the only thing between an impatient user and two of every
 *     habit.
 *  3. The OS notification prompt appears only after an explicit yes. On iOS a
 *     denial is close to permanent, so spending the one prompt on a screen
 *     the user has not answered is not a bug that can be fixed later.
 *
 * AC-OF01  hydration maps the row (and its absence) to a status
 * AC-OF02  only `pending` routes into onboarding
 * AC-OF03  install writes habits and then marks completion
 * AC-OF04  a double tap installs one set
 * AC-OF05  a failed insert leaves the flow unfinished
 * AC-OF06  habits written but status unsaved is reported, not hidden
 * AC-OF07  the permission prompt follows consent, and denial is not "enabled"
 * AC-OF08  the router's own rules, read from `app/_layout.tsx`
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';
import { stripComments } from '../helpers/sourceText';

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

const mockEnsurePermission = jest.fn(async () => true);
jest.mock('../../lib/notifications', () => ({
  ensurePermission: () => mockEnsurePermission(),
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  syncAllReminders: jest.fn(),
}));

import { needsOnboarding, useOnboardingStore } from '../../store/onboardingStore';
import { useHabitStore } from '../../store/habitStore';
import type { OnboardingAnswers } from '../../lib/onboarding';

const ANSWERS: OnboardingAnswers = {
  goals: ['sleep'],
  primaryBarrier: 'consistency',
  pace: 'balanced',
  preferredDayparts: ['bedtime'],
  reminderIntent: null,
};

function resetAll() {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockSession.userId = 'u1';
  mockEnsurePermission.mockReset();
  mockEnsurePermission.mockResolvedValue(true);
  useHabitStore.setState({ habits: [] });
  useOnboardingStore.setState({
    hydrated: false, loading: false, loadError: null, status: 'unknown',
    answers: ANSWERS, plan: null, planReasons: [],
    saving: false, saveError: null, installing: false, installError: null,
    permission: 'unknown', personalizing: false,
  });
}

beforeEach(resetAll);

// ---------------------------------------------------------------------------
describe('AC-OF01 hydration', () => {
  it('no row means a new user', async () => {
    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.status).toBe('pending');
  });

  it('a legacy row keeps an existing user out of the flow', async () => {
    mockDb.rows.user_onboarding = [{
      id: 'r1', user_id: 'u1', onboarding_version: 1, goals: [], primary_barrier: null,
      pace: null, preferred_dayparts: [], reminder_intent: null,
      status: 'legacy', completed_at: null, created_at: 'now', updated_at: 'now',
    } as never];

    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().status).toBe('legacy');
    expect(needsOnboarding(useOnboardingStore.getState().status)).toBe(false);
  });

  it('a failed read is hydrated-with-an-error, never a guessed status', async () => {
    mockSession.userId = null;   // no session -> the repository errors
    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.loadError).toBeTruthy();
    // Still 'unknown': routing on a guess is what this avoids.
    expect(s.status).toBe('unknown');
    expect(needsOnboarding(s.status)).toBe(false);
  });

  it('answers come back from the row', async () => {
    mockDb.rows.user_onboarding = [{
      id: 'r1', user_id: 'u1', onboarding_version: 1,
      goals: ['finance'], primary_barrier: 'motivation', pace: 'intensive',
      preferred_dayparts: ['morning'], reminder_intent: true,
      status: 'completed', completed_at: 'then', created_at: 'now', updated_at: 'now',
    } as never];

    await useOnboardingStore.getState().hydrate();
    expect(useOnboardingStore.getState().answers).toEqual({
      goals: ['finance'], primaryBarrier: 'motivation', pace: 'intensive',
      preferredDayparts: ['morning'], reminderIntent: true,
    });
  });
});

describe('AC-OF02 only pending routes into onboarding', () => {
  it.each([
    ['pending', true],
    ['completed', false],
    ['skipped', false],
    ['legacy', false],
    ['unknown', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(needsOnboarding(status)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
describe('AC-OF03 install writes habits, then completion', () => {
  it('habits land in the table and the flow is marked completed', async () => {
    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!;
    expect(planned.habits.length).toBeGreaterThan(0);

    const ok = await useOnboardingStore.getState().installPlan();
    expect(ok).toBe(true);

    expect(mockDb.rows.habits).toHaveLength(planned.habits.length);
    for (const row of mockDb.rows.habits) {
      expect(row.user_id).toBe('u1');
      // The richer fields the packs carry survive the installer rather than
      // being flattened to null the way they were before.
      expect(typeof row.icon).toBe('string');
      expect(row.frequency_config).toBeTruthy();
    }

    const state = useOnboardingStore.getState();
    expect(state.status).toBe('completed');
    expect(state.plan).toBeNull();

    const saved = mockDb.rows.user_onboarding[0];
    expect(saved.status).toBe('completed');
    expect(saved.completed_at).not.toBeNull();
  });

  it('the new habits appear in the habit store immediately', async () => {
    useOnboardingStore.getState().generatePlan();
    await useOnboardingStore.getState().installPlan();
    expect(useHabitStore.getState().habits.length).toBeGreaterThan(0);
  });

  it('an empty plan is refused rather than "installed"', async () => {
    useOnboardingStore.setState({ plan: { habits: [], totalMinutes: 0, requestedMin: 3, requestedMax: 3, currentLoad: 0, projectedLoad: 0, ceiling: 85, trimmedByCapacity: false } });
    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    expect(mockDb.rows.habits ?? []).toEqual([]);
    expect(useOnboardingStore.getState().status).not.toBe('completed');
  });
});

describe('AC-OF04 a double tap installs one set', () => {
  it('two concurrent calls produce one set of habits', async () => {
    useOnboardingStore.getState().generatePlan();
    const expected = useOnboardingStore.getState().plan!.habits.length;

    // Both dispatched before either resolves — the exact shape of an impatient
    // double tap, and the case a state flag alone does not catch.
    const [a, b] = await Promise.all([
      useOnboardingStore.getState().installPlan(),
      useOnboardingStore.getState().installPlan(),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(mockDb.rows.habits).toHaveLength(expected);
  });

  it('a retry after success does not install again', async () => {
    useOnboardingStore.getState().generatePlan();
    await useOnboardingStore.getState().installPlan();
    const after = mockDb.rows.habits.length;

    // The plan is cleared on success, so there is nothing left to install.
    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    expect(mockDb.rows.habits).toHaveLength(after);
  });
});

describe('AC-OF05/OF06 failures are reported, not absorbed', () => {
  it('a failed habit insert leaves the flow unfinished', async () => {
    useOnboardingStore.getState().generatePlan();
    mockDb.failNext = { error: 'insert reddedildi' };

    expect(await useOnboardingStore.getState().installPlan()).toBe(false);

    const s = useOnboardingStore.getState();
    expect(s.installError).toBe('insert reddedildi');
    // Not completed: the user must be able to reach the plan again.
    expect(s.status).not.toBe('completed');
    expect(mockDb.rows.user_onboarding ?? []).toEqual([]);
  });

  it('habits written but the status write failing is reported as a failure', async () => {
    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;

    // `failNext` fires once and clears, so it hits the SECOND write — the
    // status upsert, after the habits already landed.
    const original = mockClient.from;
    let writes = 0;
    (mockClient as { from: typeof original }).from = (table: string) => {
      writes += 1;
      if (writes === 2) mockDb.failNext = { error: 'durum kaydedilemedi' };
      return original(table);
    };

    const ok = await useOnboardingStore.getState().installPlan();
    (mockClient as { from: typeof original }).from = original;

    expect(ok).toBe(false);
    expect(mockDb.rows.habits).toHaveLength(planned);
    // The habits exist and the flow is honest about not having finished.
    expect(useOnboardingStore.getState().status).not.toBe('completed');
    expect(useOnboardingStore.getState().installError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('AC-OF07 the notification prompt follows consent', () => {
  it('recording the intent alone never prompts', () => {
    useOnboardingStore.getState().setReminderIntent(true);
    expect(mockEnsurePermission).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().permission).toBe('unknown');
  });

  it('saying no never prompts', async () => {
    useOnboardingStore.getState().setReminderIntent(false);
    await Promise.resolve();
    expect(mockEnsurePermission).not.toHaveBeenCalled();
  });

  it('asking explicitly prompts once and records the grant', async () => {
    await useOnboardingStore.getState().requestNotificationPermission();
    expect(mockEnsurePermission).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().permission).toBe('granted');
  });

  it('a denial is recorded as denied, never as enabled', async () => {
    mockEnsurePermission.mockResolvedValue(false);
    await useOnboardingStore.getState().requestNotificationPermission();
    expect(useOnboardingStore.getState().permission).toBe('denied');
    // The wish and the grant are separate facts and stay separate.
    useOnboardingStore.getState().setReminderIntent(true);
    expect(useOnboardingStore.getState().answers.reminderIntent).toBe(true);
    expect(useOnboardingStore.getState().permission).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
describe('AC-OF08 the router rules', () => {
  const layout = stripComments(
    readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8'),
  );

  it('the file was read', () => {
    expect(layout).toContain('RootLayout');
  });

  it('a pending user is sent to onboarding', () => {
    expect(layout).toContain('needsOnboarding(onboardingStatus)');
    expect(layout).toContain("router.replace('/onboarding/needs')");
  });

  it('nothing renders until the onboarding row is known', () => {
    // Without this the new user sees Today for one frame and is then yanked.
    expect(layout).toMatch(/if \(loading \|\| \(!!session && !onboardingHydrated\)\)/);
  });

  it('the redirect waits for hydration rather than guessing', () => {
    expect(layout).toContain('if (session && !onboardingHydrated) return;');
  });

  it('password recovery is still exempt from the signed-in bounce', () => {
    expect(layout).toContain('inPasswordRecovery');
    expect(layout).toContain("segmentPath[1] === 'forgot-password'");
    expect(layout).toContain("segmentPath[1] === 'reset-password'");
  });

  it('a finished user standing in onboarding is sent on — unless they meant it', () => {
    expect(layout).toContain('inOnboarding && !personalizing');
  });

  it('signing out clears the cached status', () => {
    // Otherwise account B is routed by account A's answer.
    expect(layout).toContain("useOnboardingStore.setState({ hydrated: false, status: 'unknown' })");
  });
});
