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
  const { data: { user } } = await supabase.auth.getUser();
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
