/**
 * Habit completion — the domain operation.  (plan §8 service layer)
 */
import { notify } from './webhookService';
import { LOG_TIMEZONE_ENABLED } from '../lib/featureGates';
import { roundToScale } from '../lib/localeNumber';
import type { Habit, HabitLog } from '../lib/supabase';
import {
  adaptTrackingType,
  completionRatio,
  deriveState,
  type TargetDirection,
} from '../lib/habitEngine';
import {
  fetchLogsForDate as repoFetchLogsForDate,
  findHabitLog as repoFindHabitLog,
  insertHabitLog as repoInsertHabitLog,
  updateHabitLog as repoUpdateHabitLog,
  updateLogNote as repoUpdateLogNote,
} from '../repositories/habitLogRepository';
import { normalizeNote } from '../lib/habitNote';
import { habitLogEntityId } from '../lib/outboxEngine';
import { describeHabitLogError } from '../lib/pgErrors';
import { isTransientStatus } from '../repositories/shared';

export type LogState = HabitLog['state'];

/** The persisted shape of one completion. */
export type LogPatch = {
  state: LogState;
  value: number | null;
  xp: number;
  is_completed: boolean;
  /** R01.06 — tap-time zone; sent only while LOG_TIMEZONE_ENABLED. */
  tz?: string;
  /** F31 (PS-03) — optional private single-line note; omitted when untouched. */
  notes?: string | null;
};

export type CompletionIntent = {
  state: LogState;
  value?: number;
  targetValue?: number;
  baseXp?: number;
  targetDirection?: TargetDirection;
  tz?: string;
  note?: string | null;
};

export const DEFAULT_BASE_XP = 30;

export function xpFor(intent: CompletionIntent): number {
  const base = intent.baseXp ?? DEFAULT_BASE_XP;
  if (intent.state === 'done') return base;
  if (intent.state !== 'partial') return 0;
  const measurable = intent.targetValue != null && intent.targetValue > 0;
  const ratio = completionRatio({
    trackingType: measurable ? 'numeric' : 'binary',
    state: intent.state,
    value: intent.value,
    target: intent.targetValue,
    direction: intent.targetDirection,
  });
  return Math.round(base * ratio);
}

/** Turns an intent into the row the database stores. */
export function toPatch(intent: CompletionIntent): LogPatch {
  return {
    state: intent.state,
    value: intent.value ?? null,
    xp: xpFor(intent),
    is_completed: intent.state === 'done',
    // R01.06 — only a sane zone (a hydrated queue is untrusted input).
    ...(typeof intent.tz === 'string' && intent.tz.length >= 1 && intent.tz.length <= 64 ? { tz: intent.tz } : {}),
    ...(intent.note !== undefined ? { notes: normalizeNote(intent.note) ?? null } : {}),
  };
}

export function stateForValue(
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>,
  value: number,
): 'done' | 'partial' | 'miss' {
  return deriveState({
    trackingType: adaptTrackingType(habit),
    value,
    target: habit.daily_goal,
    direction: habit.target_direction,
  });
}

/** Builds the full intent for logging `value` against `habit`. */
export function completionFor(
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>,
  value: number,
  baseXp = DEFAULT_BASE_XP,
): CompletionIntent {
  return {
    state: stateForValue(habit, value),
    value,
    targetValue: habit.daily_goal ?? undefined,
    targetDirection: habit.target_direction ?? undefined,
    baseXp,
  };
}

export function dayTotalAfterEntry(priorDayValue: number | null | undefined, entered: number): number {
  const prior = typeof priorDayValue === 'number' && Number.isFinite(priorDayValue) && priorDayValue > 0 ? priorDayValue : 0;
  const add = Number.isFinite(entered) && entered > 0 ? entered : 0;
  return roundToScale(prior + add, 2);
}

export function measuredEntryFor(
  habit: Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>,
  priorDayValue: number | null | undefined,
  entered: number,
  baseXp = DEFAULT_BASE_XP,
): CompletionIntent & { value: number } {
  const total = dayTotalAfterEntry(priorDayValue, entered);
  return { ...completionFor(habit, total, baseXp), value: total };
}

export type PersistResult =
  | { ok: true; log: HabitLog }
  | { ok: false; error: string; offline?: boolean; retryable?: boolean };

function transient(status: number | null | undefined): { retryable?: true } {
  return isTransientStatus(status) ? { retryable: true } : {};
}

/**
 * F46 (DOM-21, SYN-26): announces every `done` row with deterministic `subjectKey`
 * (`habitId|dateStr`). Same-day repeat completions and 23505 lost-response replays
 * map to the same `wh1.habit_completed.<habitId|date>.<webhookId>` operation ID in
 * `effectChannel`, so the first real completion is never skipped after a lost response
 * and a second completion on the same day is deduplicated for 14 days.
 */
function announce(habitId: string, dateStr: string, log: HabitLog): void {
  if (log.state !== 'done') return;
  notify(
    'habit_completed',
    {
      habit_id: habitId,
      date: dateStr,
      state: log.state,
      value: log.value ?? null,
    },
    { subjectKey: habitLogEntityId(habitId, dateStr) },
  );
}

function wirePatch(patch: LogPatch): Record<string, unknown> {
  if (LOG_TIMEZONE_ENABLED) return patch as Record<string, unknown>;
  const { tz: _held, ...rest } = patch;
  return rest as Record<string, unknown>;
}

type PersistParams = {
  habitId: string;
  dateStr: string;
  patch: LogPatch;
  confirmedId?: string;
};

export async function persistCompletion(params: PersistParams): Promise<PersistResult> {
  const res = await persistCompletionRaw(params);
  if (res.ok) return res;
  return { ...res, error: describeHabitLogError(res.error) };
}

async function persistCompletionRaw(params: PersistParams): Promise<PersistResult> {
  params = { ...params, patch: wirePatch(params.patch) as LogPatch };
  if (params.confirmedId) {
    const updated = await repoUpdateHabitLog(params.confirmedId, params.patch as Record<string, unknown>);
    if (!updated.ok) return { ok: false, error: updated.error, offline: updated.offline, ...transient(updated.status) };
    announce(params.habitId, params.dateStr, updated.data);
    return { ok: true, log: updated.data };
  }

  const inserted = await repoInsertHabitLog({
    habitId: params.habitId,
    dateStr: params.dateStr,
    patch: params.patch as Record<string, unknown>,
  });
  if (inserted.ok) {
    announce(params.habitId, params.dateStr, inserted.data);
    return { ok: true, log: inserted.data };
  }

  if (inserted.code === '23505') {
    const found = await repoFindHabitLog({ habitId: params.habitId, dateStr: params.dateStr });
    if (found.ok && found.data) {
      const updated = await repoUpdateHabitLog(found.data.id, params.patch as Record<string, unknown>);
      if (!updated.ok) return { ok: false, error: updated.error, offline: updated.offline, ...transient(updated.status) };
      announce(params.habitId, params.dateStr, updated.data);
      return { ok: true, log: updated.data };
    }
  }

  return { ok: false, error: inserted.error, offline: inserted.offline, ...transient(inserted.status) };
}

/** Every log for one local day, for the signed-in user. */
export async function loadDay(dateStr: string): Promise<
  { ok: true; logs: HabitLog[] } | { ok: false; error: string }
> {
  const res = await repoFetchLogsForDate(dateStr);
  return res.ok ? { ok: true, logs: res.data } : { ok: false, error: res.error };
}

export type SaveLogNoteResult =
  | { ok: true; notes: string | null }
  | { ok: false; error: string; offline?: boolean; code?: string };

/**
 * F31 (PS-03) — edits ONLY `notes` on an existing `habit_logs` row.
 * Never sends `xp`, `state`, or `value`, never inserts, and never fires webhooks.
 */
export async function saveLogNote(params: {
  habitId: string;
  dateStr: string;
  note: string | null;
}): Promise<SaveLogNoteResult> {
  const normalized = normalizeNote(params.note) ?? null;
  const res = await repoUpdateLogNote({
    habitId: params.habitId,
    dateStr: params.dateStr,
    note: normalized,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: describeHabitLogError(res.error),
      ...(res.offline ? { offline: true } : {}),
      ...(res.code ? { code: res.code } : {}),
    };
  }
  return { ok: true, notes: res.data.notes };
}
