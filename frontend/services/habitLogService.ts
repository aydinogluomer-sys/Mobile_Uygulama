/**
 * Habit completion — the domain operation.  (plan §8 service layer)
 *
 * ## What belongs here and what does not
 *
 * The store used to own all of this. That put four different kinds of
 * decision in one file: how a value becomes a state, how a state becomes XP,
 * how a write resolves against an existing row, and what the screen shows
 * while any of it is in flight. Only the last is UI state.
 *
 * What moved here:
 *   - deriving the log state from a value against its target AND direction
 *   - the XP the completion is worth
 *   - the insert / update / 23505-recovery decision
 *
 * What stayed in the store:
 *   - optimistic rows, the serialise chain, the offline queue, sync counts
 *
 * The split matters beyond tidiness: the write decision is shared by a live
 * tap and an offline replay, and both must reach the same answer. Having it
 * in one exported function makes that structural rather than a convention
 * two code paths happen to follow.
 */
import { notify } from './webhookService';
import { LOG_TIMEZONE_ENABLED } from '../lib/featureGates';
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
} from '../repositories/habitLogRepository';
import { describeHabitLogError } from '../lib/pgErrors';

export type LogState = HabitLog['state'];

/** The persisted shape of one completion. */
export type LogPatch = {
  state: LogState;
  value: number | null;
  xp: number;
  is_completed: boolean;
  /** R01.06 — tap-time zone; sent only while LOG_TIMEZONE_ENABLED. */
  tz?: string;
};

export type CompletionIntent = {
  state: LogState;
  value?: number;
  targetValue?: number;
  baseXp?: number;
  targetDirection?: TargetDirection;
  tz?: string;
};

export const DEFAULT_BASE_XP = 30;

/**
 * XP for one completion.
 *
 * A `done` day is worth the full base. A `partial` day is worth the base
 * scaled by the completion ratio — which is where `direction` matters: for a
 * ceiling ("at most 2"), an at_least ratio clamps any overshoot to 1 and
 * would award FULL XP for exceeding the limit.
 *
 * Anything else is worth nothing. `miss` and `skip` are not partial credit.
 */
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
  };
}

/**
 * The state a logged VALUE implies for a habit, given its own tracking type,
 * target and direction. `value` is the DAY'S TOTAL (see `measuredEntryFor`).
 *
 * Screens used to work this out themselves — `value >= remaining ? 'done' :
 * 'partial'`, which is floor arithmetic and calls a perfect ceiling day
 * partial. There is one answer and it lives here. (R01.03-a: this doc used to
 * claim that while `app/tabs/timeline.tsx` still did it; the screen now hands
 * the day total to `measuredEntryFor` and no screen decides a state. Pinned by
 * `__tests__/repo/measurableStateAuthority.test.ts`.)
 */
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

/**
 * R01.03-a — THE CONTRACT: `habit_logs.value` is THE DAY'S TOTAL, never the
 * amount of one entry. (Owner decision.)
 *
 * Why: `completionRatio`, `habitLogPercent` and `habitStrength` already read
 * `value` against `daily_goal` as a same-day ratio; a ceiling (`at_most`)
 * already reads it as absolute; and with `UNIQUE (habit_id, date)` a row
 * describes a DAY, not an event. Writing an increment made the row lie: "6 then
 * 4 more" against 10 was stored as `value: 4, state: 'done'` -- 40% to every
 * ratio reader, "done" to every state reader -- and the day's real total was
 * lost.
 *
 * Adding is still how the user enters it ("4 ekle"); this is where the add
 * happens, once. `priorDayValue` is the value already on the day's row
 * (`undefined`/`null` = none). A non-finite or negative prior counts as 0; a
 * non-finite or negative entry adds nothing. Rounded to 1e-6 so 0.1 + 0.2 is
 * not written as 0.30000000000000004.
 */
export function dayTotalAfterEntry(priorDayValue: number | null | undefined, entered: number): number {
  const prior = typeof priorDayValue === 'number' && Number.isFinite(priorDayValue) && priorDayValue > 0 ? priorDayValue : 0;
  const add = Number.isFinite(entered) && entered > 0 ? entered : 0;
  return Math.round((prior + add) * 1e6) / 1e6;
}

/**
 * The intent for one measurable entry: the day total after it, and the state,
 * XP and target derived FROM THAT TOTAL by `completionFor`. Screens call this
 * and pass the result to `logStore.logHabit` unchanged -- they never decide a
 * state themselves. Same rule for both directions: for a ceiling ("en çok 2")
 * a second entry adds to the day as well (2 then 1 more is 3, over the limit),
 * where the old screen wrote the latest entry alone and hid the overshoot.
 */
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
  /** `offline` = the request never reached the server. See `isTransportFailure`. */
  | { ok: false; error: string; offline?: boolean };

/**
 * Writes one completion, resolving insert vs update against what is already
 * stored.
 *
 * `confirmedId` is the caller's existing CONFIRMED row for this (habit, day)
 * — never an optimistic placeholder, which is a guess and not something to
 * update against.
 *
 * The 23505 branch is the reason this is one function. A unique violation
 * means the row exists in the database but not in the caller's state: another
 * device wrote it, the date was never fetched, or an earlier session's write
 * landed before the app was killed and this is that same intent replaying.
 * Recovering and updating is what makes a cold-start replay idempotent
 * against `UNIQUE (habit_id, completed_at)` whether or not this process has
 * ever seen the row.
 */
/**
 * Tells the user's own automations that a habit was completed.
 *
 * Only for `done`. A partial or a miss is not a completion, and the legacy
 * service fired on the same condition, so an existing n8n flow keeps its
 * meaning. Never awaited -- see `notify` in webhookService.
 */
function announce(habitId: string, dateStr: string, log: HabitLog): void {
  if (log.state !== 'done') return;
  notify('habit_completed', {
    habit_id: habitId,
    date: dateStr,
    state: log.state,
    value: log.value ?? null,
  });
}

/**
 * R01.06 — what actually goes over the wire. The zone is dropped until
 * migration 033 adds the column (LOG_TIMEZONE_ENABLED); everything else is
 * the patch unchanged.
 */
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

/**
 * F03 — every failure of a write leaves through this one door, so a server refusal
 * of migration 038 (`habit_log_day_out_of_range`, `habit_log_key_immutable`) reaches
 * the user as calm Turkish copy whichever branch produced it (update, insert, or the
 * 23505 recovery). One wrapper rather than one call per `return`: a fourth failure
 * branch added later cannot forget it. `offline` and every other field are kept.
 */
export async function persistCompletion(params: PersistParams): Promise<PersistResult> {
  const res = await persistCompletionRaw(params);
  if (res.ok) return res;
  return { ...res, error: describeHabitLogError(res.error) };
}

async function persistCompletionRaw(params: PersistParams): Promise<PersistResult> {
  params = { ...params, patch: wirePatch(params.patch) as LogPatch };
  if (params.confirmedId) {
    const updated = await repoUpdateHabitLog(params.confirmedId, params.patch as Record<string, unknown>);
    if (!updated.ok) return { ok: false, error: updated.error, offline: updated.offline };
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
      if (!updated.ok) return { ok: false, error: updated.error, offline: updated.offline };
      announce(params.habitId, params.dateStr, updated.data);
      return { ok: true, log: updated.data };
    }
  }

  return { ok: false, error: inserted.error, offline: inserted.offline };
}

/** Every log for one local day, for the signed-in user. */
export async function loadDay(dateStr: string): Promise<
  { ok: true; logs: HabitLog[] } | { ok: false; error: string }
> {
  const res = await repoFetchLogsForDate(dateStr);
  return res.ok ? { ok: true, logs: res.data } : { ok: false, error: res.error };
}
