/**
 * Capacity Engine V1 -- "Günlük Kapasite" (Plan §10).  (Phase 1, CODER-B)
 *
 * Pure domain logic. No I/O, no Supabase client, no store, no UI. Every
 * export here is a plain function over plain data so it can be unit tested
 * without a database and reused unchanged once the UI/store rewiring
 * (tracked as follow-up, see the module doc at the bottom) happens.
 *
 * ## v1 heuristic disclaimer
 *
 * Every weight, curve and constant in this file is a **v1 heuristic**,
 * chosen to produce a plausible, tunable ranking -- not a measured
 * psychological quantity. The plan is explicit that the product must not
 * imply precise psychological measurement (irade/capacity is not a
 * biometric). Treat every number below as a dial, not a fact, and read the
 * comment next to it before changing it.
 */

import type { Habit, HabitLog, FrequencyConfig } from './supabase';
import { ymd, ymdFromIso, parseLocalDate, addDaysLocal, daysBetweenLocal } from './date';
import { scheduledCompletionRate, isWithinRange } from './habitSchedule';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// §10 -- per-habit load
// ---------------------------------------------------------------------------

/**
 * The subset of `Habit` that `habitLoad` reads. A structural `Pick` (not the
 * full `Habit`) so tests and future callers can build lightweight fixtures
 * without a real Supabase row.
 *
 * `impact_level` is included because the plan lists it as an available
 * input, but it is deliberately NOT multiplied into the numeric load below:
 * the plan's worked formula for `habit_load` names exactly three factors
 * (difficulty × frequency × duration), and reproducing that formula exactly
 * is a Definition-of-Done requirement. `impact_level` is reserved for the
 * advisory layer (`capacityAdvice`'s tone/CTAs) in a later iteration, not
 * for the raw number -- a "critical" habit should perhaps be *recommended*
 * even at high load, not silently made to LOOK lighter than it is.
 */
export type HabitLoadInput = Pick<Habit, 'difficulty' | 'estimated_minutes' | 'frequency_config' | 'impact_level'>;

/**
 * Difficulty -> weight, in [0.2, 1.0].
 *
 * `difficulty` is 1|3|5 (Kolay/Orta/Zor) throughout the app. A floor of 0.2
 * rather than 0 is deliberate: even the "easy" tier still costs *something*
 * -- a habit that contributed literally zero load could be stacked without
 * limit, which is exactly the failure mode the plan is replacing (the old
 * fixed "max 3 habits" rule). Linear in `difficulty` because there are only
 * three discrete values in practice; a curve would be over-fitting three
 * points.
 */
function difficultyWeight(difficulty: number): number {
  const d = clamp(difficulty, 1, 5);
  return 0.2 + 0.8 * (d / 5);
}

/**
 * Weekly recurrence -> weight, in [0, 1].
 *
 * Converts whatever `frequency_config` says into "occurrences per week",
 * then expresses that as a fraction of "every day" (7/week). A habit done
 * once a week contributes a small slice of any GIVEN day's load, because on
 * six of those seven days it is not due at all; a daily habit contributes
 * its full weight every day.
 *
 * Capped at 1.0 on purpose: a `count` field pushed above "once daily" (e.g.
 * "drink water 5x/day") does not multiply the load further here. That extra
 * burden is expected to already show up as a larger `estimated_minutes`
 * (the user's own estimate of total daily time), so letting `count` also
 * uncap this factor would double-count it and let a stray large `count`
 * dominate the whole product.
 */
function frequencyWeight(freq: FrequencyConfig): number {
  const perWeek = occurrencesPerWeek(freq);
  return clamp(perWeek / 7, 0, 1);
}

/**
 * How many times a week the schedule asks for the habit, on average.
 *
 * The ONE frequency -> occurrences mapping in the app: `frequencyWeight`
 * (capacity load) and `triage.costBreakdown` (willpower cost, R01.02-d2) both
 * read it, so the two cannot disagree about how often a habit happens.
 *
 * `daily` + `interval_days > 1` ("every N days", R01.02-d2 / KD-07): 7 / N a
 * week (times `count` when given). Before this the branch ignored the
 * interval, so "every 3 days" was loaded as 7 a week instead of ~2.33.
 * `interval_days` absent or <= 1 is plain daily, exactly as before. The date
 * range (`range_start`/`range_end`) is deliberately NOT read here: this is a
 * weekly average, not a calendar -- see STATE.md KD-08.
 */
export function occurrencesPerWeek(freq: FrequencyConfig): number {
  if (!freq) return 7; // no config recorded -- treat as daily, the app's own default
  switch (freq.kind) {
    case 'daily': {
      const n = freq.interval_days;
      const perDay = typeof n === 'number' && n > 1 ? 1 / n : 1;
      return 7 * perDay * (freq.count ?? 1);
    }
    case 'weekly':
      if (freq.days && freq.days.length > 0) return freq.days.length;
      return freq.count ?? 1;
    case 'monthly': {
      const DAYS_PER_MONTH = 30.44; // calendar-average month length
      // R01.02 — fixed days of the month count as that many a month.
      const perMonth = freq.month_days && freq.month_days.length > 0 ? freq.month_days.length : (freq.count ?? 1);
      return (perMonth * 7) / DAYS_PER_MONTH;
    }
    case 'yearly':
      return 7 / 365.25; // R01.02 — once a year
    default:
      return 7;
  }
}

/**
 * Duration is `1.0` at `DURATION_REFERENCE_MINUTES` -- the plan's own
 * "90 dk gym = yüksek" example -- and grows only sub-linearly beyond it.
 *
 * Why logarithmic, not linear: the plan requires "duration must not scale
 * linearly forever, or a 90-minute habit swamps everything". Perceived
 * effort grows with duration but at a DECELERATING rate -- the jump from 5
 * to 20 minutes feels much larger than the jump from 90 to 105. `ln(1+m)`
 * captures that: doubling a short duration moves the weight a lot; doubling
 * an already-long one barely moves it. A linear curve, by contrast, would
 * make a single 90-minute habit worth 18x a 5-minute one in this factor
 * alone, which is not how a day's worth of habits actually competes for
 * attention.
 */
const DURATION_REFERENCE_MINUTES = 90;
function durationWeight(minutes: number): number {
  const m = Math.max(0, minutes);
  return Math.log(1 + m) / Math.log(1 + DURATION_REFERENCE_MINUTES);
}

/**
 * `habit_load = difficulty_weight × frequency_weight × duration_weight`,
 * verbatim from the plan. Roughly in `[0, ~1.15]` given the weight ranges
 * above (a habit configured well past the 90-minute reference can exceed
 * 1.0 slightly, which is intended -- there is no hard ceiling on how heavy a
 * single habit can be, only a decelerating one).
 */
export function habitLoad(habit: HabitLoadInput): number {
  return difficultyWeight(habit.difficulty) * frequencyWeight(habit.frequency_config) * durationWeight(habit.estimated_minutes);
}

/**
 * A single maximally-heavy daily habit (difficulty 5, 90 minutes, daily --
 * `habitLoad` == 1.0 exactly by construction, since duration is normalised
 * AT 90 minutes and difficulty 5 is the weight ceiling) is worth 18 of the
 * 100-point daily budget. That is this module's one true "normalisation
 * constant" for the habit axis: every other habit-load number is this
 * constant times a fraction of it. 18 was chosen, not measured, so that one
 * such habit is clearly significant (matches the plan's own "74 + 18 → 92"
 * example) without a single habit being able to consume the entire day by
 * itself.
 */
export const HABIT_POINTS_SCALE = 18;

/**
 * KD-08 — the habits whose date range covers `asOf`.
 *
 * An active habit whose range has ENDED (or not yet started) does nothing on
 * `asOf`, yet every activation gate used to count its full weekly-average load
 * against today's capacity: "3 a week, 1-14 August" kept refusing new habits
 * in September. The schedule is not consulted here on purpose -- see
 * `habitSchedule.isWithinRange`. A habit with no range always passes, so for
 * every range-less user this returns the same habits in the same order.
 */
export function habitsInRangeOn<T extends HabitLoadInput>(habits: readonly T[], asOf: Date): T[] {
  return habits.filter((h) => isWithinRange(h, asOf));
}

/** `habitLoad` expressed in day-scale points (see `HABIT_POINTS_SCALE`). */
export function habitLoadPoints(habit: HabitLoadInput): number {
  return habitLoad(habit) * HABIT_POINTS_SCALE;
}

// ---------------------------------------------------------------------------
// §10 -- daily load
// ---------------------------------------------------------------------------

/**
 * The only fields a task contributes to load. Deliberately NOT the app's
 * full Task shape -- that type lives outside this domain layer (there is no
 * canonical `Task` type in `lib/supabase.ts` today, and this module must not
 * reach into `app/**`/`components/**`). Any object with an optional
 * `estimated_minutes` satisfies this.
 */
export type TaskLoadItem = { estimated_minutes?: number | null };

/**
 * Base points every task contributes just by existing (context-switch
 * overhead), plus a duration-scaled top-up using the same saturating curve
 * as habits. Deliberately smaller per-unit than a habit: tasks don't carry
 * a difficulty multiplier here, so undifferentiated per-task weight is kept
 * modest to avoid a long task list alone pushing the day into "aşırı".
 */
const TASK_BASE_POINTS = 3;
const TASK_DURATION_POINTS = 5;
const DEFAULT_TASK_MINUTES = 15; // used when a task has no estimate at all

function taskLoadPoints(task: TaskLoadItem): number {
  const minutes = task.estimated_minutes ?? DEFAULT_TASK_MINUTES;
  return TASK_BASE_POINTS + durationWeight(minutes) * TASK_DURATION_POINTS;
}

/**
 * Points per minute of completed focus work. Linear on purpose: a focus
 * session's own length is already self-limiting (25/50 minute blocks in
 * practice), so unlike a habit's open-ended `estimated_minutes`, there is
 * little risk of a single number distorting the whole day -- a saturating
 * curve would be solving a problem this input does not have. 60 minutes of
 * focus work costs 3 points.
 */
const FOCUS_POINTS_PER_MINUTE = 0.05;

/**
 * Points per overdue item. Linear and uncapped -- a backlog of overdue
 * items is meant to visibly dominate the load number the longer it is
 * ignored; capping it would hide exactly the situation this input exists to
 * surface.
 */
const OVERDUE_POINTS_PER_ITEM = 3;

export type DailyLoadInput = {
  /** The habits whose load counts. `dailyLoad` is a pure sum over whatever it
   *  is handed -- deciding WHICH habits count is the caller's job, and there
   *  are two kinds of caller:
   *
   *  - activation gates ("can I take this on today?" -- `evaluateActivation`,
   *    `evaluateProposal`, the capacity previews) pass every ACTIVE habit and
   *    let `frequencyWeight` fold its schedule in as a weekly average. They do
   *    NOT filter by schedule (that would count it twice); they DO filter by
   *    the date envelope via `habitsInRangeOn` (KD-08).
   *  - day walks (weekly/monthly review, insights overload days) pass the
   *    habits that carried work on that specific day (`carriesDayLoad`),
   *    which already excludes days outside the range.
   *
   *  (This used to say "filter by schedule with isDueOn", which no activation
   *  caller ever did -- a stale contract, corrected with KD-08.) */
  habits: HabitLoadInput[];
  tasks?: TaskLoadItem[];
  focusMinutes?: number;
  overdueCount?: number;
};

export type DailyLoadResult = {
  /** Unclamped point sum -- can exceed 100 on a genuinely overloaded day. */
  raw: number;
  /** `raw` clamped and rounded into the 0-100 scale the bands are defined on. */
  normalised: number;
  band: LoadBandKey;
};

/**
 * `daily_load = habit_load + task_load + focus_load + overdue_pressure`,
 * normalised to 0-100.
 *
 * Every summand here is already expressed in the same "100 ≈ a full,
 * sustainable day" point scale (see `HABIT_POINTS_SCALE` and the constants
 * above), so `raw` is a straight sum and `normalised` is just `raw` clamped
 * into range and rounded -- there is no separate hidden division. This is a
 * v1 heuristic composition, not a measured quantity: the four inputs are
 * summed as if they were fungible, which is a simplification (a heavy
 * overdue backlog does not literally cost the same kind of "capacity" as a
 * long habit), made because a single legible number is the point of this
 * feature and a more elaborate model has no evidence behind it yet.
 */
export function dailyLoad({ habits, tasks = [], focusMinutes = 0, overdueCount = 0 }: DailyLoadInput): DailyLoadResult {
  const habitPoints = habits.reduce((sum, h) => sum + habitLoadPoints(h), 0);
  const taskPoints = tasks.reduce((sum, t) => sum + taskLoadPoints(t), 0);
  const focusPoints = Math.max(0, focusMinutes) * FOCUS_POINTS_PER_MINUTE;
  const overduePoints = Math.max(0, overdueCount) * OVERDUE_POINTS_PER_ITEM;
  const raw = habitPoints + taskPoints + focusPoints + overduePoints;
  const normalised = clamp(Math.round(raw), 0, 100);
  return { raw, normalised, band: bandFor(normalised) };
}

// ---------------------------------------------------------------------------
// §10 -- load bands (exact boundaries)
// ---------------------------------------------------------------------------

export type LoadBandKey = 'dusuk' | 'dengeli' | 'yuksek' | 'asiri';

export type LoadBand = { key: LoadBandKey; label: string; min: number; max: number };

/**
 * `0-40 düşük · 41-70 dengeli · 71-85 yüksek · 86-100 aşırı` -- exact
 * boundaries from the plan. `min`/`max` are inclusive.
 */
export const LOAD_BANDS: readonly LoadBand[] = [
  { key: 'dusuk', label: 'düşük', min: 0, max: 40 },
  { key: 'dengeli', label: 'dengeli', min: 41, max: 70 },
  { key: 'yuksek', label: 'yüksek', min: 71, max: 85 },
  { key: 'asiri', label: 'aşırı', min: 86, max: 100 },
];

// ---------------------------------------------------------------------------
// R03.05 -- what a make-up does to the day it lands on
// ---------------------------------------------------------------------------

/**
 * The points of ONE occurrence of a habit -- its full per-occurrence load,
 * whatever its schedule. `habitLoadPoints` spreads a habit over the week
 * (`frequencyWeight`), which is right for "how heavy is my week"; a make-up
 * is one extra occurrence on one specific day, and a weekly habit's make-up is
 * a whole session of work on that day, not a seventh of one.
 */
export function oneOccurrencePoints(habit: HabitLoadInput): number {
  return habitLoadPoints({ ...habit, frequency_config: { kind: 'daily' } });
}

export type MakeupLoadPreview = {
  /** The day's load before this make-up, 0-100. */
  before: number;
  /** ... and after it, 0-100. */
  after: number;
  bandBefore: LoadBandKey;
  bandAfter: LoadBandKey;
  /** Unrounded points this make-up adds. */
  addedPoints: number;
};

/**
 * R03.05 -- the load a make-up adds to the day it is moved to, for the
 * planning preview ("taşınan iş yeni güne ek yük yaratıyorsa önizlemede
 * göster").
 *
 * The baseline is the same model as the activation gates -- every active
 * habit at its weekly-average weight, filtered by the date envelope for THAT
 * day -- plus the tasks due that day and the make-ups already planned onto it.
 * The make-up adds one occurrence (`oneOccurrencePoints`), scaled by `share`:
 * 1 for a full make-up, 0.5 for each day of `split_two_days`. A preview, not a
 * gate: it informs the choice and refuses nothing.
 */
export function makeupLoadPreview(params: {
  day: Date;
  activeHabits: readonly HabitLoadInput[];
  incoming: HabitLoadInput;
  share: number;
  tasksDue?: TaskLoadItem[];
  plannedMakeups?: readonly { habit: HabitLoadInput; share: number }[];
}): MakeupLoadPreview {
  const planned = (params.plannedMakeups ?? []).reduce((sum, m) => sum + oneOccurrencePoints(m.habit) * m.share, 0);
  const baseRaw = dailyLoad({ habits: habitsInRangeOn(params.activeHabits, params.day), tasks: params.tasksDue }).raw + planned;
  const addedPoints = oneOccurrencePoints(params.incoming) * Math.max(0, params.share);
  const before = clamp(Math.round(baseRaw), 0, 100);
  const after = clamp(Math.round(baseRaw + addedPoints), 0, 100);
  return { before, after, bandBefore: bandFor(before), bandAfter: bandFor(after), addedPoints };
}

/** Which band a 0-100 load value falls in. Clamps out-of-range input. */
export function bandFor(n: number): LoadBandKey {
  const v = clamp(n, 0, 100);
  const band = LOAD_BANDS.find((b) => v >= b.min && v <= b.max);
  // Unreachable given LOAD_BANDS covers [0,100] with no gaps, but keeps the
  // function total instead of possibly-undefined.
  return band ? band.key : 'asiri';
}

// ---------------------------------------------------------------------------
// §10 -- capacity advice (the "74 + 18 → 92" example)
// ---------------------------------------------------------------------------

export type CapacityVerdict = 'safe' | 'caution' | 'unsustainable';

export type CapacityAdvice = {
  /** `currentLoad + incomingHabit`'s points, clamped to [0,100]. */
  projected: number;
  verdict: CapacityVerdict;
  /** Turkish, user-facing. The 'unsustainable' message/ctas reproduce the
   *  plan's worked example verbatim. */
  message: string;
  ctas: string[];
  /** How many of the 100 points this specific habit would add. */
  incomingPoints: number;
};

/**
 * The plan's worked example: current load 74, adding an incoming habit
 * worth 18 points projects to 92 (the "aşırı" band) and produces the exact
 * message/CTAs below.
 */
export function capacityAdvice({
  currentLoad,
  incomingHabit,
}: {
  currentLoad: number;
  incomingHabit: HabitLoadInput;
}): CapacityAdvice {
  const incomingPoints = habitLoadPoints(incomingHabit);
  const projected = clamp(Math.round(currentLoad + incomingPoints), 0, 100);
  const band = bandFor(projected);

  if (band === 'asiri') {
    return {
      projected,
      incomingPoints,
      verdict: 'unsustainable',
      message: 'Bu rutini şimdi başlatmak sürdürülebilir olmayabilir.',
      ctas: ['Kuyruğa al', 'Düşük yoğunlukla başla', 'Yine de etkinleştir'],
    };
  }
  if (band === 'yuksek') {
    return {
      projected,
      incomingPoints,
      verdict: 'caution',
      message: 'Bu rutin bugünün geri kalanını zorlayabilir.',
      ctas: ['Düşük yoğunlukla başla', 'Yine de etkinleştir'],
    };
  }
  return {
    projected,
    incomingPoints,
    verdict: 'safe',
    message: 'Bu rutin bugüne rahatça sığar.',
    ctas: ['Etkinleştir'],
  };
}

// ---------------------------------------------------------------------------
// §10 -- max-capacity activation gate (replaces the fixed 3-slot rule)
// ---------------------------------------------------------------------------

/**
 * The top of the "yüksek" band. Activation is refused only once it would
 * push the projected day into "aşırı" -- i.e. capacity, not a habit COUNT,
 * is the gate. This is what lets 5 easy habits coexist (their combined
 * points stay well under this ceiling) while a 3rd genuinely heavy habit
 * can be refused (its points alone cross the ceiling), which is the plan's
 * explicit requirement replacing the old `active_count < focus_capacity`
 * rule in `willpowerStore.ts`.
 */
export const CAPACITY_CEILING_DEFAULT = 85;

/**
 * Max-capacity replacement for `willpowerStore.canActivate`'s fixed
 * `active_count < focus_capacity` rule.
 * Keşfet atomik ekleme de bu kuralı kullanır (`exploreCatalog.buildAtomicHabitInsert`).
 *
 * NOTE: `willpowerStore.ts` is NOT modified by this change (out of scope
 * for the domain layer per the phase-1 task split). This function is the
 * new rule; wiring the store to call it instead of the fixed-slot check is
 * tracked as follow-up.
 */
export function canActivate({
  currentLoad,
  habit,
  ceiling = CAPACITY_CEILING_DEFAULT,
}: {
  currentLoad: number;
  habit: HabitLoadInput;
  ceiling?: number;
}): boolean {
  const projected = currentLoad + habitLoadPoints(habit);
  return projected <= ceiling;
}

// ---------------------------------------------------------------------------
// §10 -- Habit Mastery
// ---------------------------------------------------------------------------

/**
 * Minimum habit age, in days, before mastery can be granted at all -- ~4
 * calendar weeks. Not a claim about habit-formation neuroscience (the
 * "21/66/90 days" folk numbers have no solid evidence behind them and this
 * module refuses to imply otherwise); it is a pragmatic minimum SAMPLE
 * SIZE: `stability_score` below buckets the recent window into 4 weekly
 * chunks, so 28 days is the smallest history that gives every bucket at
 * least a chance to hold data, while still being short enough that mastery
 * isn't deferred indefinitely.
 */
export const MASTERY_MIN_AGE_DAYS = 28;

/**
 * How many of the recent days must be completed. 0.8, not 1.0, because
 * requiring perfection would mean one bad week (illness, travel) resets
 * mastery entirely, which does not match how "mastered" habits actually
 * behave in practice -- occasional legitimate misses are normal.
 */
export const MASTERY_COMPLETION_RATE_THRESHOLD = 0.8;

/**
 * How even completion must be week-to-week. 0.7 tolerates one moderately
 * uneven week among the trailing four without disqualifying the habit, but
 * rules out a clearly bursty pattern (two great weeks then two abandoned
 * ones) that a bare average completion rate would miss entirely -- see
 * `stability_score`'s doc below for why that distinction matters.
 */
export const MASTERY_STABILITY_THRESHOLD = 0.7;

/** Trailing window `recent_completion_rate`/`stability_score` are computed over. */
const RECENT_WINDOW_DAYS = 28;
/** The window is split into this many weekly buckets for `stability_score`. */
const STABILITY_WEEK_BUCKETS = 4;

export type MasteryResult = {
  /**
   * `minimum_age >= 28 AND recent_completion_rate >= threshold AND
   * stability_score >= threshold`, per the plan -- replaces the old bare
   * `strength >= 80` check.
   */
  mastered: boolean;
  /**
   * A mastered habit does not disappear -- it enters maintenance mode.
   * Kept as a SEPARATE field from `mastered` (even though it mirrors it in
   * v1) because mastery here literally IS the transition into maintenance;
   * a later iteration could let `maintenance` persist through a temporary
   * dip (hysteresis) instead of flipping back to `false` the moment one
   * criterion slips, without changing this type's shape. That hysteresis
   * is explicitly out of scope for v1 -- it would need a "was this habit
   * previously mastered" signal this function is not given.
   */
  maintenance: boolean;
  /** Human-readable pass/fail per criterion, for debugging/UI explanation. */
  reasons: string[];
  recent_completion_rate: number;
  stability_score: number;
  age_days: number;
  /** Due days the rate was measured over — 0 means "nothing was scheduled". */
  due_days: number;
  done_days: number;
};

/**
 * `stability_score`: 1 minus (2x) the standard deviation of the habit's
 * weekly completion rate across the trailing `STABILITY_WEEK_BUCKETS`
 * weeks, clamped to [0,1].
 *
 * WHY variance, not just the average: a habit done perfectly for two weeks
 * then abandoned for two has a *high average* completion rate (50%... or
 * even higher if the abandoned weeks are simply unlogged) but is not what
 * anyone means by "stable" -- `recent_completion_rate` alone cannot
 * distinguish steady 80%-every-week from two great weeks and two collapsed
 * ones. Variance across the weekly buckets captures exactly that
 * unevenness.
 *
 * A weekly rate's standard deviation over a [0,1]-bounded value maxes out
 * at 0.5 (half the weeks at 0, half at 1), so `1 - stdDev * 2` maps
 * "maximally uneven" to a stability of 0 and "perfectly even" to 1.
 */
function weeklyStability(
  habit: Habit,
  logs: HabitLog[],
  windowStart: Date,
  buckets: number,
  since: Date | null,
): number {
  const weekRates: number[] = [];
  for (let w = 0; w < buckets; w++) {
    const from = addDaysLocal(windowStart, w * 7);
    const to = addDaysLocal(windowStart, w * 7 + 6);
    // The SAME rate the threshold is applied to, per week. Measuring
    // stability on a log-count rate while gating on a schedule-aware one
    // would put the two halves of the mastery rule on different scales.
    const week = scheduledCompletionRate(habit, logs, { from, to, since });
    // A week with nothing due contributes 0 rather than being dropped: for a
    // habit that IS due most weeks, a week off is a real dip in consistency,
    // and dropping it would let an every-other-week habit read as perfectly
    // stable.
    weekRates.push(week.rate);
  }
  const mean = weekRates.reduce((a, b) => a + b, 0) / weekRates.length;
  const variance = weekRates.reduce((a, b) => a + (b - mean) ** 2, 0) / weekRates.length;
  const stdDev = Math.sqrt(variance);
  return clamp(1 - stdDev * 2, 0, 1);
}

/**
 * `minimum_age >= 28 days AND recent_completion_rate >= threshold AND
 * stability_score >= threshold` -- the plan's replacement for
 * `strength >= 80`.
 *
 * ## `recent_completion_rate` is schedule-aware
 *
 * It used to be `done` logs divided by TOTAL logs in the window, which made
 * the denominator "days the user touched" instead of "days the habit was
 * due". A daily habit logged `done` twice and ignored the other five days
 * scored 1.00 and was certified mastered on 2/7 adherence — the rule granted
 * its strongest verdict to its weakest evidence.
 *
 * The rate now comes from `habitSchedule.scheduledCompletionRate`, which owns
 * `isDueOn` and the skip / negative-habit exclusions. The calculation is not
 * repeated here; `capacity.ts` states the THRESHOLDS and
 * `habitSchedule.ts` states what is being measured.
 *
 * A habit with no due days in the window (paused, or scheduled outside it)
 * gets `rate: 0` and is not mastered. That is deliberate: mastery is a claim
 * about demonstrated consistency, and there is nothing to demonstrate it
 * with. `dueDays` is returned so a caller can tell that apart from "due and
 * missed".
 */
export function masteryStatus(
  habit: Habit,
  logs: HabitLog[],
  { asOf = new Date() }: { asOf?: Date } = {}
): MasteryResult {
  const createdDate = parseLocalDate(ymdFromIso(habit.created_at));
  const asOfDate = parseLocalDate(ymd(asOf))!;
  const ageDays = createdDate ? daysBetweenLocal(createdDate, asOfDate) : 0;

  const windowStart = addDaysLocal(asOfDate, -(RECENT_WINDOW_DAYS - 1));
  const windowStartYmd = ymd(windowStart);
  const asOfYmd = ymd(asOfDate);
  const recentLogs = logs.filter(
    (l) => l.habit_id === habit.id && l.completed_at >= windowStartYmd && l.completed_at <= asOfYmd
  );

  // Days before the habit existed are not due days, so they are excluded
  // from the denominator rather than counted as misses.
  const completion = scheduledCompletionRate(habit, recentLogs, {
    from: windowStart,
    to: asOfDate,
    since: createdDate ?? null,
  });
  const recentCompletionRate = completion.rate;
  const stabilityScore = weeklyStability(habit, recentLogs, windowStart, STABILITY_WEEK_BUCKETS, createdDate ?? null);

  const ageOk = ageDays >= MASTERY_MIN_AGE_DAYS;
  const rateOk = recentCompletionRate >= MASTERY_COMPLETION_RATE_THRESHOLD;
  const stabilityOk = stabilityScore >= MASTERY_STABILITY_THRESHOLD;

  const reasons = [
    `age_days >= ${MASTERY_MIN_AGE_DAYS}: ${ageOk ? 'OK' : 'FAILED'} (${ageDays})`,
    `recent_completion_rate >= ${MASTERY_COMPLETION_RATE_THRESHOLD}: ${rateOk ? 'OK' : 'FAILED'} (${recentCompletionRate.toFixed(2)} over ${completion.dueDays} due days)`,
    `stability_score >= ${MASTERY_STABILITY_THRESHOLD}: ${stabilityOk ? 'OK' : 'FAILED'} (${stabilityScore.toFixed(2)})`,
  ];

  const mastered = ageOk && rateOk && stabilityOk;
  return {
    mastered,
    maintenance: mastered,
    reasons,
    recent_completion_rate: recentCompletionRate,
    stability_score: stabilityScore,
    age_days: ageDays,
    due_days: completion.dueDays,
    done_days: completion.doneDays,
  };
}
