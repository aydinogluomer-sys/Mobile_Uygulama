/**
 * Routine Proposal Gate.  (Phase 3, CODER-J, plan §13 / Gate D)
 *
 * Pure domain logic. No I/O, no `supabase` import, no React, no store. This
 * file IS the barrier plan §13 demands, verbatim:
 *
 *   AI proposal → schema validation → capacity evaluation → user preview
 *   → explicit confirmation → database
 *
 * `validateRoutineProposal` is step 1 (schema validation) and
 * `evaluateProposal` is step 2 (capacity evaluation). Steps 3-5 (preview,
 * confirmation, the actual write) are UI/store concerns and live in
 * `store/routineStore.ts` + `components/AIRoutineModal.tsx` — this module
 * knows nothing about Supabase, React, or a screen, exactly like
 * `lib/capacity.ts` and `lib/behaviorIntelligence.ts` before it.
 *
 * ## Why this exists — the CURRENT write path before this change
 *
 * `store/routineStore.ts`'s `addGeneratedToHabits` (pre-existing, before this
 * task) took the AI's JSON response and wrote it to `habits` with ONLY
 * nullish-coalescing defaults (`item.tracking_type ?? 'boolean'`,
 * `item.willpower_cost ?? 3`) — never a rejection, never a shape check, a
 * missing/garbage field was silently papered over with a default and still
 * reached the database. That is precisely what plan §13 forbids ("AI hiçbir
 * zaman doğrudan database write yapmayacaktır"). This module is the fix: a
 * strict, defensive validator that returns a discriminated result instead of
 * ever silently coercing a malformed field into a default.
 *
 * ## "Defensive" — assume the AI output is hostile, not just sloppy
 *
 * Every check below assumes the JSON handed in could be: missing fields,
 * wrong-typed fields, `null`/`undefined` in place of a required value, an
 * empty habit list, absurd numeric values (negative or huge), an unknown
 * enum value, extra fields nobody asked for, or fields named `__proto__` /
 * `constructor` / `prototype` aimed at polluting whatever object the
 * validated result gets merged into downstream. None of that fails softly
 * into a best-effort partial object — `validateRoutineProposal` returns
 * EITHER a fully-valid `RoutineProposal` OR a non-empty `errors` array,
 * never something in between (see `ValidationResult`'s doc).
 *
 * ## Vocabulary: `TrackingType`, not `Habit['tracking_type']`
 *
 * The AI (and `RoutinePack`s in `routinePacks.ts`) speak the app's V2
 * tracking-type vocabulary already defined by `lib/habitEngine.ts`
 * (`binary | numeric | duration | abstinence`) — the same domain concept
 * `habitEngine.adaptTrackingType` already derives from real rows in the
 * OTHER direction (DB → V2). `lib/supabase.ts`'s `Habit.tracking_type`
 * (`'boolean' | 'numeric'`) is a DB-storage detail the proposal layer never
 * needs to know about; the STORE (`routineStore.ts`, this task's W3) is
 * where a validated `'binary'` proposal habit gets translated to the DB's
 * `'boolean'` literal at write time, mirroring `adaptTrackingType`'s mapping
 * in reverse.
 *
 * `'duration'` and `'abstinence'` are real, recognised V2 tracking types —
 * they are NOT "unknown enum values". They are rejected with a SPECIFIC
 * reason (the migration that would let the DB store them is authored but
 * unapplied — the Supabase project is paused, per this task's brief) that is
 * deliberately different from the generic "unknown tracking_type" error, so
 * a caller/tester can tell "this will never work today" apart from
 * "this AI response is garbage".
 */
import type { TrackingType } from './habitEngine';
import type { FrequencyConfig } from './supabase';
import {
  dailyLoad,
  habitLoadPoints,
  habitsInRangeOn,
  bandFor,
  CAPACITY_CEILING_DEFAULT,
  type HabitLoadInput,
  type TaskLoadItem,
  type LoadBandKey,
} from './capacity';
import { DIFFICULTY_LEVELS } from './triage';
import { parseLocalDate } from './date';

// ---------------------------------------------------------------------------
// Schema constants — every bound a validator rejection below cites.
// ---------------------------------------------------------------------------

/** `difficulty` must be one of the app's real discrete levels (DB column is
 *  1/3/5, "Kolay/Orta/Zor" — see `lib/triage.ts`'s `DIFFICULTY_LEVELS`, the
 *  single source of truth reused here rather than re-declaring `[1,3,5]` and
 *  risking the two definitions drifting apart). This directly rejects the
 *  brief's own absurd examples (`0`, `99`) along with every other non-member. */
export const VALID_DIFFICULTIES: readonly number[] = DIFFICULTY_LEVELS.map((d) => d.key);

/** Tracking types an AI-generated ROUTINE PROPOSAL may contain. Expressed in
 *  the V2 vocabulary the proposal schema itself uses. */
export const PERSISTABLE_TRACKING_TYPES: readonly TrackingType[] = ['binary', 'numeric'];

/** Tracking types this validator refuses in an AI proposal.
 *
 *  NOTE — the reason changed on 2026-08-30 and the old one was wrong. It used
 *  to read "the migration is authored but unapplied (Supabase project is
 *  PAUSED)". That migration was applied on 2026-08-30: the database accepts
 *  all four values, and the app persists duration and abstinence through
 *  onboarding today.
 *
 *  The restriction survives for a different and still-real reason: the edge
 *  function's own SYSTEM_PROMPT instructs the model to emit
 *  `tracking_type: boolean veya numeric`, so anything else coming back is a
 *  model that ignored its contract, not a feature. Refusing it here keeps a
 *  drifting prompt from quietly installing habits nobody specified.
 *
 *  Widening this is a two-sided change: the edge prompt must ask for the new
 *  vocabulary first, otherwise loosening the validator only widens what an
 *  off-contract response can slip through. */
export const BLOCKED_TRACKING_TYPES: readonly TrackingType[] = ['duration', 'abstinence'];

const BLOCKED_TRACKING_TYPE_REASON =
  'the AI routine contract only emits \'binary\' or \'numeric\' — a proposal asking for duration/abstinence is an off-contract response, not a supported request (the database itself accepts all four)';

/** A full calendar day. No habit's own daily time estimate can sanely exceed
 *  this — anything larger (e.g. the brief's own `10^6` example) is not a
 *  plausible single-habit estimate, hostile or malformed input. */
export const MAX_ESTIMATED_MINUTES = 24 * 60;

/** Defensive ceiling on how many habits one proposal may contain. Every real
 *  source stays well under it today (the edge function's own prompt caps at
 *  4, the heaviest routine pack — SLEEP RESET — has 6), so this exists purely
 *  to bound a hostile/glitched response, not to constrain a legitimate one. */
export const MAX_HABITS_PER_PROPOSAL = 10;

export const MAX_TITLE_LENGTH = 100;
export const MAX_GOAL_LENGTH = 400;
export const MAX_HABIT_NAME_LENGTH = 80;

const ALLOWED_TOP_KEYS = new Set(['title', 'goal', 'habits']);

/**
 * The four required fields, plus the four SEMANTIC ones added in 11A.2.2.
 *
 * The semantic four are what makes "her gün 20 dakika kitap oku" survive the
 * trip from a sentence to a row. Before them the schema could only say
 * `estimated_minutes: 20`, which is a different fact -- see
 * MAX_ESTIMATED_MINUTES's neighbour `daily_goal` below, and this file's
 * `validateHabit`.
 */
const ALLOWED_HABIT_KEYS = new Set([
  'name', 'tracking_type', 'difficulty', 'estimated_minutes',
  'unit', 'daily_goal', 'target_direction', 'frequency_config',
]);

/**
 * Schedule keys a PROPOSAL may carry.
 *
 * `interval_days`, `range_start` and `range_end` used to be refused here: the
 * scheduler's day walks went through `isDueOn`, which reads none of them, so
 * "every 3 days" would have installed a habit treated as daily. That reason is
 * gone (R01.02-d): every day-lane consumer asks `isEligibleOn` (R01.02-c), and
 * the date range is a lifetime ENVELOPE that combines with any shape
 * (R01.02-d1). Each new key is validated below in the same refuse-don't-coerce
 * style as the others. An unknown key is still refused.
 */
const ALLOWED_FREQUENCY_KEYS = new Set(['kind', 'days', 'part_of_day', 'count', 'interval_days', 'range_start', 'range_end']);

const FREQUENCY_KINDS = new Set(['daily', 'weekly', 'monthly']);
const PARTS_OF_DAY = new Set(['morning', 'afternoon', 'evening']);
export const TARGET_DIRECTIONS: readonly string[] = ['at_least', 'at_most'];

/** A daily target no habit sanely exceeds. Pages, minutes, glasses, reps. */
export const MAX_DAILY_GOAL = 100_000;
export const MAX_UNIT_LENGTH = 24;
/** Weekly count ceiling is 7; monthly is 31. Enforced per `kind`. */
export const MAX_WEEKLY_COUNT = 7;
export const MAX_MONTHLY_COUNT = 31;
/** "Every N days": 2 is the smallest that is not plain daily; a year is the
 *  longest cycle a habit plausibly has. 1 (and 0) are refused, not coerced. */
export const MIN_INTERVAL_DAYS = 2;
export const MAX_INTERVAL_DAYS = 365;

/** Keys that, if present as an OWN property anywhere in the input, are
 *  refused outright regardless of their value — a JSON payload naming these
 *  is either an attempted prototype-pollution probe or, at minimum, not a
 *  proposal any legitimate caller would produce. `JSON.parse` (unlike a
 *  hand-written object literal) creates `__proto__` as an ordinary own data
 *  property rather than invoking the accessor, which is exactly why this
 *  must be checked explicitly instead of assumed impossible. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One error found while validating. `path` is a JSON-pointer-ish location
 *  (`habits[1].tracking_type`) so a caller/UI/test can pin down exactly what
 *  was wrong, not just that something was. */
export type ValidationError = { path: string; message: string };

/**
 * A single validated habit inside a `RoutineProposal`.
 *
 * ## Four required fields, four optional semantic ones
 *
 * The first four are plan §13's original schema and every source supplies
 * them. The last four were added in 11A.2.2 because the schema could not
 * express what a user had actually said.
 *
 * "Her gün 20 dakika kitap oku" used to become `estimated_minutes: 20` and
 * nothing else, and those are not the same fact:
 *
 *   estimated_minutes  what it COSTS -- the effort the capacity and willpower
 *                      calculations price the habit at;
 *   daily_goal         what COUNTS as done -- the measurable target a logged
 *                      value is judged against;
 *   unit               what the number is IN (dakika / sayfa / bardak);
 *   target_direction   which side of the target is success;
 *   frequency_config   which days it is due on at all.
 *
 * A habit installed with only `estimated_minutes: 20` has no target, so
 * "bugün 10 dakika okudum" cannot be `partial` -- there is nothing to be
 * partial OF. That was the defect.
 *
 * All four stay OPTIONAL. A source that does not know them (a plain binary
 * habit, an older caller) omits them and gets exactly the row it always got:
 * `services/routineService.buildInstallRows` already defaults every one of
 * them, and has since routine packs needed the same columns.
 */
export type ProposalHabit = {
  name: string;
  tracking_type: Extract<TrackingType, 'binary' | 'numeric'>;
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
  /** What `daily_goal` counts in. Only meaningful with a numeric target. */
  unit?: string | null;
  /** The measurable target. NOT the effort estimate -- see this type's doc. */
  daily_goal?: number | null;
  /** Which side of `daily_goal` is success. Absent means `at_least`. */
  target_direction?: 'at_least' | 'at_most' | null;
  /** Which days it is due. Absent means the install path's daily default. */
  frequency_config?: FrequencyConfig;
};

/** Plan §13's canonical schema, post-validation. Every field here is
 *  guaranteed present, correctly typed and in-range — a caller never needs
 *  to re-check anything this type already promises. */
export type RoutineProposal = {
  title: string;
  goal: string;
  habits: ProposalHabit[];
};

/**
 * `{ok:true, proposal}` or `{ok:false, errors}` — never a third shape.
 * There is deliberately no "partially valid, here's what we could salvage"
 * variant: a caller that wants to know what went wrong reads `errors`; a
 * caller that wants to write something reads `proposal`, and `proposal` is
 * only ever present when EVERY check passed. Coercion (filling in a missing
 * or wrong-typed field with a guessed default) is exactly how bad data
 * reaches a database unnoticed, so this type structurally forbids it: there
 * is no field on the `ok:false` branch a caller could mistake for usable
 * data.
 */
export type ValidationResult =
  | { ok: true; proposal: RoutineProposal }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (Number.isNaN(v)) return 'NaN';
  return typeof v;
}

function hasForbiddenKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => FORBIDDEN_KEYS.has(k));
}

function validateRequiredString(
  value: unknown,
  path: string,
  maxLength: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof value !== 'string') {
    errors.push({ path, message: `${path}: expected a string, got ${describeType(value)}` });
    return errors;
  }
  if (value.trim().length === 0) {
    errors.push({ path, message: `${path}: must not be empty` });
  }
  if (value.length > maxLength) {
    errors.push({ path, message: `${path}: exceeds max length ${maxLength} (got ${value.length})` });
  }
  return errors;
}

/**
 * Validates a proposal's `frequency_config` against the app's REAL schedule
 * schema, and rejects anything the scheduler cannot honour.
 *
 * ## Weekday indexing is Monday = 0
 *
 * `lib/habitSchedule.ts`'s `weekdayIndex` is `(date.getDay() + 6) % 7`, so the
 * app's `days` array is **Pzt=0 … Paz=6** -- NOT JavaScript's `getDay()`,
 * where Sunday is 0. A model (or any caller) emitting `[0]` meaning Sunday
 * would silently schedule Monday. The range is the same either way, so this
 * cannot be caught by validation; it is caught by saying so, here and in the
 * prompt that asks for it.
 *
 * ## What is refused, and why refusing beats coercing
 *
 * An unknown `kind`, a `days` array on a non-weekly schedule, a count outside
 * its kind's real ceiling, a duplicate weekday -- all rejected rather than
 * normalised. A schedule quietly rewritten into something else is a habit the
 * user never agreed to, showing up on days they did not choose.
 *
 * ## The three keys accepted since R01.02-d
 *
 *   interval_days   "every N days". Only with kind 'daily' (that is the shape
 *                   `scheduleKind` reads it on), an integer 2-365. 1 and 0 are
 *                   REFUSED, not turned into plain daily. The cycle is counted
 *                   from max(created_at, range_start) -- `habitSchedule.ts`.
 *   range_start /   a lifetime ENVELOPE (R01.02-d1), not a shape: it combines
 *   range_end       with every kind and clips the days that shape is due on.
 *                   Each end is optional (one-sided ranges are valid), must be
 *                   a real local calendar day ('2026-02-30' is refused, not
 *                   rolled into March), and start may not be after end.
 *
 * Until R01.02-d all three were refused because the scheduler's day walks
 * ignored them; R01.02-c (consumers ask `isEligibleOn`) and R01.02-d1 (range as
 * envelope) removed that reason. Any OTHER key is still refused.
 *
 * `monthly` is accepted as a SHAPE, but note that `isDueOn` deliberately
 * returns false for monthly habits (it has nowhere to store which day of the
 * month), so a monthly habit is never counted as due. That is a pre-existing
 * domain limitation documented in `habitSchedule.ts`, not something this
 * validator introduces or can fix.
 */
export function validateFrequencyConfig(
  raw: unknown,
  path: string,
): { errors: ValidationError[]; frequency: FrequencyConfig | null } {
  const errors: ValidationError[] = [];
  if (!isPlainObject(raw)) {
    errors.push({ path, message: `${path}: expected an object, got ${describeType(raw)}` });
    return { errors, frequency: null };
  }
  if (hasForbiddenKey(raw)) {
    errors.push({ path, message: `${path}: contains a forbidden key (__proto__ / constructor / prototype)` });
    return { errors, frequency: null };
  }
  const extra = Object.keys(raw).filter((k) => !ALLOWED_FREQUENCY_KEYS.has(k));
  if (extra.length > 0) {
    errors.push({ path, message: `${path}: unexpected field(s): ${extra.join(', ')} (allowed: ${[...ALLOWED_FREQUENCY_KEYS].join(', ')})` });
  }

  const kind = raw.kind;
  if (typeof kind !== 'string' || !FREQUENCY_KINDS.has(kind)) {
    errors.push({ path: `${path}.kind`, message: `${path}.kind: expected one of ${[...FREQUENCY_KINDS].join('/')}, got ${describeType(kind)}` });
    return { errors, frequency: null };
  }

  const out: FrequencyConfig = { kind: kind as FrequencyConfig['kind'] };

  if (raw.days !== undefined) {
    if (kind !== 'weekly') {
      errors.push({ path: `${path}.days`, message: `${path}.days: only meaningful with kind 'weekly', got '${kind}'` });
    } else if (!Array.isArray(raw.days)) {
      errors.push({ path: `${path}.days`, message: `${path}.days: expected an array, got ${describeType(raw.days)}` });
    } else if (raw.days.length === 0 || raw.days.length > 7) {
      errors.push({ path: `${path}.days`, message: `${path}.days: expected 1-7 weekdays, got ${raw.days.length}` });
    } else {
      const bad = raw.days.filter((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6);
      if (bad.length > 0) {
        errors.push({ path: `${path}.days`, message: `${path}.days: weekdays must be integers 0-6 (Pzt=0 … Paz=6)` });
      } else if (new Set(raw.days as number[]).size !== raw.days.length) {
        errors.push({ path: `${path}.days`, message: `${path}.days: contains a duplicate weekday` });
      } else {
        out.days = [...(raw.days as number[])].sort((a, b) => a - b);
      }
    }
  }

  if (raw.part_of_day !== undefined) {
    if (!Array.isArray(raw.part_of_day)) {
      errors.push({ path: `${path}.part_of_day`, message: `${path}.part_of_day: expected an array, got ${describeType(raw.part_of_day)}` });
    } else if (raw.part_of_day.length === 0 || raw.part_of_day.length > 3) {
      errors.push({ path: `${path}.part_of_day`, message: `${path}.part_of_day: expected 1-3 entries, got ${raw.part_of_day.length}` });
    } else if (raw.part_of_day.some((v) => typeof v !== 'string' || !PARTS_OF_DAY.has(v))) {
      errors.push({ path: `${path}.part_of_day`, message: `${path}.part_of_day: entries must be ${[...PARTS_OF_DAY].join('/')}` });
    } else if (new Set(raw.part_of_day as string[]).size !== raw.part_of_day.length) {
      errors.push({ path: `${path}.part_of_day`, message: `${path}.part_of_day: contains a duplicate` });
    } else {
      out.part_of_day = raw.part_of_day as FrequencyConfig['part_of_day'];
    }
  }

  if (raw.count !== undefined) {
    const ceiling = kind === 'monthly' ? MAX_MONTHLY_COUNT : MAX_WEEKLY_COUNT;
    if (kind === 'daily') {
      errors.push({ path: `${path}.count`, message: `${path}.count: meaningless with kind 'daily'` });
    } else if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > ceiling) {
      errors.push({ path: `${path}.count`, message: `${path}.count: expected an integer 1-${ceiling} for kind '${kind}'` });
    } else {
      out.count = raw.count;
    }
  }

  // "Every N days" is a variant of DAILY (`scheduleKind`: daily + interval > 1
  // -> every_n_days); with weekly/monthly it means nothing. 1 or 0 is refused,
  // NOT rewritten to plain daily: the caller said something the schedule
  // cannot mean, and silently reinterpreting it is the coercion this file
  // exists to forbid.
  if (raw.interval_days !== undefined) {
    if (kind !== 'daily') {
      errors.push({ path: `${path}.interval_days`, message: `${path}.interval_days: only meaningful with kind 'daily', got '${kind}'` });
    } else if (typeof raw.interval_days !== 'number' || !Number.isInteger(raw.interval_days)) {
      errors.push({ path: `${path}.interval_days`, message: `${path}.interval_days: expected an integer, got ${describeType(raw.interval_days)}${typeof raw.interval_days === 'number' ? ` ${raw.interval_days}` : ''}` });
    } else if (raw.interval_days < MIN_INTERVAL_DAYS || raw.interval_days > MAX_INTERVAL_DAYS) {
      errors.push({ path: `${path}.interval_days`, message: `${path}.interval_days: expected ${MIN_INTERVAL_DAYS}-${MAX_INTERVAL_DAYS} (1 is plain daily -- send kind 'daily' without it), got ${raw.interval_days}` });
    } else {
      out.interval_days = raw.interval_days;
    }
  }

  // The date range is an ENVELOPE (R01.02-d1), so it combines with every
  // `kind` and either end may be absent (a one-sided range is valid). Each
  // end must be a REAL local calendar day: `parseLocalDate` rejects
  // '2026-02-30' instead of rolling it into March.
  const rangeEnd = (key: 'range_start' | 'range_end'): string | null => {
    const v = raw[key];
    if (v === undefined) return null;
    if (typeof v !== 'string' || parseLocalDate(v) === null) {
      errors.push({ path: `${path}.${key}`, message: `${path}.${key}: expected a real calendar date 'YYYY-MM-DD', got ${typeof v === 'string' ? `'${v}'` : describeType(v)}` });
      return null;
    }
    return v;
  };
  const rangeStart = rangeEnd('range_start');
  const rangeFinish = rangeEnd('range_end');
  if (rangeStart !== null && rangeFinish !== null && rangeStart > rangeFinish) {
    errors.push({ path: `${path}.range_start`, message: `${path}: range_start ${rangeStart} is after range_end ${rangeFinish}` });
  } else {
    if (rangeStart !== null) out.range_start = rangeStart;
    if (rangeFinish !== null) out.range_end = rangeFinish;
  }

  // "Weekly" with neither days nor count pins to nothing: `isDueOn` returns
  // false for every day of the year, so the habit is never due and never
  // missed. Refused rather than installed as an invisible habit.
  if (kind === 'weekly' && out.days === undefined && out.count === undefined) {
    errors.push({ path, message: `${path}: kind 'weekly' needs either days or count -- without one the habit is never due` });
  }

  return errors.length > 0 ? { errors, frequency: null } : { errors: [], frequency: out };
}

// ---------------------------------------------------------------------------
// Per-habit validation
// ---------------------------------------------------------------------------

function validateHabit(
  raw: unknown,
  index: number
): { errors: ValidationError[]; habit: ProposalHabit | null } {
  const path = `habits[${index}]`;
  const errors: ValidationError[] = [];

  if (!isPlainObject(raw)) {
    errors.push({ path, message: `${path}: expected an object, got ${describeType(raw)}` });
    return { errors, habit: null };
  }

  if (hasForbiddenKey(raw)) {
    errors.push({ path, message: `${path}: contains a forbidden key (__proto__ / constructor / prototype)` });
  }
  const extraKeys = Object.keys(raw).filter((k) => !ALLOWED_HABIT_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
  if (extraKeys.length > 0) {
    errors.push({ path, message: `${path}: unexpected field(s): ${extraKeys.join(', ')}` });
  }

  errors.push(...validateRequiredString(raw.name, `${path}.name`, MAX_HABIT_NAME_LENGTH));

  const tt = raw.tracking_type;
  if (typeof tt !== 'string') {
    errors.push({ path: `${path}.tracking_type`, message: `${path}.tracking_type: expected a string, got ${describeType(tt)}` });
  } else if ((BLOCKED_TRACKING_TYPES as readonly string[]).includes(tt)) {
    errors.push({ path: `${path}.tracking_type`, message: `${path}.tracking_type: '${tt}' cannot be persisted — ${BLOCKED_TRACKING_TYPE_REASON}` });
  } else if (!(PERSISTABLE_TRACKING_TYPES as readonly string[]).includes(tt)) {
    errors.push({ path: `${path}.tracking_type`, message: `${path}.tracking_type: unknown tracking_type '${tt}' — expected one of ${PERSISTABLE_TRACKING_TYPES.join(', ')}` });
  }

  const diff = raw.difficulty;
  if (typeof diff !== 'number' || !Number.isFinite(diff)) {
    errors.push({ path: `${path}.difficulty`, message: `${path}.difficulty: expected a number, got ${describeType(diff)}` });
  } else if (!VALID_DIFFICULTIES.includes(diff)) {
    errors.push({ path: `${path}.difficulty`, message: `${path}.difficulty: must be one of ${VALID_DIFFICULTIES.join('/')} (Kolay/Orta/Zor), got ${diff}` });
  }

  const mins = raw.estimated_minutes;
  if (typeof mins !== 'number' || !Number.isFinite(mins)) {
    errors.push({ path: `${path}.estimated_minutes`, message: `${path}.estimated_minutes: expected a number, got ${describeType(mins)}` });
  } else if (mins < 0) {
    errors.push({ path: `${path}.estimated_minutes`, message: `${path}.estimated_minutes: must not be negative, got ${mins}` });
  } else if (mins > MAX_ESTIMATED_MINUTES) {
    errors.push({ path: `${path}.estimated_minutes`, message: `${path}.estimated_minutes: exceeds sane ceiling of ${MAX_ESTIMATED_MINUTES} minutes (one full day), got ${mins}` });
  }

  // ── the semantic four ───────────────────────────────────────────────────
  //
  // Each is optional, and each is validated as strictly as the required four
  // when present. A `daily_goal` on a binary habit is a contradiction rather
  // than a harmless extra: nothing measures it, so it would sit in the row
  // implying a target the engine can never judge against.

  let unit: string | null | undefined;
  if (raw.unit !== undefined && raw.unit !== null) {
    if (typeof raw.unit !== 'string') {
      errors.push({ path: `${path}.unit`, message: `${path}.unit: expected a string, got ${describeType(raw.unit)}` });
    } else if (raw.unit.trim().length === 0 || raw.unit.length > MAX_UNIT_LENGTH) {
      errors.push({ path: `${path}.unit`, message: `${path}.unit: expected 1-${MAX_UNIT_LENGTH} characters` });
    } else if (tt !== 'numeric') {
      errors.push({ path: `${path}.unit`, message: `${path}.unit: only meaningful on a numeric habit` });
    } else {
      unit = raw.unit.trim();
    }
  }

  let dailyGoal: number | null | undefined;
  if (raw.daily_goal !== undefined && raw.daily_goal !== null) {
    if (typeof raw.daily_goal !== 'number' || !Number.isFinite(raw.daily_goal)) {
      errors.push({ path: `${path}.daily_goal`, message: `${path}.daily_goal: expected a number, got ${describeType(raw.daily_goal)}` });
    } else if (raw.daily_goal <= 0 || raw.daily_goal > MAX_DAILY_GOAL) {
      errors.push({ path: `${path}.daily_goal`, message: `${path}.daily_goal: expected a positive number up to ${MAX_DAILY_GOAL}, got ${raw.daily_goal}` });
    } else if (tt !== 'numeric') {
      errors.push({ path: `${path}.daily_goal`, message: `${path}.daily_goal: only meaningful on a numeric habit -- a binary habit has nothing to measure` });
    } else {
      dailyGoal = raw.daily_goal;
    }
  }

  let direction: 'at_least' | 'at_most' | null | undefined;
  if (raw.target_direction !== undefined && raw.target_direction !== null) {
    if (typeof raw.target_direction !== 'string' || !TARGET_DIRECTIONS.includes(raw.target_direction)) {
      errors.push({ path: `${path}.target_direction`, message: `${path}.target_direction: expected one of ${TARGET_DIRECTIONS.join('/')}, got ${describeType(raw.target_direction)}` });
    } else if (tt !== 'numeric') {
      errors.push({ path: `${path}.target_direction`, message: `${path}.target_direction: only meaningful on a numeric habit` });
    } else {
      direction = raw.target_direction as 'at_least' | 'at_most';
    }
  }

  let frequency: FrequencyConfig | undefined;
  if (raw.frequency_config !== undefined) {
    const fc = validateFrequencyConfig(raw.frequency_config, `${path}.frequency_config`);
    errors.push(...fc.errors);
    if (fc.frequency) frequency = fc.frequency;
  }

  // A numeric habit whose target has no unit, or a unit with no target, is
  // half a measurement. The preview would read "Hedef: 20" or "Hedef: dakika".
  if (dailyGoal !== undefined && unit === undefined) {
    errors.push({ path: `${path}.unit`, message: `${path}: daily_goal given without a unit -- a target needs to be a target OF something` });
  }
  if (unit !== undefined && dailyGoal === undefined) {
    errors.push({ path: `${path}.daily_goal`, message: `${path}: unit given without a daily_goal -- nothing to measure in ${String(raw.unit)}` });
  }

  if (errors.length > 0) return { errors, habit: null };

  const habit: ProposalHabit = {
    name: (raw.name as string).trim(),
    tracking_type: tt as Extract<TrackingType, 'binary' | 'numeric'>,
    difficulty: diff as 1 | 3 | 5,
    estimated_minutes: mins as number,
  };
  // Assigned rather than spread-with-undefined so an omitted field stays
  // ABSENT: `{ unit: undefined }` and `{}` are the same to the install path
  // but not to a deep-equality assertion, and the tests read these objects.
  if (unit !== undefined) habit.unit = unit;
  if (dailyGoal !== undefined) habit.daily_goal = dailyGoal;
  if (direction !== undefined) habit.target_direction = direction;
  if (frequency !== undefined) habit.frequency_config = frequency;

  return { errors: [], habit };
}

// ---------------------------------------------------------------------------
// Top-level validator — the barrier's entry point
// ---------------------------------------------------------------------------

/**
 * Validates an `unknown` blob (the AI's parsed JSON response, or a
 * `RoutinePack` converted to the same shape) against plan §13's canonical
 * schema. Never throws — every failure mode is data, not an exception, so a
 * caller can render it directly.
 *
 * Errors are ACCUMULATED, not fail-fast: a response with three separate
 * problems reports all three in one pass, so a UI (or a test) can show the
 * whole picture instead of a caller having to re-submit repeatedly to
 * discover each new complaint one at a time. The `habits` array in particular
 * has every element validated even after an earlier element already failed.
 */
export function validateRoutineProposal(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: `expected an object, got ${describeType(raw)}` }] };
  }

  const errors: ValidationError[] = [];

  if (hasForbiddenKey(raw)) {
    errors.push({ path: '$', message: 'root object contains a forbidden key (__proto__ / constructor / prototype)' });
  }
  const extraTopKeys = Object.keys(raw).filter((k) => !ALLOWED_TOP_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
  if (extraTopKeys.length > 0) {
    errors.push({ path: '$', message: `unexpected field(s): ${extraTopKeys.join(', ')}` });
  }

  errors.push(...validateRequiredString(raw.title, 'title', MAX_TITLE_LENGTH));
  errors.push(...validateRequiredString(raw.goal, 'goal', MAX_GOAL_LENGTH));

  const habitsRaw = raw.habits;
  const validHabits: ProposalHabit[] = [];

  if (!Array.isArray(habitsRaw)) {
    errors.push({ path: 'habits', message: `habits: expected an array, got ${describeType(habitsRaw)}` });
  } else if (habitsRaw.length === 0) {
    errors.push({ path: 'habits', message: 'habits: must contain at least one habit' });
  } else if (habitsRaw.length > MAX_HABITS_PER_PROPOSAL) {
    errors.push({ path: 'habits', message: `habits: contains ${habitsRaw.length} habits, exceeds max of ${MAX_HABITS_PER_PROPOSAL}` });
  } else {
    let allHabitsClean = true;
    habitsRaw.forEach((h, i) => {
      const { errors: hErrors, habit } = validateHabit(h, i);
      if (hErrors.length > 0) allHabitsClean = false;
      errors.push(...hErrors);
      if (habit) validHabits.push(habit);
    });

    // Duplicate-name check only runs once every habit individually
    // validated cleanly -- otherwise a missing/malformed `name` (already
    // reported above) would false-positive as "duplicate of itself".
    if (allHabitsClean) {
      const seenAt = new Map<string, number>();
      validHabits.forEach((h, i) => {
        const key = h.name.toLowerCase();
        const firstIndex = seenAt.get(key);
        if (firstIndex !== undefined) {
          errors.push({
            path: `habits[${i}].name`,
            message: `habits[${i}].name: duplicate habit name '${h.name}' (already used at habits[${firstIndex}])`,
          });
        } else {
          seenAt.set(key, i);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    proposal: {
      title: (raw.title as string).trim(),
      goal: (raw.goal as string).trim(),
      habits: validHabits,
    },
  };
}

// ---------------------------------------------------------------------------
// Capacity evaluation — step 2 of the plan §13 pipeline
// ---------------------------------------------------------------------------

/** A proposal habit priced for capacity.
 *
 *  This used to hard-code `{ kind: 'daily' }` because the schema had no
 *  schedule to read. Now that it can carry one, a three-days-a-week habit is
 *  priced as three days a week -- the same rule
 *  `services/routineService.buildInstallRows` already applies when it derives
 *  `willpower_cost`, so the number the user is shown in the preview and the
 *  number the row is installed with come from the same schedule.
 *
 *  A habit with no schedule still falls back to daily, which is
 *  `capacity.ts`'s own documented default for a missing config ("no config
 *  recorded -- treat as daily, the app's own default"), not a new guess. */
function toHabitLoadInput(h: ProposalHabit): HabitLoadInput {
  return {
    difficulty: h.difficulty,
    estimated_minutes: h.estimated_minutes,
    frequency_config: h.frequency_config ?? { kind: 'daily' },
    impact_level: null,
  };
}

export type HabitEvaluation = {
  name: string;
  /** This habit's own `habitLoadPoints` -- how much it alone would add. */
  points: number;
  /** The running daily-load total (0-100, clamped) INCLUDING this habit,
   *  evaluated against every habit already accepted before it. */
  projectedLoad: number;
  band: LoadBandKey;
  /** `true` -> activate now. `false` -> queue (does not consume capacity). */
  fits: boolean;
};

export type ProposalEvaluation = {
  /** Today's load BEFORE this proposal, from the caller's active habits. */
  currentLoad: number;
  ceiling: number;
  habits: HabitEvaluation[];
  /** Names of habits that fit under the ceiling -- installed as 'active'. */
  toActivate: string[];
  /** Names of habits that would push the day over the ceiling -- installed
   *  as 'waiting' (queued), never force-activated. */
  toQueue: string[];
  /** Sum of every habit's own points, regardless of whether it fits --
   *  expressed on the same 0-100 day-load scale `dailyLoad` uses, so e.g. a
   *  proposal totalling 31 of those points is naturally read as "raises
   *  load by about 31" (plan §13's own "%31" worked-example phrasing). */
  totalIncomingPoints: number;
  /** `currentLoad + totalIncomingPoints`, clamped -- "if every habit here
   *  were force-activated". For display only; NOT what actually gets
   *  activated (see `toActivate`/`toQueue`, which are capacity-gated). */
  projectedIfAllActivated: number;
};

function clampRound(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type EvaluateProposalContext = {
  /** Habits already active today -- the baseline this proposal is added on
   *  top of. */
  activeHabits: HabitLoadInput[];
  tasks?: TaskLoadItem[];
  focusMinutes?: number;
  overdueCount?: number;
  /** Overrides `CAPACITY_CEILING_DEFAULT` -- exposed for tests. */
  ceiling?: number;
  /**
   * KD-08 — the day the baseline is computed for. This is an activation gate
   * ("what fits TODAY"), so it defaults to now; an active habit whose date
   * range does not cover it carries no load. Tests pin a fixed date.
   */
  asOf?: Date;
};

/**
 * Step 2 of plan §13's pipeline: given an already-VALIDATED proposal (never
 * call this with raw/unvalidated input -- there is no schema check here,
 * only capacity math) and the user's current load inputs, decides per-habit
 * whether it fits under the capacity ceiling.
 *
 * Evaluation is SEQUENTIAL/greedy over `proposal.habits` in the order given:
 * each habit is checked against the running load (starting at the caller's
 * `currentLoad`), and only a habit that fits has its points folded into the
 * running total before the next habit is checked. A queued habit's points
 * are NOT added to the running total -- it consumes no capacity, matching
 * "queue it" rather than "activate it small". This reproduces the shape of
 * plan §13's worked example (a routine that would raise load by ~31 points
 * activates the habits that fit and queues the rest) without needing that
 * example's exact fixture numbers, which are illustrative, not specified.
 */
export function evaluateProposal(
  proposal: RoutineProposal,
  ctx: EvaluateProposalContext
): ProposalEvaluation {
  const ceiling = ctx.ceiling ?? CAPACITY_CEILING_DEFAULT;
  const baseline = dailyLoad({
    habits: habitsInRangeOn(ctx.activeHabits, ctx.asOf ?? new Date()),
    tasks: ctx.tasks,
    focusMinutes: ctx.focusMinutes,
    overdueCount: ctx.overdueCount,
  });

  let running = baseline.normalised;
  const habits: HabitEvaluation[] = [];
  const toActivate: string[] = [];
  const toQueue: string[] = [];
  let totalIncomingPoints = 0;

  for (const h of proposal.habits) {
    const points = habitLoadPoints(toHabitLoadInput(h));
    totalIncomingPoints += points;
    const projectedLoad = clampRound(running + points);
    const fits = projectedLoad <= ceiling;

    habits.push({ name: h.name, points, projectedLoad, band: bandFor(projectedLoad), fits });

    if (fits) {
      toActivate.push(h.name);
      running = projectedLoad;
    } else {
      toQueue.push(h.name);
    }
  }

  return {
    currentLoad: baseline.normalised,
    ceiling,
    habits,
    toActivate,
    toQueue,
    totalIncomingPoints,
    projectedIfAllActivated: clampRound(baseline.normalised + totalIncomingPoints),
  };
}

// ---------------------------------------------------------------------------
// Edge-function response adapter.  (Phase 3, CODER-K, Rule 8 regression fix)
//
// `supabase/functions/generate-routine/index.ts`'s SYSTEM_PROMPT (verbatim,
// as of this fix) asks the AI for:
//
//   {"name","description","items":[{"name","icon","tracking_type","unit",
//    "daily_goal","frequency_config","willpower_cost"}]}
//
// -- field names that do not match this file's canonical plan §13 schema
// (`title`/`goal`/`habits`), a `tracking_type` vocabulary that speaks the
// DB's storage literal (`'boolean'`) instead of the V2 domain vocabulary
// (`'binary'`) `validateRoutineProposal` expects, and -- the gap that
// actually matters -- NO `difficulty` or `estimated_minutes` at all. The
// edge function itself is off-limits for this fix (redeploying it is an
// irreversible production action, out of scope here -- see this task's
// report), so all three gaps are closed client-side, below, without ever
// inventing the two fields the AI genuinely never supplies. Silently
// defaulting them (e.g. `difficulty: 3, estimated_minutes: 0`) is the exact
// bug this whole gate exists to prevent -- `estimated_minutes: 0` alone
// made `capacity.habitLoad` blind to every AI habit before this file
// existed. See this file's own top-of-file doc for that history.
//
// `adaptEdgeRoutineResponse` below is that bridge. It is NOT a second,
// looser validator: it renames/maps fields, then hands the result to
// `validateRoutineProposal` ITSELF (not a re-implementation of its logic),
// so every hostile-input check that function performs -- forbidden keys,
// wrong types, unknown/blocked tracking_type, absurd values, empty/too-many
// habits, duplicate names -- runs unchanged on the adapted data. The ONLY
// thing this function treats specially is a `difficulty`/`estimated_minutes`
// error whose value was `undefined`/`null` (i.e. genuinely ABSENT, not
// present-and-wrong) -- see `isMissingCapacityField` below. Everything else
// that fails `validateRoutineProposal` fails here too, with the identical
// reason.
// ---------------------------------------------------------------------------

/** Top-level keys today's edge function actually sends. */
const ALLOWED_EDGE_TOP_KEYS = new Set(['name', 'description', 'items']);

/**
 * The TRANSPORT ENVELOPE, which is not part of the proposal at all.
 *
 * The edge function never returns the AI payload on its own. Every success
 * leaves through a single line:
 *
 *     return json({ ...payload, balance, cost, replayed });
 *
 * -- the debited Focus Point balance, the price, and whether the spend was an
 * idempotent replay, merged into the SAME object as `{name, description,
 * items}`. So the object this adapter receives always carries these three
 * keys, and rejecting them as "unexpected field(s)" rejected every real,
 * correctly-generated routine the product ever produced. Worse than a
 * cosmetic failure: the edge function had already SUCCEEDED and charged 25
 * Focus Points, so nothing refunded them -- the loss was created entirely on
 * this side of the wire.
 *
 * The whole suite missed it because every fixture was hand-written as the AI
 * payload alone; `__tests__/edge/generateRoutineResponseEnvelope.test.ts`
 * builds its fixture from the edge function's own source instead, so the two
 * cannot drift apart again.
 *
 * Kept SEPARATE from `ALLOWED_EDGE_TOP_KEYS` on purpose: these are tolerated,
 * not accepted. `toCanonicalShape` copies only `name`/`description`/`items`,
 * so an envelope field can never reach a `RoutineProposal`, and anything
 * outside these two sets is still rejected exactly as before.
 */
const EDGE_ENVELOPE_KEYS = new Set(['balance', 'cost', 'replayed']);

/** Per-item keys today's edge function actually sends (`SYSTEM_PROMPT`'s own
 *  item shape), PLUS `difficulty`/`estimated_minutes` -- not asked for
 *  today, but tolerated here so a response that DOES already include them
 *  (a future prompt change, or any other already-complete caller) is not
 *  rejected as "unexpected field". */
const ALLOWED_EDGE_HABIT_KEYS = new Set([
  'name', 'icon', 'tracking_type', 'unit', 'daily_goal', 'frequency_config',
  'willpower_cost', 'difficulty', 'estimated_minutes',
]);

/**
 * A validated-but-incomplete habit. `name`/`tracking_type` are guaranteed
 * valid -- they passed every check `validateHabit` performs, exactly as if
 * they came from a complete proposal. `difficulty`/`estimated_minutes` are
 * `null` ONLY when genuinely absent from the edge response -- NEVER a
 * guessed default.
 *
 * Every OTHER field the edge function sends per item today (`icon`, `unit`,
 * `daily_goal`, `frequency_config`, `willpower_cost`) is deliberately
 * DROPPED, not carried through:
 *
 *  - none of them exist on plan §13's canonical `ProposalHabit` (see that
 *    type's own doc, above) -- carrying them through would mean widening
 *    the canonical AI-facing schema itself, which is out of scope for a
 *    client-side-only fix and is not requested;
 *  - the install path (`store/routineStore.ts`'s `confirmInstall`) already
 *    hardcodes `icon: null`, `unit: null`, `daily_goal: null` and a fixed
 *    daily `frequency_config` for EVERY proposal habit today, `willpower_cost`
 *    is always recomputed via `computeWillpowerCost` -- true for an AI
 *    proposal AND for a Routine Pack alike (`routinePacks.ts`'s own
 *    `packToProposal` already strips these exact fields down before
 *    validating, for the same reason). Dropping them here is not a new loss
 *    this fix introduces; it matches the app's existing, already-tested
 *    behaviour for every other proposal source.
 */
export type AdaptedProposalHabit = {
  name: string;
  tracking_type: Extract<TrackingType, 'binary' | 'numeric'>;
  difficulty: 1 | 3 | 5 | null;
  estimated_minutes: number | null;
};

/** An accepted-but-incomplete proposal. `incomplete` is always `true` on
 *  this type -- a complete proposal is a plain `RoutineProposal` instead
 *  (see `AdaptResult`) -- kept as an explicit literal field so a value of
 *  this type stays self-describing wherever it travels (e.g. once
 *  destructured out of `AdaptResult` into `store/routineStore.ts`'s own
 *  state). */
export type AdaptedRoutineProposal = {
  title: string;
  goal: string;
  habits: AdaptedProposalHabit[];
  incomplete: true;
  /** User-facing prompts naming exactly the still-missing fields -- NOT
   *  rejection reasons (this proposal WAS accepted, just not yet
   *  complete). There is always at least one entry wherever this type is
   *  actually constructed. */
  missingFieldNotices: string[];
};

/**
 * `adaptEdgeRoutineResponse`'s result. Three shapes, never a fourth:
 *  - hostile/malformed input -> `ok:false`, identical meaning to
 *    `ValidationResult`'s `ok:false` -- a caller renders `errors` the same
 *    way it already does for `validateRoutineProposal`.
 *  - fully-formed input (difficulty/estimated_minutes ALREADY present and
 *    valid) -> `ok:true, complete:true` with a real, trusted
 *    `RoutineProposal` -- ready for `evaluateProposal` immediately, exactly
 *    like a Routine Pack.
 *  - accepted but missing capacity-critical fields -> `ok:true,
 *    complete:false` with an `AdaptedRoutineProposal` -- NOT valid input
 *    for `evaluateProposal` until `completeAdaptedProposal` below turns it
 *    into a real one using values the user supplies.
 */
export type AdaptResult =
  | { ok: true; complete: true; proposal: RoutineProposal }
  | { ok: true; complete: false; proposal: AdaptedRoutineProposal }
  | { ok: false; errors: ValidationError[] };

function mapEdgeTrackingType(tt: unknown): unknown {
  // The DB-storage literal the edge function's SYSTEM_PROMPT actually asks
  // the AI for -> the V2 domain vocabulary `validateRoutineProposal`
  // expects. Anything else (including a garbage value) passes through
  // UNCHANGED so the strict validator's own type/enum checks report it,
  // rather than this function silently swallowing an unrecognised value.
  return tt === 'boolean' ? 'binary' : tt;
}

/** Renames the edge function's field names onto plan §13's canonical ones
 *  and maps `tracking_type`'s vocabulary -- a pure rename/map, nothing
 *  more. Does NOT validate anything; `validateRoutineProposal` does that
 *  next, on the object this returns. */
function toCanonicalShape(raw: Record<string, unknown>): Record<string, unknown> {
  const items = raw.items;
  return {
    title: raw.name,
    goal: raw.description,
    habits: Array.isArray(items)
      ? items.map((item) => {
          if (!isPlainObject(item)) return item; // let the canonical pass report "expected an object"
          return {
            name: item.name,
            tracking_type: mapEdgeTrackingType(item.tracking_type),
            difficulty: item.difficulty,
            estimated_minutes: item.estimated_minutes,
          };
        })
      : items,
  };
}

/** `true` only for a `validateRoutineProposal` error on EXACTLY
 *  `habits[i].difficulty` or `habits[i].estimated_minutes` whose message
 *  says the value was `undefined`/`null` -- i.e. the field was genuinely
 *  ABSENT, not present-and-garbage. A present-but-wrong value (a string
 *  `"3"`, a negative number, `NaN`, an out-of-range `99`) produces a
 *  DIFFERENT message from `validateHabit` and correctly does NOT match
 *  here, so it still causes a real rejection below -- the "adapter still
 *  runs every hostile check" requirement this file's task brief names
 *  explicitly. */
function isMissingCapacityField(e: ValidationError): boolean {
  return (
    (/\.difficulty$/.test(e.path) || /\.estimated_minutes$/.test(e.path)) &&
    (/got undefined$/.test(e.message) || /got null$/.test(e.message))
  );
}

/**
 * Adapts TODAY's real `generate-routine` edge function response
 * (`{name, description, items:[...]}`, no `difficulty`/`estimated_minutes`
 * -- see this section's module doc) into either a trusted `RoutineProposal`
 * (nothing missing) or an `AdaptedRoutineProposal` explicitly marked
 * `incomplete` (missing fields represented as `null`, never guessed). Any
 * OTHER problem -- hostile keys, wrong types, an unknown/blocked
 * tracking_type, empty/too-many habits, a duplicate name, an absurd
 * difficulty/estimated_minutes value that IS present -- is a real
 * rejection, `ok:false`, identical in shape and reasoning to
 * `validateRoutineProposal`'s own.
 */
export function adaptEdgeRoutineResponse(raw: unknown): AdaptResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: `expected an object, got ${describeType(raw)}` }] };
  }
  if (hasForbiddenKey(raw)) {
    return { ok: false, errors: [{ path: '$', message: 'root object contains a forbidden key (__proto__ / constructor / prototype)' }] };
  }
  const extraTop = Object.keys(raw).filter(
    (k) => !ALLOWED_EDGE_TOP_KEYS.has(k) && !EDGE_ENVELOPE_KEYS.has(k) && !FORBIDDEN_KEYS.has(k),
  );
  if (extraTop.length > 0) {
    return { ok: false, errors: [{ path: '$', message: `unexpected field(s): ${extraTop.join(', ')}` }] };
  }

  // Per-item hostile checks in the EDGE vocabulary. `toCanonicalShape` below
  // only ever COPIES four specific keys per item into a fresh object, so a
  // forbidden/unexpected key that is not one of those four would otherwise
  // never reach `validateRoutineProposal` at all -- it simply would not be
  // copied over, and would silently vanish instead of being rejected.
  const itemsRaw = raw.items;
  if (Array.isArray(itemsRaw)) {
    for (let i = 0; i < itemsRaw.length; i++) {
      const item = itemsRaw[i];
      if (!isPlainObject(item)) continue; // let the canonical pass report "expected an object"
      if (hasForbiddenKey(item)) {
        return { ok: false, errors: [{ path: `habits[${i}]`, message: `habits[${i}]: contains a forbidden key (__proto__ / constructor / prototype)` }] };
      }
      const extra = Object.keys(item).filter((k) => !ALLOWED_EDGE_HABIT_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
      if (extra.length > 0) {
        return { ok: false, errors: [{ path: `habits[${i}]`, message: `habits[${i}]: unexpected field(s): ${extra.join(', ')}` }] };
      }
    }
  }

  const shaped = toCanonicalShape(raw);
  const strict = validateRoutineProposal(shaped);
  if (strict.ok) {
    return { ok: true, complete: true, proposal: strict.proposal };
  }

  const realErrors = strict.errors.filter((e) => !isMissingCapacityField(e));
  if (realErrors.length > 0) {
    // At least one problem beyond the two capacity-critical fields being
    // absent -- report EVERYTHING `validateRoutineProposal` found (including
    // any missing-field entries too), matching its own
    // accumulate-don't-fail-fast contract rather than masking one problem
    // behind another.
    return { ok: false, errors: strict.errors };
  }

  // Every error is EXACTLY "difficulty/estimated_minutes absent" on an
  // otherwise fully-valid proposal -- safe to build the incomplete shape by
  // hand, re-reading only fields the strict pass already proved valid.
  const shapedHabits = shaped.habits as Record<string, unknown>[];
  const missingPaths = new Set(strict.errors.map((e) => e.path));
  const habits: AdaptedProposalHabit[] = shapedHabits.map((h, i) => ({
    name: (h.name as string).trim(),
    tracking_type: h.tracking_type as Extract<TrackingType, 'binary' | 'numeric'>,
    difficulty: missingPaths.has(`habits[${i}].difficulty`) ? null : (h.difficulty as 1 | 3 | 5),
    estimated_minutes: missingPaths.has(`habits[${i}].estimated_minutes`) ? null : (h.estimated_minutes as number),
  }));

  const missingFieldNotices = strict.errors.map((e) => {
    const m = /^habits\[(\d+)\]\.(difficulty|estimated_minutes)$/.exec(e.path);
    if (!m) return e.message; // defensive; unreachable given the filter above
    const habitName = habits[Number(m[1])]?.name ?? `#${Number(m[1]) + 1}`;
    return m[2] === 'difficulty'
      ? `"${habitName}" için zorluk (difficulty) seviyesini seçmen gerekiyor -- AI bu bilgiyi vermiyor.`
      : `"${habitName}" için tahmini süreyi (estimated_minutes) girmen gerekiyor -- AI bu bilgiyi vermiyor.`;
  });

  return {
    ok: true,
    complete: false,
    proposal: {
      title: (shaped.title as string).trim(),
      goal: (shaped.goal as string).trim(),
      habits,
      incomplete: true,
      missingFieldNotices,
    },
  };
}

/**
 * One user-supplied completion, index-aligned with
 * `AdaptedRoutineProposal.habits`. Both fields are always required here,
 * even for a habit that was only missing one of the two -- simpler for a
 * caller than a per-field-optional shape, and harmless: `??` in
 * `completeAdaptedProposal` below only falls back to it when the adapted
 * value is actually `null`, so a field that was never missing keeps its own
 * already-valid value regardless of what is passed here for it.
 */
export type ProposalCompletion = { difficulty: 1 | 3 | 5; estimated_minutes: number };

/**
 * Turns an `AdaptedRoutineProposal` into a real `RoutineProposal` using
 * user-supplied values for whatever was `null`. The ONLY function in this
 * file that ever fills in `difficulty`/`estimated_minutes` for an AI
 * proposal -- and it only ever does so with a value the USER just typed or
 * selected, never a guess. Every field -- including the two just supplied
 * -- is then re-checked by the SAME `validateRoutineProposal` used
 * everywhere else in this file, so a hostile or absurd value typed into the
 * completion UI (a negative minute count, an out-of-range difficulty) is
 * rejected here exactly like anywhere else in the gate.
 */
export function completeAdaptedProposal(
  proposal: AdaptedRoutineProposal,
  completions: ProposalCompletion[]
): ValidationResult {
  if (completions.length !== proposal.habits.length) {
    return {
      ok: false,
      errors: [{
        path: 'habits',
        message: `habits: expected ${proposal.habits.length} completion entr${proposal.habits.length === 1 ? 'y' : 'ies'}, got ${completions.length}`,
      }],
    };
  }
  const candidate = {
    title: proposal.title,
    goal: proposal.goal,
    habits: proposal.habits.map((h, i) => ({
      name: h.name,
      tracking_type: h.tracking_type,
      difficulty: h.difficulty ?? completions[i].difficulty,
      estimated_minutes: h.estimated_minutes ?? completions[i].estimated_minutes,
    })),
  };
  return validateRoutineProposal(candidate);
}
