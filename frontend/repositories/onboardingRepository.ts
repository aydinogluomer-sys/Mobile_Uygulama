/**
 * `user_onboarding` data access.  (plan §5 Rule 4)
 *
 * One row per user, owner-scoped by an explicit `user_id` filter as well as
 * by RLS — the same defence-in-depth every other repository here applies.
 *
 * ## Why "no row" is a value, not an error
 *
 * A brand-new account has no row until it answers something. `fetchOnboarding`
 * returns `{ ok: true, data: null }` for that, and the store reads null as
 * `pending`. Returning an error instead would make "you are new" and "the
 * query failed" the same outcome, and the router would have to guess which
 * one it was looking at while deciding whether to show onboarding.
 *
 * ## Why the status invariant lives here
 *
 * The live CHECK `user_onboarding_completed_at_agrees_with_status` requires
 * `completed_at` to be set exactly when `status = 'completed'`. Leaving that
 * to callers means every call site has to remember it and one of them
 * eventually will not — the write then fails with a constraint violation the
 * user sees as "kaydedilemedi". `writeOnboarding` derives the timestamp from
 * the status, so the pair cannot disagree.
 */
import type { TableInsert } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, type RepoResult } from './shared';
import {
  ONBOARDING_VERSION,
  type OnboardingAnswers,
  type OnboardingReturnStatus,
  type OnboardingStatus,
} from '../lib/onboarding';

export type OnboardingRow = {
  user_id: string;
  onboarding_version: number;
  goals: string[];
  primary_barrier: string | null;
  pace: string | null;
  preferred_dayparts: string[];
  reminder_intent: boolean | null;
  status: OnboardingStatus;
  completed_at: string | null;
  /** The install claimed by `status = 'installing'`; kept after completion. */
  install_id: string | null;
  /** How many habits that install should produce. */
  install_expected_habits: number | null;
  /**
   * The lifecycle status `status` had before the claim overwrote it with
   * `installing`. Null whenever no install is in flight.
   */
  install_return_status: OnboardingReturnStatus | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  'user_id,onboarding_version,goals,primary_barrier,pace,preferred_dayparts,' +
  'reminder_intent,status,completed_at,install_id,install_expected_habits,' +
  'install_return_status,created_at,updated_at';

/** The caller's row, or `null` when they have never answered anything. */
export async function fetchOnboarding(): Promise<RepoResult<OnboardingRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u; // carries `offline` (F06: an unreachable auth server is not "signed out")
  const { data, error, status } = await supabase
    .from('user_onboarding')
    .select(COLS)
    .eq('user_id', u.userId)
    .maybeSingle();
  // F06 (NAV-04): the store tells "the server could not be reached" (offline / 5xx: a cached
  // terminal status may open Today) from "the server refused" (401, RLS: the gate).
  if (error) {
    return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  }
  return { ok: true, data: (data ?? null) as OnboardingRow | null };
}

/**
 * Writes the answers and the lifecycle status together.
 *
 * Upsert on `user_id` — one row per user is the primary key, so a second
 * write from a second device updates rather than duplicating. `user_id` is
 * supplied here and never by the caller, so the conflict target cannot be
 * aimed at somebody else's row.
 */
export async function writeOnboarding(input: {
  answers: OnboardingAnswers;
  status: OnboardingStatus;
  /**
   * The install identity, written with the claim BEFORE any habit exists.
   *
   * Omitting it leaves the stored value alone, so the completion write does
   * not have to repeat the id it is completing -- and cannot accidentally
   * erase the audit trail of which rows the plan produced.
   */
  installId?: string | null;
  installExpectedHabits?: number | null;
  /**
   * Where a failed install must return the user.
   *
   * Passed WITH the claim, in this one upsert, so a claim can never exist
   * without the status it displaced -- which is the whole point: the rollback
   * has to work in a process that was not running when the claim was made.
   *
   * Omitting it leaves the stored value alone, exactly like the two fields
   * above, so the completion write does not have to restate it.
   */
  installReturnStatus?: OnboardingReturnStatus | null;
}): Promise<RepoResult<OnboardingRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const row: TableInsert<'user_onboarding'> = {
    user_id: u.userId,
    onboarding_version: ONBOARDING_VERSION,
    goals: input.answers.goals,
    primary_barrier: input.answers.primaryBarrier,
    pace: input.answers.pace,
    preferred_dayparts: input.answers.preferredDayparts,
    reminder_intent: input.answers.reminderIntent,
    status: input.status,
    // Derived, never passed in — see the file doc.
    completed_at: input.status === 'completed' ? new Date().toISOString() : null,
  };
  if (input.installId !== undefined) row.install_id = input.installId;
  if (input.installExpectedHabits !== undefined) {
    row.install_expected_habits = input.installExpectedHabits;
  }
  if (input.installReturnStatus !== undefined) {
    row.install_return_status = input.installReturnStatus;
  }

  const { data, error } = await supabase
    .from('user_onboarding')
    .upsert(row, { onConflict: 'user_id' })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as OnboardingRow };
}
