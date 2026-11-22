/**
 * `recovery_plans` reads for reporting.  (Phase 2, CODER-I, plan §12)
 *
 * `store/recoveryStore.ts`'s `fetchPlans` only ever loads `status: 'planned'`
 * rows -- its whole job is "what's still actionable right now" (see that
 * file's own `fetchPlans`). Weekly/Monthly Review need the OPPOSITE slice:
 * every plan whose `target_date` falls inside the reporting period, in ANY
 * status, so that `lib/behaviorIntelligence.ts`'s `recoverySuccessRate` /
 * `mostRecoveredHabit` -- which need `completed`/`expired`/`cancelled`
 * OUTCOMES, not open ones -- has something to compute from. No existing
 * repository function returns that shape (checked: `habitLogRepository.ts`,
 * `focusSessionRepository.ts`, `reviewRepository.ts`, `taskRepository.ts`,
 * `creditRepository.ts`, `focusTaskRepository.ts` -- none touch
 * `recovery_plans` at all), so this is a genuinely new query, not a
 * duplicate of `recoveryStore.fetchPlans`.
 *
 * Returns the LEGACY `RecoveryPlan` row shape (same columns
 * `recoveryStore.ts` selects) -- callers map it through
 * `lib/recovery.ts`'s `fromLegacyRecoveryPlan` themselves, exactly as
 * `recoveryStore.ts` does, so this file stays a thin, honest read with no
 * domain logic of its own.
 */
import { supabase } from '../lib/supabase';
import type { RecoveryPlan, RecoveryStatus, RecoveryStrategy } from '../lib/supabase';
import { requireComplete, selectAllPages } from './pagedSelect';
import { currentUserId, isTransportFailure, deleteOwned, updateOwned, insertOwnedWithId, updateOwnedVersioned, deleteOwnedIfPresent, type RepoResult } from './shared';

// All fifteen columns. The previous list stopped at `created_at` and
// omitted the five the adapter used to drop, so a plan read back had no
// deficit and no day distribution even once they were stored.
const SELECT = 'id,user_id,habit_id,source_log_id,source_date,target_date,deficit_type,deficit_value,strategy,distributed_days,note,reminder_time,status,completed_at,created_at';

/**
 * Every recovery plan (any status) whose `target_date` falls within
 * `[start, end]` (inclusive) -- source for the weekly/monthly review's
 * "Recovery completion" / "Recovery trend" blocks (plan §12).
 */
export async function fetchRecoveryPlansForReview(params: {
  start: string;
  end: string;
}): Promise<RepoResult<RecoveryPlan[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const r = await selectAllPages<RecoveryPlan>((from, to) =>
    supabase
      .from('recovery_plans')
      .select(SELECT)
      .eq('user_id', u.userId)
      .gte('target_date', params.start)
      .lte('target_date', params.end)
      .order('target_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Telafi planları');
}

// ---------------------------------------------------------------------------
// Plan mutations. (§8 — moved out of store/recoveryStore.ts, where they were
// keyed on `id` alone with two of the three discarding their result.)
// ---------------------------------------------------------------------------

/**
 * Marks a plan done or skipped.
 *
 * `status` is a closed set here rather than a free string: the live
 * `recovery_plans_status_check` accepts a fixed vocabulary, and a typo used
 * to surface as a silently rejected write.
 */
export async function setRecoveryPlanStatus(
  id: string,
  status: RecoveryStatus,
): Promise<RepoResult<{ id: string; status: string }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // `completed_at` is not decoration: the table refuses a 'completed' row
  // without one, and refuses a non-completed row that has one. Setting it
  // here keeps the pair consistent no matter which caller flips the status,
  // rather than leaving each of them to remember.
  const patch: Record<string, unknown> = {
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  };
  return updateOwned<{ id: string; status: string }>({
    table: 'recovery_plans', id, userId: u.userId,
    patch, columns: 'id,status',
  });
}

export async function deleteRecoveryPlan(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'recovery_plans', id, userId: u.userId });
}

// Was a SECOND, shorter column list. Two lists meant the fifteen-column
// read was only true for whichever query happened to use the longer one.
const PLAN_COLS = SELECT;

/** Planned (not yet done/skipped) recovery plans, soonest target first. */
export async function fetchPlannedRecoveryPlans(limit = 200): Promise<RepoResult<RecoveryPlan[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('recovery_plans')
    .select(PLAN_COLS)
    .eq('user_id', u.userId)
    .eq('status', 'planned')
    .order('target_date', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 1000)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as RecoveryPlan[] };
}

export type RecoveryPlanStateRow = {
  id: string;
  habit_id: string;
  source_date: string;
  target_date: string;
  status: string;
  completed_at: string | null;
};

/**
 * F31 (PS-07): planned and completed recovery plans for a single habit since `since` —
 * feeds `repairedSourceDates` (Kintsugi gold-vein overlay).
 */
export async function fetchRecoveryPlanStatesForHabit(params: {
  habitId: string;
  since: string;
}): Promise<RepoResult<RecoveryPlanStateRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('recovery_plans')
    .select('id,habit_id,source_date,target_date,status,completed_at')
    .eq('user_id', u.userId)
    .eq('habit_id', params.habitId)
    .in('status', ['planned', 'completed'])
    .gte('source_date', params.since)
    .limit(500);
  if (error) {
    return {
      ok: false,
      error: error.message,
      offline: isTransportFailure(status, error),
      status,
      code: error.code,
    };
  }
  return { ok: true, data: data ?? [] };
}

// R02.03 — outbox delivery: a plan with a client-made id (re-delivery = 23505 = one plan).
export const insertRecoveryPlanRow = (row: Record<string, unknown> & { id: string }, expectedUserId?: string) =>
  insertOwnedWithId<RecoveryPlan>({ table: 'recovery_plans', row, columns: PLAN_COLS, expectedUserId });
export const updateRecoveryPlanRow = (id: string, patch: Record<string, unknown>, expectedUserId?: string) =>
  updateOwnedVersioned<RecoveryPlan>({ table: 'recovery_plans', id, patch, baseVersion: null, columns: PLAN_COLS, expectedUserId });
export const deleteRecoveryPlanIfPresent = (id: string, expectedUserId?: string) =>
  deleteOwnedIfPresent({ table: 'recovery_plans', id, expectedUserId });

export async function insertRecoveryPlan(input: {
  habitId: string;
  sourceDate: string;
  targetDate: string;
  strategy: RecoveryStrategy;
  note?: string | null;
  reminderTime?: string | null;
  /**
   * What the plan is answering, and how much of it.
   *
   * Optional because the recovery screen can create a plan from a day the
   * user picked rather than from a specific log. Written when known — which
   * is the whole point of retiring the adapter: these five were computed by
   * `lib/recovery.deficitFor` and then discarded on the way to the database.
   */
  sourceLogId?: string | null;
  deficitType?: 'numeric' | 'binary' | null;
  deficitValue?: number | null;
  distributedDays?: { date: string; value: number }[] | null;
}): Promise<RepoResult<RecoveryPlan>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // NOTE: habit ownership is enforced by RLS, not here. A client-side
  // pre-check would cost a round trip on every plan creation and stop
  // nothing -- anyone bypassing the app calls PostgREST directly. The
  // control lives in `008_child_row_ownership.sql`, which requires
  // habit_id to belong to the caller in the INSERT/UPDATE policy.

  const { data, error } = await supabase
    .from('recovery_plans')
    .insert({
      user_id: u.userId,
      habit_id: input.habitId,
      source_date: input.sourceDate,
      target_date: input.targetDate,
      strategy: input.strategy,
      note: input.note ?? null,
      reminder_time: input.reminderTime ?? null,
      status: 'planned',
      source_log_id: input.sourceLogId ?? null,
      deficit_type: input.deficitType ?? null,
      deficit_value: input.deficitValue ?? null,
      distributed_days: input.distributedDays ?? null,
      // `completed_at` is deliberately absent: the table's CHECK requires it
      // to be null unless the status is 'completed', and a new plan is not.
    })
    .select(PLAN_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as RecoveryPlan };
}
