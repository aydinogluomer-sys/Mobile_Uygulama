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

// ---------------------------------------------------------------------------
// Keyset pagination
// ---------------------------------------------------------------------------

/**
 * Where the previous page stopped.
 *
 * Two fields, not one: the ordering column alone is not unique — several
 * notes can share an `updated_at` to the microsecond after a bulk edit — and
 * a cursor that is not unique either skips rows or repeats them at the page
 * boundary. `id` breaks the tie, and the query orders by both.
 */
export type Cursor = { key: string; id: string };

export type Page<T> = {
  rows: T[];
  /** Pass to the next call. `null` means the collection is exhausted. */
  nextCursor: Cursor | null;
  hasMore: boolean;
};

export const DEFAULT_PAGE_SIZE = 30;

/**
 * One page of a user-owned table, newest first, using KEYSET pagination.
 *
 * ## Why not `.limit(50)`
 *
 * Four stores fetched entire tables with no bound at all. The tempting fix is
 * a bare `.limit()`, which is worse than the problem: the query still looks
 * like it returns "the notes", the UI still renders "the notes", and older
 * rows simply stop existing from the user's point of view. Silently hiding
 * data is not a performance fix.
 *
 * ## Why not `.range(offset, offset + n)`
 *
 * Offset paging is unstable under writes, which is exactly the workload here.
 * Insert a note while the user is on page 1 and every subsequent page shifts
 * by one: the row that was last on page 1 reappears first on page 2. Keyset
 * paging asks "what comes after this specific row", so a concurrent insert
 * lands at the top and disturbs nothing already fetched.
 *
 * `hasMore` is derived by asking for one row more than requested and
 * discarding it, which distinguishes "exactly a full page" from "a full page
 * and then some" without a second count query.
 */
export async function fetchPage<T extends { id: string }>(params: {
  table: string;
  /** Columns to select. Explicit lists beat `*` — see each repository. */
  columns: string;
  /** The ordering column. Must be monotonic-ish and present in `columns`. */
  orderBy: string;
  userId: string;
  cursor?: Cursor | null;
  limit?: number;
  /** Extra equality filters, e.g. `{ status: 'active' }`. */
  match?: Record<string, string | number | boolean | null>;
  /** Extra inequality filters, e.g. `{ status: 'archived' }` to exclude it. */
  not?: Record<string, string | number | boolean>;
}): Promise<RepoResult<Page<T>>> {
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_PAGE_SIZE, 200));

  let q = supabase
    .from(params.table)
    .select(params.columns)
    .eq('user_id', params.userId);

  for (const [col, value] of Object.entries(params.match ?? {})) {
    q = value === null ? q.is(col, null) : q.eq(col, value);
  }
  for (const [col, value] of Object.entries(params.not ?? {})) {
    q = q.neq(col, value);
  }

  if (params.cursor) {
    // "strictly before (key, id)" in the compound descending order.
    const { key, id } = params.cursor;
    q = q.or(`${params.orderBy}.lt.${key},and(${params.orderBy}.eq.${key},id.lt.${id})`);
  }

  const { data, error } = await q
    .order(params.orderBy, { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) return { ok: false, error: error.message };

  const all = (data ?? []) as unknown as T[];
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  const last = rows[rows.length - 1] as (T & Record<string, unknown>) | undefined;
  const nextCursor =
    hasMore && last ? { key: String(last[params.orderBy]), id: last.id } : null;

  return { ok: true, data: { rows, nextCursor, hasMore } };
}

/**
 * An UPDATE/DELETE scoped to the owner as well as the row id.
 *
 * Every mutation in the stores this replaced was written as
 * `.update(patch).eq('id', id)` — RLS and nothing else. Plan Rule 2/3 is
 * explicit that RLS is the backstop, not the only guard, and these calls also
 * discarded their result, so a rejected write left the UI showing the change
 * as applied. Both are fixed here rather than in eleven places.
 */
export async function updateOwned<T>(params: {
  table: string;
  id: string;
  userId: string;
  patch: Record<string, unknown>;
  columns?: string;
}): Promise<RepoResult<T>> {
  const { data, error } = await supabase
    .from(params.table)
    .update(params.patch)
    .eq('id', params.id)
    .eq('user_id', params.userId)
    .select(params.columns ?? '*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Kayıt bulunamadı ya da erişim yok.' };
  return { ok: true, data: data as T };
}

export async function deleteOwned(params: {
  table: string;
  id: string;
  userId: string;
}): Promise<RepoResult<true>> {
  const { data, error } = await supabase
    .from(params.table)
    .delete()
    .eq('id', params.id)
    .eq('user_id', params.userId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // A delete that matched nothing is reported, not treated as success -- the
  // stores previously removed the row from local state either way.
  if (!data || data.length === 0) return { ok: false, error: 'Kayıt bulunamadı ya da erişim yok.' };
  return { ok: true, data: true };
}
