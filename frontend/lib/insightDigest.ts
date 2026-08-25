/**
 * Weekly/Monthly AI-insight digest builder.  (Phase 3, CODER-L, plan §13)
 *
 * Plan §13, verbatim: "prompt'a bütün ham veriyi göndermek yerine
 * deterministic analytics motorunun özetleri verilmelidir" -- with the
 * worked example `walking_completion_30d = 72`, `monday_completion = 41`,
 * `weekend_completion = 92`, `recovery_success = 80`.
 *
 * This module builds exactly that: a compact, deterministic, fully
 * unit-testable summary object assembled ONLY from the OUTPUTS of
 * `lib/behaviorIntelligence.ts` (Phase 2's exact-arithmetic engine) and
 * `lib/capacity.ts`/`lib/recovery.ts`-derived numbers a caller already
 * computed. No I/O, no `supabase` import, no React, no store -- same purity
 * contract as `lib/routineProposal.ts` and `lib/behaviorIntelligence.ts`
 * itself.
 *
 * ## The "no raw log rows" guarantee is structural, not a convention
 *
 * Every input type below (`WeeklyDigestInput`, `MonthlyDigestInput`) is
 * built from `Result<T>` values, plain already-computed numbers, and
 * `{ habitName, rate }` pairs -- NONE of them has a field capable of holding
 * a `HabitLog`/`BILog` row (no `habit_id`, no `completed_at`, no `state`).
 * A caller cannot accidentally leak a raw log into a digest through this
 * module's own type signatures; the reduction from raw rows to a rate
 * MUST already have happened (via `behaviorIntelligence.ts`) before this
 * file ever sees the data. This is deliberately a stronger guarantee than
 * "we promise not to pass logs in" -- it is "there is nowhere to put them".
 *
 * ## The "never fabricate a missing metric" rule
 *
 * Same rule `willpowerStore.score()` established (`null` instead of a
 * guessed `100`) and `lib/behaviorIntelligence.ts`'s whole `Result<T>`
 * design formalises: every metric sourced from a `Result<T>` that comes
 * back `{ ok: false }` is OMITTED from `Digest.entries` entirely -- never
 * emitted as a fabricated `0`. The omission itself is not silent: it is
 * recorded in `Digest.omittedMetrics` with the real reason, so a test (or a
 * future caller) can confirm every absence was deliberate, not a bug.
 * `formatDigestForPrompt` only ever renders `entries` -- an omitted metric
 * never reaches the AI prompt as a number, fabricated or otherwise.
 *
 * A handful of inputs (today's/this month's capacity load, overload-day
 * counts, focus minutes) are plain numbers rather than `Result<T>` --
 * `lib/capacity.ts`'s `dailyLoad` and the screen's own day-walking counters
 * always produce a real, evidenced value (including a real `0`, exactly
 * like `behaviorIntelligence.currentStreak`'s own "`0` is earned, not
 * guessed" rule), so there is no insufficient-data branch to model for
 * them. The one exception -- overall week/month completion rate -- CAN be a
 * fabricated `0` when there are no active habits at all (`reportMetrics.
 * habitAveragePercent` returns `0` for an empty habit list, which is "no
 * average exists" wearing a real number's clothes); both digest builders
 * below guard that specific case with `activeHabitCount` and omit the
 * metric instead of trusting the raw number.
 *
 * ## Where this is wired in -- and why
 *
 * `app/screens/insights.tsx` (plan §11) is the ONLY screen that already
 * computes every ingredient both digests need in one place: per-weekday
 * completion (`weekdayBreakdown`, required for `monday_completion`/
 * `weekend_completion`-style keys), 4- and 12-week trends, strongest/most
 * fragile habit, recovery success rate, today's capacity load, and weekly
 * AND monthly focus minutes. `app/screens/weekly-review.tsx` and
 * `app/screens/monthly-review.tsx` each have only part of this (neither
 * computes a per-weekday breakdown at all), so wiring the AI-commentary
 * action into `insights.tsx` avoids duplicating a second data-fetch/
 * computation pass elsewhere for the same numbers. See this task's report
 * for the full reasoning.
 */
import { MIN_WEEKDAY_SAMPLES } from './behaviorIntelligence';
import type { Result, Trend, WeekdayStat } from './behaviorIntelligence';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Every value in a digest is a plain number -- percentages are already
 *  rounded to whole points (`pct`, below), counts/minutes are already
 *  integers. Kept uniformly numeric (rather than allowing a qualitative
 *  string like a capacity-band label) so `formatDigestForPrompt`'s output
 *  is uniform `key = number` lines, matching plan §13's example exactly. */
export type DigestEntries = Record<string, number>;

export type OmittedMetric = { key: string; reason: string };

export type Digest = {
  period: 'weekly' | 'monthly';
  /** Insertion-ordered -- every key here is a non-numeric-looking string
   *  (`snake_case`), so standard JS object key ordering (insertion order
   *  for string keys) is guaranteed by spec, which is what makes
   *  `formatDigestForPrompt` deterministic. */
  entries: DigestEntries;
  /** Every metric that COULD have appeared in `entries` but didn't, with
   *  the real reason -- never silently dropped. See file doc. */
  omittedMetrics: OmittedMetric[];
};

/** A per-habit rate already reduced to a `Result<number>` by
 *  `behaviorIntelligence.habitCompletionRate` -- see file doc for why this
 *  shape cannot carry a raw log row. */
export type NamedHabitRate = { habitName: string; rate: Result<number> };

/** Caps how many per-habit rate entries a digest carries -- same "bound a
 *  legitimate list without inventing a new rule" reasoning
 *  `routineProposal.ts`'s `MAX_HABITS_PER_PROPOSAL` uses; a prompt digest
 *  naming every habit a power user has would stop being "compact". Mirrors
 *  `app/screens/ai-coach.tsx`'s own existing `.slice(0, 20)` cap on the
 *  analogous habit-name list, at a smaller number appropriate to a
 *  per-habit NUMBER line rather than a short name. */
export const MAX_HABIT_ENTRIES = 12;

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

/** Fraction (0..1) -> whole percentage point, the same rounding
 *  `app/screens/insights.tsx` already applies at every call site
 *  (`Math.round(v * 100)`), reused here rather than re-invented. */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

const TURKISH_ASCII_MAP: Record<string, string> = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u',
};

/** Deterministic `habit_name -> ascii_snake_case` transform for building a
 *  per-habit digest key (e.g. plan §13's own `walking_completion_30d`,
 *  where `walking` is a transliterated habit name). Never throws, never
 *  returns an empty string (falls back to `'habit'`) so a pathological
 *  habit name (all punctuation, all emoji) still produces a usable key
 *  rather than an unreadable `_completion_30d`. */
export function slugify(name: string): string {
  const transliterated = name.split('').map((ch) => TURKISH_ASCII_MAP[ch] ?? ch).join('');
  const cleaned = transliterated.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'habit';
}

function isKeyTaken(key: string, entries: DigestEntries, omitted: OmittedMetric[]): boolean {
  return key in entries || omitted.some((o) => o.key === key);
}

/** Returns `base` if unused, else `base_2`, `base_3`, ... -- guards against
 *  two DIFFERENT habits slugifying to the same key (e.g. "Su İç" and
 *  "SU-iç" both -> `su_ic`), which would otherwise silently overwrite one
 *  entry with another. Checked against the full key (slug + suffix), so two
 *  habits sharing a slug but appearing under DIFFERENT suffixes (one as
 *  `_strength`, the other as `_completion_30d`) never collide in the first
 *  place -- there is nothing to dedupe. */
function dedupeKey(base: string, entries: DigestEntries, omitted: OmittedMetric[]): string {
  if (!isKeyTaken(base, entries, omitted)) return base;
  let i = 2;
  while (isKeyTaken(`${base}_${i}`, entries, omitted)) i += 1;
  return `${base}_${i}`;
}

function recordResult<T>(
  entries: DigestEntries,
  omitted: OmittedMetric[],
  key: string,
  result: Result<T>,
  toValue: (v: T) => number,
): void {
  if (result.ok) entries[key] = toValue(result.value);
  else omitted.push({ key, reason: result.reason });
}

function recordHabitRates(
  entries: DigestEntries,
  omitted: OmittedMetric[],
  rates: NamedHabitRate[],
): void {
  for (const h of rates.slice(0, MAX_HABIT_ENTRIES)) {
    const key = dedupeKey(`${slugify(h.habitName)}_completion_30d`, entries, omitted);
    recordResult(entries, omitted, key, h.rate, pct);
  }
}

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

export type WeeklyDigestInput = {
  /** Guards `weekCompletionRate` -- see file doc's "no fabricated 0" note. */
  activeHabitCount: number;
  /** Already a 0-100 percent (`reportMetrics.calculateHabitCompletionRate`'s
   *  own return shape) -- not a `Result`, because that function itself
   *  never returns "insufficient", only sometimes a fabricated `0` this
   *  digest guards against via `activeHabitCount` instead. */
  weekCompletionRate: number;
  weekOverWeekTrend: Result<Trend>;
  /** This week's per-weekday scheduled/completed/rate -- `weekday` 0=Pzt
   *  (Monday) .. 6=Paz (Sunday), per `behaviorIntelligence.weekdayIndex`'s
   *  own convention. An OUTPUT of `weekdayBreakdown`, not raw logs. */
  weekdayStats: WeekdayStat[];
  strongestHabit: Result<{ habitName: string; strength: number }>;
  mostFragileHabit: Result<{ habitName: string; volatility: number }>;
  recoverySuccess: Result<number>;
  habitCompletionRates30d: NamedHabitRate[];
  /** `lib/capacity.ts`'s `dailyLoad(...).normalised`, 0-100. */
  capacityLoadToday: number;
  overloadDaysThisWeek: number;
  focusMinutesThisWeek: number;
};

/**
 * Plan §13's weekly digest: `week_completion_rate`, `week_over_week_trend`,
 * one `<weekday>_completion` entry per weekday that clears
 * `behaviorIntelligence.MIN_WEEKDAY_SAMPLES` (plus a combined
 * `weekend_completion`), `<habit>_strength`/`<habit>_volatility` for the
 * strongest/most fragile habit, `recovery_success`, one
 * `<habit>_completion_30d` per active habit (capped at
 * `MAX_HABIT_ENTRIES`), and the three always-real capacity/focus counts.
 * Every entry sourced from a `Result` is omitted, never zeroed, when its
 * source was `{ ok: false }` -- see file doc.
 */
export function weeklyDigest(input: WeeklyDigestInput): Digest {
  const entries: DigestEntries = {};
  const omitted: OmittedMetric[] = [];

  if (input.activeHabitCount > 0) {
    entries.week_completion_rate = Math.round(input.weekCompletionRate);
  } else {
    omitted.push({ key: 'week_completion_rate', reason: 'no active habits' });
  }

  recordResult(entries, omitted, 'week_over_week_trend', input.weekOverWeekTrend, (t) => pct(t.magnitude));

  for (const stat of input.weekdayStats) {
    const dayKey = `${WEEKDAY_KEYS[stat.weekday] ?? `weekday_${stat.weekday}`}_completion`;
    if (stat.scheduled >= MIN_WEEKDAY_SAMPLES) {
      entries[dayKey] = pct(stat.rate);
    } else {
      omitted.push({ key: dayKey, reason: `insufficient sample size (${stat.scheduled} scheduled day(s), need >= ${MIN_WEEKDAY_SAMPLES})` });
    }
  }

  const saturday = input.weekdayStats.find((s) => s.weekday === 5);
  const sunday = input.weekdayStats.find((s) => s.weekday === 6);
  if (saturday && sunday) {
    const scheduled = saturday.scheduled + sunday.scheduled;
    const completed = saturday.completed + sunday.completed;
    if (scheduled >= MIN_WEEKDAY_SAMPLES) {
      entries.weekend_completion = pct(completed / scheduled);
    } else {
      omitted.push({ key: 'weekend_completion', reason: `insufficient sample size (${scheduled} scheduled day(s), need >= ${MIN_WEEKDAY_SAMPLES})` });
    }
  } else {
    omitted.push({ key: 'weekend_completion', reason: 'Saturday/Sunday weekday stats not provided' });
  }

  if (input.strongestHabit.ok) {
    const key = dedupeKey(`${slugify(input.strongestHabit.value.habitName)}_strength`, entries, omitted);
    entries[key] = Math.round(input.strongestHabit.value.strength);
  } else {
    omitted.push({ key: 'strongest_habit_strength', reason: input.strongestHabit.reason });
  }

  if (input.mostFragileHabit.ok) {
    const key = dedupeKey(`${slugify(input.mostFragileHabit.value.habitName)}_volatility`, entries, omitted);
    entries[key] = pct(input.mostFragileHabit.value.volatility);
  } else {
    omitted.push({ key: 'most_fragile_habit_volatility', reason: input.mostFragileHabit.reason });
  }

  recordResult(entries, omitted, 'recovery_success', input.recoverySuccess, pct);
  recordHabitRates(entries, omitted, input.habitCompletionRates30d);

  entries.capacity_load_today = Math.round(input.capacityLoadToday);
  entries.overload_days_this_week = Math.round(input.overloadDaysThisWeek);
  entries.focus_minutes_this_week = Math.round(input.focusMinutesThisWeek);

  return { period: 'weekly', entries, omittedMetrics: omitted };
}

// ---------------------------------------------------------------------------
// Monthly digest
// ---------------------------------------------------------------------------

export type MonthlyDigestInput = {
  /** Guards `monthCompletionRate` -- same reasoning as `WeeklyDigestInput`. */
  activeHabitCount: number;
  monthCompletionRate: number;
  trend4w: Result<Trend>;
  trend12w: Result<Trend>;
  strongestHabit: Result<{ habitName: string; strength: number }>;
  mostFragileHabit: Result<{ habitName: string; volatility: number }>;
  recoverySuccess: Result<number>;
  habitCompletionRates30d: NamedHabitRate[];
  overloadDaysThisMonth: number;
  focusMinutesThisMonth: number;
};

/**
 * Plan §13's monthly digest: `month_completion_rate`, `trend_4w`/`trend_12w`,
 * `<habit>_strength`/`<habit>_volatility`, `recovery_success`, per-habit
 * `<habit>_completion_30d`, and the two always-real monthly counts. No
 * per-weekday breakdown -- see file doc for why that stays a weekly-only
 * concept in this digest design.
 */
export function monthlyDigest(input: MonthlyDigestInput): Digest {
  const entries: DigestEntries = {};
  const omitted: OmittedMetric[] = [];

  if (input.activeHabitCount > 0) {
    entries.month_completion_rate = Math.round(input.monthCompletionRate);
  } else {
    omitted.push({ key: 'month_completion_rate', reason: 'no active habits' });
  }

  recordResult(entries, omitted, 'trend_4w', input.trend4w, (t) => pct(t.magnitude));
  recordResult(entries, omitted, 'trend_12w', input.trend12w, (t) => pct(t.magnitude));

  if (input.strongestHabit.ok) {
    const key = dedupeKey(`${slugify(input.strongestHabit.value.habitName)}_strength`, entries, omitted);
    entries[key] = Math.round(input.strongestHabit.value.strength);
  } else {
    omitted.push({ key: 'strongest_habit_strength', reason: input.strongestHabit.reason });
  }

  if (input.mostFragileHabit.ok) {
    const key = dedupeKey(`${slugify(input.mostFragileHabit.value.habitName)}_volatility`, entries, omitted);
    entries[key] = pct(input.mostFragileHabit.value.volatility);
  } else {
    omitted.push({ key: 'most_fragile_habit_volatility', reason: input.mostFragileHabit.reason });
  }

  recordResult(entries, omitted, 'recovery_success', input.recoverySuccess, pct);
  recordHabitRates(entries, omitted, input.habitCompletionRates30d);

  entries.overload_days_this_month = Math.round(input.overloadDaysThisMonth);
  entries.focus_minutes_this_month = Math.round(input.focusMinutesThisMonth);

  return { period: 'monthly', entries, omittedMetrics: omitted };
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Renders a `Digest` as plan §13's literal `key = value` line format, one
 * metric per line, in `entries`' insertion order -- deterministic (same
 * `Digest` in, same string out, always) and snapshot-testable. Only
 * `entries` is rendered; `omittedMetrics` never reaches the prompt (an
 * unavailable metric should be silent to the AI, not narrated).
 */
export function formatDigestForPrompt(digest: Digest): string {
  return Object.entries(digest.entries)
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');
}
