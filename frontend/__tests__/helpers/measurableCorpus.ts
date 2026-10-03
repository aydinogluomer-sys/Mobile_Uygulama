/**
 * R01.03-a A4/A7 — habits × prior day value × entered value, covering every
 * tracking type, both directions, a range of targets, and the degenerate ones
 * (no target, zero target). Deterministic.
 */
import type { Habit } from '../../lib/supabase';

export type CorpusHabit = Pick<Habit, 'id' | 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>;

const TRACKING: Habit['tracking_type'][] = ['numeric', 'duration', 'boolean', 'abstinence'];
const DIRECTIONS: (Habit['target_direction'])[] = ['at_least', 'at_most', null];
const GOALS: (number | null)[] = [10, 2, 1, 30, 0.5, 0, null];
const BEHAVIOURS: Habit['behavior_type'][] = ['positive', 'negative'];

export const CORPUS_HABITS: CorpusHabit[] = TRACKING.flatMap((tracking_type) =>
  DIRECTIONS.flatMap((target_direction) =>
    GOALS.flatMap((daily_goal) =>
      BEHAVIOURS.map((behavior_type) => ({
        id: `${tracking_type}|${target_direction}|${daily_goal}|${behavior_type}`,
        tracking_type, target_direction, daily_goal, behavior_type,
      })))));

/** The day's value already on the row before this entry (`undefined` = no row). */
export const PRIOR_VALUES: (number | null | undefined)[] = [undefined, null, 0, 1, 2, 3, 6, 9.5, 10, 12, 40];
/** What the user types into the modal. */
export const ENTERED: number[] = [0, 0.5, 1, 2, 3, 4, 5, 8, 10, 15, 30];

export const STATES = ['done', 'partial', 'miss', 'skip'] as const;
