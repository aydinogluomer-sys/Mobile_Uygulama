/**
 * Repository layer shared plumbing.  (Phase 1, plan §5 Rule 4)
 *
 * Every repository function returns a `RepoResult<T>` instead of a raw
 * PostgREST response or a thrown exception -- callers get a typed value they
 * must look at, not a query builder they could misuse and not an error that
 * silently vanishes into a `catch {}`. This mirrors `store/logStore.ts`'s
 * `LogResult` (task 1B-005 / commit 8a04c04): a Supabase error is a value the
 * caller inspects, never a value that gets swallowed.
 *
 * No React import. No UI concerns. Pure data access, same as every module
 * under `repositories/`.
 */
import { supabase } from '../lib/supabase';

export type RepoResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ScopedUser =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Resolves the current authenticated user id, or a typed failure.
 *
 * Every repository function that touches a user-owned table calls this
 * FIRST and scopes its query to the returned `userId` with `.eq('user_id',
 * userId)` -- RLS is the backstop (plan Rule 3), not the only guard (plan
 * Rule 2). A caller with no session gets an explicit `{ ok: false }` instead
 * of a query that quietly returns nothing.
 */
export async function currentUserId(): Promise<ScopedUser> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return { ok: false, error: error.message };
  if (!user) return { ok: false, error: 'Oturum bulunamadı.' };
  return { ok: true, userId: user.id };
}
