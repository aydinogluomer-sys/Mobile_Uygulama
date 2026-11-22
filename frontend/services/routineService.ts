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
import { isNoAnswer, retryWhileInProgress, type InvokeOutcome, type RetryOutcome } from '../lib/aiAttempt';
import { extractInvokeError } from '../lib/aiInvoke';
import { computeWillpowerCost } from '../lib/triage';
import type { FrequencyConfig, Habit } from '../lib/supabase';
import {
  insertRoutineHabits,
  type InstallHabitRow,
} from '../repositories/habitRepository';
import { fetchRoutines as repoFetchRoutines } from '../repositories/routineRepository';
import { invokeEdgeFunction } from './edgeFunctions';

/** The user's saved routines. Bounded in the repository. */
export const listRoutines = <T,>() => repoFetchRoutines<T>();

/**
 * The subset of a validated proposal habit this service needs.
 *
 * The last five fields are OPTIONAL and additive. An AI proposal cannot carry
 * them — its contract has four fields — so it omits them and gets exactly the
 * defaults it always got. App-authored sources CAN: a routine pack knows its
 * habit's icon, its unit and target, and which part of the day it belongs to,
 * and the first-run plan is built from those same packs.
 *
 * Before this, `buildInstallRows` flattened every install to
 * `icon: null, unit: null, daily_goal: null, frequency_config: daily` — so a
 * pack's "Su hedefi, 8 bardak" installed as a bare yes/no habit with no unit
 * and no target, silently losing the thing that made it measurable. The
 * repository row (`InstallHabitRow`) always had the columns; only this
 * function refused to fill them.
 */
export type ProposalHabit = {
  name: string;
  tracking_type: 'binary' | 'numeric';
  difficulty: number;
  estimated_minutes: number;
  icon?: string | null;
  unit?: string | null;
  daily_goal?: number | null;
  target_direction?: 'at_least' | 'at_most' | null;
  frequency_config?: FrequencyConfig;
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
    // Daily remains the default for anything that does not state a schedule.
    const frequency = h.frequency_config ?? dailyFreq;
    return {
      name: h.name,
      icon: h.icon ?? null,
      tracking_type: trackingType,
      unit: h.unit ?? null,
      daily_goal: h.daily_goal ?? null,
      target_direction: h.target_direction ?? null,
      frequency_config: frequency,
      // Costed from the habit's OWN schedule, so a weekly habit is not priced
      // as if it ran every day.
      willpower_cost: computeWillpowerCost({
        difficulty: h.difficulty,
        impact_level: 'medium',
        behavior_type: 'positive',
        tracking_type: trackingType,
        frequency_config: frequency,
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

/**
 * Persists a validated, capacity-evaluated proposal as habits.
 *
 * `installId` is optional and passed straight through. Callers that do not
 * supply one -- the Routine Pack picker and the AI builder -- produce rows
 * with `install_id = null`, exactly as before.
 */
export async function installProposal(
  habits: ProposalHabit[],
  toActivate: readonly string[],
  installId?: string | null,
): Promise<InstallResult> {
  const rows = buildInstallRows(habits, toActivate);
  const res = await insertRoutineHabits(rows, installId);
  return res.ok ? { ok: true, habits: res.data } : { ok: false, error: res.error };
}

export type RoutineGenerationReply =
  | { kind: 'no_answer' }
  | { kind: 'in_progress' }
  | { kind: 'refused'; message: string; balance?: number }
  | { kind: 'answered'; data: Record<string, unknown> | null };

const ROUTINE_ERROR_FALLBACK = 'Bir hata oluştu, tekrar deneyin.';

export async function requestRoutineGeneration(
  prompt: string,
  requestId: string,
  runRetry: <T>(
    call: () => Promise<InvokeOutcome<T>>,
    opts?: { fallbackMessage?: string },
  ) => Promise<RetryOutcome<T>> = retryWhileInProgress,
): Promise<RoutineGenerationReply> {
  try {
    const outcome = await runRetry(
      () =>
        invokeEdgeFunction<Record<string, unknown>>('generate-routine', {
          label: 'AI rutin',
          body: { prompt, request_id: requestId },
        }),
      { fallbackMessage: ROUTINE_ERROR_FALLBACK },
    );
    if (outcome.error && isNoAnswer(outcome.error)) return { kind: 'no_answer' };
    if (outcome.stillInProgress) return { kind: 'in_progress' };
    if (outcome.error) {
      const info = outcome.errorInfo ?? (await extractInvokeError(outcome.error, ROUTINE_ERROR_FALLBACK));
      return { kind: 'refused', message: info.msg, balance: info.balance };
    }
    return { kind: 'answered', data: outcome.data };
  } catch (e) {
    if (isNoAnswer(e)) return { kind: 'no_answer' };
    throw e;
  }
}
