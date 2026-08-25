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
import { currentUserId, RepoResult } from './shared';

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
