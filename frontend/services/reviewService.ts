/**
 * Weekly and monthly reviews.  (plan §8, §9)
 *
 * A review is an aggregate over several tables — habit logs, recovery plans,
 * focus sessions, tasks — for a period, plus the user's own reflections. The
 * screens were assembling it themselves, each reaching into whichever
 * repositories it happened to need, which is why the AI Coach screen imported
 * two repositories directly.
 */
import { fetchHabitLogsForReview, type ReviewLogRow } from '../repositories/habitLogRepository';
import { fetchRecoveryPlansForReview } from '../repositories/recoveryRepository';
import { fetchFocusSessionsSince } from '../repositories/focusSessionRepository';
import { fetchWeeklyReview, upsertWeeklyReview } from '../repositories/reviewRepository';
import type { RecoveryPlan } from '../lib/supabase';

export type { ReviewLogRow };
export type ReviewWindow = { start: string; end: string };

export type ReviewData = {
  logs: ReviewLogRow[];
  recoveryPlans: RecoveryPlan[];
};

/**
 * Everything a review period needs, fetched together.
 *
 * Both queries are issued in parallel and BOTH must succeed: a review built
 * from habit logs plus an empty recovery list, because that query failed, is
 * a report that silently understates how much the user caught up.
 */
export async function loadReviewData(
  window: ReviewWindow,
): Promise<{ ok: true; data: ReviewData } | { ok: false; error: string }> {
  const [logs, plans] = await Promise.all([
    fetchHabitLogsForReview(window),
    fetchRecoveryPlansForReview(window),
  ]);
  if (!logs.ok) return { ok: false, error: logs.error };
  if (!plans.ok) return { ok: false, error: plans.error };
  return { ok: true, data: { logs: logs.data, recoveryPlans: plans.data as RecoveryPlan[] } };
}


/**
 * The same window, plus focus minutes — what the weekly and monthly review
 * screens render.
 *
 * Focus is fetched but NOT required: a review without focus data is still a
 * useful review, whereas a review missing habit logs or recovery would
 * understate the period. The distinction is deliberate and is why this does
 * not simply `Promise.all` everything and fail on any error.
 */
export async function loadPeriodReview(
  window: ReviewWindow,
): Promise<
  | { ok: true; data: ReviewData & { focusSeconds: number } }
  | { ok: false; error: string }
> {
  const core = await loadReviewData(window);
  if (!core.ok) return core;

  const focus = await fetchFocusSessionsSince({ sinceIso: `${window.start}T00:00:00.000Z` });
  const focusSeconds = focus.ok
    ? focus.data.reduce((sum, f) => sum + (f.completed_seconds || 0), 0)
    : 0;

  return { ok: true, data: { ...core.data, focusSeconds } };
}

/** The user's saved reflections for one week. */
export const loadWeeklyReflection = (params: Parameters<typeof fetchWeeklyReview>[0]) =>
  fetchWeeklyReview(params);
export const saveWeeklyReflection = (params: Parameters<typeof upsertWeeklyReview>[0]) =>
  upsertWeeklyReview(params);


/**
 * The two period reads, separately.
 *
 * `loadReviewData` fetches both over ONE window, which is right when they
 * describe the same period. The monthly and weekly screens deliberately use
 * different windows — habit logs go back far enough to compute behaviour
 * intelligence, recovery only to the previous period — so merging them there
 * would silently change what those reports measure.
 */
export const logsForPeriod = (window: ReviewWindow) => fetchHabitLogsForReview(window);
export const recoveryForPeriod = (window: ReviewWindow) => fetchRecoveryPlansForReview(window);
