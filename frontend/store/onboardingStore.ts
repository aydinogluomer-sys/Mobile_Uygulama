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

/**
 * Whether the onboarding row has been READ, and whether the read worked.
 *
 * This replaced a `hydrated: boolean`, and the boolean was a real defect: it
 * went true on failure as well as success, so the router stopped waiting while
 * `status` was still `'unknown'` — and `needsOnboarding('unknown')` is false,
 * so a brand-new user reached Today because the app could not find out whether
 * they needed onboarding. Failure now has its own value and its own screen.
 */
export type HydrationState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Where an install got to. Durable half lives in `user_onboarding.status`.
 *
 * `awaiting_completion` is the state that used to be unreachable: the habits
 * are in the database and the completion write is not. A retry from here must
 * write ONLY the completion — inserting again would give the user two of
 * every habit, which nothing in the schema would reject.
 */
export type InstallPhase = 'idle' | 'installing' | 'awaiting_completion';

type OnboardingStore = {
  hydrationState: HydrationState;
  loadError: string | null;
  status: OnboardingStatus | 'unknown';
  answers: OnboardingAnswers;

  plan: StarterPlan | null;
  planReasons: string[];

  saving: boolean;
  saveError: string | null;
  installing: boolean;
  installError: string | null;
  installPhase: InstallPhase;
  /** How many habits an earlier attempt left behind. Reported, not guessed. */
  installedHabitCount: number;

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
  /** Retries only the completion write. Never inserts habits. */
  completeInstall: () => Promise<boolean>;
  /** Drops every per-account value so account B is never routed by A's. */
  resetForAccount: () => void;
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
  hydrationState: 'idle',
  loadError: null,
  status: 'unknown',
  answers: EMPTY_ANSWERS,

  plan: null,
  planReasons: [],

  saving: false,
  saveError: null,
  installing: false,
  installError: null,
  installPhase: 'idle',
  installedHabitCount: 0,

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
    set({ hydrationState: 'loading', loadError: null });
    const res = await fetchOnboarding();
    if (!res.ok) {
      // NOT 'ready'. The router blocks on this and shows a retry, because
      // "we could not find out whether you need onboarding" is not the same
      // fact as "you do not", and only one of them may lead to Today.
      set({ hydrationState: 'error', loadError: res.error });
      return;
    }

    const row = res.data;
    // No row means a new account. The legacy backfill in
    // `20260906_user_onboarding.sql` is what keeps existing users out of it.
    const status = row?.status ?? 'pending';
    const answers = row ? normaliseAnswers(row) : EMPTY_ANSWERS;

    if (status === 'installing') {
      /**
       * A durable claim from an earlier attempt, possibly from a previous
       * process. Decide from the ACCOUNT, not from memory and not from a
       * guess about habit names:
       *
       *   0 habits  -> the insert provably never landed. There is nothing to
       *                duplicate, so the whole install may run again.
       *   n habits  -> the insert landed. Only the completion write is
       *                missing, and re-inserting would double every habit.
       *
       * The count is the whole decision, and it is exact in both directions.
       */
      await useHabitStore.getState().fetchHabits();
      const installed = useHabitStore.getState().habits.length;
      set({
        hydrationState: 'ready',
        loadError: null,
        status,
        answers,
        installPhase: installed > 0 ? 'awaiting_completion' : 'idle',
        installedHabitCount: installed,
      });
      return;
    }

    set({
      hydrationState: 'ready',
      loadError: null,
      status,
      answers,
      installPhase: 'idle',
      installedHabitCount: 0,
    });
  },

  /**
   * Phase 3 on its own.
   *
   * Reached two ways: immediately after a successful insert, and as the retry
   * when that write failed — including in a later process, where the durable
   * `installing` status is the only thing that knows an install happened.
   * Neither path can insert a habit, which is the point.
   */
  completeInstall: async () => {
    const { installedHabitCount } = get();
    set({ installing: true, installError: null });
    const saved = await writeOnboarding({ answers: get().answers, status: 'completed' });
    if (!saved.ok) {
      // Still recoverable, and still without duplicating: the phase stays
      // `awaiting_completion` and the durable status stays `installing`.
      set({ installing: false, installError: saved.error, installPhase: 'awaiting_completion' });
      return false;
    }
    set({
      installing: false,
      installError: null,
      status: 'completed',
      installPhase: 'idle',
      plan: null,
      planReasons: [],
      personalizing: false,
    });
    emitAnalytics('onboarding_plan_installed', { habit_count: installedHabitCount });
    return true;
  },

  /**
   * Everything that belongs to ONE account.
   *
   * Called on sign-out. Leaving any of it behind lets account B be routed by
   * account A's answers, or shows B the error A hit, or lets B's plan screen
   * open on A's proposal.
   */
  resetForAccount: () => {
    startedEmitted = false;
    set({
      hydrationState: 'idle',
      loadError: null,
      status: 'unknown',
      answers: EMPTY_ANSWERS,
      plan: null,
      planReasons: [],
      saving: false,
      saveError: null,
      installing: false,
      installError: null,
      installPhase: 'idle',
      installedHabitCount: 0,
      permission: 'unknown',
      personalizing: false,
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

  /**
   * Three phases, in this order, because the middle one is the only
   * irreversible thing here.
   *
   *   1. claim    write `status: 'installing'` BEFORE any habit exists
   *   2. install  insert the habits
   *   3. confirm  write `status: 'completed'`
   *
   * The claim is what makes (3) recoverable. It is durable, it is written
   * while there is still nothing to duplicate, and a later process reads it
   * to learn that an install already happened — which is exactly what the
   * previous version had no way to know. See `hydrate` for how `installing`
   * is resolved on a cold start.
   *
   * A failure at (1) or (2) leaves no habits, so the row goes back to
   * `pending` and the user simply tries again. A failure at (3) leaves the
   * habits and the claim, and the retry is `completeInstall` — never this
   * function's insert path.
   */
  installPlan: async () => {
    if (installInFlight) return installInFlight;

    // The habits are already there from an earlier attempt: this is a retry
    // of the completion write and nothing else. Placed first so no later
    // branch can reach the insert.
    if (get().installPhase === 'awaiting_completion') return get().completeInstall();

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
        // expected to queue -- but it goes through the gate rather than around
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

        // ── 1. the durable claim, before anything exists to duplicate ──
        const claim = await writeOnboarding({ answers: get().answers, status: 'installing' });
        if (!claim.ok) {
          set({ installing: false, installError: claim.error, installPhase: 'idle' });
          return false;
        }
        set({ installPhase: 'installing', status: 'installing' });

        // ── 2. the habits ──
        //
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
          // Nothing was written, so the claim is retracted rather than left
          // to strand the account in recovery on the next launch. The plan is
          // kept: the user retries the same install.
          await writeOnboarding({ answers: get().answers, status: 'pending' });
          set({ installing: false, installError: result.error, installPhase: 'idle', status: 'pending' });
          return false;
        }

        useHabitStore.setState((st) => ({ habits: [...result.habits, ...st.habits] }));

        // From here the habits EXIST. Recorded before the confirm is
        // attempted, so a failure below lands in a state that knows it.
        set({ installPhase: 'awaiting_completion', installedHabitCount: result.habits.length });

        // ── 3. the confirm ──
        return await get().completeInstall();
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
 * The whole routing decision, as a value.
 *
 * ## Why this is a function and not four `if`s in the layout
 *
 * The defect it replaces lived in exactly such a chain: a failed read set
 * `hydrated = true`, the layout stopped waiting, `needsOnboarding('unknown')`
 * answered false, and a brand-new user reached Today because the app could
 * not find out whether they needed onboarding. Nothing threw. The only way to
 * catch that class of mistake is to be able to ask the decision directly, for
 * every combination, without mounting a navigator — so the decision is a pure
 * function and the layout is the thing that obeys it.
 *
 * `wait` means render nothing: a redirect that has not been decided yet must
 * not be guessed at, because the wrong screen for one frame is still the wrong
 * screen. `gate` means the read FAILED and the user needs a retry control —
 * distinct from `wait`, which would be a spinner that never ends.
 */
export type RoutingDecision =
  | { kind: 'wait' }
  | { kind: 'gate' }
  | { kind: 'stay' }
  | { kind: 'redirect'; to: OnboardingRoute | '/tabs/today' | '/(auth)/login' };

export type RoutingInput = {
  /** A Supabase session. Notion-only sessions are not one. */
  hasSupabaseSession: boolean;
  /** Either kind of session — Supabase or Notion. */
  hasAnySession: boolean;
  hydrationState: HydrationState;
  status: OnboardingStatus | 'unknown';
  inAuthGroup: boolean;
  inPasswordRecovery: boolean;
  inOnboarding: boolean;
  personalizing: boolean;
};

export function resolveOnboardingRouting(input: RoutingInput): RoutingDecision {
  if (!input.hasAnySession) {
    return input.inAuthGroup ? { kind: 'stay' } : { kind: 'redirect', to: '/(auth)/login' };
  }

  // A Supabase-authenticated user is routed by their onboarding row, and only
  // once that row has been read SUCCESSFULLY. `ready` is the whole condition:
  // `error` is a separate outcome with a screen of its own, and anything else
  // is still in flight.
  if (input.hasSupabaseSession) {
    if (input.hydrationState === 'error') return { kind: 'gate' };
    if (input.hydrationState !== 'ready') return { kind: 'wait' };

    if (needsOnboarding(input.status)) {
      const target = onboardingRoute(input.status);
      if (target && !input.inOnboarding) return { kind: 'redirect', to: target };
      return { kind: 'stay' };
    }
  }

  // Finished, skipped, legacy -- or a Notion session, which never enters
  // onboarding. Anyone standing in the onboarding group is sent on, UNLESS
  // they opened it deliberately from Settings.
  if (input.inOnboarding && !input.personalizing) {
    return { kind: 'redirect', to: '/tabs/today' };
  }

  if (input.inAuthGroup && !input.inPasswordRecovery) {
    return { kind: 'redirect', to: '/tabs/today' };
  }

  return { kind: 'stay' };
}

/**
 * Does this user still owe us a first run?
 *
 * `legacy` and `skipped` both mean "do not route them into onboarding" — the
 * first because they predate the feature, the second because they said no.
 * Neither means they answered, which is why the two are distinct values and
 * not one `completed`.
 *
 * `installing` DOES count. It means an install was claimed and the flow never
 * finished, so the user still has something to resolve — sending them to
 * Today would leave a half-finished install nobody ever returns to.
 *
 * `unknown` deliberately answers false here and is NOT the router's whole
 * question: the router must also see `hydrationState === 'ready'` before it
 * acts, because "we could not find out" and "you do not need it" reach this
 * function looking identical. That is the bug this pair now prevents.
 */
export function needsOnboarding(status: OnboardingStatus | 'unknown'): boolean {
  return status === 'pending' || status === 'installing';
}

/**
 * Where an unfinished user belongs.
 *
 * An interrupted install goes straight to the plan screen, which is the only
 * screen that can resolve it; sending them back to the first question would
 * ask them to re-answer everything for habits they already have.
 */
export type OnboardingRoute = '/onboarding/plan' | '/onboarding/needs';

export function onboardingRoute(status: OnboardingStatus | 'unknown'): OnboardingRoute | null {
  if (status === 'installing') return '/onboarding/plan';
  if (status === 'pending') return '/onboarding/needs';
  return null;
}
