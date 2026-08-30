/**
 * Routine installation.  (plan §8 service layer, §13 AI gate)
 *
 * ## The orchestration
 *
 * Installing a routine turns a validated proposal into habit rows. Three
 * domain decisions sit between those two things, and none of them is UI
 * state:
 *
 *  1. which habits activate now and which queue, per the capacity evaluation
 *     — a proposal that exceeds capacity is QUEUED, never force-activated;
 *  2. the willpower cost of each habit, derived rather than supplied, so an
 *     AI response cannot claim a habit is cheap;
 *  3. the persisted defaults for fields the AI contract does not carry.
 *
 * The store keeps `generating` / `installing` / the staged proposal, which
 * are what the screen renders.
 */
import { computeWillpowerCost } from '../lib/triage';
import type { Habit } from '../lib/supabase';
import {
  insertRoutineHabits,
  type InstallHabitRow,
} from '../repositories/habitRepository';
import { fetchRoutines as repoFetchRoutines } from '../repositories/routineRepository';

/** The user's saved routines. Bounded in the repository. */
export const listRoutines = <T,>() => repoFetchRoutines<T>();

/** The subset of a validated proposal habit this service needs. */
export type ProposalHabit = {
  name: string;
  tracking_type: 'binary' | 'numeric';
  difficulty: number;
  estimated_minutes: number;
};

/**
 * Builds the rows for one install.
 *
 * `willpower_cost` is COMPUTED from difficulty, frequency and estimated
 * minutes — never taken from the proposal. The AI contract has no such field
 * and a routine pack should not be able to declare its own price either;
 * deriving it means every habit in the app is costed by the same rule.
 *
 * `status` comes from the capacity evaluation: anything not in `toActivate`
 * installs as `waiting`. Exceeding capacity queues, it does not activate.
 */
export function buildInstallRows(
  habits: ProposalHabit[],
  toActivate: readonly string[],
): InstallHabitRow[] {
  const activateSet = new Set(toActivate);
  const dailyFreq = { kind: 'daily' as const };

  return habits.map((h) => {
    const trackingType: 'boolean' | 'numeric' = h.tracking_type === 'numeric' ? 'numeric' : 'boolean';
    return {
      name: h.name,
      icon: null,
      tracking_type: trackingType,
      unit: null,
      daily_goal: null,
      target_direction: null,
      frequency_config: dailyFreq,
      willpower_cost: computeWillpowerCost({
        difficulty: h.difficulty,
        impact_level: 'medium',
        behavior_type: 'positive',
        tracking_type: trackingType,
        frequency_config: dailyFreq,
        estimated_minutes: h.estimated_minutes,
      }),
      difficulty: h.difficulty,
      estimated_minutes: h.estimated_minutes,
      status: activateSet.has(h.name) ? 'active' : 'waiting',
    };
  });
}

export type InstallResult =
  | { ok: true; habits: Habit[] }
  | { ok: false; error: string };

/** Persists a validated, capacity-evaluated proposal as habits. */
export async function installProposal(
  habits: ProposalHabit[],
  toActivate: readonly string[],
): Promise<InstallResult> {
  const rows = buildInstallRows(habits, toActivate);
  const res = await insertRoutineHabits(rows);
  return res.ok ? { ok: true, habits: res.data } : { ok: false, error: res.error };
}
