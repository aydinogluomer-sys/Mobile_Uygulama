/**
 * `monthly_reviews` read + upsert.  (plan §9; migration 20260831_monthly_reviews)
 *
 * Replaces the AsyncStorage entry `monthly_review_<YYYY-MM>` that
 * `app/screens/monthly-review.tsx` wrote. That key had no account in it, so
 * on a shared device the next person to sign in read the previous account's
 * written reflections; it never left the handset, so a reinstall lost every
 * month; and nothing else could read it.
 *
 * The row is the source of truth. AsyncStorage is now a draft cache of the
 * month being edited, scoped per account — see `services/reviewService.ts`.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, type RepoResult } from './shared';

export type MonthlyReviewRow = {
  id: string;
  user_id: string;
  month_key: string;
  answers: Record<string, string>;
  created_at: string;
  updated_at: string;
};

const COLS = 'id,user_id,month_key,answers,created_at,updated_at';

/** 'YYYY-MM', the shape the table's CHECK accepts. */
export const MONTH_KEY = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * One month, or `null` when nothing has been written yet.
 *
 * SINGLE_ROW: `(user_id, month_key)` is unique, so `maybeSingle` is exact
 * rather than a bound. "Not written yet" is `{ ok: true, data: null }`, not an
 * error — the screen renders an empty form for it, and conflating the two
 * would show a failure banner on a month the user simply has not reached.
 */
export async function fetchMonthlyReview(
  monthKey: string,
): Promise<RepoResult<MonthlyReviewRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  if (!MONTH_KEY.test(monthKey)) return { ok: false, error: `Geçersiz ay anahtarı: ${monthKey}` };

  const { data, error } = await supabase
    .from('monthly_reviews')
    .select(COLS)
    .eq('user_id', u.userId)
    .eq('month_key', monthKey)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as unknown as MonthlyReviewRow) ?? null };
}

/**
 * Writes the month, creating or replacing it.
 *
 * `onConflict` names the unique pair explicitly. Without it PostgREST infers
 * the conflict target from the primary key, which this call never supplies —
 * so a second save for the same month would try to INSERT and fail on the
 * unique index instead of updating.
 *
 * `updated_at` is set here rather than left to a trigger, so the row carries
 * a save time even on a project with no trigger installed; the screen shows
 * it as "kaydedildi".
 */
export async function upsertMonthlyReview(params: {
  monthKey: string;
  answers: Record<string, string>;
}): Promise<RepoResult<MonthlyReviewRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  if (!MONTH_KEY.test(params.monthKey)) {
    return { ok: false, error: `Geçersiz ay anahtarı: ${params.monthKey}` };
  }

  const { data, error } = await supabase
    .from('monthly_reviews')
    .upsert(
      {
        user_id: u.userId,
        month_key: params.monthKey,
        answers: params.answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,month_key' },
    )
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as MonthlyReviewRow };
}
