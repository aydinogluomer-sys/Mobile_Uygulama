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
 * SHAPE: a string is only permitted if it is structurally an identifier
 * (uuid), a short enum token, or an ISO date. Anything else — prose, a habit
 * title, a note — is dropped. A blocklist forgets; a shape allowlist does not.
 *
 * Dropping is deliberate rather than throwing: a careless call site should not
 * crash the app, but it must not leak either. Dropped keys are reported on the
 * event so a test (and a developer) can see what was refused.
 */

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
/** A short, lowercase, underscore/hyphen token — i.e. an enum, not prose. */
const ENUM_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** `yyyy-MM-dd` or a full ISO timestamp. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/**
 * A string is permitted only if its SHAPE proves it is not prose.
 * Note the deliberate order: uuid and ISO date are checked before the enum
 * pattern, because both would otherwise fail it (hyphens, digits, length).
 */
function isPermittedString(v: string): boolean {
  if (UUID_RE.test(v)) return true;
  if (DATE_RE.test(v)) return true;
  return ENUM_RE.test(v);
}

function isPermitted(v: unknown): v is AnalyticsValue {
  if (v === null) return true;
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return isPermittedString(v);
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
    if (isPermitted(v)) clean[k] = v;
    else dropped.push(k);
  }
  return { name, props: clean, dropped };
}
