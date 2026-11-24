/**
 * The deterministic first-run plan.
 *
 * ## Why deterministic, and why that is not a compromise
 *
 * A brand-new account must get a usable plan when Anthropic has no credit,
 * when the device is offline, and when the edge function is down — which is
 * every one of the three ways `generate-routine` currently fails. Making the
 * first thing a user ever sees depend on an external provider means the worst
 * first impression happens on exactly the days the provider is unwell.
 *
 * So this is rules over app-authored data, not a model call. It imports no
 * network client, no supabase, no AI helper; `__tests__/lib/starterPlan.test.ts`
 * asserts that by scanning this module's own import graph, so a future edit
 * cannot quietly reintroduce the dependency.
 *
 * ## Where the habits come from
 *
 * `ROUTINE_PACKS` — the same app-authored data the pack picker installs, with
 * the same types, validator and installer. Nothing here defines a habit; it
 * ranks candidates that already exist. A separate onboarding habit list would
 * be a second library to keep in sync, which plan §13 explicitly rejects.
 *
 * ## The shape of the rules
 *
 *   score   = goal match + daypart match + barrier preference
 *   order   = score desc, then a STABLE index (never the name)
 *   reduce  = barrier-driven target reduction, applied to the chosen few
 *   trim    = stop when the Capacity Engine says the day is full
 *
 * The trim is last and it is the one that wins. A pace card promises a habit
 * count; the ceiling promises the user will not be handed more than their day
 * holds. When they disagree the plan comes back smaller and `explainPlan`
 * says so out loud rather than quietly delivering four when it said five.
 */
import { CAPACITY_CEILING_DEFAULT, dailyLoad, habitLoadPoints, habitsInRangeOn, type HabitLoadInput } from './capacity';
import { ROUTINE_PACKS, type RoutinePack, type RoutinePackHabit, type RoutinePackKey } from './routinePacks';
import {
  DAYPART_TO_PART_OF_DAY,
  paceMeta,
  type BarrierId,
  type DaypartId,
  type GoalId,
  type OnboardingAnswers,
} from './onboarding';
import type { FrequencyConfig } from './supabase';

/** A pack habit plus where it came from, so the plan can cite its source. */
export type StarterCandidate = RoutinePackHabit & {
  packKey: RoutinePackKey;
  /** Position in the flattened pack order — the deterministic tiebreak. */
  index: number;
};

export type StarterHabit = {
  name: string;
  icon: string;
  tracking_type: 'binary' | 'numeric';
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
  frequency_config: FrequencyConfig;
  unit: string | null;
  daily_goal: number | null;
  target_direction: 'at_least' | 'at_most' | null;
  daypart: DaypartId;
  goals: GoalId[];
  packKey: RoutinePackKey;
  /** Set when a barrier caused the starting target to be lowered. */
  reduced: null | { minutesFrom: number; goalFrom: number | null };
};

export type StarterPlan = {
  habits: StarterHabit[];
  /** Sum of the (possibly reduced) estimated minutes. */
  totalMinutes: number;
  /** The band the chosen pace asked for. */
  requestedMin: number;
  requestedMax: number;
  /** Capacity context, so the screen can be honest about why it stopped. */
  currentLoad: number;
  projectedLoad: number;
  ceiling: number;
  /** True when the ceiling, not the pace, decided the size. */
  trimmedByCapacity: boolean;
};

/** Every pack habit, flattened once, in a stable order. */
export function starterCandidates(packs: readonly RoutinePack[] = ROUTINE_PACKS): StarterCandidate[] {
  const out: StarterCandidate[] = [];
  for (const pack of packs) {
    for (const habit of pack.habits) {
      out.push({ ...habit, packKey: pack.key, index: out.length });
    }
  }
  return out;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const GOAL_MATCH_POINTS = 10;
const DAYPART_MATCH_POINTS = 6;

/**
 * How much each barrier likes this candidate.
 *
 * Every branch is a preference over candidates that already exist — none of
 * them invents a habit or edits one. The two barriers that need an actual
 * edit (`oversized_goals`, `lack_of_time`) do it in `reduceTargets` below,
 * where the change is visible in the returned plan rather than hidden in a
 * score.
 */
function barrierScore(barrier: BarrierId | null, h: StarterCandidate): number {
  const shortness = Math.max(0, 30 - h.estimated_minutes) / 3;   // 0..10
  const easiness = (6 - h.difficulty) * 2;                        // 2..10
  const breadth = h.goals.length * 4;                             // 4..8

  switch (barrier) {
    // Lower the activation cost of the very first step as far as it goes.
    case 'getting_started': return easiness * 1.5 + shortness;
    // Keep the first week's load low so week two is still possible.
    case 'consistency': return easiness + shortness * 0.5;
    // A habit that sits at a clear, repeatable point in the day is the one a
    // reminder can actually anchor to; difficulty matters less.
    case 'forgetting': return easiness * 0.5 + shortness * 0.5;
    // Quick wins: something finishable today, visible today.
    case 'motivation': return shortness * 1.5 + easiness * 0.5;
    // The size fix is in reduceTargets; here just avoid the giants.
    case 'oversized_goals': return easiness + shortness;
    // Minutes are the scarce resource, so they dominate.
    case 'lack_of_time': return shortness * 2;
    // No opinion about the goal, so prefer habits that serve several.
    case 'unsure_where_to_start': return breadth + easiness * 0.5;
    case null:
    default: return 0;
  }
}

export function scoreCandidate(answers: OnboardingAnswers, h: StarterCandidate): number {
  // No goals chosen (the skip path) means no goal opinion — every candidate
  // scores 0 here rather than 0 for some and positive for others, so the
  // barrier and daypart rules decide instead of an accidental bias toward
  // whichever habit happens to carry the most tags.
  const goalHits = answers.goals.length === 0
    ? 0
    : h.goals.filter((g) => answers.goals.includes(g)).length;

  const daypartHit = answers.preferredDayparts.length === 0
    ? 0
    : (answers.preferredDayparts.includes(h.daypart) ? 1 : 0);

  return goalHits * GOAL_MATCH_POINTS
    + daypartHit * DAYPART_MATCH_POINTS
    + barrierScore(answers.primaryBarrier, h);
}

// ── Target reduction ────────────────────────────────────────────────────────

/** Nothing is reduced below this; a two-minute habit has nothing to give. */
const MIN_MINUTES = 3;

const MINUTES_FACTOR: Partial<Record<BarrierId, number>> = {
  oversized_goals: 0.6,
  lack_of_time: 0.6,
};
const GOAL_FACTOR: Partial<Record<BarrierId, number>> = {
  // "Fazla büyük hedefler koyuyorum" is answered by starting at half the
  // target, not by removing the habit. 120 g protein becomes 60; 8000 steps
  // becomes 4000. The user can raise it the moment it feels easy.
  oversized_goals: 0.5,
};

function reduceTargets(barrier: BarrierId | null, h: StarterCandidate): {
  minutes: number;
  dailyGoal: number | null;
  reduced: StarterHabit['reduced'];
} {
  const minutesFactor = barrier ? MINUTES_FACTOR[barrier] ?? 1 : 1;
  const goalFactor = barrier ? GOAL_FACTOR[barrier] ?? 1 : 1;

  const minutes = minutesFactor === 1
    ? h.estimated_minutes
    : Math.max(MIN_MINUTES, Math.round(h.estimated_minutes * minutesFactor));

  const rawGoal = h.daily_goal ?? null;
  const dailyGoal = rawGoal == null || goalFactor === 1
    ? rawGoal
    : Math.max(1, Math.round(rawGoal * goalFactor));

  const changedMinutes = minutes !== h.estimated_minutes;
  const changedGoal = dailyGoal !== rawGoal;
  return {
    minutes,
    dailyGoal,
    reduced: changedMinutes || changedGoal
      ? { minutesFrom: h.estimated_minutes, goalFrom: changedGoal ? rawGoal : null }
      : null,
  };
}

// ── The plan ────────────────────────────────────────────────────────────────

export type StarterPlanContext = {
  /** Habits already active — the load this plan is added on top of. */
  activeHabits: HabitLoadInput[];
  /** Explicit clock so range-envelope gating is deterministic across midnight. */
  asOf: Date;
  ceiling?: number;
  candidates?: StarterCandidate[];
};

function toHabit(h: StarterCandidate, barrier: BarrierId | null): StarterHabit {
  const { minutes, dailyGoal, reduced } = reduceTargets(barrier, h);
  return {
    name: h.name,
    icon: h.icon,
    tracking_type: h.tracking_type,
    difficulty: h.difficulty,
    estimated_minutes: minutes,
    // The daypart becomes real schedule data rather than a label on a card:
    // `frequency_config.part_of_day` is an existing additive field that
    // `habitSchedule` already understands.
    frequency_config: {
      ...h.frequency_config,
      part_of_day: [DAYPART_TO_PART_OF_DAY[h.daypart]],
    },
    unit: h.unit ?? null,
    daily_goal: dailyGoal,
    target_direction: h.target_direction ?? null,
    daypart: h.daypart,
    goals: h.goals,
    packKey: h.packKey,
    reduced,
  };
}

function loadInput(h: StarterHabit): HabitLoadInput {
  return {
    difficulty: h.difficulty,
    estimated_minutes: h.estimated_minutes,
    frequency_config: h.frequency_config,
    impact_level: null,
  };
}

/**
 * Same answers in, same plan out — no clock, no randomness, no network.
 *
 * The sort comparator falls back to `index` rather than leaving equal scores
 * to `Array#sort`. V8's sort is stable today, but relying on that would make
 * this function's determinism a property of the runtime rather than of the
 * code, and the test that asserts "same input, same output" would be checking
 * the engine instead of the rules.
 */
export function buildStarterPlan(
  answers: OnboardingAnswers,
  ctx: StarterPlanContext,
): StarterPlan {
  const pace = answers.pace ?? 'balanced';
  const { min: requestedMin, max: requestedMax } = paceMeta(pace);
  const ceiling = ctx.ceiling ?? CAPACITY_CEILING_DEFAULT;

  const ranked = (ctx.candidates ?? starterCandidates())
    .map((c) => ({ c, score: scoreCandidate(answers, c) }))
    .sort((a, b) => (b.score - a.score) || (a.c.index - b.c.index))
    .map((r) => r.c);

  // KD-08 — same activation-gate rule as evaluateProposal: a habit outside its
  // date range today carries no load.
  const currentLoad = dailyLoad({ habits: habitsInRangeOn(ctx.activeHabits, ctx.asOf) }).normalised;

  const chosen: StarterHabit[] = [];
  let running = currentLoad;
  let blockedByCeiling = false;

  for (const candidate of ranked) {
    if (chosen.length >= requestedMax) break;
    const habit = toHabit(candidate, answers.primaryBarrier);
    const points = habitLoadPoints(loadInput(habit));
    if (running + points > ceiling) {
      // Do not force-activate past the ceiling to satisfy the pace card. Keep
      // scanning: a cheaper candidate further down may still fit, which is
      // how an "intensive" plan degrades gracefully instead of stopping dead
      // at the first expensive habit.
      blockedByCeiling = true;
      continue;
    }
    chosen.push(habit);
    running += points;
  }

  return {
    habits: chosen,
    totalMinutes: chosen.reduce((sum, h) => sum + h.estimated_minutes, 0),
    requestedMin,
    requestedMax,
    currentLoad,
    projectedLoad: Math.max(0, Math.min(100, Math.round(running))),
    ceiling,
    trimmedByCapacity: blockedByCeiling && chosen.length < requestedMax,
  };
}

/** The plan's habits grouped for display, in day order. */
export const DAYPART_ORDER: readonly DaypartId[] = ['morning', 'daytime', 'evening', 'bedtime'];

export function groupByDaypart(plan: StarterPlan): { daypart: DaypartId; habits: StarterHabit[] }[] {
  return DAYPART_ORDER
    .map((daypart) => ({ daypart, habits: plan.habits.filter((h) => h.daypart === daypart) }))
    .filter((g) => g.habits.length > 0);
}
