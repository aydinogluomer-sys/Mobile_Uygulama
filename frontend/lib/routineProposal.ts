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
import {
  dailyLoad,
  habitLoadPoints,
  bandFor,
  CAPACITY_CEILING_DEFAULT,
  type HabitLoadInput,
  type TaskLoadItem,
  type LoadBandKey,
} from './capacity';
import { DIFFICULTY_LEVELS } from './triage';

// ---------------------------------------------------------------------------
// Schema constants — every bound a validator rejection below cites.
// ---------------------------------------------------------------------------

/** `difficulty` must be one of the app's real discrete levels (DB column is
 *  1/3/5, "Kolay/Orta/Zor" — see `lib/triage.ts`'s `DIFFICULTY_LEVELS`, the
 *  single source of truth reused here rather than re-declaring `[1,3,5]` and
 *  risking the two definitions drifting apart). This directly rejects the
 *  brief's own absurd examples (`0`, `99`) along with every other non-member. */
export const VALID_DIFFICULTIES: readonly number[] = DIFFICULTY_LEVELS.map((d) => d.key);

/** Tracking types the DB can persist TODAY (`Habit.tracking_type` is only
 *  `'boolean' | 'numeric'` — see `lib/supabase.ts`). Expressed in the V2
 *  vocabulary the proposal schema itself uses. */
export const PERSISTABLE_TRACKING_TYPES: readonly TrackingType[] = ['binary', 'numeric'];

/** Real V2 tracking types that CANNOT be persisted yet — the
 *  `duration`/`abstinence` migration is authored but unapplied (Supabase
 *  project PAUSED). Writing either would fail at runtime, so the validator
 *  refuses them up front instead of letting that failure surface later as a
 *  confusing insert error. */
export const BLOCKED_TRACKING_TYPES: readonly TrackingType[] = ['duration', 'abstinence'];

const BLOCKED_TRACKING_TYPE_REASON =
  'the tracking_type migration that would add duration/abstinence support is authored but unapplied (Supabase project is paused) — only \'binary\' or \'numeric\' can be written today';

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
const ALLOWED_HABIT_KEYS = new Set(['name', 'tracking_type', 'difficulty', 'estimated_minutes']);

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

/** A single validated habit inside a `RoutineProposal`. Deliberately only
 *  the four fields plan §13's schema names — `frequency_config` and every
 *  other `Habit` column are NOT part of the AI-facing schema; the install
 *  path (routineStore.ts) supplies app-level defaults for those, which is
 *  not "coercion of AI data" because the AI is never asked to supply them
 *  (see this file's doc). */
export type ProposalHabit = {
  name: string;
  tracking_type: Extract<TrackingType, 'binary' | 'numeric'>;
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
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

  if (errors.length > 0) return { errors, habit: null };

  return {
    errors: [],
    habit: {
      name: (raw.name as string).trim(),
      tracking_type: tt as Extract<TrackingType, 'binary' | 'numeric'>,
      difficulty: diff as 1 | 3 | 5,
      estimated_minutes: mins as number,
    },
  };
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

/** The proposal schema carries no `frequency_config` (plan §13 does not name
 *  one), so every proposal habit is evaluated as a daily habit for capacity
 *  purposes. This mirrors `capacity.ts`'s OWN documented fallback for a
 *  missing config (`occurrencesPerWeek`: "no config recorded -- treat as
 *  daily, the app's own default") rather than inventing a new rule — it is
 *  not a guess this file introduces, it is the domain layer's existing
 *  default made explicit here for type-safety (`HabitLoadInput.frequency_config`
 *  is not optional). */
function toHabitLoadInput(h: ProposalHabit): HabitLoadInput {
  return {
    difficulty: h.difficulty,
    estimated_minutes: h.estimated_minutes,
    frequency_config: { kind: 'daily' },
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
    habits: ctx.activeHabits,
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
