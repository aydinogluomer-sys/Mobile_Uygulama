/**
 * Task Decomposition Service V2 -- AI subtask validator.  (Phase 3, CODER-L, plan §15)
 *
 * Plan §15 changes the ADHD task splitter's architecture from a single
 * inline write to a pipeline:
 *
 *   task -> task decomposition service -> AI -> validated subtasks -> preview -> save
 *
 * This module IS the "validated subtasks" barrier -- the exact same role
 * `lib/routineProposal.ts` plays for AI-proposed routines (plan §13:
 * "AI hiçbir zaman doğrudan database write yapmayacaktır"). It follows that
 * file's pattern deliberately rather than inventing a second one: a
 * hand-written defensive validator, accumulating errors, a discriminated
 * result, never coercing a malformed field into a guessed default.
 *
 * ## What "the existing feature" was BEFORE this change
 *
 * `components/ADHDTaskSplitter.tsx` (pre-existing) built three subtask rows
 * from a HARD-CODED label table (`SPLIT_LABELS`, keyed by 15/25/45 minutes)
 * and called `repositories/taskRepository.ts`'s `insertSplitTasks` the
 * instant the user tapped a duration button -- there was no AI call
 * anywhere in that path, and no preview step either: the rows a user saw
 * afterwards were the ALREADY-INSERTED database rows (with real ids), not a
 * proposal awaiting confirmation. There was also nothing to validate,
 * because the labels were fully trusted, static strings the app itself
 * wrote.
 *
 * Plan §15 asks for the architecture in the box above, and says the
 * feature's user-facing BEHAVIOUR (the three duration presets, their
 * Turkish copy) must be PRESERVED, not redesigned. This module supplies the
 * missing middle of that pipeline -- a defensive validator ANY subtask
 * proposal must clear before it can reach a preview, whether that proposal
 * one day comes from a real AI edge function (none exists yet -- see this
 * task's Edge Function Findings; this file does not call one, and does not
 * invent one) or, today, from `buildLocalSplitProposal` below, a pure
 * function that reproduces the OLD hard-coded label table exactly, but
 * returns it as an untyped `unknown` blob and forces it through the SAME
 * gate a hostile AI response would have to pass. That is not a defensive
 * formality: it is what makes the seam swap-in-ready for a real AI backend
 * later without moving the validation boundary at all.
 *
 * ## "Defensive" -- same hostility assumptions as `routineProposal.ts`
 *
 * Every check below assumes the input could be: missing fields, wrong-typed
 * fields, `null`/`undefined` in place of a required value, an empty subtask
 * list, an absurd subtask count, a non-string title, an unreasonably long
 * title/description, two subtasks with the same title, or a field named
 * `__proto__`/`constructor`/`prototype` aimed at polluting whatever object
 * the validated result gets merged into downstream. `validateSubtaskProposal`
 * returns EITHER a fully-valid `SubtaskDecompositionProposal` OR a
 * non-empty `errors` array, never a partially-salvaged in-between.
 *
 * ## What is persistable -- the `tasks` table's real insert shape
 *
 * `repositories/taskRepository.ts`'s `SplitTaskInput` (verified against
 * `store/taskStore.ts`'s `Task` type, `lib/supabase.ts` has no separate
 * `Task` type of its own) is the single source of truth for what a `tasks`
 * row insert actually accepts:
 *
 *   { title, description, status: 'pending', priority, due_date,
 *     project_id, list_type, completed }
 *
 * Of those eight fields, only `title` and `description` are things an AI
 * (or the local generator) could sensibly originate per-subtask -- the
 * other six (`status`, `priority`, `due_date`, `project_id`, `list_type`,
 * `completed`) are properties of the PARENT task being split, not new facts
 * an AI invents. This module's AI-facing schema therefore exposes exactly
 * `title`/`description` (mirroring `routineProposal.ts`'s own precedent:
 * its AI-facing `ProposalHabit` excludes `icon`/`unit`/`daily_goal`/
 * `frequency_config` for the identical reason -- those are supplied by the
 * install path from real app defaults, never by the AI). `toSplitTaskInputs`
 * below assembles the other six fields from the REAL parent `Task` object
 * the caller already has -- never a guess, never an AI-invented value. Any
 * OTHER key an AI/local proposal tries to smuggle in (e.g. a subtask
 * carrying its own `status` or `priority`) is rejected outright as an
 * "unexpected field" -- it is structurally impossible for such a field to
 * reach the database through this module, because `toSplitTaskInputs` only
 * ever reads `title`/`description` off a validated subtask.
 */
import type { ValidationError } from './routineProposal';
import type { Task } from '../store/taskStore';

// ---------------------------------------------------------------------------
// Schema constants -- every bound a validator rejection below cites.
// ---------------------------------------------------------------------------

/** Defensive ceiling on how many subtasks one proposal may contain. The
 *  whole point of ADHD-friendly decomposition is a SMALL number of
 *  manageable chunks -- today's real templates never exceed 3 -- so this
 *  exists purely to bound a hostile/glitched response (the brief's own
 *  "absurd counts" example), not to constrain a legitimate one. Mirrors
 *  `routineProposal.ts`'s `MAX_HABITS_PER_PROPOSAL` reasoning at a size
 *  appropriate to this schema.
 */
export const MAX_SUBTASKS_PER_PROPOSAL = 8;

/** No real task title in this app is anywhere near this long; a plain
 *  ceiling well above today's longest real proposal title (parent title +
 *  " — " + a short phase label) while still rejecting a hostile giant
 *  string. */
export const MAX_SUBTASK_TITLE_LENGTH = 150;

/** Mirrors `routineProposal.ts`'s `MAX_GOAL_LENGTH` (400) at a slightly
 *  smaller ceiling appropriate to a one-line subtask description rather
 *  than a routine's whole goal statement. */
export const MAX_SUBTASK_DESCRIPTION_LENGTH = 500;

const ALLOWED_TOP_KEYS = new Set(['subtasks']);
const ALLOWED_SUBTASK_KEYS = new Set(['title', 'description']);

/** Same prototype-pollution guard as `routineProposal.ts` -- see that
 *  file's doc for why this must be checked explicitly rather than assumed
 *  impossible (`JSON.parse` makes `__proto__` an ordinary own property). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One validated subtask. Deliberately only the two fields an AI/local
 *  proposal is ever asked for -- see this file's doc for why the other six
 *  `SplitTaskInput` fields are NOT part of this schema. */
export type ProposedSubtask = {
  title: string;
  /** `null` means "no description supplied" -- a real, deliberate absence,
   *  never coerced to `''` at THIS layer (see `toSplitTaskInputs`, the only
   *  place that conversion happens, and only because the DB column itself
   *  is non-nullable -- a structural default, not an invented fact). */
  description: string | null;
};

/** Plan §15's canonical AI-facing schema, post-validation. */
export type SubtaskDecompositionProposal = {
  subtasks: ProposedSubtask[];
};

/**
 * `{ok:true, proposal}` or `{ok:false, errors}` -- never a third shape, for
 * the exact reason `routineProposal.ts`'s `ValidationResult` gives: there is
 * no "partially valid, here's what we could salvage" branch, because that
 * is exactly how bad data reaches a database unnoticed.
 */
export type SubtaskValidationResult =
  | { ok: true; proposal: SubtaskDecompositionProposal }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Small internal helpers -- intentionally re-declared, not imported from
// `routineProposal.ts`. That file keeps these three predicates private (not
// exported), and they are ~10 lines of generic, dependency-free logic --
// duplicating them here matches this codebase's own existing precedent
// (`reportMetrics.ts` and `behaviorIntelligence.ts` each define small
// overlapping helpers rather than forcing a shared-utils module for a
// handful of lines) rather than widening `routineProposal.ts`'s public
// surface just to save repeating them.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return typeof v;
}

function hasForbiddenKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => FORBIDDEN_KEYS.has(k));
}

// ---------------------------------------------------------------------------
// Per-subtask validation
// ---------------------------------------------------------------------------

function validateSubtask(
  raw: unknown,
  index: number,
): { errors: ValidationError[]; subtask: ProposedSubtask | null } {
  const path = `subtasks[${index}]`;
  const errors: ValidationError[] = [];

  if (!isPlainObject(raw)) {
    errors.push({ path, message: `${path}: expected an object, got ${describeType(raw)}` });
    return { errors, subtask: null };
  }

  if (hasForbiddenKey(raw)) {
    errors.push({ path, message: `${path}: contains a forbidden key (__proto__ / constructor / prototype)` });
  }
  const extraKeys = Object.keys(raw).filter((k) => !ALLOWED_SUBTASK_KEYS.has(k) && !FORBIDDEN_KEYS.has(k));
  if (extraKeys.length > 0) {
    errors.push({ path, message: `${path}: unexpected field(s): ${extraKeys.join(', ')}` });
  }

  const title = raw.title;
  if (typeof title !== 'string') {
    errors.push({ path: `${path}.title`, message: `${path}.title: expected a string, got ${describeType(title)}` });
  } else if (title.trim().length === 0) {
    errors.push({ path: `${path}.title`, message: `${path}.title: must not be empty` });
  } else if (title.length > MAX_SUBTASK_TITLE_LENGTH) {
    errors.push({ path: `${path}.title`, message: `${path}.title: exceeds max length ${MAX_SUBTASK_TITLE_LENGTH} (got ${title.length})` });
  }

  const description = raw.description;
  if (description !== null && description !== undefined) {
    if (typeof description !== 'string') {
      errors.push({ path: `${path}.description`, message: `${path}.description: expected a string or null, got ${describeType(description)}` });
    } else if (description.length > MAX_SUBTASK_DESCRIPTION_LENGTH) {
      errors.push({ path: `${path}.description`, message: `${path}.description: exceeds max length ${MAX_SUBTASK_DESCRIPTION_LENGTH} (got ${description.length})` });
    }
  }

  if (errors.length > 0) return { errors, subtask: null };

  return {
    errors: [],
    subtask: {
      title: (title as string).trim(),
      description: typeof description === 'string' ? description.trim() : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level validator -- the barrier's entry point
// ---------------------------------------------------------------------------

/**
 * Validates an `unknown` blob (a real AI response, once one exists, or
 * `buildLocalSplitProposal`'s output today -- see this file's doc) against
 * plan §15's subtask schema. Never throws -- every failure mode is data, so
 * a caller/UI/test can render or assert on it directly.
 *
 * Errors are ACCUMULATED, not fail-fast, exactly like
 * `routineProposal.validateRoutineProposal` -- every subtask is validated
 * even after an earlier one already failed, so a caller sees the whole
 * picture in one pass.
 */
export function validateSubtaskProposal(raw: unknown): SubtaskValidationResult {
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

  const subtasksRaw = raw.subtasks;
  const validSubtasks: ProposedSubtask[] = [];

  if (!Array.isArray(subtasksRaw)) {
    errors.push({ path: 'subtasks', message: `subtasks: expected an array, got ${describeType(subtasksRaw)}` });
  } else if (subtasksRaw.length === 0) {
    errors.push({ path: 'subtasks', message: 'subtasks: must contain at least one subtask' });
  } else if (subtasksRaw.length > MAX_SUBTASKS_PER_PROPOSAL) {
    errors.push({ path: 'subtasks', message: `subtasks: contains ${subtasksRaw.length} subtasks, exceeds max of ${MAX_SUBTASKS_PER_PROPOSAL}` });
  } else {
    let allSubtasksClean = true;
    subtasksRaw.forEach((s, i) => {
      const { errors: sErrors, subtask } = validateSubtask(s, i);
      if (sErrors.length > 0) allSubtasksClean = false;
      errors.push(...sErrors);
      if (subtask) validSubtasks.push(subtask);
    });

    // Duplicate-title check only runs once every subtask individually
    // validated cleanly -- otherwise a missing/malformed `title` (already
    // reported above) would false-positive as "duplicate of itself", same
    // guard `routineProposal.ts` applies to habit names.
    if (allSubtasksClean) {
      const seenAt = new Map<string, number>();
      validSubtasks.forEach((s, i) => {
        const key = s.title.toLowerCase();
        const firstIndex = seenAt.get(key);
        if (firstIndex !== undefined) {
          errors.push({
            path: `subtasks[${i}].title`,
            message: `subtasks[${i}].title: duplicate subtask title '${s.title}' (already used at subtasks[${firstIndex}])`,
          });
        } else {
          seenAt.set(key, i);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, proposal: { subtasks: validSubtasks } };
}

// ---------------------------------------------------------------------------
// Local deterministic generator -- today's stand-in for a real AI call
// ---------------------------------------------------------------------------

/** Verbatim copy of `ADHDTaskSplitter.tsx`'s pre-existing label table --
 *  preserving the feature's existing behaviour/Turkish copy is this task's
 *  explicit brief, not a detail left to chance. */
export const SPLIT_LABELS: Record<number, string[]> = {
  15: ['Başlangıç', 'Devam', 'Bitiş'],
  25: ['1. Pomodoro', '2. Pomodoro', '3. Pomodoro'],
  45: ['Hazırlık & Araştırma', 'Ana Çalışma', 'Gözden Geçirme'],
};

const DEFAULT_SPLIT_LABELS = ['Parça 1', 'Parça 2', 'Parça 3'];

/**
 * Builds today's subtask proposal for a given parent task title and chosen
 * duration preset. This is the "task decomposition service" box in plan
 * §15's pipeline, standing in for a real AI call: no edge function for task
 * splitting exists in this codebase (see this task's Edge Function
 * Findings), and deploying a new one is out of scope (`supabase/**` is
 * off-limits). Reproduces the OLD component's exact template logic
 * (`${title} — ${label}` / `${minutes} dk blok (i/n)`) so the user-facing
 * behaviour is unchanged.
 *
 * Returns `unknown` ON PURPOSE, not `SubtaskDecompositionProposal` --
 * even though this particular generator is trusted/deterministic, the
 * caller (`ADHDTaskSplitter.tsx`) is required to push EVERY proposal,
 * regardless of source, through `validateSubtaskProposal` before it can
 * reach a preview. That is what keeps this seam swap-in-ready for a real,
 * hostile-input-capable AI response later without moving the validation
 * boundary -- the same discipline that makes `routineProposal.ts`'s
 * `adaptEdgeRoutineResponse` a bridge INTO its own strict validator, never a
 * parallel looser one.
 */
export function buildLocalSplitProposal(taskTitle: string, minutes: number): unknown {
  const labels = SPLIT_LABELS[minutes] ?? DEFAULT_SPLIT_LABELS;
  return {
    subtasks: labels.map((label, i) => ({
      title: `${taskTitle} — ${label}`,
      description: `${minutes} dk blok (${i + 1}/${labels.length})`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Assembly -- turning a VALIDATED proposal into a real insert payload
// ---------------------------------------------------------------------------

/** The subset of the parent `Task` every subtask inherits -- never AI-
 *  originated, always read straight off the real task being split. */
export type ParentTaskContext = Pick<Task, 'priority' | 'due_date' | 'project_id' | 'list_type'>;

/**
 * Structurally identical to `repositories/taskRepository.ts`'s
 * `SplitTaskInput` -- re-declared here rather than imported because `lib/**`
 * does not depend on `repositories/**` anywhere in this codebase (the
 * dependency only ever runs the other way: repositories import from `lib/**`
 * and `store/**`). If `SplitTaskInput`'s shape ever changes, this type must
 * be kept in sync with it -- exactly the same trade-off `routineProposal.ts`
 * accepts by re-declaring its own `ProposalHabit` instead of importing
 * `Habit` wholesale.
 */
export type SplitTaskInputLike = {
  title: string;
  description: string;
  status: 'pending';
  priority: Task['priority'];
  due_date: string | null;
  project_id: string | null;
  list_type: Task['list_type'];
  completed: boolean;
};

/**
 * Turns an ALREADY-VALIDATED `SubtaskDecompositionProposal` into real
 * `tasks`-insert payloads, never called with raw/unvalidated input (there is
 * no schema check here, only field assembly -- mirrors
 * `routineProposal.evaluateProposal`'s own "only call this on validated
 * input" contract).
 *
 * `description ?? ''` is the ONLY coercion in this whole module, and it is
 * not "inventing an AI fact": `description: null` from a validated proposal
 * means "the proposal genuinely supplied no description", a fact this
 * function is allowed to know about; `''` is simply how the DB's
 * non-nullable `description` column represents "none supplied" (see
 * `SplitTaskInput`'s own type -- it is `string`, not `string | null`). This
 * is the same category of structural default `routineProposal.ts`'s install
 * path already applies to fields the AI schema never covers (`icon: null`,
 * `unit: null`), not a guess about a value the AI DID supply.
 */
export function toSplitTaskInputs(
  proposal: SubtaskDecompositionProposal,
  parent: ParentTaskContext,
): SplitTaskInputLike[] {
  return proposal.subtasks.map((s) => ({
    title: s.title,
    description: s.description ?? '',
    status: 'pending' as const,
    priority: parent.priority,
    due_date: parent.due_date ?? null,
    project_id: parent.project_id ?? null,
    list_type: parent.list_type,
    completed: false,
  }));
}
