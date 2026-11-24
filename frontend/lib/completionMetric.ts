/**
 * F13 — Single completion metric contract (INT-01, INT-06, INT-07, DOM-20).
 *
 * Pure domain logic: no I/O, no `new Date()`, no React, no store, and no
 * imports from `habitSchedule`, `reportMetrics`, or `behaviorIntelligence`
 * (preventing circular dependencies). Day-walking callers keep ownership of
 * schedule eligibility (`isEligibleOn`) and ask `judgeDay` / `dayCredit` for
 * the canonical per-day verdict and credit.
 */
import type { Habit, HabitLog } from './supabase';
import { completionRatio, isMeasurableTracking, type HabitLogState } from './habitEngine';

/**
 * `'weighted'`: partial days count by their measured ratio (or 0.5 when unmeasured);
 * used by reports, behavior intelligence, insight digests, and habit strength.
 * `'strict_done'`: only `done` counts (partial = 0); used by mastery certification
 * (`habitSchedule.scheduledCompletionRate` -> `capacity.masteryStatus`).
 */
export type CompletionPolicy = 'weighted' | 'strict_done';

export type DayHabit = Pick<Habit, 'behavior_type'> &
  Partial<Pick<Habit, 'tracking_type' | 'daily_goal' | 'target_direction'>>;

export type DayLog = { state: HabitLog['state']; value?: number | null };

export type DayVerdict =
  | { kind: 'credit'; credit: number }   // 0..1; enters both numerator and denominator
  | { kind: 'excused' }                  // skip: excluded from both numerator and denominator
  | { kind: 'pending' }                  // in-range but not yet lived: future day or unlogged asOf day
  | { kind: 'unknown' }                  // unlogged negative habit day: neither success nor failure
  | { kind: 'not_scheduled' };           // not eligible / paused / outside lifetime

/** `done` | `partial`. Binary completion predicate for streaks, counted days, and completedDays (AC-H07/H08). */
export function isCompletedState(state: HabitLog['state']): boolean {
  return state === 'done' || state === 'partial';
}

/**
 * Per-day credit in `[0, 1]`.
 *
 * - `'strict_done'`: `done` = 1, everything else (including `partial`) = 0.
 * - `'weighted'` (default): `done` = 1; `partial` = direction-aware `completionRatio`
 *   when measurable with numeric `value` and `daily_goal >= 0`, otherwise `0.5`;
 *   `miss` = 0; `skip` = 0 (`judgeDay` filters `skip` before reaching `dayCredit`).
 */
export function dayCredit(
  habit: DayHabit,
  log: DayLog,
  policy: CompletionPolicy = 'weighted',
): number {
  if (policy === 'strict_done') {
    return log.state === 'done' ? 1 : 0;
  }

  if (!isCompletedState(log.state)) return 0;

  if (habit.tracking_type && isMeasurableTracking(habit.tracking_type)) {
    if (typeof log.value === 'number' && habit.daily_goal != null && habit.daily_goal >= 0) {
      const ratio = completionRatio({
        trackingType: habit.tracking_type === 'duration' ? 'duration' : 'numeric',
        state: log.state as HabitLogState,
        value: log.value,
        target: habit.daily_goal,
        direction: habit.target_direction,
      });
      return Math.max(0, Math.min(1, ratio));
    }
    if (log.state === 'done') return 1;
    if (log.state === 'partial') return 0.5;
    return 0;
  }

  if (log.state === 'done') return 1;
  if (log.state === 'partial') return 0.5;
  return 0;
}

export function judgeDay(p: {
  habit: DayHabit;
  /** Caller's `isEligibleOn` verdict; `false` -> `not_scheduled`. Defaults to `true`. */
  eligible?: boolean;
  /** Local `'yyyy-MM-dd'`. */
  dayYmd: string;
  /**
   * When provided: `dayYmd > asOfYmd` -> `pending`; `dayYmd === asOfYmd` with no log -> `pending`.
   * When omitted (`null`/`undefined`), no clipping occurs.
   */
  asOfYmd?: string | null;
  log?: DayLog;
  policy?: CompletionPolicy;
}): DayVerdict {
  if (p.eligible === false) return { kind: 'not_scheduled' };

  if (p.asOfYmd != null) {
    if (p.dayYmd > p.asOfYmd) return { kind: 'pending' };
    if (p.dayYmd === p.asOfYmd && !p.log) return { kind: 'pending' };
  }

  if (p.log?.state === 'skip') return { kind: 'excused' };
  if (!p.log && p.habit.behavior_type === 'negative') return { kind: 'unknown' };
  if (!p.log) return { kind: 'credit', credit: 0 };

  return { kind: 'credit', credit: dayCredit(p.habit, p.log, p.policy) };
}

export type Completion = { due: number; credit: number };

export function emptyCompletion(): Completion {
  return { due: 0, credit: 0 };
}

export function addVerdict(acc: Completion, v: DayVerdict): Completion {
  if (v.kind !== 'credit') return acc;
  return { due: acc.due + 1, credit: acc.credit + v.credit };
}

/** `due > 0 ? credit / due : null` (`null` means no data, never a fabricated `0`). */
export function toRate(c: Completion): number | null {
  return c.due > 0 ? c.credit / c.due : null;
}

export function toPercent(c: Completion): number | null {
  const rate = toRate(c);
  return rate === null ? null : Math.round(rate * 100);
}

/** Maps `habitSchedule.periodStatus` output into `DayVerdict` for count-based schedules. */
export type PeriodLike = { status: string; reason: string; target: number; counted: number };

export function periodVerdict(st: PeriodLike): DayVerdict {
  if (st.status === 'satisfied') return { kind: 'credit', credit: 1 };
  if (st.status === 'closed_unmet') {
    return st.target > 0
      ? { kind: 'credit', credit: Math.min(1, Math.max(0, st.counted / st.target)) }
      : { kind: 'unknown' };
  }
  if (st.status === 'in_progress' || st.status === 'not_started') return { kind: 'pending' };
  if (st.status === 'paused') return { kind: 'not_scheduled' };
  if (st.status === 'unknown') {
    return st.reason === 'not_scheduled' || st.reason === 'habit_paused'
      ? { kind: 'not_scheduled' }
      : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// Statistical sample-size thresholds (INT-07). Single source for BI and insightDigest.
export const MIN_WEEKDAY_DISTINCT_DATES = 3;
export const WEEKDAY_PATTERN_WINDOW_DAYS = 56;
export const MIN_TREND_DAYS = 14;
export const MIN_WEEK_LIVED_DAYS = 3;
export const MIN_TREND_DELTA = 0.05;
export const MIN_LOGS_FOR_STRENGTH = 10;
