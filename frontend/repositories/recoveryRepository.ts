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
import type { RecoveryPlan } from '../lib/supabase';
import { currentUserId, deleteOwned, updateOwned, type RepoResult } from './shared';

const SELECT = 'id,user_id,habit_id,source_date,target_date,strategy,note,reminder_time,status,created_at';

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
  const { data, error } = await supabase
    .from('recovery_plans')
    .select(SELECT)
    .eq('user_id', u.userId)
    .gte('target_date', params.start)
    .lte('target_date', params.end);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as RecoveryPlan[] };
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
  status: 'done' | 'skipped' | 'completed' | 'planned',
): Promise<RepoResult<{ id: string; status: string }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<{ id: string; status: string }>({
    table: 'recovery_plans', id, userId: u.userId,
    patch: { status }, columns: 'id,status',
  });
}

export async function deleteRecoveryPlan(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'recovery_plans', id, userId: u.userId });
}

const PLAN_COLS =
  'id,user_id,habit_id,source_date,target_date,strategy,note,reminder_time,status,created_at';

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

export async function insertRecoveryPlan(input: {
  habitId: string;
  sourceDate: string;
  targetDate: string;
  strategy: string;
  note?: string | null;
  reminderTime?: string | null;
}): Promise<RepoResult<RecoveryPlan>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // NOTE: habit ownership is enforced by RLS, not here. A client-side
  // pre-check would cost a round trip on every plan creation and stop
  // nothing -- anyone bypassing the app calls PostgREST directly. The
  // control lives in `20260830_child_row_ownership.sql`, which requires
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
    })
    .select(PLAN_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as RecoveryPlan };
}
