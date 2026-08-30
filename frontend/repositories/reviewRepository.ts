/**
 * `weekly_reviews` select + upsert.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Also backs `app/screens/monthly-review.tsx`'s DB-side metrics load
 * (`fetchHabitLogsForReview` / `fetchFocusSecondsForReview` in the sibling
 * repositories) -- monthly-review's own reflection text is persisted to
 * AsyncStorage, not this table, so this file only covers the weekly screen's
 * `weekly_reviews` row.
 *
 * Phase 4 addition: this file is also where §22's `weekly_review_completed`
 * is emitted. See the block comment on `upsertWeeklyReview` for why it is
 * here and not in a store or a screen.
 */
import { supabase } from '../lib/supabase';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { currentUserId, RepoResult } from './shared';

/**
 * §22 analytics emission seam -- byte-for-byte the wrapper used in
 * `store/habitStore.ts`, `store/recoveryStore.ts` and `store/routineStore.ts`,
 * and for the same three reasons: run the payload through `buildEvent` (which
 * drops free text BY SHAPE, here, at the call site), hand the result to
 * `lib/analytics.ts`'s sink funnel, and never let `buildEvent`'s deliberate
 * throw on an undeclared name escape into the user's action. `emitEvent`
 * already swallows a SINK's throw; `buildEvent`'s throw happens before it is
 * reached, which is exactly what this `try` is for.
 *
 * The one difference from the store copies is WHERE it sits. The other ten
 * §22 events all have a store to hang off; `weekly_review_completed` has
 * none -- there is no weekly-review store (a grep over `store/` finds zero
 * references), and the screen is not a funnel because a screen can be
 * bypassed. This repository is the only code path through which a weekly
 * review actually reaches the database, so it is the honest seam.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

/**
 * "Did the user actually answer this question?" -- `''` and `'   '` are a
 * blank box, not an answer. A boolean, deliberately: the answer TEXT is the
 * one thing §22 forbids putting on an event.
 */
function answered(v: string | null): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

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

/**
 * Insert-or-update the weekly review row for one `week_key`, and emit §22's
 * `weekly_review_completed` on the FIRST save of that week only.
 *
 * ## Why "first save only" needs work at all
 *
 * The write is an upsert, so a user who reopens Haftalık Rapor and fixes a
 * typo runs exactly the same statement as the user who saved for the first
 * time. Emitting unconditionally would report one review as two, three, ten
 * "completed"s -- and the metric §22 wants ("kaç kullanıcı haftalık
 * değerlendirmesini tamamladı") would silently become "how often does anyone
 * press Kaydet". An upsert cannot tell you which branch it took unless you
 * make it.
 *
 * ## What was chosen: a check-then-write probe
 *
 * One extra `select('id')` for this `(user_id, week_key)` before the upsert.
 * No row -> this save is the review's completion -> emit. Row already there
 * -> the user is editing -> stay silent.
 *
 * ## The race, stated honestly rather than pretended away
 *
 * The probe and the upsert are two round trips, not one statement, so there
 * IS a window between them. If a second writer inserts the same
 * `(user_id, week_key)` inside that window, both writers see "no row" and
 * both emit -- one duplicate event.
 *
 * That window is accepted here, and the reason is the shape of the resource,
 * not optimism. `weekly_reviews` is keyed on `(user_id, week_key)`: the only
 * writer that can collide with you is YOU, saving your own review of the same
 * week from a second device, inside the few hundred milliseconds between two
 * requests. This is a personal reflection form, not a contended counter. And
 * the blast radius is bounded to analytics: the upsert itself is still a
 * single atomic statement with the same last-write-wins semantics it always
 * had, so no review is lost, duplicated or corrupted by the race -- at worst
 * one event is counted twice.
 *
 * ## The alternatives, and why they lost
 *
 *  - `created_at` vs `updated_at` on the returned row: `weekly_reviews` has
 *    no `updated_at`. No in-repo migration even defines this table (it exists
 *    only remotely), and `WeeklyReviewRow` above -- the sole in-repo
 *    description of its shape -- declares `created_at` alone. Relying on a
 *    column nothing in this repository can show would be a guess, and adding
 *    one is a schema change this change is not scoped to make.
 *  - `created_at` vs the device clock (`now - created_at < N seconds` =>
 *    insert): one round trip and no race, but it swaps a rare concurrency
 *    window for a permanent dependency on device/server clock agreement. A
 *    phone whose clock is ten minutes off would misclassify EVERY save. That
 *    is a worse failure mode than the one it removes.
 *  - `insert()` first, fall back to `update()` on unique-violation `23505`:
 *    genuinely atomic -- the database, not a read, decides who was first --
 *    and it is the right answer if this ever becomes contended. It is not
 *    taken now because it replaces the user's save path (one statement
 *    becomes two, and a row deleted between the failed insert and the update
 *    would silently save nothing) to buy accuracy on an analytics counter.
 *    Analytics does not get to add a failure mode to the thing it measures.
 *  - `ON CONFLICT ... RETURNING xmax = 0`, the exact answer in raw SQL, is
 *    not expressible through PostgREST's select syntax. It would need an RPC.
 */
export async function upsertWeeklyReview(params: {
  weekKey: string;
  wins: string | null;
  challenges: string | null;
  next_week: string | null;
}): Promise<RepoResult<void>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  // The probe. `select('id')` rather than reusing `fetchWeeklyReview`: this
  // needs one bit ("is there a row?"), and `select('*')` would drag the
  // user's reflection prose through the analytics code path for nothing.
  const { data: existing, error: probeError } = await supabase
    .from('weekly_reviews')
    .select('id')
    .eq('user_id', u.userId)
    .eq('week_key', params.weekKey)
    .maybeSingle();

  // A probe that FAILED proves nothing, so it must not be read as "no row" --
  // that would fire a second `completed` for a review the user is merely
  // editing. Unknown means silent: under-counting is the honest failure
  // direction for an exactly-once event. Note also what is NOT done with
  // `probeError`: it is not returned. This read exists only to decide an
  // analytics question, and an analytics question must never be able to fail
  // the user's save.
  const isFirstSave = probeError == null && existing == null;

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

  // Emitted only AFTER the write came back clean. Emitting alongside the
  // request -- or on the optimistic assumption that an upsert works -- would
  // report a review the database rejected as a completed one.
  if (isFirstSave) {
    emitAnalytics('weekly_review_completed', {
      // 'yyyy-MM-dd' (the week's Monday, per the screen's `getWeekKey`), so
      // it is date-shaped and survives `buildEvent`'s allowlist.
      week_key: params.weekKey,
      // Which questions got an answer -- three booleans, never the answers.
      // `params.wins` / `challenges` / `next_week` are the user's own
      // reflection prose and are the exact thing §22 keeps off an event
      // payload; they are persisted to the user's row above and go no
      // further. `buildEvent` would drop them anyway, but the point is not
      // to hand them over in the first place.
      has_wins: answered(params.wins),
      has_challenges: answered(params.challenges),
      has_next_week: answered(params.next_week),
    });
  }

  return { ok: true, data: undefined };
}
