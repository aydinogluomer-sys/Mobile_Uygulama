/**
 * What AI Coach is allowed to PROPOSE, and nothing it is allowed to do.
 *
 * ## The one rule this file exists to enforce
 *
 * The model never writes. It returns text and, optionally, a small structured
 * suggestion; everything after that is the app's: this validator, then
 * resolution against the user's own rows, then a preview, then an explicit
 * tap, then the existing repositories. `lib/routineProposal.ts` already
 * established that shape for AI-generated routines and this file deliberately
 * mirrors it rather than inventing a second one -- same bounded keys, same
 * refusal to coerce, same `{ok:true}|{ok:false}` discipline.
 *
 * ## Why habit proposals are expressed in the ROUTINE vocabulary
 *
 * A coach habit suggestion is converted into a `RoutineProposal` and handed to
 * `validateRoutineProposal`, which means capacity evaluation, the install
 * pipeline and the tracking-type rules stay in exactly one place. The
 * alternative -- a richer coach-only habit schema carrying `unit`, `target`
 * and `frequency` -- would have meant a second validator and a second write
 * path beside the routine one, which is the thing that file warns against.
 * "20 dakika kitap oku" therefore becomes a `numeric` habit with
 * `estimated_minutes: 20`, exactly as the routine pipeline already models it.
 *
 * ## Untrusted input
 *
 * Everything here treats its argument as hostile. A malformed, oversized,
 * unknown or prototype-poisoning action is DISCARDED and reported -- it never
 * throws, because a bad suggestion must not cost the user the reply they paid
 * 5 FP for.
 */
import type { Habit } from './supabase';
import { todayLocal, ymd, addDaysLocal, parseLocalDate } from './date';
import type { RoutineProposal } from './routineProposal';

// ---------------------------------------------------------------------------
// Bounds. Every one of these exists to make a hostile or glitched response
// finite, not to constrain a legitimate one.
// ---------------------------------------------------------------------------

/** A coach turn may stage at most this many actions. Real turns emit 0 or 1. */
export const MAX_COACH_ACTIONS = 3;
/** Mirrors MAX_HABITS_PER_PROPOSAL; a plan larger than this is not a plan. */
export const MAX_PLAN_HABITS = 10;
export const MAX_NAME_LENGTH = 80;
export const MAX_QUERY_LENGTH = 80;
export const MAX_UNIT_LENGTH = 24;
export const MAX_TITLE_LENGTH = 100;
/** No habit's daily numeric target sanely exceeds this. */
export const MAX_LOG_VALUE = 100_000;
export const MAX_ESTIMATED_MINUTES = 24 * 60;

const ACTION_TYPES = ['propose_habit', 'propose_habit_plan', 'log_habit'] as const;
export type CoachActionType = (typeof ACTION_TYPES)[number];

const LOG_STATES = ['done', 'partial', 'miss', 'skip'] as const;
export type CoachLogState = (typeof LOG_STATES)[number];

const TRACKING_TYPES = ['binary', 'numeric'] as const;
const DIFFICULTIES = [1, 3, 5] as const;

const ALLOWED_KEYS: Record<CoachActionType, Set<string>> = {
  propose_habit: new Set(['type', 'habit']),
  propose_habit_plan: new Set(['type', 'title', 'goal', 'habits']),
  log_habit: new Set(['type', 'habit_query', 'date', 'completion']),
};
const ALLOWED_HABIT_KEYS = new Set(['name', 'tracking_type', 'difficulty', 'estimated_minutes']);
const ALLOWED_COMPLETION_KEYS = new Set(['kind', 'state', 'value', 'unit']);

/** Refused as an OWN property anywhere. `JSON.parse` makes `__proto__` an
 *  ordinary data property rather than invoking the accessor, so this has to be
 *  checked rather than assumed impossible -- same reasoning as
 *  routineProposal.ts. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Keys the model must never supply, because they are authority rather than
 *  content. Ownership comes from the session; price comes from the server. */
const AUTHORITY_KEYS = new Set([
  'user_id', 'userId', 'habit_id', 'habitId', 'id',
  'xp', 'baseXp', 'cost', 'price', 'balance', 'focus_points',
  'table', 'rpc', 'sql', 'query',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachProposalHabit = {
  name: string;
  tracking_type: 'binary' | 'numeric';
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
};

export type CoachLogCompletion =
  | { kind: 'state'; state: CoachLogState }
  | { kind: 'value'; value: number; unit?: string };

export type CoachAction =
  | { type: 'propose_habit'; habit: CoachProposalHabit }
  | { type: 'propose_habit_plan'; title: string; goal: string; habits: CoachProposalHabit[] }
  | { type: 'log_habit'; habit_query: string; date: string; completion: CoachLogCompletion };

export type RejectedAction = { index: number; reason: string };

export type CoachActionsResult = {
  /** Only fully valid actions. Never partially salvaged. */
  actions: CoachAction[];
  /** Why anything was thrown away, for logging and tests -- never shown raw. */
  rejected: RejectedAction[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasForbiddenKey(o: Record<string, unknown>): boolean {
  return Object.keys(o).some((k) => FORBIDDEN_KEYS.has(k));
}

function hasAuthorityKey(o: Record<string, unknown>): boolean {
  return Object.keys(o).some((k) => AUTHORITY_KEYS.has(k));
}

function onlyAllowedKeys(o: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(o).every((k) => allowed.has(k));
}

function boundedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

function boundedInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

function finiteNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

/** One habit, in the routine vocabulary. Returns null rather than coercing. */
function readHabit(raw: unknown): CoachProposalHabit | null {
  if (!isPlainObject(raw)) return null;
  if (hasForbiddenKey(raw) || hasAuthorityKey(raw)) return null;
  if (!onlyAllowedKeys(raw, ALLOWED_HABIT_KEYS)) return null;

  const name = boundedString(raw.name, MAX_NAME_LENGTH);
  if (!name) return null;

  const tt = raw.tracking_type;
  if (typeof tt !== 'string' || !(TRACKING_TYPES as readonly string[]).includes(tt)) return null;

  const difficulty = boundedInt(raw.difficulty, 1, 5);
  if (difficulty === null || !(DIFFICULTIES as readonly number[]).includes(difficulty)) return null;

  const minutes = boundedInt(raw.estimated_minutes, 1, MAX_ESTIMATED_MINUTES);
  if (minutes === null) return null;

  return {
    name,
    tracking_type: tt as 'binary' | 'numeric',
    difficulty: difficulty as 1 | 3 | 5,
    estimated_minutes: minutes,
  };
}

function readCompletion(raw: unknown): CoachLogCompletion | null {
  if (!isPlainObject(raw)) return null;
  if (hasForbiddenKey(raw) || hasAuthorityKey(raw)) return null;
  if (!onlyAllowedKeys(raw, ALLOWED_COMPLETION_KEYS)) return null;

  if (raw.kind === 'state') {
    const st = raw.state;
    if (typeof st !== 'string' || !(LOG_STATES as readonly string[]).includes(st)) return null;
    return { kind: 'state', state: st as CoachLogState };
  }

  if (raw.kind === 'value') {
    const value = finiteNumber(raw.value, 0, MAX_LOG_VALUE);
    if (value === null) return null;
    // The unit is carried ONLY so a mismatch with the habit's own unit can be
    // caught and asked about. It is never written and never converted.
    if (raw.unit === undefined) return { kind: 'value', value };
    const unit = boundedString(raw.unit, MAX_UNIT_LENGTH);
    if (unit === null) return null;
    return { kind: 'value', value, unit };
  }

  return null;
}

/**
 * Date the model asked for, resolved in the DEVICE'S LOCAL calendar.
 *
 * `today`/`yesterday` and an explicit `YYYY-MM-DD` are the whole vocabulary.
 * Everything goes through `lib/date.ts`, never raw UTC arithmetic: a habit
 * logged with `toISOString().slice(0,10)` lands on the wrong day for anyone
 * east of UTC in the evening, which is most of this app's users.
 */
export function resolveCoachDate(spec: unknown, now: Date = new Date()): string | null {
  // An ABSENT date means "the user did not say", which conversationally means
  // today. An empty STRING is different: the model emitted a date field and
  // put nothing in it, which is malformed rather than unspecified.
  if (spec === undefined || spec === null) return todayLocal(now);
  if (typeof spec !== 'string') return null;
  const s = spec.trim().toLowerCase();
  if (!s) return null;
  if (s === 'today' || s === 'bugün' || s === 'bugun') return todayLocal(now);
  if (s === 'yesterday' || s === 'dün' || s === 'dun') return ymd(addDaysLocal(now, -1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = parseLocalDate(s);
    if (!d) return null;
    // Round-trip guard: rejects 2026-02-31, which Date happily rolls over.
    return ymd(d) === s ? s : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function readAction(raw: unknown): CoachAction | string {
  if (!isPlainObject(raw)) return 'not an object';
  if (hasForbiddenKey(raw)) return 'forbidden key';
  if (hasAuthorityKey(raw)) return 'action tried to supply authority (ownership/price/xp)';

  const type = raw.type;
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) {
    return 'unknown action type';
  }
  const t = type as CoachActionType;
  if (!onlyAllowedKeys(raw, ALLOWED_KEYS[t])) return 'unexpected key for ' + t;

  if (t === 'propose_habit') {
    const habit = readHabit(raw.habit);
    return habit ? { type: t, habit } : 'invalid habit';
  }

  if (t === 'propose_habit_plan') {
    const title = boundedString(raw.title, MAX_TITLE_LENGTH);
    if (!title) return 'invalid title';
    // Required, not defaulted: `validateRoutineProposal` demands a non-empty
    // goal, and synthesising one here would be this file inventing content the
    // user never saw. A plan without a stated goal is an off-contract answer.
    const goal = boundedString(raw.goal, 400);
    if (!goal) return 'invalid goal';
    if (!Array.isArray(raw.habits)) return 'habits not an array';
    if (raw.habits.length === 0) return 'empty plan';
    if (raw.habits.length > MAX_PLAN_HABITS) return 'plan too large';
    const habits: CoachProposalHabit[] = [];
    for (const h of raw.habits) {
      const parsed = readHabit(h);
      if (!parsed) return 'invalid habit in plan';
      habits.push(parsed);
    }
    return { type: t, title, goal, habits };
  }

  // log_habit
  const query = boundedString(raw.habit_query, MAX_QUERY_LENGTH);
  if (!query) return 'invalid habit_query';
  const date = resolveCoachDate(raw.date);
  if (!date) return 'invalid date';
  const completion = readCompletion(raw.completion);
  if (!completion) return 'invalid completion';
  return { type: t, habit_query: query, date, completion };
}

/**
 * Validate whatever the coach turn put in `actions`.
 *
 * Never throws and never partially salvages: an action is either wholly valid
 * or wholly discarded. A missing/empty `actions` is the normal case -- most
 * coach turns are conversation, not intent.
 */
export function validateCoachActions(raw: unknown): CoachActionsResult {
  if (raw === undefined || raw === null) return { actions: [], rejected: [] };
  if (!Array.isArray(raw)) return { actions: [], rejected: [{ index: -1, reason: 'actions not an array' }] };

  const actions: CoachAction[] = [];
  const rejected: RejectedAction[] = [];

  raw.slice(0, MAX_COACH_ACTIONS).forEach((item, index) => {
    const parsed = readAction(item);
    if (typeof parsed === 'string') rejected.push({ index, reason: parsed });
    else actions.push(parsed);
  });

  if (raw.length > MAX_COACH_ACTIONS) {
    rejected.push({ index: MAX_COACH_ACTIONS, reason: 'too many actions; extras ignored' });
  }

  return { actions, rejected };
}

// ---------------------------------------------------------------------------
// Bridging to the existing routine pipeline
// ---------------------------------------------------------------------------

/**
 * A coach habit/plan expressed as the routine proposal the rest of the app
 * already knows how to validate, evaluate for capacity and install. This is
 * the whole reason coach habits use the routine vocabulary: from here on there
 * is one pipeline, not two.
 */
export function coachActionToRoutineProposal(action: CoachAction): RoutineProposal | null {
  if (action.type === 'propose_habit') {
    // `goal` is required by validateRoutineProposal and a single suggested
    // habit has no separate goal to state. This string is APP framing, not
    // model content -- the same category as the install path supplying
    // `icon: null` for a field the AI is never asked to fill.
    return { title: action.habit.name, goal: SINGLE_HABIT_GOAL, habits: [action.habit] };
  }
  if (action.type === 'propose_habit_plan') {
    return { title: action.title, goal: action.goal, habits: action.habits };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolving a log against the user's REAL habits
// ---------------------------------------------------------------------------

/** App-supplied framing for a one-habit suggestion. See the use site. */
export const SINGLE_HABIT_GOAL = 'Sohbetten eklenen alışkanlık';

export type HabitResolution =
  | { kind: 'exact'; habit: Habit }
  | { kind: 'ambiguous'; candidates: Habit[] }
  | { kind: 'none' };

const fold = (s: string) =>
  s.toLocaleLowerCase('tr')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Which of the user's habits did they mean?
 *
 * Only ever chooses when the choice is unambiguous. Two plausible habits is a
 * question, not a coin flip -- writing to the wrong habit is a silent data
 * error the user may never notice, which is worse than one extra tap.
 *
 * The candidate list must already be the signed-in user's own rows; this
 * function has no notion of ownership and must never be handed someone else's.
 */
export function resolveHabitQuery(query: string, habits: readonly Habit[]): HabitResolution {
  const q = fold(query);
  if (!q) return { kind: 'none' };

  const active = habits.filter((h) => h.status === 'active');
  const pool = active.length > 0 ? active : habits;

  const exact = pool.filter((h) => fold(h.name) === q);
  if (exact.length === 1) return { kind: 'exact', habit: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

  const contains = pool.filter((h) => {
    const n = fold(h.name);
    return n.includes(q) || q.includes(n);
  });
  if (contains.length === 1) return { kind: 'exact', habit: contains[0] };
  if (contains.length > 1) return { kind: 'ambiguous', candidates: contains.slice(0, 5) };

  return { kind: 'none' };
}
