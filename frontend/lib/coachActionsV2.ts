/**
 * R09.02 / R09.03 / R09.04 — the coach's second set of actions, and the
 * version check every coach action passes before it writes.
 *
 * Each action maps onto a command the app already has; the coach never
 * writes anything a screen could not:
 *   edit_habit_schedule  -> habitStore.updateHabit(frequencyEditPatch(...))   (versioned, R01.05)
 *   pause_habit          -> habitStore.addTimeOff(habitId, draft)            (dated break, R01.05)
 *   move_task            -> taskStore.updateTask(id, { due_date })           (outbox, R02)
 *   suggest_small_step   -> focusStore.startSmallStep(parent, draft)         (R03.03)
 *   lighten_today        -> a `skip` log today for the habits the USER keeps  (R03.02)
 *
 * The four places an action type must agree on stay in step: this
 * validator, the edge function's tool schema
 * (supabase/functions/generate-routine), the database CHECK on
 * ai_conversation_actions.action_type (migration 032, written, NOT applied)
 * and the gate `COACH_ACTIONS_V2_ENABLED` (false until both server halves
 * are live: S2 + S3).
 *
 * R09.03: a staged action is a promise about an entity AS IT WAS. Before the
 * write, the entity's fingerprint is compared with the one taken at staging;
 * if it changed (edited elsewhere, archived, deleted) the action is NOT
 * applied -- it is re-previewed against the current entity, or dropped.
 *
 * Pure.
 */
import { validateFrequencyConfig } from './routineProposal';
import { resolveCoachDate } from './coachActions';
import { canonical } from './backupFormat';
import type { FrequencyConfig, Habit } from './supabase';

export const V2_ACTION_TYPES = ['edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today'] as const;
export type V2ActionType = (typeof V2_ACTION_TYPES)[number];

export type CoachActionV2 =
  | { type: 'edit_habit_schedule'; habit_query: string; frequency_config: FrequencyConfig }
  | { type: 'pause_habit'; habit_query: string; from: string; until: string | null }
  | { type: 'move_task'; task_query: string; date: string }
  | { type: 'suggest_small_step'; task_query: string; step: string; minutes: number }
  | { type: 'lighten_today'; habit_queries: string[] };

const ALLOWED: Record<V2ActionType, Set<string>> = {
  edit_habit_schedule: new Set(['type', 'habit_query', 'frequency_config']),
  pause_habit: new Set(['type', 'habit_query', 'from', 'until']),
  move_task: new Set(['type', 'task_query', 'date']),
  suggest_small_step: new Set(['type', 'task_query', 'step', 'minutes']),
  lighten_today: new Set(['type', 'habit_queries']),
};

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};

export function isV2Type(t: unknown): t is V2ActionType {
  return typeof t === 'string' && (V2_ACTION_TYPES as readonly string[]).includes(t);
}

/** Validate one v2 action; a string is the reason it was refused. `raw` has already passed the forbidden/authority-key checks. */
export function readActionV2(raw: Record<string, unknown>, today: string, now: Date = new Date()): CoachActionV2 | string {
  const t = raw.type as V2ActionType;
  if (!Object.keys(raw).every((k) => ALLOWED[t].has(k))) return 'unexpected key for ' + t;
  switch (t) {
    case 'edit_habit_schedule': {
      const q = str(raw.habit_query, 80);
      if (!q) return 'invalid habit_query';
      const fc = validateFrequencyConfig(raw.frequency_config, 'frequency_config');
      if (!fc.frequency) return 'invalid frequency_config';
      return { type: t, habit_query: q, frequency_config: fc.frequency };
    }
    case 'pause_habit': {
      const q = str(raw.habit_query, 80);
      if (!q) return 'invalid habit_query';
      const from = resolveCoachDate(raw.from, now);
      if (!from) return 'invalid from';
      if (from < today) return 'a break cannot start in the past';
      let until: string | null = null;
      if (raw.until !== undefined && raw.until !== null) {
        until = resolveCoachDate(raw.until, now);
        if (!until) return 'invalid until';
        if (until < from) return 'until before from';
      }
      return { type: t, habit_query: q, from, until };
    }
    case 'move_task': {
      const q = str(raw.task_query, 80);
      if (!q) return 'invalid task_query';
      const date = resolveCoachDate(raw.date, now);
      if (!date) return 'invalid date';
      return { type: t, task_query: q, date };
    }
    case 'suggest_small_step': {
      const q = str(raw.task_query, 80);
      if (!q) return 'invalid task_query';
      const step = str(raw.step, 120);
      if (!step) return 'invalid step';
      const m = raw.minutes;
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 60) return 'invalid minutes';
      return { type: t, task_query: q, step, minutes: m };
    }
    case 'lighten_today': {
      if (!Array.isArray(raw.habit_queries) || raw.habit_queries.length === 0 || raw.habit_queries.length > 10) return 'invalid habit_queries';
      const qs: string[] = [];
      for (const x of raw.habit_queries) { const q = str(x, 80); if (!q) return 'invalid habit_query'; if (!qs.includes(q)) qs.push(q); }
      return { type: t, habit_queries: qs };
    }
  }
}

// ---------------------------------------------------------------------------
// Resolving a task by what the user called it
// ---------------------------------------------------------------------------

export type TaskLike = { id: string; title: string; completed: boolean; status: string; due_date?: string | null; updated_at?: string | null };

export type TaskResolution<T> = { kind: 'one'; task: T } | { kind: 'ambiguous'; candidates: T[] } | { kind: 'none' };

/** Open tasks only; exact (case-folded) title first, then a unique containment. Never guesses between two. */
export function resolveTaskQuery<T extends TaskLike>(query: string, tasks: readonly T[]): TaskResolution<T> {
  const q = query.trim().toLocaleLowerCase('tr');
  const open = tasks.filter((t) => !t.completed && t.status !== 'cancelled');
  const exact = open.filter((t) => t.title.trim().toLocaleLowerCase('tr') === q);
  if (exact.length === 1) return { kind: 'one', task: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.slice(0, 5) };
  const part = open.filter((t) => t.title.toLocaleLowerCase('tr').includes(q));
  if (part.length === 1) return { kind: 'one', task: part[0] };
  if (part.length > 1) return { kind: 'ambiguous', candidates: part.slice(0, 5) };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// R09.03 — entity fingerprints
// ---------------------------------------------------------------------------

/** What a habit write depends on. A change in any of these makes a staged action stale. */
export function habitFingerprint(h: Pick<Habit, 'tracking_type' | 'daily_goal' | 'target_direction' | 'unit' | 'status' | 'frequency_config' | 'behavior_type'>): string {
  return canonical({
    t: h.tracking_type, g: h.daily_goal ?? null, d: h.target_direction ?? null, u: h.unit ?? null,
    s: h.status, f: h.frequency_config ?? null, b: h.behavior_type,
  });
}

export function taskFingerprint(t: TaskLike): string {
  return canonical({ ti: t.title, c: t.completed, s: t.status, d: t.due_date ?? null, v: t.updated_at ?? null });
}

export type Staleness = 'same' | 'changed' | 'gone';

/** Compare the fingerprint taken at staging with the entity now. */
export function staleness<T>(stagedFingerprint: string, current: T | undefined, fingerprint: (x: T) => string): Staleness {
  if (current === undefined) return 'gone';
  return fingerprint(current) === stagedFingerprint ? 'same' : 'changed';
}
