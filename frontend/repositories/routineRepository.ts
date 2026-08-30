/**
 * `routines` data access.  (plan §5 Rule 4)
 *
 * The store's single call was `supabase.from('routines').select('*').order('id')`
 * — no user filter and no bound. It relied on RLS alone and would have grown
 * without limit.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, type RepoResult } from './shared';

export async function fetchRoutines<T>(limit = 100): Promise<RepoResult<T[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', u.userId)
    .order('id')
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as T[] };
}
