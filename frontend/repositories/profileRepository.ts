/**
 * `profiles` + `profile_badges` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/profileStore.ts`.
 *
 * `profiles` is scoped by `id`, not `user_id` — it IS the user row — so the
 * shared `updateOwned` helper does not apply and the scoping is written out
 * here. `profiles` holds `email` and `push_token`, so getting that filter
 * right matters more here than anywhere else in the app; the live RLS audit
 * confirmed the policy is `id = auth.uid()`, and this query agrees with it
 * rather than depending on it.
 */
import { currentUser } from '../lib/session';
import { supabase } from '../lib/supabase';
import { currentUserId, type RepoResult } from './shared';

export async function fetchOrCreateProfile<T>(): Promise<RepoResult<T>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const existing = await supabase.from('profiles').select('*').eq('id', u.userId).maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data) return { ok: true, data: existing.data as T };

  // Older accounts predate the profile-creation trigger. Creating it here is
  // idempotent in practice because `id` is the primary key: a race resolves
  // as a duplicate-key error rather than a second row.
  const user = await currentUser();
  const created = await supabase
    .from('profiles')
    .insert({ id: u.userId, email: user?.email ?? null })
    .select('*')
    .single();
  if (created.error) return { ok: false, error: created.error.message };
  return { ok: true, data: created.data as T };
}

export async function updateUsername<T>(name: string): Promise<RepoResult<T>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const trimmed = name.trim().slice(0, 24);
  const { data, error } = await supabase
    .from('profiles')
    .update({ username: trimmed || null })
    .eq('id', u.userId)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Profil bulunamadı.' };
  return { ok: true, data: data as T };
}

export async function fetchBadges<T>(limit = 100): Promise<RepoResult<T[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('profile_badges')
    .select('*')
    .eq('user_id', u.userId)
    .order('earned_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as T[] };
}

// ---------------------------------------------------------------------------
// Leaderboards
//
// These are RPCs, not table reads, and they lived in `store/profileStore.ts`
// as bare `supabase.rpc(...)` calls. Two things were wrong with that beyond
// the layering: the layer-boundary gate only recognised `supabase.from(`, so
// five database calls across two stores sat outside a check that reported the
// layering complete; and both discarded their error —
//
//     const { data } = await supabase.rpc(fn, { limit_val: 50 });
//
// — which is the exact defect the repository layer exists to end. A failed
// leaderboard read rendered as an empty leaderboard, i.e. as "nobody has any
// XP", with no way for the caller to tell the difference.
// ---------------------------------------------------------------------------

export type LeaderboardScope = 'global' | 'weekly';

/**
 * One page of the leaderboard.
 *
 * BOUNDED_DOMAIN_WINDOW: the board is a top-N by definition, and `limit_val`
 * is that N rather than a page size — there is no "next page" of a top 50.
 *
 * DB1-V01 (F03): `weekly_xp` is never read as a table; only through the
 * `get_weekly_leaderboard` RPC. So a later narrowing of the table's SELECT
 * policy (F09, migration 040) cannot break the board.
 */
export async function fetchLeaderboard<T>(
  scope: LeaderboardScope,
  limit = 50,
): Promise<RepoResult<T[]>> {
  const fn = scope === 'weekly' ? 'get_weekly_leaderboard' : 'get_global_leaderboard';
  const { data, error } = await supabase.rpc(fn, { limit_val: Math.max(1, Math.min(limit, 100)) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as T[] };
}

/** The caller's own rank, or null when they are not ranked yet. */
export async function fetchMyRank(): Promise<RepoResult<number | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase.rpc('get_user_rank', { target_user_id: u.userId });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const rank = (row as { rank?: number } | null)?.rank;
  return { ok: true, data: typeof rank === 'number' ? rank : null };
}
