import { create } from 'zustand';
import { Platform } from 'react-native';
import {
  EMPTY_ANSWERS,
  SKIP_DEFAULT_ANSWERS,
  explainPlan,
  normaliseAnswers,
  toggleDaypart as toggleDaypartPure,
  toggleGoal as toggleGoalPure,
  type BarrierId,
  type DaypartId,
  type GoalId,
  type OnboardingAnswers,
  type OnboardingStatus,
  type PaceId,
} from '../lib/onboarding';
import { buildStarterPlan, type StarterPlan } from '../lib/starterPlan';
import { fetchOnboarding, writeOnboarding } from '../repositories/onboardingRepository';
import { installProposal } from '../services/routineService';
import { evaluateProposal, validateRoutineProposal } from '../lib/routineProposal';
import { ensurePermission } from '../lib/notifications';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { useHabitStore } from './habitStore';
import type { HabitLoadInput } from '../lib/capacity';

/**
 * First-run onboarding state.
 *
 * ## Where the truth lives
 *
 * On the server, in `user_onboarding`. Not in AsyncStorage: a device-local
 * flag would re-ask a user who reinstalled, and would ask again on their
 * second device — and it would let a signed-out/signed-in pair lose an
 * answer the user already gave. `status` here is a cache of the row, and
 * `hydrate()` is the only thing that fills it.
 *
 * ## "unknown" is not "pending"
 *
 * Before the first successful read, `status` is `'unknown'`, and the router
 * shows nothing rather than guessing. Treating unknown as pending would flash
 * onboarding at an existing user on every cold start; treating it as complete
 * would flash Today at a new one. Neither is a redirect the user asked for.
 */
export type NotificationPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

type OnboardingStore = {
  /** True once a server read has resolved, successfully or not. */
  hydrated: boolean;
  loading: boolean;
  loadError: string | null;
  status: OnboardingStatus | 'unknown';
  answers: OnboardingAnswers;

  plan: StarterPlan | null;
  planReasons: string[];

  saving: boolean;
  saveError: string | null;
  installing: boolean;
  installError: string | null;

  permission: NotificationPermission;

  /**
   * True while the user is in the flow ON PURPOSE from Settings rather than
   * because they are new.
   *
   * The router sends anyone whose status is not `pending` out of the
   * onboarding group — that is what stops a finished user landing back in
   * first-run. Without this flag that rule would also eject someone who
   * deliberately opened "Kişiselleştirme", i.e. the Settings entry would be a
   * button that bounces you straight back.
   */
  personalizing: boolean;
  beginPersonalization: () => void;
  endPersonalization: () => void;

  hydrate: () => Promise<void>;
  toggleGoal: (goal: GoalId) => void;
  setBarrier: (barrier: BarrierId) => void;
  setPace: (pace: PaceId) => void;
  toggleDaypart: (daypart: DaypartId) => void;
  /** Records the WISH. Only `true` may lead to an OS prompt, and only via
   *  `requestNotificationPermission`, which the screen calls explicitly. */
  setReminderIntent: (intent: boolean) => void;
  requestNotificationPermission: () => Promise<void>;

  /** Pure, local, offline-safe. Never a network call. */
  generatePlan: () => void;
  /** Fired once per entry into the flow, not once per render. */
  markStarted: () => void;
  /** Persists the answers so far without claiming the flow is finished. */
  saveProgress: (step: 'needs' | 'preferences') => Promise<boolean>;
  installPlan: () => Promise<boolean>;
  skip: () => Promise<boolean>;
  reset: () => void;
};

/**
 * §22 analytics emission seam -- the same wrapper every other store carries
 * (see `store/habitStore.ts` for the full rationale): run the payload through
 * `buildEvent`, which drops free text by shape at the call site, and never let
 * its deliberate throw escape into a user action.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

function activeHabitLoadInputs(): HabitLoadInput[] {
  return useHabitStore
    .getState()
    .habits.filter((h) => h.status === 'active')
    .map((h) => ({
      difficulty: h.difficulty,
      estimated_minutes: h.estimated_minutes,
      frequency_config: h.frequency_config,
      impact_level: h.impact_level,
    }));
}

/**
 * Re-entrancy guard for the install.
 *
 * Module scope, not store state: two taps landing in the same tick both read
 * the pre-update `installing` value, so a state flag alone does not stop the
 * second one. The same reasoning as `logStore`'s `flushInFlight` — the second
 * caller joins the in-flight promise instead of starting a second insert, so
 * a double tap produces one set of habits, not two.
 */
let installInFlight: Promise<boolean> | null = null;

/**
 * `onboarding_started` is one event per entry, not one per mount.
 *
 * The needs screen re-mounts on every back-navigation from preferences, and
 * emitting there unguarded would report a user who stepped back once as
 * having started twice -- which would quietly inflate every funnel built on
 * this event.
 */
let startedEmitted = false;

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  hydrated: false,
  loading: false,
  loadError: null,
  status: 'unknown',
  answers: EMPTY_ANSWERS,

  plan: null,
  planReasons: [],

  saving: false,
  saveError: null,
  installing: false,
  installError: null,

  permission: 'unknown',
  personalizing: false,

  markStarted: () => {
    if (startedEmitted) return;
    startedEmitted = true;
    emitAnalytics('onboarding_started', { entry: get().personalizing ? 'settings' : 'first_run' });
  },

  beginPersonalization: () => set({ personalizing: true, plan: null, planReasons: [], installError: null, saveError: null }),
  endPersonalization: () => set({ personalizing: false }),

  hydrate: async () => {
    set({ loading: true, loadError: null });
    const res = await fetchOnboarding();
    if (!res.ok) {
      // Hydrated with an error: the router must not redirect on a guess, and
      // the screen must be able to say the read failed rather than showing
      // empty selections as though they were the user's answers.
      set({ loading: false, hydrated: true, loadError: res.error });
      return;
    }
    const row = res.data;
    set({
      loading: false,
      hydrated: true,
      loadError: null,
      // No row means a new account. The legacy backfill in
      // `20260906_user_onboarding.sql` is what keeps existing users out of
      // this branch.
      status: row?.status ?? 'pending',
      answers: row ? normaliseAnswers(row) : EMPTY_ANSWERS,
    });
  },

  toggleGoal: (goal) => set((s) => ({ answers: { ...s.answers, goals: toggleGoalPure(s.answers.goals, goal) } })),
  setBarrier: (barrier) => set((s) => ({ answers: { ...s.answers, primaryBarrier: barrier } })),
  setPace: (pace) => set((s) => ({ answers: { ...s.answers, pace } })),
  toggleDaypart: (daypart) => set((s) => ({
    answers: { ...s.answers, preferredDayparts: toggleDaypartPure(s.answers.preferredDayparts, daypart) },
  })),
  setReminderIntent: (intent) => set((s) => ({ answers: { ...s.answers, reminderIntent: intent } })),

  /**
   * Asks the OS, and only when called.
   *
   * Nothing here runs because a screen rendered. The preferences screen calls
   * this from the "Evet, hatırlat" handler and nowhere else, so a user who
   * never touches that card never sees a system prompt — which is the
   * difference between asking and ambushing.
   *
   * The result is recorded separately from the intent. A user can want
   * reminders and have denied the permission; reporting that as "enabled"
   * would be the app telling them something it can see is untrue.
   */
  requestNotificationPermission: async () => {
    if (Platform.OS === 'web') {
      set({ permission: 'unsupported' });
      return;
    }
    const granted = await ensurePermission();
    set({ permission: granted ? 'granted' : 'denied' });
  },

  generatePlan: () => {
    const { answers } = get();
    // A skipped flow still gets a real plan, from the documented safe
    // defaults rather than from a second code path.
    const effective: OnboardingAnswers = answers.pace ? answers : { ...SKIP_DEFAULT_ANSWERS, ...answers, pace: answers.pace ?? SKIP_DEFAULT_ANSWERS.pace };
    const plan = buildStarterPlan(effective, { activeHabits: activeHabitLoadInputs() });
    set({
      plan,
      planReasons: explainPlan(effective, { habitCount: plan.habits.length, requestedMax: plan.requestedMax }),
    });
    emitAnalytics('onboarding_plan_generated', {
      pace: effective.pace,
      goal_count: effective.goals.length,
      barrier: effective.primaryBarrier,
      habit_count: plan.habits.length,
      trimmed_by_capacity: plan.trimmedByCapacity,
    });
  },

  saveProgress: async (step) => {
    const { answers, status } = get();
    set({ saving: true, saveError: null });
    // A partial save never advances the lifecycle: a user who closes the app
    // mid-flow is still pending, and their answers so far are already stored.
    // A returning user editing their preferences stays `completed`; only a
    // genuinely unfinished first run is written back as `pending`. Demoting
    // them would put them behind the first-run redirect on the next launch.
    const nextStatus: OnboardingStatus = status === 'completed' || status === 'legacy' || status === 'skipped'
      ? status
      : 'pending';
    const res = await writeOnboarding({ answers, status: nextStatus });
    if (!res.ok) {
      set({ saving: false, saveError: res.error });
      return false;
    }
    set({ saving: false, saveError: null, status: res.data.status });
    emitAnalytics(step === 'needs' ? 'onboarding_needs_completed' : 'onboarding_preferences_completed', {
      goal_count: answers.goals.length,
      barrier: answers.primaryBarrier,
      pace: answers.pace,
      daypart_count: answers.preferredDayparts.length,
      reminder_intent: answers.reminderIntent,
    });
    return true;
  },

  installPlan: async () => {
    if (installInFlight) return installInFlight;
    const { plan, installing } = get();
    if (!plan || installing) return false;
    if (plan.habits.length === 0) {
      set({ installError: 'Kurulacak alışkanlık yok.' });
      return false;
    }

    const run = (async (): Promise<boolean> => {
      set({ installing: true, installError: null });
      try {
        // The same two gates a routine pack goes through: the schema
        // validator, then the capacity evaluation that decides activate vs
        // queue. The plan was built under the ceiling already, so nothing is
        // expected to queue — but it goes through the gate rather than around
        // it, because "we already checked" is how the check stops being run.
        const proposal = {
          title: 'Başlangıç planın',
          goal: 'Onboarding sırasında oluşturulan kişisel başlangıç planı.',
          habits: plan.habits.map((h) => ({
            name: h.name,
            tracking_type: h.tracking_type,
            difficulty: h.difficulty,
            estimated_minutes: h.estimated_minutes,
          })),
        };
        const validation = validateRoutineProposal(proposal);
        if (!validation.ok) {
          set({ installing: false, installError: validation.errors.map((e) => e.message).join(' ') });
          return false;
        }
        const evaluation = evaluateProposal(validation.proposal, { activeHabits: activeHabitLoadInputs() });

        // The richer persistence fields the packs carry -- icon, unit, target,
        // and the daypart written into `frequency_config.part_of_day` -- ride
        // along here. `buildInstallRows` treats them as optional, so an AI
        // proposal without them is unaffected.
        const result = await installProposal(
          plan.habits.map((h) => ({
            name: h.name,
            tracking_type: h.tracking_type,
            difficulty: h.difficulty,
            estimated_minutes: h.estimated_minutes,
            icon: h.icon,
            unit: h.unit,
            daily_goal: h.daily_goal,
            target_direction: h.target_direction,
            frequency_config: h.frequency_config,
          })),
          evaluation.toActivate,
        );
        if (!result.ok) {
          // Onboarding stays PENDING. Marking it complete here would lose the
          // user's answers behind a flow they can no longer reach, for a plan
          // that was never written.
          set({ installing: false, installError: result.error });
          return false;
        }

        useHabitStore.setState((s) => ({ habits: [...result.habits, ...s.habits] }));

        // Completion is recorded only after the habits are really there.
        const saved = await writeOnboarding({ answers: get().answers, status: 'completed' });
        if (!saved.ok) {
          // The habits exist. Saying "not finished" is the honest report, and
          // it is also recoverable: a retry re-runs `writeOnboarding`, and the
          // guard below stops the habits being installed a second time.
          set({ installing: false, installError: saved.error, plan: { ...plan, habits: [] } });
          return false;
        }

        set({ installing: false, installError: null, status: 'completed', plan: null, planReasons: [], personalizing: false });
        emitAnalytics('onboarding_plan_installed', {
          habit_count: result.habits.length,
          activated_count: result.habits.filter((h) => h.status === 'active').length,
          queued_count: result.habits.filter((h) => h.status === 'waiting').length,
        });
        return true;
      } catch (err) {
        set({ installing: false, installError: err instanceof Error ? err.message : 'Kurulum başarısız.' });
        return false;
      }
    })();

    installInFlight = run;
    try {
      return await run;
    } finally {
      installInFlight = null;
    }
  },

  skip: async () => {
    set({ saving: true, saveError: null });
    const res = await writeOnboarding({ answers: get().answers, status: 'skipped' });
    if (!res.ok) {
      set({ saving: false, saveError: res.error });
      return false;
    }
    set({ saving: false, saveError: null, status: 'skipped', personalizing: false });
    emitAnalytics('onboarding_skipped', { step: 'needs' });
    return true;
  },

  reset: () => set({
    plan: null, planReasons: [], installError: null, saveError: null,
    installing: false, saving: false, personalizing: false,
  }),
}));

/**
 * Does this user still owe us a first run?
 *
 * `legacy` and `skipped` both mean "do not route them into onboarding" — the
 * first because they predate the feature, the second because they said no.
 * Neither means they answered, which is why the two are distinct values and
 * not one `completed`.
 */
export function needsOnboarding(status: OnboardingStatus | 'unknown'): boolean {
  return status === 'pending';
}
