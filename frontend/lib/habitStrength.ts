/**
 * Habit Strength Engine V2.  (task 1-W2, IMPLEMENTATION_V2.md §10)
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
 */
import { addDaysLocal, ymd } from './date';

export type HabitLogState = 'done' | 'partial' | 'miss' | 'skip';

/**
 * The minimal shape `habitStrength` needs from a log.
 *
 * `ratio` is optional: if the caller already resolved a precise fractional
 * ratio for this log (e.g. via `habitEngine.completionRatio`, which knows
 * the habit's `trackingType` and `target` — neither of which is available
 * here, since this function only ever receives logs, not the parent habit),
 * pass it and it is used as-is. When omitted, this module falls back to a
 * coarser state-only credit (`done` = 1, `partial` = 0.5, `miss` = 0) — see
 * `dayCredit`. This keeps the common case (caller only has `state`) simple
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
};

const BUCKETS = [
  { key: 'recent', fromDay: 0, toDay: 6, weight: 0.50 },  // last 7 days
  { key: 'mid', fromDay: 7, toDay: 29, weight: 0.35 },    // 8-30 days back
  { key: 'long', fromDay: 30, toDay: 89, weight: 0.15 },  // 31-90 days back
] as const;

/**
 * Per-day credit toward a bucket's rate.
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
 * exact §8.6 ratio, and 0.5 is the same fallback `reportMetrics.ts` already
 * uses for a state with no numeric goal attached (see `habitLogPercent`'s
 * `partial` branch there), so this stays consistent with the rest of the
 * codebase rather than inventing a new convention.
 */
function dayCredit(log: Pick<StrengthLog, 'state' | 'ratio'>): number {
  if (log.state === 'skip') return 0;
  if (typeof log.ratio === 'number') return Math.max(0, Math.min(1, log.ratio));
  if (log.state === 'done') return 1;
  if (log.state === 'partial') return 0.5;
  return 0; // miss
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
  const asOf = options.asOf ?? new Date();

  const sinceYmd = options.since
    ? ymd(options.since)
    : logs.reduce<string | null>((min, l) => {
      const d = l.completed_at.slice(0, 10); // 'completed_at' zaten yerel 'date' kolonu — burada UTC dönüşümü yok.
      return min == null || d < min ? d : min;
    }, null);

  if (sinceYmd == null) return 0; // ne `since` verildi ne de hiç log var — dayanacak hiçbir şey yok.

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

  let weightSum = 0;
  let scoreSum = 0;

  for (const bucket of BUCKETS) {
    let expected = 0;
    let credit = 0;

    for (let dayOffset = bucket.fromDay; dayOffset <= bucket.toDay; dayOffset++) {
      const d = ymd(addDaysLocal(asOf, -dayOffset));
      if (d < sinceYmd) continue; // habit bu gün henüz yoktu — bu gün hiçbir bucket'ta beklenmez.

      const log = logByDate.get(d);
      if (log && log.state === 'skip') continue; // skip: pay VE paydan tamamen dışlanır.

      expected += 1;
      credit += log ? dayCredit(log) : 0; // log yoksa (hiç dokunulmamış gün) = gerçek bir kaçırma, 0 kredi ama sayılır.
    }

    if (expected === 0) continue; // bkz. yukarıdaki re-normalisation notu — bu bucket ağırlığa katılmaz.

    const rate = credit / expected;
    weightSum += bucket.weight;
    scoreSum += bucket.weight * rate;
  }

  if (weightSum === 0) return 0; // hiçbir bucket'ta beklenen gün yoktu (örn. `since` gelecekte).

  return Math.max(0, Math.min(100, Math.round((scoreSum / weightSum) * 100)));
}
