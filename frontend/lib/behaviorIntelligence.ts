/**
 * Behavior Intelligence Engine V1.  (Phase 2, CODER-G, plan §11 / Gate C)
 *
 * Pure domain logic. No I/O, no `supabase` import, no React, no store. This
 * module reads plain habit/log/recovery-plan arrays and derives the ten
 * signals plan §11 names:
 *
 *   En başarılı gün / En zayıf gün   -> weekdayBreakdown + bestWeekday/worstWeekday
 *   En güçlü habit                   -> strongestHabit (reuses habitStrength)
 *   En kırılgan habit                -> mostFragileHabit (variance, not a bare rate)
 *   Son 4 hafta / 12 hafta trend      -> completionTrend({ weeks: 4|12 })
 *   En sık telafi edilen habit        -> mostRecoveredHabit
 *   Telafi başarı oranı               -> recoverySuccessRate
 *   Sabah/akşam farkı                 -> morningEveningDifference (honest gap, see below)
 *   Streak stability                  -> streakStability (built on currentStreak/longestStreak)
 *
 * ## Gate C -- "exact", not "approximately right"
 *
 * Plan §24 Gate C: "Completion rate exact · Streak exact · Recovery rate
 * exact · Capacity history exact ... AI kullanılmadan doğru çalışmalıdır."
 * Every metric here is plain arithmetic over the caller-supplied rows --
 * counts, ratios, variance -- reproducible by hand from the same rows. There
 * is no sampling, no heuristic classifier, no AI call anywhere in this file.
 * ("Capacity history exact" is `lib/capacity.ts`'s `dailyLoad`/`bandFor`,
 * already implemented elsewhere; it is not part of this file's scope.)
 *
 * ## The "insufficient data" rule -- read this before adding a new metric
 *
 * `willpowerStore.score()` returns `null` instead of a made-up 100 for "no
 * reading yet", with an explicit comment: a guess presented as a measurement
 * is a bug, not a convenience. Every ranking/rate function in this file
 * follows the same rule via the `Result<T>` type below: `{ ok: true, value }`
 * for a real, non-fabricated answer, `{ ok: false, reason }` when the sample
 * is too thin to trust. `0` is used ONLY when it is itself the true,
 * evidenced answer (e.g. `currentStreak` returning `0` for "no streak right
 * now" is a real fact, not a guess) -- never as a stand-in for "unknown".
 * Each function's doc states its minimum sample size and why.
 *
 * ## Denominators are SCHEDULED days, not calendar days
 *
 * This is, per this task's own brief, the single most important correctness
 * decision in the file. A habit due 3x/week must never be scored against 7
 * calendar days -- `reportMetrics.calculateHabitCompletionRate` already
 * established this precedent (payda DUE günlerdir, takvim günleri değil) via
 * `habitSchedule.isDueOn`, and every day-walking function below follows the
 * same precedent, for the same reason.
 *
 * F13 (INT-01, INT-06): every eligible day is then judged by
 * `completionMetric.judgeDay`, the same verdict `reportMetrics` uses. Only a
 * `credit` day enters a denominator. Not counted: a future day or an unlogged
 * `asOf` day when the caller passes `asOf` (`pending` -- not yet lived), and an
 * unlogged day of a NEGATIVE habit (`unknown` -- neither success nor failure).
 * A `partial` day is credited by its measured ratio (`dayCredit`, 0.5 when
 * unmeasured), so `completed` is a credit SUM and may be fractional.
 *
 * ## `skip` is excluded from both numerator and denominator, everywhere
 *
 * Consistent with `habitEngine.completionRatio` and `habitStrength`'s bucket
 * walk -- a skipped day is neither a success nor a failure, so it must not
 * lower (nor raise) any rate it appears next to. `judgeDay` returns `excused`
 * for it and every day-walking loop below `continue`s before touching either
 * counter.
 *
 * ## Reuse, not duplication -- what this file calls vs. reimplements
 *
 *  - `isDueOn` / `weekdayIndex` (habitSchedule.ts) -- the schedule oracle for
 *    every "was this day due" question in this file. `windowFor`/
 *    `isWindowSatisfied`/`streakBroken`'s more precise counter-based window
 *    model (for `weekly_count`/`monthly_count` without explicit days) is
 *    deliberately NOT used here -- `reportMetrics.ts`, the codebase's other
 *    schedule-aware analytics module, made the same choice (it also calls
 *    only `isDueOn`), and following that precedent keeps the two "what is a
 *    scheduled day" answers in this codebase from silently diverging.
 *  - `judgeDay` / `isCompletedState` / the sample thresholds
 *    (completionMetric.ts) -- the one day verdict and credit both this file
 *    and `reportMetrics.ts` use (F13: this file no longer imports
 *    `reportMetrics`). `isCompletedState` (`done`/`partial`) stays the binary
 *    rule for streaks.
 *  - `habitStrengthFor` (habitStrength.ts) -- `strongestHabit` below ranks by
 *    its schedule-aware time-weighted 0-100 score rather than inventing a
 *    second "how strong is this habit" number.
 *  - `RecoveryPlanV2`'s status vocabulary (recovery.ts) -- `BIRecoveryPlan`
 *    below is a `Pick` of it, not a parallel type.
 *  - NOT reused: `reportMetrics.habitAveragePercent`/
 *    `calculateHabitCompletionRate`. Those return a rounded 0-100 aggregate
 *    across habits; `habitCompletionRate` below needs an exact per-habit
 *    ratio usable identically for weekday/trend/fragility denominators. Both
 *    are built from the same two primitives (`isEligibleOn` + `judgeDay`), so
 *    the two answers agree without one being a special case of the other.
 *  - NOT reused: `capacity.ts`'s private `weeklyStability` (not exported).
 *    `habitFragility` below is a fresh implementation that follows the SAME
 *    transform it documents (`1 - stdDev * 2`, clamped) for the same
 *    documented reason (a [0,1]-bounded rate's stdDev maxes at 0.5), but
 *    computes its per-week rate from `isDueOn` (schedule-aware) rather than
 *    `capacity.ts`'s own documented TODO-approximation (raw log count as the
 *    denominator, undated because `habitSchedule.ts` was off-limits to that
 *    file's author at the time). This file has no such restriction, so it
 *    uses the more correct denominator while keeping the same variance math.
 */
import type { Habit, HabitLog } from './supabase';
import { isEligibleOn, weekdayIndex, scheduleKind, scheduledCompletionRate, periodStatus } from './habitSchedule';
import {
  isCompletedState,
  judgeDay,
  MIN_LOGS_FOR_STRENGTH,
  MIN_TREND_DAYS,
  MIN_TREND_DELTA,
  MIN_WEEK_LIVED_DAYS,
  MIN_WEEKDAY_DISTINCT_DATES,
  type DayLog,
} from './completionMetric';
import { habitStrengthFor } from './habitStrength';
import { habitCreatedDay } from './habitCreatedDay';
import type { RecoveryPlanV2 } from './recovery';
import { addDaysLocal, parseLocalDate, startOfWeekLocal, ymd, type Ymd } from './date';

// F13 (INT-07) — the sample thresholds live in `completionMetric.ts` (one
// place for BI and the digest); re-exported here for existing importers.
export { MIN_LOGS_FOR_STRENGTH, MIN_TREND_DAYS, MIN_TREND_DELTA, MIN_WEEK_LIVED_DAYS, MIN_WEEKDAY_DISTINCT_DATES };

// ---------------------------------------------------------------------------
// shared types
// ---------------------------------------------------------------------------

/**
 * The subset of `Habit` every function here reads. A structural `Pick` (not
 * the full row) so fixtures stay small, matching `capacity.ts`'s
 * `HabitLoadInput` convention. The measure fields are optional (F13): when
 * present, a `partial` day is credited by its measured ratio; when absent it
 * gets the standard 0.5 credit.
 */
export type BIHabit = Pick<Habit, 'id' | 'name' | 'behavior_type' | 'created_at' | 'end_condition' | 'frequency_config'>
  & Partial<Pick<Habit, 'status' | 'tracking_type' | 'daily_goal' | 'target_direction'>>;

/** The subset of `HabitLog` every function here reads (`value` optional, for measured partial credit). */
export type BILog = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> & { value?: number | null };

/** The subset of `RecoveryPlanV2` the recovery metrics read. */
export type BIRecoveryPlan = Pick<RecoveryPlanV2, 'habit_id' | 'status'>;

/** A real, non-fabricated answer. */
export type Ok<T> = { ok: true; value: T };
/** An explicit "not enough evidence" signal -- see the file doc above. */
export type Insufficient = { ok: false; reason: string };
export type Result<T> = Ok<T> | Insufficient;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
function insufficient(reason: string): Insufficient {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// minimum sample sizes -- each a deliberate, documented dial, not a guess
// ---------------------------------------------------------------------------

/**
 * A weekday needs at least this many SCHEDULED occurrences within the
 * queried range before its rate is trusted for best/worst-day ranking. 3 is
 * the smallest count that stops a single unusually good or bad day from
 * deciding the answer outright (with 1 or 2 samples, one outlier IS the
 * average). F13 (INT-07): kept as an extra floor; the binding gate is now
 * `MIN_WEEKDAY_DISTINCT_DATES` -- three habits on ONE Monday are three
 * habit-days but a single observation of "Mondays".
 */
export const MIN_WEEKDAY_SAMPLES = 3;

/*
 * `MIN_LOGS_FOR_STRENGTH` (defined in `completionMetric.ts`, re-exported
 * above): `strongestHabit` needs at least this many NON-SKIP logs for a habit
 * before ranking it. A barely-logged habit's strength is "no evidence", not
 * "a measured weak habit", and this file's rule is that a guess must never be
 * presented as a measurement (see the file doc). Filtering candidates here is
 * what keeps a never-logged habit from silently winning "most fragile" or
 * losing "strongest" by an unearned number. F13 (INT-07) raised it from 3 to
 * 10: with one log per day that is at least ten days of life, so a 3-day-old
 * habit with a perfect 3/3 no longer outranks a habit kept for months.
 */

/** Default trailing window `habitFragility` evaluates, in weeks. */
export const FRAGILITY_WEEKS_DEFAULT = 8;

/**
 * `habitFragility` needs at least this many WEEKS-WITH-SCHEDULED-DAYS before
 * its variance is trusted. Variance over 1 point is always exactly 0 (a
 * false "perfectly stable" reading); over 2 points it is technically
 * defined but is really just "how far apart these two numbers are", not a
 * pattern. 3 is the smallest window that can distinguish "consistently
 * medium" from "wildly alternating" with any real confidence.
 */
export const MIN_WEEKS_FOR_FRAGILITY = 3;

/**
 * `currentStreak`'s walk-back safety bound, in days (~10 years). Without a
 * bound, a `daily` habit with no logs at all and a very old `created_at`
 * would walk one day at a time indefinitely. In practice the loop always
 * stops far earlier (at the first due-and-unmet day, or at `created_at`);
 * this is a defensive ceiling, not an expected path.
 */
export const MAX_STREAK_LOOKBACK_DAYS = 3650;

/**
 * The period analogue of `MAX_STREAK_LOOKBACK_DAYS` for `periodStreakBack` /
 * `periodStreakLongest`, which advance a whole week or month per iteration.
 * Reusing the day bound there would stretch the same "~10 years" intent to 70
 * years (weekly) or 300 (monthly), so the ceiling is scaled to periods: 520
 * weeks is ~10 years, and 520 months is far past any real history. As with the
 * day bound the loops stop much earlier in practice -- at the first
 * `closed_unmet` period, or at `created_at`.
 */
const MAX_STREAK_LOOKBACK_PERIODS = 520;

// ---------------------------------------------------------------------------
// shared day-walking helpers (private)
// ---------------------------------------------------------------------------

/** `${habit_id}|${YYYY-MM-DD}` -> `{ state, value }` (F13: `value` feeds `dayCredit`). */
type LogIndex = Map<string, DayLog>;

/**
 * `${habit_id}|${YYYY-MM-DD}` -> `{ state, value }`, last entry wins.
 *
 * Two logs for the same habit on the same day is a store-level invariant
 * violation (see `habitStrength.ts`'s FINDING A-02 note) -- this file
 * inherits that module's documented tie-break (array order, last wins)
 * rather than inventing a different one for the same underlying situation.
 */
function buildLogIndex(logs: BILog[]): LogIndex {
  const map: LogIndex = new Map();
  for (const l of logs) {
    map.set(`${l.habit_id}|${l.completed_at.slice(0, 10)}`, { state: l.state, value: l.value ?? null });
  }
  return map;
}

function isCountBased(habit: BIHabit): boolean {
  const kind = scheduleKind(habit as Habit).kind;
  return kind === 'weekly_count' || kind === 'monthly_count';
}

function createdDate(habit: BIHabit): Date | null {
  const day = habitCreatedDay(habit);
  return day ? parseLocalDate(day) : null;
}

/** The index back into rows for one habit -- what the canonical evaluator consumes. */
function logsFromIndex(habit: BIHabit, logIndex: LogIndex): BILog[] {
  const prefix = `${habit.id}|`;
  const out: BILog[] = [];
  for (const [key, entry] of logIndex) {
    if (key.startsWith(prefix)) out.push({ habit_id: habit.id, completed_at: key.slice(prefix.length), state: entry.state, value: entry.value });
  }
  return out;
}

/**
 * Consecutive satisfied PERIODS for a count-based habit, walking backwards
 * from the period containing `asOf`. The open current period is transparent
 * unless already satisfied: it has time left, so it neither counts nor
 * breaks -- the period analogue of "not due today". A `closed_unmet` period
 * ends the run. Unit is periods (weeks or months), stated in the callers' docs.
 *
 * F13 (DOM-09): a period fully inside a dated pause / holiday (`paused` while
 * the habit itself is not legacy-paused) is transparent too -- the streak
 * bridges a holiday, as `habitPauses.ts` promises. A legacy undated pause
 * (`habit.status === 'paused'`) hides the history and still stops the walk;
 * so does any other `unknown` (`not_scheduled`: walking back reached the
 * start of the range; `no_target`, unsupported amounts).
 */
function periodStreakBack(habit: BIHabit, logs: BILog[], asOf: Date): number {
  const created = createdDate(habit);
  let count = 0;
  let cursor = asOf;
  for (let i = 0; i < MAX_STREAK_LOOKBACK_PERIODS; i++) {
    const st = periodStatus(habit as Habit, logs, cursor, { asOf });
    const datedPause = st.status === 'paused' && habit.status !== 'paused';
    if (!datedPause && (st.status === 'unknown' || st.status === 'paused')) break;
    if (created && ymd(st.periodEnd) < ymd(created)) break;
    if (st.status === 'satisfied') count += 1;
    else if (st.status === 'closed_unmet') break;
    // not_started / in_progress / dated pause: transparent
    cursor = addDaysLocal(st.periodStart, -1);
    if (created && ymd(cursor) < ymd(created) && ymd(st.periodStart) <= ymd(created)) break;
  }
  return count;
}

/**
 * Longest run of consecutive satisfied periods between `since` and `asOf`,
 * walked forward. Open periods are transparent, `closed_unmet` resets.
 *
 * F13 (DOM-09): dated pause / holiday periods are transparent, and so is a
 * period before the schedule's range begins (`unknown` + `not_scheduled`):
 * walking forward, the range has simply not started yet. Legacy undated
 * pause and other `unknown` reasons still stop the walk.
 */
function periodStreakLongest(habit: BIHabit, logs: BILog[], since: Date, asOf: Date): number {
  let running = 0;
  let max = 0;
  let cursor = since;
  for (let i = 0; i < MAX_STREAK_LOOKBACK_PERIODS && ymd(cursor) <= ymd(asOf); i++) {
    const st = periodStatus(habit as Habit, logs, cursor, { asOf });
    const datedPause = st.status === 'paused' && habit.status !== 'paused';
    const beforeRange = st.status === 'unknown' && st.reason === 'not_scheduled';
    if (!datedPause && !beforeRange && (st.status === 'unknown' || st.status === 'paused')) break;
    if (st.status === 'satisfied') { running += 1; if (running > max) max = running; }
    else if (st.status === 'closed_unmet') running = 0;
    cursor = addDaysLocal(st.periodEnd, 1);
  }
  return max;
}

/** Inclusive list of local `YYYY-MM-DD` strings from `start` to `end`. Empty if `start > end` or either is unparseable. */
function iterateYmd(start: Ymd, end: Ymd): Ymd[] {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e || s.getTime() > e.getTime()) return [];
  const out: Ymd[] = [];
  let cur = s;
  while (cur.getTime() <= e.getTime()) {
    out.push(ymd(cur));
    cur = addDaysLocal(cur, 1);
  }
  return out;
}

/**
 * Scheduled count, credit total and lived scheduled dates for one habit
 * across `days` -- the shared core of `habitCompletionRate`,
 * `weekdayBreakdown`, `weeklyRates` (fragility) and `completionTrend`.
 *
 * F13 (INT-01, INT-06, INT-07): each eligible day is judged by `judgeDay`;
 * only a `credit` day is counted (`skip`, a `pending` day at/after
 * `asOfYmd`, and an unlogged negative-habit day are not). `completed` is the
 * credit SUM (fractional for partial days). `livedDates` lists the counted
 * days -- the evidence the trend validity rules measure. `asOfYmd === null`
 * means no clipping (pre-F13 behaviour for callers without a clock).
 */
function dueDayStats(
  habit: BIHabit,
  logIndex: LogIndex,
  days: Ymd[],
  asOfYmd: string | null = null,
): { scheduled: number; completed: number; livedDates: Ymd[] } {
  // R01.02-b — count-based schedules have no per-day obligation. `scheduled`
  // is the period target (edge-prorated over `days`) and `completed` the
  // unique done/partial days, both from the canonical evaluator. Fractional
  // `scheduled` is fine for every ratio built on this.
  if (isCountBased(habit) && days.length > 0) {
    const last = days[days.length - 1];
    const end = asOfYmd !== null && last > asOfYmd ? asOfYmd : last;
    if (end < days[0]) return { scheduled: 0, completed: 0, livedDates: [] };
    const from = parseLocalDate(days[0]);
    const to = parseLocalDate(end);
    if (from && to) {
      const since = createdDate(habit);
      const r = scheduledCompletionRate(habit as Habit, logsFromIndex(habit, logIndex), { from, to, since });
      const sinceYmd = since ? ymd(since) : null;
      const livedDates = r.dueDays > 0 ? days.filter((d) => d <= end && (sinceYmd === null || d >= sinceYmd)) : [];
      return { scheduled: r.dueDays, completed: r.doneDays, livedDates };
    }
  }
  let scheduled = 0;
  let completed = 0;
  const livedDates: Ymd[] = [];
  for (const d of days) {
    const date = parseLocalDate(d);
    if (!date) continue;
    // R01.02-c — day lane: count schedules returned above (`isCountBased && days.length`; an empty `days` never enters this loop). `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
    if (!isEligibleOn(habit as Habit, date)) continue; // `as Habit` -- same cast reportMetrics.ts already uses for this Pick.
    const v = judgeDay({ habit, dayYmd: d, asOfYmd, log: logIndex.get(`${habit.id}|${d}`) });
    if (v.kind !== 'credit') continue; // skip / pending / unknown: excluded from BOTH sides -- see file doc.
    scheduled += 1;
    completed += v.credit;
    livedDates.push(d);
  }
  return { scheduled, completed, livedDates };
}

// ---------------------------------------------------------------------------
// completion rate -- the schedule-aware foundation everything else builds on
// ---------------------------------------------------------------------------

/**
 * `credit / scheduled` over `[range.start, range.end]` (inclusive), for one
 * habit. `scheduled` counts only days `isDueOn` says are due and `judgeDay`
 * credits (see file doc); a partial day adds its ratio. With `opts.asOf`,
 * a future day or an unlogged `asOf` day is pending, not missed (INT-01).
 * This is Gate C's "Completion rate exact" metric.
 *
 * Insufficient data: zero scheduled days in range (e.g. the habit was
 * created after `range.end`, or its schedule never lands inside the range).
 * A habit with zero opportunities to succeed or fail has no completion rate
 * to report -- `0` would misleadingly read as "always missed".
 */
export function habitCompletionRate(
  habit: BIHabit,
  logs: BILog[],
  range: { start: Ymd; end: Ymd },
  opts?: { asOf?: Date },
): Result<number> {
  const logIndex = buildLogIndex(logs.filter((l) => l.habit_id === habit.id));
  const days = iterateYmd(range.start, range.end);
  const { scheduled, completed } = dueDayStats(habit, logIndex, days, opts?.asOf ? ymd(opts.asOf) : null);
  if (scheduled === 0) return insufficient('no scheduled (due, non-skip) days for this habit in the given range');
  return ok(completed / scheduled);
}

// ---------------------------------------------------------------------------
// En başarılı gün / En zayıf gün -- best/worst weekday, aggregated across habits
// ---------------------------------------------------------------------------

export type WeekdayStat = {
  /** 0=Pzt ... 6=Paz, per `habitSchedule.weekdayIndex`. */
  weekday: number;
  scheduled: number;
  /** Credit sum (`completionMetric.dayCredit`; a partial day adds its ratio). */
  completed: number;
  /** Distinct calendar dates on this weekday with at least one counted (planned, lived) habit-day (F13, INT-07). */
  distinctDates: number;
  /** `completed / scheduled`, or `0` when `scheduled` is `0` (a real "no data" 0 in a STAT ROW is fine -- the insufficient-data gate lives in `bestWeekday`/`worstWeekday`, not here, since a caller may want the raw counts regardless.) */
  rate: number;
};

/**
 * Scheduled/completed/distinctDates/rate per weekday, aggregated across every
 * habit in `habits`, over `[range.start, range.end]` (clipped at `opts.asOf`
 * when given). Always returns exactly 7 rows (`weekday` 0..6) even when a
 * weekday has zero samples -- the min-sample gate is applied by the two
 * functions below, not here, so a caller that wants the raw counts (e.g. to
 * build its own chart) is not forced through the `Result` wrapper.
 */
export function weekdayBreakdown(
  habits: BIHabit[],
  logs: BILog[],
  range: { start: Ymd; end: Ymd },
  opts?: { asOf?: Date },
): WeekdayStat[] {
  const logIndex = buildLogIndex(logs);
  const days = iterateYmd(range.start, range.end);
  const asOfYmd = opts?.asOf ? ymd(opts.asOf) : null;
  const totals = Array.from({ length: 7 }, (_, i) => ({ weekday: i, scheduled: 0, completed: 0 }));
  const dates = Array.from({ length: 7 }, () => new Set<Ymd>());

  for (const habit of habits) {
    // R01.02-b — a count-based habit has no per-weekday obligation, so it has
    // no per-weekday "scheduled" and therefore no weekday rate: "Monday 0%"
    // for a "3 a week" habit is exactly the fabricated daily judgement the
    // period model exists to remove. Such habits are excluded here; the
    // insufficient-data gate in `bestWeekday`/`worstWeekday` handles a user
    // whose habits are all flexible.
    if (isCountBased(habit)) continue;
    for (const d of days) {
      const date = parseLocalDate(d);
      if (!date) continue;
      // R01.02-c — day lane: `if (isCountBased(habit)) continue;` above. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
      if (!isEligibleOn(habit as Habit, date)) continue;
      const v = judgeDay({ habit, dayYmd: d, asOfYmd, log: logIndex.get(`${habit.id}|${d}`) });
      if (v.kind !== 'credit') continue;
      const wd = weekdayIndex(date);
      totals[wd].scheduled += 1;
      totals[wd].completed += v.credit;
      dates[wd].add(d);
    }
  }

  return totals.map((t, wd) => ({
    ...t,
    distinctDates: dates[wd].size,
    rate: t.scheduled > 0 ? t.completed / t.scheduled : 0,
  }));
}

/** F13 (INT-07): a weekday is rankable only with enough DISTINCT dates and habit-days. */
function rankableWeekday(s: WeekdayStat): boolean {
  return s.distinctDates >= MIN_WEEKDAY_DISTINCT_DATES && s.scheduled >= MIN_WEEKDAY_SAMPLES;
}

const WEEKDAY_INSUFFICIENT = `no weekday has data on at least ${MIN_WEEKDAY_DISTINCT_DATES} distinct dates`;

/**
 * Highest-rate weekday among those with at least `MIN_WEEKDAY_DISTINCT_DATES`
 * distinct dates and `MIN_WEEKDAY_SAMPLES` habit-days. Ties broken by lowest
 * weekday index (Monday-first), a fixed, deterministic rule so the same input
 * always yields the same answer.
 */
export function bestWeekday(stats: WeekdayStat[]): Result<WeekdayStat> {
  const eligible = stats.filter(rankableWeekday);
  if (eligible.length === 0) return insufficient(WEEKDAY_INSUFFICIENT);
  return ok(eligible.reduce((best, s) => (s.rate > best.rate ? s : best)));
}

/** The mirror of `bestWeekday` -- lowest rate among eligible weekdays. */
export function worstWeekday(stats: WeekdayStat[]): Result<WeekdayStat> {
  const eligible = stats.filter(rankableWeekday);
  if (eligible.length === 0) return insufficient(WEEKDAY_INSUFFICIENT);
  return ok(eligible.reduce((worst, s) => (s.rate < worst.rate ? s : worst)));
}

// ---------------------------------------------------------------------------
// Streak stability -- currentStreak / longestStreak
// ---------------------------------------------------------------------------

/**
 * Consecutive satisfied SCHEDULED days, walking backward from `asOf`
 * (inclusive). This is Gate C's "Streak exact" metric.
 *
 * Walk rule, per day going backward:
 *  - before the habit's `created_at` -> stop (the habit did not exist yet).
 *  - not due (`isDueOn` false) -> transparent, keep walking (neither counts
 *    nor breaks).
 *  - due, logged `skip` -> transparent, same as above (see file doc).
 *  - due, `done`/`partial` -> counts (+1), keep walking.
 *  - due, no log, and the day IS `asOf` -> transparent (F13, DOM-07): today
 *    is not over yet, so an unlogged today neither counts nor breaks.
 *  - due, no log, NEGATIVE habit -> transparent (F13, DOM-17): an unlogged
 *    day of a quit habit is unknown, not a failure (`isMissedOn`).
 *  - due, `miss` (any day, including `asOf`), or no log on a PAST day of a
 *    positive habit -> STOP. This day is NOT counted.
 *
 * There is still no tolerance for YESTERDAY: if yesterday was due, positive
 * and unlogged, the streak is `0` right now. A "never miss twice" grace that
 * bridges one isolated miss is a product decision deferred to F38 (OD-02),
 * not something this function invents.
 *
 * Always returns a plain number, never a `Result` -- `0` is a real, earned
 * answer ("no streak right now"), not a fabricated placeholder, exactly like
 * `willpowerStore.score()`'s own distinction between "a real 0" and "no
 * reading" (see file doc).
 */
export function currentStreak(habit: BIHabit, logs: BILog[], asOf: Date = new Date()): number {
  // R01.02-b — for a count-based habit the streak is counted in PERIODS
  // (consecutive satisfied weeks/months), not days: a "3 a week" habit has
  // no due day to be missed. See `periodStreakBack` for the open-period rule.
  if (isCountBased(habit)) return periodStreakBack(habit, logs.filter((l) => l.habit_id === habit.id), asOf);
  const logIndex = buildLogIndex(logs.filter((l) => l.habit_id === habit.id));
  const createdYmd = habitCreatedDay(habit) ?? '';
  let count = 0;
  let cursor = asOf;
  for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
    const d = ymd(cursor);
    if (createdYmd && d < createdYmd) break; // habit did not exist yet on this day.
    // R01.02-c — day lane: `isCountBased` returned at the top of `currentStreak`. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
    if (!isEligibleOn(habit as Habit, cursor)) {
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    const state = logIndex.get(`${habit.id}|${d}`)?.state;
    if (state === 'skip') {
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    if (state && isCompletedState(state)) {
      count += 1;
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    if (!state && d === ymd(asOf)) { // today is not over yet (pending)
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    if (!state && habit.behavior_type === 'negative') { // unknown, not missed
      cursor = addDaysLocal(cursor, -1);
      continue;
    }
    break; // due, unmet (miss, or no log on a past day) -> streak ends here, this day not counted.
  }
  return count;
}

/**
 * The longest run of consecutive satisfied scheduled days anywhere between
 * `since` (default: the habit's `created_at`, falling back to `asOf` if
 * neither is available) and `asOf` (default: now). Same per-day rule as
 * `currentStreak` (skip transparent, not-due transparent, an unlogged day of
 * a negative habit transparent (F13, DOM-17), miss resets the running count
 * to `0`), walked FORWARD so every run in the window is seen.
 *
 * Always a plain number -- `0` is real ("never once completed a scheduled
 * day in this window"), not a placeholder.
 */
export function longestStreak(habit: BIHabit, logs: BILog[], opts: { since?: Date; asOf?: Date } = {}): number {
  const asOf = opts.asOf ?? new Date();
  const since = opts.since ?? createdDate(habit) ?? asOf;
  // R01.02-b — periods, not days, for count-based schedules (see `currentStreak`).
  if (isCountBased(habit)) return periodStreakLongest(habit, logs.filter((l) => l.habit_id === habit.id), since, asOf);
  const logIndex = buildLogIndex(logs.filter((l) => l.habit_id === habit.id));
  const days = iterateYmd(ymd(since), ymd(asOf));

  let running = 0;
  let max = 0;
  for (const d of days) {
    const date = parseLocalDate(d);
    if (!date) continue;
    // R01.02-c — day lane: `isCountBased` returned at the top of `longestStreak`. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
    if (!isEligibleOn(habit as Habit, date)) continue; // transparent
    const state = logIndex.get(`${habit.id}|${d}`)?.state;
    if (state === 'skip') continue; // transparent
    if (!state && habit.behavior_type === 'negative') continue; // unknown: neither extends nor resets
    if (state && isCompletedState(state)) {
      running += 1;
      if (running > max) max = running;
    } else {
      running = 0; // due, unmet -> run resets
    }
  }
  return max;
}

/**
 * "Streak stability" (plan §11): `currentStreak / longestStreak`. A value
 * near `1` means the user's current run is as strong as their historical
 * best (a sustained streak, not a recent reset); a value near `0` means
 * they are far below their own peak.
 *
 * Insufficient data: `longestStreak === 0` -- the habit has never once
 * completed a scheduled day in the window, so there is no peak to be
 * "stable relative to" and the ratio is undefined (not `0`, not `1`).
 */
export function streakStability(habit: BIHabit, logs: BILog[], opts: { since?: Date; asOf?: Date } = {}): Result<number> {
  const longest = longestStreak(habit, logs, opts);
  if (longest === 0) {
    return insufficient('habit has never completed a scheduled day in this window -- no peak streak to be stable relative to');
  }
  const current = currentStreak(habit, logs, opts.asOf ?? new Date());
  return ok(current / longest);
}

// ---------------------------------------------------------------------------
// En kırılgan habit -- fragility via variance, not a bare completion rate
// ---------------------------------------------------------------------------

/** One weekly sample used by `habitFragility`. */
type WeeklyRate = { weekStart: Ymd; scheduled: number; completed: number; rate: number };

/**
 * Trailing `weeks` weekly rate samples ending in the Mon-Sun week containing
 * `asOf`. A week with zero scheduled days (habit did not exist yet, or its
 * schedule never lands that week) is OMITTED, not recorded as a `0` rate --
 * exactly the same "absence of data is not a zero" reasoning `habitStrength`
 * uses for its bucket re-normalisation. F13: the week containing `asOf` is
 * clipped at `asOf` (its future days are pending, not missed).
 */
function weeklyRates(habit: BIHabit, logs: BILog[], weeks: number, asOf: Date): WeeklyRate[] {
  const logIndex = buildLogIndex(logs.filter((l) => l.habit_id === habit.id));
  const lastWeekStart = startOfWeekLocal(asOf);
  const out: WeeklyRate[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = addDaysLocal(lastWeekStart, -7 * w);
    const days = iterateYmd(ymd(weekStart), ymd(addDaysLocal(weekStart, 6)));
    const { scheduled, completed } = dueDayStats(habit, logIndex, days, ymd(asOf));
    if (scheduled === 0) continue;
    out.push({ weekStart: ymd(weekStart), scheduled, completed, rate: completed / scheduled });
  }
  return out;
}

export type FragilityResult = {
  /**
   * `min(1, stdDev(weeklyRates) * 2)`. `0` = perfectly even week-to-week,
   * `1` = maximally uneven (alternating 100%/0%). See `capacity.ts`'s
   * `weeklyStability` doc for why this transform is the right one for a
   * [0,1]-bounded rate -- this is its complement (`fragility = 1 - stability`
   * in spirit, computed directly rather than via a separate stability value).
   */
  volatility: number;
  weeksUsed: number;
  /** The raw per-week rates that produced `volatility`, oldest first -- for debugging/UI explanation. */
  weeklyRates: number[];
};

/**
 * How FRAGILE (volatile), not how weak, a single habit's recent history is.
 * NOT the same as a low completion rate: a habit steady at 60% every week is
 * LESS fragile than one oscillating 100%/0%/100%/0%, even though the
 * oscillating habit's average can be higher (see the worked example in this
 * file's test suite). Fragility is about CONSISTENCY, completion rate is
 * about MAGNITUDE -- the two questions are answered by different functions
 * in this file on purpose.
 *
 * Insufficient data: fewer than `MIN_WEEKS_FOR_FRAGILITY` weeks carried any
 * scheduled days within the window -- see that constant's doc for why a
 * shorter window cannot be trusted.
 */
export function habitFragility(
  habit: BIHabit,
  logs: BILog[],
  opts: { weeks?: number; asOf?: Date } = {},
): Result<FragilityResult> {
  const weeks = opts.weeks ?? FRAGILITY_WEEKS_DEFAULT;
  const asOf = opts.asOf ?? new Date();
  const wr = weeklyRates(habit, logs, weeks, asOf);
  if (wr.length < MIN_WEEKS_FOR_FRAGILITY) {
    return insufficient(`only ${wr.length} week(s) with scheduled days in this window -- need >= ${MIN_WEEKS_FOR_FRAGILITY}`);
  }
  const rates = wr.map((w) => w.rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const stdDev = Math.sqrt(variance);
  const volatility = Math.min(1, stdDev * 2);
  return ok({ volatility, weeksUsed: rates.length, weeklyRates: rates });
}

/**
 * The most fragile habit among `habits` -- highest `volatility`, restricted
 * to habits that individually clear `habitFragility`'s own min-sample gate.
 *
 * Insufficient data: no habit in `habits` has enough weekly history to be
 * judged at all.
 */
export function mostFragileHabit(
  habits: BIHabit[],
  logs: BILog[],
  opts: { weeks?: number; asOf?: Date } = {},
): Result<{ habitId: string; volatility: number }> {
  const candidates: { habitId: string; volatility: number }[] = [];
  for (const h of habits) {
    const r = habitFragility(h, logs, opts);
    if (r.ok) candidates.push({ habitId: h.id, volatility: r.value.volatility });
  }
  if (candidates.length === 0) return insufficient('no habit has enough weekly history to judge fragility');
  return ok(candidates.reduce((worst, c) => (c.volatility > worst.volatility ? c : worst)));
}

// ---------------------------------------------------------------------------
// En güçlü habit -- reuses habitStrengthFor, does not reimplement it
// ---------------------------------------------------------------------------

/**
 * The habit with the highest schedule-aware `habitStrengthFor`
 * (habitStrength.ts, plan §10; F13 DOM-06 -- a Mon/Wed/Fri habit kept
 * perfectly scores 100, not 43, so daily habits no longer win by default),
 * restricted to habits with at least `MIN_LOGS_FOR_STRENGTH` non-skip logs --
 * see that constant's note for why a barely-logged habit is excluded. A habit
 * whose strength is `null` (no evaluable day yet) is not a candidate.
 *
 * Insufficient data: no habit in `habits` clears the minimum log count.
 */
export function strongestHabit(
  habits: BIHabit[],
  logs: BILog[],
  opts: { asOf?: Date } = {},
): Result<{ habitId: string; strength: number }> {
  const asOf = opts.asOf ?? new Date();
  const candidates: { habitId: string; strength: number }[] = [];

  for (const h of habits) {
    const hLogs = logs.filter((l) => l.habit_id === h.id);
    const nonSkipCount = hLogs.filter((l) => l.state !== 'skip').length;
    if (nonSkipCount < MIN_LOGS_FOR_STRENGTH) continue;

    const strength = habitStrengthFor(h, hLogs, { asOf });
    if (strength === null) continue;
    candidates.push({ habitId: h.id, strength });
  }

  if (candidates.length === 0) return insufficient(`no habit has >= ${MIN_LOGS_FOR_STRENGTH} non-skip logs`);
  return ok(candidates.reduce((best, c) => (c.strength > best.strength ? c : best)));
}

// ---------------------------------------------------------------------------
// Son 4 hafta / 12 hafta trend
// ---------------------------------------------------------------------------

export type Trend = {
  direction: 'improving' | 'declining' | 'flat';
  /** `avg(second half of available weeks) - avg(first half)`. Positive = improving. */
  magnitude: number;
  /** How many weeks actually carried scheduled data (may be < `weeksRequested`). */
  weeksUsed: number;
  weeksRequested: number;
  /** `true` when the user's history is shorter than the requested window. */
  partialWindow: boolean;
};

/**
 * Direction + magnitude of the aggregate (across every habit in `habits`)
 * scheduled-day completion rate over the trailing `weeks` weeks ending in
 * the week containing `asOf`.
 *
 * Method: collect one rate per week that had >= 1 scheduled day (a week with
 * none is OMITTED, not scored `0` -- same reasoning as `weeklyRates` above).
 * Split the resulting list into two halves by position (oldest half vs
 * newest half); if the count is odd, the single MIDDLE week is dropped so
 * both halves stay equal-sized and directly comparable. `magnitude` is
 * `avg(newest half) - avg(oldest half)`; `direction` is its sign.
 *
 * Handles a user with fewer weeks of history than `weeks` by simply using
 * whatever weeks exist (`weeksUsed < weeksRequested`, `partialWindow: true`)
 * rather than padding the missing weeks with a fabricated `0`.
 *
 * Insufficient data: fewer than 2 weeks carried any scheduled data -- a
 * trend needs at least one "before" and one "after" sample to have a
 * direction at all.
 *
 * F13 (INT-07) validity rules, on top of the above:
 *  - the current week is clipped at `asOf` (future / unlogged-today days are
 *    pending), and a week with fewer than `MIN_WEEK_LIVED_DAYS` (3) lived
 *    scheduled DATES across all habits is omitted like an empty week -- a
 *    Monday-Tuesday is not a week's evidence;
 *  - for windows of 4+ weeks the kept weeks must hold at least
 *    `MIN_TREND_DAYS` (14) lived scheduled dates in total. Two- and
 *    three-week windows skip this total (a two-week window holds at most 14
 *    lived days and reaches it only on Sunday -- the "vs last week" line
 *    would vanish six days a week);
 *  - `|magnitude| < MIN_TREND_DELTA` (0.05) is `flat`, not a direction:
 *    0.80 -> 0.79 is noise. `magnitude` keeps the raw difference.
 */
export function completionTrend(
  habits: BIHabit[],
  logs: BILog[],
  opts: { weeks: number; asOf?: Date },
): Result<Trend> {
  const asOf = opts.asOf ?? new Date();
  const asOfYmd = ymd(asOf);
  const weeks = opts.weeks;
  const logIndex = buildLogIndex(logs);
  const lastWeekStart = startOfWeekLocal(asOf);

  const rates: number[] = [];
  const livedAll = new Set<Ymd>();
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = addDaysLocal(lastWeekStart, -7 * w);
    const days = iterateYmd(ymd(weekStart), ymd(addDaysLocal(weekStart, 6)));
    let scheduled = 0;
    let completed = 0;
    const livedWeek = new Set<Ymd>();
    for (const h of habits) {
      const stats = dueDayStats(h, logIndex, days, asOfYmd);
      scheduled += stats.scheduled;
      completed += stats.completed;
      for (const d of stats.livedDates) livedWeek.add(d);
    }
    if (scheduled === 0 || livedWeek.size < MIN_WEEK_LIVED_DAYS) continue;
    for (const d of livedWeek) livedAll.add(d);
    rates.push(completed / scheduled);
  }

  if (weeks >= 4 && livedAll.size < MIN_TREND_DAYS) {
    return insufficient(`trend needs >= ${MIN_TREND_DAYS} lived scheduled days`);
  }

  if (rates.length < 2) {
    return insufficient(`only ${rates.length} week(s) with scheduled data in this window -- need >= 2 to detect a trend`);
  }

  const n = rates.length;
  const halfSize = Math.floor(n / 2);
  const firstHalf = rates.slice(0, halfSize);
  const secondHalf = rates.slice(n - halfSize);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const magnitude = avg(secondHalf) - avg(firstHalf);
  const direction: Trend['direction'] =
    Math.abs(magnitude) < MIN_TREND_DELTA ? 'flat' : magnitude > 0 ? 'improving' : 'declining';

  return ok({ direction, magnitude, weeksUsed: n, weeksRequested: weeks, partialWindow: n < weeks });
}

// ---------------------------------------------------------------------------
// En sık telafi edilen habit / Telafi başarı oranı
// ---------------------------------------------------------------------------

/**
 * The habit with the most ACTUALLY-COMPLETED recovery plans (`status ===
 * 'completed'`). Deliberately not "most recovery plans of any status" --
 * a `'cancelled'` plan means the user explicitly declined recovery
 * ("Telafi etme"), and counting a decline as being "recovered" would invert
 * the metric's meaning. Only a genuinely completed recovery counts.
 *
 * Insufficient data: not one plan in `plans` has `status === 'completed'`.
 */
export function mostRecoveredHabit(plans: BIRecoveryPlan[]): Result<{ habitId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of plans) {
    if (p.status !== 'completed') continue;
    counts.set(p.habit_id, (counts.get(p.habit_id) ?? 0) + 1);
  }
  if (counts.size === 0) return insufficient('no recovery plan has status "completed" yet');

  let bestId = '';
  let bestCount = -1;
  for (const [habitId, count] of counts) {
    if (count > bestCount) {
      bestId = habitId;
      bestCount = count;
    }
  }
  return ok({ habitId: bestId, count: bestCount });
}

/**
 * `completed / (completed + expired + cancelled)` -- Gate C's "Recovery
 * rate exact" metric.
 *
 * `status === 'planned'` plans are EXCLUDED from the denominator: they are
 * still open, their outcome is not yet known, and counting an open plan as
 * a failure (by including it in the denominator without crediting the
 * numerator) would fabricate a negative result for something that has not
 * actually failed yet. The denominator is therefore "plans with a known
 * outcome" (`completed`/`expired`/`cancelled`), and the numerator is the
 * subset of those that actually succeeded.
 *
 * Insufficient data: zero plans have a resolved (non-`'planned'`) status.
 */
export function recoverySuccessRate(plans: BIRecoveryPlan[]): Result<number> {
  const resolved = plans.filter((p) => p.status !== 'planned');
  if (resolved.length === 0) {
    return insufficient('no recovery plan has a resolved status yet (all still "planned", or none exist)');
  }
  const completed = resolved.filter((p) => p.status === 'completed').length;
  return ok(completed / resolved.length);
}

// ---------------------------------------------------------------------------
// Sabah/akşam farkı -- an honest, structural gap, not an invented metric
// ---------------------------------------------------------------------------

/**
 * Plan §11 asks for a morning/evening performance difference. The data does
 * not support measuring one, and this function says so explicitly rather
 * than fabricating an answer:
 *
 *  - `habit_logs.completed_at` is a DATE-ONLY string ('yyyy-MM-dd',
 *    `lib/supabase.ts`), never a timestamp. There is no time-of-day at which
 *    a log was actually completed anywhere in this schema.
 *  - `habits.frequency_config.part_of_day` (`('morning'|'afternoon'|
 *    'evening')[]`) exists, but it describes the time slot a habit is
 *    INTENDED for, set once at habit-creation time -- it is not an
 *    observation of when the user actually acted. Comparing completion
 *    rates grouped by this tag would silently answer a different question
 *    ("do morning-tagged habits get completed more than evening-tagged
 *    ones") than the one asked ("does the user perform better in the
 *    morning or the evening"), and present it as if it were the same
 *    thing. That substitution is exactly the kind of invented metric this
 *    task's brief calls out by name and forbids.
 *  - `created_at` is a real timestamp, but it is the log ROW's insertion
 *    time (when the row was written to the database), not necessarily when
 *    the tracked behaviour happened -- a user who logs yesterday's workout
 *    this morning would be counted as a morning workout. Inferring
 *    behaviour timing from write timing is the exact kind of guess this
 *    file's rule forbids (see the file doc's "insufficient data" section),
 *    so it is not used here either.
 *
 * This function therefore always returns the explicit unsupported signal.
 * It takes no arguments on purpose: no amount of habit/log data changes the
 * answer, because the schema itself cannot support the question as asked.
 * Fixing this requires either a real timestamp column on `habit_logs` or a
 * product decision to redefine the metric around `part_of_day` explicitly
 * (and label it as such) -- both are out of scope for this pure-function
 * engine. See this task's "Unsupported / honest gaps" report section.
 */
export function morningEveningDifference(): Insufficient {
  return insufficient(
    'unsupported: habit_logs.completed_at is a date-only string with no time-of-day, so no observed ' +
      'morning/evening split can be computed. habits.frequency_config.part_of_day exists but only describes ' +
      "a habit's INTENDED time slot (set at creation), not when it was actually performed, and created_at is " +
      'the log row\'s write time, not the behaviour\'s actual time -- neither is a valid substitute, so this ' +
      'metric is deliberately reported as unsupported rather than inferred.',
  );
}
