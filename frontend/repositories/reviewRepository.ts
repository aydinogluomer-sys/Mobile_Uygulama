/**
 * `weekly_reviews` select + upsert.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Also backs `app/screens/monthly-review.tsx`'s DB-side metrics load
 * (`fetchHabitLogsForReview` / `fetchFocusSecondsForReview` in the sibling
 * repositories) -- monthly-review's own reflection text is persisted to
 * AsyncStorage, not this table, so this file only covers the weekly screen's
 * `weekly_reviews` row.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, RepoResult } from './shared';

export type WeeklyReviewRow = {
  id: string;
  user_id: string;
  week_key: string;
  wins: string | null;
  challenges: string | null;
  next_week: string | null;
  created_at: string;
};

/** The saved weekly review for one `week_key`, or `null` if none exists yet. */
export async function fetchWeeklyReview(params: {
  weekKey: string;
}): Promise<RepoResult<WeeklyReviewRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('weekly_reviews')
    .select('*')
    .eq('user_id', u.userId)
    .eq('week_key', params.weekKey)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as WeeklyReviewRow | null) ?? null };
}

/** Insert-or-update the weekly review row for one `week_key`. */
export async function upsertWeeklyReview(params: {
  weekKey: string;
  wins: string | null;
  challenges: string | null;
  next_week: string | null;
}): Promise<RepoResult<void>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error } = await supabase.from('weekly_reviews').upsert(
    {
      user_id: u.userId,
      week_key: params.weekKey,
      wins: params.wins,
      challenges: params.challenges,
      next_week: params.next_week,
    },
    { onConflict: 'user_id,week_key' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
