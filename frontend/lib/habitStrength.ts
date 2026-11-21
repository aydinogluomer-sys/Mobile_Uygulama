/**
 * Habit Strength Engine V2.  (task 1-W2, IMPLEMENTATION_V2.md §10; F13 DOM-06)
 *
 * Pure domain logic. No I/O, no `supabase` import, no network.
 *
 * Replaces the flat `completion_count / expected_count` model with a
 * time-weighted one: recent behaviour matters more than distant behaviour,
 * but a habit's whole life still contributes.
 *
 *   last 7 days   × 0.50
 *   8-30 days     × 0.35
 *   31-90 days    × 0.15
 *
 * Only `lib/date.ts`'s local-day helpers are used to walk the calendar, so
 * this module inherits the repo's local-day guarantee and never derives a
 * day key from a UTC instant (see `__tests__/repo/noUtcDayKeys.test.ts`).
 *
 * F13 (DOM-06): `habitStrengthFor(habit, logs, { asOf })` is the schedule-aware
 * entry point production callers use (habit detail, `strongestHabit`). It
 * imports `habitSchedule` (`isEligibleOn`, `periodStatus`) and
 * `completionMetric` (`dayCredit`, `periodVerdict`); neither of those imports
 * this file, so there is no cycle.
 */
import type { Habit, HabitLog } from './supabase';
import { addDaysLocal, daysBetweenLocal, parseLocalDate, ymd, ymdFromIso } from './date';
import { dayCredit, periodVerdict } from './completionMetric';
import { isEligibleOn, periodStatus, scheduleKind } from './habitSchedule';

export type HabitLogState = 'done' | 'partial' | 'miss' | 'skip';

/**
 * The minimal shape `habitStrength` needs from a log.
 *
 * `ratio` is optional: if the caller already resolved a precise fractional
 * ratio for this log (e.g. via `completionMetric.dayCredit`, which knows
 * the habit's `trackingType` and `target` — neither of which is available
 * here, since this function only ever receives logs, not the parent habit),
 * pass it and it is used as-is. When omitted, this module falls back to a
 * coarser state-only credit (`done` = 1, `partial` = 0.5, `miss` = 0) — see
 * `coarseCredit`. This keeps the common case (caller only has `state`) simple
 * while still letting a caller with richer data get an exact score.
 */
export type StrengthLog = {
  /** Local `YYYY-MM-DD`. `habit_logs.completed_at` is already this shape. */
  completed_at: string;
  state: HabitLogState;
  ratio?: number;
};

export type HabitStrengthOptions = {
  /** The day strength is evaluated as of. Defaults to `new Date()`. */
  asOf?: Date;
  /**
   * The habit's start date (its `created_at`, as a local `Date`) — the day
   * before which no bucket can possibly have data because the habit did not
   * exist yet. Optional; see the re-normalisation note below for what
   * happens without it.
   */
  since?: Date;
  /**
   * F13 (DOM-06) — calendar mode. When given, a day for which `isDueOn(day)`
   * is `false` (not planned, or inside a dated pause / holiday) is in NEITHER
   * the numerator nor the denominator of its bucket. Production passes
   * `(d) => isEligibleOn(habit, d)` (see `habitStrengthFor`). Omitted: every
   * day on/after `since` is expected, exactly as before F13.
   */
  isDueOn?: (day: Date) => boolean;
  /**
   * F13 (DOM-07 analogue) — when `true`, an unlogged `asOf` day is pending
   * ("today is not over yet") and is not counted. Omitted/`false`: the
   * pre-F13 behaviour (an unlogged `asOf` day is a 0-credit expected day).
   */
  pendingToday?: boolean;
};

/** Log shape `habitStrengthFor` reads (`value` lets `dayCredit` score a measured partial day). */
export type StrengthSource = Pick<HabitLog, 'completed_at' | 'state'> & { value?: number | null };

/** Habit shape `habitStrengthFor` reads: schedule fields plus optional measure fields. */
export type StrengthHabit = Pick<Habit, 'id' | 'behavior_type' | 'frequency_config' | 'created_at' | 'end_condition'>
  & Partial<Pick<Habit, 'status' | 'tracking_type' | 'daily_goal' | 'target_direction'>>;

const BUCKETS = [
  { key: 'recent', fromDay: 0, toDay: 6, weight: 0.50 },  // last 7 days
  { key: 'mid', fromDay: 7, toDay: 29, weight: 0.35 },    // 8-30 days back
  { key: 'long', fromDay: 30, toDay: 89, weight: 0.15 },  // 31-90 days back
] as const;

/** Count lane: at most this many periods are walked back (weekly: ~13 fit in 90 days, monthly: ~3). */
const MAX_STRENGTH_PERIODS = 40;

/**
 * Per-day credit toward a bucket's rate. (F13: renamed from `dayCredit` so it
 * is never confused with `completionMetric.dayCredit`; behaviour unchanged.)
 *
 * `skip` is handled by the caller (the day is excluded from the bucket
 * entirely, both numerator and denominator — see the loop below) so it never
 * reaches this function in practice; the `0` here is defensive, not load
 * bearing.
 *
 * When `ratio` is present it wins outright (clamped to `[0,1]` in case a
 * caller passes something out of range). Otherwise the coarse state-level
 * credit applies: `done` = full credit, `partial` = half credit, `miss` = 0.
 * Half credit for an unqualified `partial` is a deliberate simplification —
 * without the habit's `trackingType`/`target` this module cannot compute the
 * exact §8.6 ratio, and 0.5 is the same fallback `completionMetric.dayCredit`
 * uses for a state with no numeric goal attached, so this stays consistent
 * with the rest of the codebase rather than inventing a new convention.
 */
function coarseCredit(log: Pick<StrengthLog, 'state' | 'ratio'>): number {
  if (log.state === 'skip') return 0;
  if (typeof log.ratio === 'number') return Math.max(0, Math.min(1, log.ratio));
  if (log.state === 'done') return 1;
  if (log.state === 'partial') return 0.5;
  return 0; // miss
}

/** Re-normalised weighted score over the buckets that had expected days, or `null` when none had any. */
function weightedScore(buckets: readonly { weight: number; expected: number; credit: number }[]): number | null {
  let weightSum = 0;
  let scoreSum = 0;
  for (const b of buckets) {
    if (b.expected === 0) continue; // bkz. re-normalisation notu — bu bucket ağırlığa katılmaz.
    weightSum += b.weight;
    scoreSum += b.weight * (b.credit / b.expected);
  }
  if (weightSum === 0) return null; // hiçbir bucket'ta beklenen gün yoktu (örn. `since` gelecekte).
  return Math.max(0, Math.min(100, Math.round((scoreSum / weightSum) * 100)));
}

/** The day-bucket walk shared by `habitStrength` (0 on no data) and `habitStrengthFor` (null on no data). */
function dayBucketStrength(logs: StrengthLog[], options: HabitStrengthOptions): number | null {
  const asOf = options.asOf ?? new Date();

  const sinceYmd = options.since
    ? ymd(options.since)
    : logs.reduce<string | null>((min, l) => {
      const d = l.completed_at.slice(0, 10); // 'completed_at' zaten yerel 'date' kolonu — burada UTC dönüşümü yok.
      return min == null || d < min ? d : min;
    }, null);

  if (sinceYmd == null) return null; // ne `since` verildi ne de hiç log var — dayanacak hiçbir şey yok.

  // FINDING A-02: two logs for the same calendar day are a store-level
  // invariant violation -- "one log per habit per day" is enforced above
  // this module (the log store), not here; `habitStrength` only ever
  // receives whatever it is handed. This function's defence against that
  // case is intentionally simple: `Map#set` overwrites, so the LAST entry
  // for a given day in `logs`' array order wins outright -- no merge, no
  // "best state wins", no "latest `created_at` wins". Array order is the
  // tiebreak, full stop.
  //
  // Deliberately not "improved" to a smarter rule: `StrengthLog` does not
  // carry a `created_at`/timestamp, only the local day (`completed_at`) the
  // log is FOR -- so there is no reliable signal here for which of two same-
  // day entries actually happened later in real time, and inventing a
  // "best state wins" rule (e.g. done > partial > miss) is not obviously
  // correct either: a user who corrects a mistaken `'done'` down to `'miss'`
  // would have that correction silently discarded by a best-wins rule. With
  // no trustworthy signal to prefer one entry, last-in-array-wins is at
  // least simple, deterministic, and honest about being an ordering
  // artifact rather than a guessed-at "smarter" rule.
  const logByDate = new Map<string, StrengthLog>();
  for (const l of logs) {
    logByDate.set(l.completed_at.slice(0, 10), l); // last entry for a given day overwrites -- see note above
  }

  const totals = BUCKETS.map((b) => ({ weight: b.weight, expected: 0, credit: 0 }));

  BUCKETS.forEach((bucket, i) => {
    for (let dayOffset = bucket.fromDay; dayOffset <= bucket.toDay; dayOffset++) {
      const date = addDaysLocal(asOf, -dayOffset);
      const d = ymd(date);
      if (d < sinceYmd) continue; // habit bu gün henüz yoktu — bu gün hiçbir bucket'ta beklenmez.
      if (options.isDueOn && !options.isDueOn(date)) continue; // planlı değil / duraklatılmış: pay VE paydadan dışlanır.

      const log = logByDate.get(d);
      if (log && log.state === 'skip') continue; // skip: pay VE paydan tamamen dışlanır.
      if (options.pendingToday && dayOffset === 0 && !log) continue; // kayıtsız bugün henüz bitmedi: sayılmaz.

      totals[i].expected += 1;
      totals[i].credit += log ? coarseCredit(log) : 0; // log yoksa (hiç dokunulmamış gün) = gerçek bir kaçırma, 0 kredi ama sayılır.
    }
  });

  return weightedScore(totals);
}

/**
 * Time-weighted habit strength, 0-100 (§10).
 *
 * ## Rate, not raw count — and why
 *
 * Each bucket contributes a completion RATE (successes / expected days
 * within that bucket), not a raw count of successes. A raw count would
 * unfairly favour a habit that has simply existed longer: a 200-day-old habit
 * with 60 good days in its 31-90 bucket would outscore a 40-day-old habit
 * with 55 good days there, purely because the older habit has more days to
 * accumulate a count from — even if the younger habit's actual RATE of
 * success is higher. Dividing by the bucket's own expected-day count removes
 * that bias: both habits are judged on how consistent they were during the
 * days that actually applied to them.
 *
 * ## The re-normalisation rule — the most important decision in this file
 *
 * A brand-new habit has no 8-30 or 31-90 day history: those buckets have
 * ZERO expected days, because the habit did not exist on any of those
 * calendar days. Scoring a bucket with no data as `0` (and then applying its
 * weight) would structurally cap a 3-day-old habit's strength at 50 — the
 * `recent` bucket's weight — even with a flawless 3-for-3 record, because
 * 35% and 15% of the total weight would be multiplied by a manufactured
 * zero.  That is wrong: a habit cannot be faulted for a history it has not
 * had the chance to build yet.
 *
 * The fix: buckets with **zero expected days** are dropped entirely, and the
 * remaining buckets' weights are re-normalised (divided by their own sum)
 * before averaging — so a 3-day-old habit with a perfect record scores 100,
 * not 50. A bucket that HAS expected days but a poor rate (e.g. a habit that
 * existed but was mostly missed) is NOT dropped — a low `0` rate is real
 * signal and is weighted normally; only the complete ABSENCE of applicable
 * days is treated as "no data" and excluded. This distinction is what
 * `since`/log-inference (below) exists to compute correctly.
 *
 * ## Determining which days are "expected"
 *
 * If `since` is given (the habit's `created_at`), a calendar day counts
 * toward a bucket's denominator only if it falls on/after `since` — a day
 * before the habit existed is never expected, in any bucket. If `since` is
 * omitted, this function cannot know the true habit age, so it falls back to
 * treating the EARLIEST date present across `logs` as a lower bound: a day
 * cannot be judged "expected" if there is no evidence the habit was even
 * being tracked yet, but this is only an approximation (a habit that existed
 * but was never logged on its first few days would be under-counted). Pass
 * `since` when it is available; the inference exists so the function still
 * degrades sensibly when it is not. With no `since` and no logs at all,
 * there is nothing to infer from and the function returns `0`.
 *
 * ## Calendar mode (F13, DOM-06)
 *
 * Without `isDueOn` this function is schedule-blind: EVERY calendar day on or
 * after `since` is expected, so a Mon/Wed/Fri habit kept perfectly scores
 * 3/7 ≈ 43. That mode is kept verbatim for existing callers and tests. With
 * `isDueOn`, a day the habit was not planned for (or a dated pause / holiday
 * day) is excluded from both sides, so the same habit scores 100; with
 * `pendingToday`, an unlogged `asOf` day is not yet a miss. Production code
 * with a habit row should call `habitStrengthFor`, which supplies both and
 * also handles count schedules (`weekly_count`, `monthly_count`) by period.
 *
 * ## `skip`
 *
 * A day whose log has `state: 'skip'` is excluded from BOTH the numerator
 * and the denominator of its bucket — it is neither a success nor a failure,
 * so it must not silently count as a miss (which excluding it only from the
 * numerator would do) nor as a success. A day with NO log at all (never
 * logged) is different: it IS counted in the denominator with `0` credit,
 * because an expected day that was simply never touched is a real miss, not
 * a skip — only an explicit skip action removes a day from consideration.
 */
export function habitStrength(logs: StrengthLog[], options: HabitStrengthOptions = {}): number {
  return dayBucketStrength(logs, options) ?? 0;
}

/**
 * Schedule-aware habit strength (F13, DOM-06): 0-100, or `null` when no bucket
 * holds an expected / evaluable day or period (`null` = no data yet, NOT 0).
 *
 * - Day lane (daily, weekly days, every_n_days, monthly days, yearly date):
 *   `habitStrength(logs, { asOf, since: created_at, isDueOn: (d) =>
 *   isEligibleOn(habit, d), pendingToday: true })`, each log scored with
 *   `completionMetric.dayCredit(habit, log)` (a measured partial day gets its
 *   real ratio). An unlogged day of a NEGATIVE habit is unknown, not a miss
 *   (`judgeDay` → `unknown`), so it is not expected either.
 * - Count lane (`weekly_count`, `monthly_count`): periods are walked back from
 *   `asOf` with `periodStatus` (logs stamped with `habit_id: habit.id`); each
 *   period's `periodVerdict` credit is written into the bucket (0-6, 7-29,
 *   30-89 days back) that holds the period's END day (clamped to `asOf` for
 *   the open period). The open period counts only once satisfied (otherwise
 *   it is `pending`); a period that starts before `created_at` counts only if
 *   fully satisfied (the first week is not a burden); offset > 89 stops; at
 *   most `MAX_STRENGTH_PERIODS` periods are walked. Buckets re-normalise with
 *   the same 0.50 / 0.35 / 0.15 weights.
 */
export function habitStrengthFor(
  habit: StrengthHabit,
  logs: readonly (StrengthSource & { habit_id?: string })[],
  opts?: { asOf?: Date },
): number | null {
  const asOf = opts?.asOf ?? new Date();
  const asOfYmd = ymd(asOf);
  const createdYmd = ymdFromIso(habit.created_at) || null;
  if (createdYmd && createdYmd > asOfYmd) return null;

  const fullHabit = habit as Habit;
  const own = logs.filter((l) => l.habit_id === undefined || l.habit_id === habit.id);
  const kind = scheduleKind(fullHabit).kind;

  if (kind === 'weekly_count' || kind === 'monthly_count') {
    // `oneLogPerDay` inside the period evaluator filters by `habit_id`.
    const stamped = own.map((l) => ({ habit_id: habit.id, completed_at: l.completed_at, state: l.state, value: l.value ?? null }));
    const totals = BUCKETS.map((b) => ({ ...b, expected: 0, credit: 0 }));
    let cursor = asOf;
    for (let step = 0; step < MAX_STRENGTH_PERIODS; step++) {
      const st = periodStatus(fullHabit, stamped, cursor, { asOf });
      const startYmd = ymd(st.periodStart);
      const endYmd = ymd(st.periodEnd);
      if (createdYmd && endYmd < createdYmd) break;
      const dayOffset = daysBetweenLocal(endYmd > asOfYmd ? asOf : st.periodEnd, asOf);
      if (dayOffset > 89) break;
      const straddlesCreation = createdYmd !== null && startYmd < createdYmd;
      if (!straddlesCreation || st.status === 'satisfied') {
        const v = periodVerdict(st);
        if (v.kind === 'credit') {
          const bucket = totals.find((b) => dayOffset >= b.fromDay && dayOffset <= b.toDay);
          if (bucket) {
            bucket.expected += 1;
            bucket.credit += v.credit;
          }
        }
      }
      if (straddlesCreation) break; // reached the habit's first period
      cursor = addDaysLocal(st.periodStart, -1);
    }
    return weightedScore(totals);
  }

  const strengthLogs: StrengthLog[] = own.map((l) => ({
    completed_at: l.completed_at,
    state: l.state,
    ratio: dayCredit(habit, { state: l.state, value: l.value ?? null }),
  }));
  const loggedDays = new Set(strengthLogs.map((l) => l.completed_at.slice(0, 10)));
  const negative = habit.behavior_type === 'negative';
  const since = createdYmd ? parseLocalDate(createdYmd) ?? undefined : undefined;

  return dayBucketStrength(strengthLogs, {
    asOf,
    since,
    isDueOn: (d) => isEligibleOn(fullHabit, d) && (!negative || loggedDays.has(ymd(d))),
    pendingToday: true,
  });
}
