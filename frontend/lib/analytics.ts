/**
 * Analytics event layer — plan §22.
 *
 * ## The privacy rule, stated precisely
 *
 * §22 says: "hassas journal metinleri event platformlarına gönderilmemelidir."
 *
 * The boundary is narrower and sharper than "journal text never leaves the
 * device". Journal text legitimately reaches the AI journal-insights feature
 * the user explicitly invoked (`app/screens/journal-insights.tsx` sends
 * `entries: text` — that text IS the feature's input). What §22 forbids is
 * journal text reaching an ANALYTICS/EVENT sink, where the user never asked
 * for it to go and where it would sit indefinitely in a third-party system.
 *
 * So this module enforces one invariant: an event payload carries
 * **ids, counts, enums, booleans and timestamps only — never free text.**
 *
 * Rather than blocklist known-sensitive keys (`note`, `journal`, `content`…),
 * which fails the moment someone adds a new one, this ALLOWLISTS by VALUE
 * SHAPE and KEYED ENUM VOCABULARY: a string is only permitted if it is
 * structurally an identifier (uuid), an ISO date, or a closed enum token
 * listed under its own property key in `ANALYTICS_ENUMS`. Anything else —
 * prose, a habit title, a single-word note like "spor" — is dropped.
 *
 * Dropping is deliberate rather than throwing: a careless call site should not
 * crash the app, but it must not leak either. Dropped keys are reported on the
 * event so a test (and a developer) can see what was refused.
 */
import type { BarrierId, PaceId } from './onboarding';
import type { Habit, HabitLog, RecoveryStrategy } from './supabase';

export const ANALYTICS_EVENTS = [
  'habit_created',
  'habit_completed',
  'habit_partial',
  'habit_missed',
  'recovery_created',
  'recovery_completed',
  'routine_installed',
  'focus_started',
  'focus_completed',
  'weekly_review_completed',
  'ai_routine_generated',
  // First-run onboarding. Categorical ids only -- never an email, a name or
  // free text; see `buildEvent`'s own contract and
  // `__tests__/repo/analyticsNoFreeText.test.ts`.
  'onboarding_started',
  'onboarding_needs_completed',
  'onboarding_preferences_completed',
  'onboarding_plan_generated',
  'onboarding_plan_installed',
  'onboarding_skipped',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Values an event may carry. Free text is not among them. */
export type AnalyticsValue = string | number | boolean | null;

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  props: Record<string, AnalyticsValue>;
  /** Keys refused by the shape allowlist. Present so leaks are observable. */
  dropped: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A short, lowercase, underscore/hyphen token — structural pre-check before `ANALYTICS_ENUMS[key]`. */
const ENUM_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** `yyyy-MM-dd` or a full ISO timestamp. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

function exhaustiveList<T extends string>(record: Record<T, true>): readonly string[] {
  return Object.keys(record);
}

/**
 * Closed vocabulary per prop KEY (F23, EDG-18).
 * A string prop passes only if it is a UUID, an ISO date, or listed here under its own key.
 * Note: `reminder_intent` in `onboardingStore` is `boolean | null` (`lib/onboarding.ts`),
 * so it passes through the boolean/null branch rather than this string map.
 */
export const ANALYTICS_ENUMS: Readonly<Record<string, readonly string[]>> = {
  state: exhaustiveList<HabitLog['state']>({
    done: true,
    partial: true,
    miss: true,
    skip: true,
  }),
  entry: exhaustiveList<'first_run' | 'settings'>({
    first_run: true,
    settings: true,
  }),
  step: exhaustiveList<'needs' | 'preferences'>({
    needs: true,
    preferences: true,
  }),
  behavior_type: exhaustiveList<Habit['behavior_type']>({
    positive: true,
    negative: true,
  }),
  tracking_type: exhaustiveList<Habit['tracking_type'] | 'binary'>({
    boolean: true,
    binary: true,
    numeric: true,
    duration: true,
    abstinence: true,
  }),
  status: exhaustiveList<Habit['status']>({
    active: true,
    waiting: true,
    paused: true,
    completed: true,
    archived: true,
    idea: true,
  }),
  phase: exhaustiveList<'work' | 'short_break' | 'long_break'>({
    work: true,
    short_break: true,
    long_break: true,
  }),
  barrier: exhaustiveList<BarrierId>({
    getting_started: true,
    consistency: true,
    forgetting: true,
    motivation: true,
    oversized_goals: true,
    lack_of_time: true,
    unsure_where_to_start: true,
  }),
  pace: exhaustiveList<PaceId>({
    gentle: true,
    balanced: true,
    intensive: true,
  }),
  strategy: exhaustiveList<RecoveryStrategy>({
    complete_today: true,
    push_tomorrow: true,
    split_two_days: true,
    skip: true,
  }),
  source: exhaustiveList<'ai' | 'pack' | 'coach'>({
    ai: true,
    pack: true,
    coach: true,
  }),
};

/**
 * A string is permitted only if it is a UUID, an ISO date, or an allowed enum
 * token for `key` in `ANALYTICS_ENUMS`.
 */
export function isPermittedString(key: string, v: string): boolean {
  if (UUID_RE.test(v)) return true;
  if (DATE_RE.test(v)) return true;
  return ENUM_RE.test(v) && ANALYTICS_ENUMS[key]?.includes(v) === true;
}

function isPermitted(key: string, v: unknown): v is AnalyticsValue {
  if (v === null) return true;
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return isPermittedString(key, v);
  // objects, arrays, functions, symbols, undefined: never emitted
  return false;
}

/**
 * Build an event, dropping anything that is not id/count/enum/timestamp shaped.
 *
 * Throws on an unknown event name — an undeclared event is a programming
 * error, and silently emitting it would put an unreviewed payload on the wire.
 * That is the one case where failing loudly is safer than degrading.
 */
export function buildEvent(
  name: AnalyticsEventName,
  props: Record<string, unknown>,
): AnalyticsEvent {
  if (!ANALYTICS_EVENTS.includes(name)) {
    throw new Error(
      `analytics: unknown event '${name}'. Declare it in ANALYTICS_EVENTS (plan §22) before emitting.`,
    );
  }
  const clean: Record<string, AnalyticsValue> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(props ?? {})) {
    // Never let prototype keys through onto an emitted object.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      dropped.push(k);
      continue;
    }
    if (isPermitted(k, v)) clean[k] = v;
    else dropped.push(k);
  }
  return { name, props: clean, dropped };
}

// ---------------------------------------------------------------------------
// Sink  (Phase 4, plan §22 — emission)
// ---------------------------------------------------------------------------
//
// Until this block existed, `lib/analytics.ts` could only BUILD events. A
// grep across `app/**`, `components/**` and `store/**` found zero call sites,
// so §22's whole event layer was inert: correct, well-tested, and never
// reached by a single habit completion. Building an event that nothing can
// receive is not an analytics layer; it is a validator.
//
// Deliberately NO third-party SDK. Mirrors `lib/crashReporting.ts`'s posture
// and for the same reason: attaching a vendor transport means committing a
// dependency plus credentials for an account that does not exist yet, and it
// means user data starts leaving the device the moment someone runs the app.
// What IS a coding deliverable is the seam — one funnel, one swappable sink —
// so a real transport is an `setAnalyticsSink()` call at boot, not a rewrite
// of every emission site.

export type AnalyticsSink = (event: AnalyticsEvent) => void;

/**
 * The default sink DROPS the event.
 *
 * Deliberate, and the opposite of `crashReporting`'s dev-console default. A
 * crash is rare and always worth a line in the console; a habit completion is
 * not. Logging every event unconditionally would print a habit id into the
 * Metro console on every single tap and flood the test runner with hundreds
 * of blocks — which trains a developer to ignore console output entirely,
 * i.e. it makes the NEXT diagnostic worse. A developer who wants to watch
 * events opts in with `setAnalyticsSink(consoleAnalyticsSink)`.
 */
const noopSink: AnalyticsSink = () => {};

/** Opt-in developer sink. Never attached automatically — see `noopSink`. */
export const consoleAnalyticsSink: AnalyticsSink = (event) => {
   
  console.log(`[analytics] ${event.name}`, event.props, event.dropped);
};

let sink: AnalyticsSink = noopSink;

/** Attach a real transport (or `consoleAnalyticsSink`) at app boot. `null` restores the default. */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next ?? noopSink;
}

/**
 * Hand a built event to the sink. NEVER throws.
 *
 * A sink is by definition foreign code (a vendor SDK, a fetch, a test spy). If
 * it throws, the throw must stop here: emission sits inside a habit
 * completion, and a failed analytics call is not a failed habit. Same posture,
 * same reason, as `crashReporting.reportError`.
 *
 * Note what is NOT swallowed: `buildEvent`'s throw on an undeclared event
 * name. That happens at the CALL SITE, before this function is reached, and
 * stays loud by design (see `buildEvent`) — an undeclared event is a
 * programming error, not a runtime condition.
 */
export function emitEvent(event: AnalyticsEvent): void {
  try {
    sink(event);
  } catch {
    // Deliberately empty: see above.
  }
}
