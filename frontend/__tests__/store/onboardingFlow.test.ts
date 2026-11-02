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
  useOnboardingStore.getState().resetForAccount();
  useOnboardingStore.setState({ answers: ANSWERS });
}

beforeEach(resetAll);

// ---------------------------------------------------------------------------
describe('AC-OF01 hydration', () => {
  it('no row means a new user', async () => {
    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    expect(s.hydrationState).toBe('ready');
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

  it('a failed read is its own state, not a hydrated one', async () => {
    mockSession.userId = null;   // no session -> the repository errors
    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    // NOT 'ready'. The old code set a `hydrated` boolean true here, the
    // router stopped waiting, and a new user reached Today because
    // `needsOnboarding('unknown')` is false. `error` is what stops that, and
    // `onboardingRecovery.test.ts` asserts the routing consequence.
    expect(s.hydrationState).toBe('error');
    expect(s.loadError).toBeTruthy();
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
    // An interrupted install still owes the user a resolution; sending them
    // to Today would leave it half-finished forever.
    ['installing', true],
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

    // Armed on the `habits` table specifically. A bare `failNext` would now
    // hit the FIRST write, which is the durable claim, and this test would
    // quietly become a test of a different failure.
    const original = mockClient.from;
    (mockClient as { from: typeof original }).from = (table: string) => {
      if (table === 'habits') mockDb.failNext = { error: 'insert reddedildi' };
      return original(table);
    };

    expect(await useOnboardingStore.getState().installPlan()).toBe(false);
    (mockClient as { from: typeof original }).from = original;

    const s = useOnboardingStore.getState();
    expect(s.installError).toBe('insert reddedildi');
    expect(mockDb.rows.habits ?? []).toEqual([]);
    // Not completed: the user must be able to reach the plan again.
    expect(s.status).not.toBe('completed');
    // The durable claim written before the insert is retracted, so the next
    // launch does not put them in install recovery for habits that were
    // never written.
    expect(mockDb.rows.user_onboarding[0].status).toBe('pending');
    expect(s.installPhase).toBe('idle');
  });

  it('habits written but the completion write failing is reported as a failure', async () => {
    useOnboardingStore.getState().generatePlan();
    const planned = useOnboardingStore.getState().plan!.habits.length;

    // Three writes now, in order: the durable claim (user_onboarding), the
    // habits, then the completion (user_onboarding again). Counting visits to
    // `user_onboarding` targets the completion specifically — a bare "second
    // write" counter would hit the habits insert instead, which is the wrong
    // failure and would prove nothing about this case.
    const original = mockClient.from;
    let onboardingWrites = 0;
    (mockClient as { from: typeof original }).from = (table: string) => {
      if (table === 'user_onboarding') {
        onboardingWrites += 1;
        if (onboardingWrites === 2) mockDb.failNext = { error: 'durum kaydedilemedi' };
      }
      return original(table);
    };

    const ok = await useOnboardingStore.getState().installPlan();
    (mockClient as { from: typeof original }).from = original;

    expect(ok).toBe(false);
    expect(mockDb.rows.habits).toHaveLength(planned);
    // The habits exist, the flow is honest about not having finished, and it
    // is now in the state that knows a retry must not insert again. The full
    // retry sequence is `onboardingRecovery.test.ts` AC-R01.
    expect(useOnboardingStore.getState().status).not.toBe('completed');
    expect(useOnboardingStore.getState().installPhase).toBe('awaiting_completion');
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

  it('routing is delegated to the pure decision, not re-implemented here', () => {
    // The behavioural coverage lives in `onboardingRecovery.test.ts`, against
    // `resolveOnboardingRouting` directly. What matters here is that the
    // layout OBEYS it rather than keeping a second copy of the rules.
    expect(layout).toContain('resolveOnboardingRouting({');
    expect(layout).toContain("if (decision.kind === 'redirect') router.replace(decision.to);");
  });

  it('nothing renders until the onboarding row is known', () => {
    // Without this the new user sees Today for one frame and is then yanked.
    expect(layout).toMatch(/if \(loading \|\| \(!!session && onboardingHydration !== 'ready'\)\)/);
  });

  it('a failed read renders a retry gate rather than falling through', () => {
    expect(layout).toContain("onboardingHydration === 'error'");
    expect(layout).toContain('<OnboardingGate');
  });

  it('password recovery is still exempt from the signed-in bounce', () => {
    expect(layout).toContain('inPasswordRecovery');
    expect(layout).toContain("segmentPath[1] === 'forgot-password'");
    expect(layout).toContain("segmentPath[1] === 'reset-password'");
  });

  it('signing out clears every account-scoped value', () => {
    // Otherwise account B is routed by account A's answer — and sees A's
    // error, and can open A's plan.
    expect(layout).toContain('useOnboardingStore.getState().resetForAccount()');
  });

  it('F06 (SYN-02): the boot decides the session through resolveBootSession, with the stored session as the offline fallback', () => {
    expect(layout).toContain('resolveBootSession(');
    expect(layout).toContain('readStored: readStoredSession');
  });

  it('F06 (SYN-02): a null INITIAL_SESSION does not sign the user out; only SIGNED_OUT does', () => {
    expect(layout).toMatch(/if \(!session && event !== 'SIGNED_OUT'\) return;/);
    // ... and it is the first thing the auth handler does, before setSession
    const handler = layout.slice(layout.indexOf('onAuthStateChange('));
    expect(handler.indexOf("event !== 'SIGNED_OUT'")).toBeLessThan(handler.indexOf('setSession('));
  });

  it('F06 (NAV-04): the boot cannot hang the app: try/finally opens the gate, a 12 s watchdog offers "Tekrar dene"', () => {
    expect(layout).toMatch(/setTimeout\(\(\) => \{ if \(alive\) setBootStalled\(true\); \}, BOOT_WATCHDOG_MS\)/);
    expect(layout).toMatch(/finally \{\s*clearTimeout\(watchdog\);\s*if \(alive\) \{ setBootStalled\(false\); setLoading\(false\); \}/);
    expect(layout).toContain('Promise.allSettled([hydrateNotionSession(), hydrateSyncQueue()])');
    expect(layout).toContain('bootAttempt]);'); // "Tekrar dene" restarts the boot effect
  });

  it('F06: the render order is config -> stalled boot -> onboarding gate (with its escape) -> spinner', () => {
    const config = layout.indexOf('if (SUPABASE_CONFIG_ERROR) return <BootGate variant="config"');
    const stalled = layout.indexOf('if (loading && bootStalled) return <BootGate variant="stalled"');
    const gate = layout.indexOf('<OnboardingGate');
    const spinner = layout.search(/if \(loading \|\| \(!!session && onboardingHydration !== 'ready'\)\)/);
    expect([config, stalled, gate, spinner].every((i) => i > -1)).toBe(true);
    expect(config).toBeLessThan(stalled);
    expect(stalled).toBeLessThan(gate);
    expect(gate).toBeLessThan(spinner);
    const gateJsx = layout.slice(gate, layout.indexOf('/>', gate));
    expect(gateJsx).toMatch(/onSignOut=\{/);
    expect(gateJsx).toContain('signOutCurrentAccount()');
    expect(gateJsx).toContain('signingOut={signingOut}');
  });

  it('F06 (STO-04): onboarding, reminders and routing follow the user id, not the Session object', () => {
    expect(layout).toContain('}, [sessionUid, loading, hydrateOnboarding]);');
    expect(layout).toContain('}, [loading, sessionUid, router]);');
    expect(layout).toMatch(/\}, \[hasSupabaseSession, notionSession, loading,/);
    expect(layout).not.toMatch(/\}, \[session, loading, hydrateOnboarding\]\);/);
  });

  it('F06 (NAV-04, SYN-23): a stale status is re-read in the foreground; the refresh ticker follows AppState (native)', () => {
    expect(layout).toMatch(/if \(next === 'active'\) \{[\s\S]*?if \(useOnboardingStore\.getState\(\)\.staleStatus\) void hydrateOnboarding\(\);/);
    expect(layout).toMatch(/if \(Platform\.OS === 'web'\) return;\s*return bindAuthAutoRefresh\(supabase, AppState, \(\) => \{ void flushPendingAuthStorage\(\); \}\);/);
  });
});
