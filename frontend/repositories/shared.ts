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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublicTableName, TableRow } from '../lib/database.types';
import { supabase } from '../lib/supabase';
// F06: the bounded read lives in a dependency-free module (many tests mock lib/session with only `currentUser`)
import { boundSession, isRetryableAuthError, LOCAL_USER_TIMEOUT_MS } from '../lib/bootSession';

// CONTRACT (F00, BLD-01/SYN-12/TST-21): the client is resolved on EVERY call,
// never captured at module load. Tests swap `lib/supabase` through a getter
// (`get supabase() { return mock; }`) AFTER this module has been required, so a
// module-level capture would freeze `undefined`. Do not "simplify" this to an
// eager constant. Do not add a test-only setter here.
// F11 (BLD-11): the ONE place the schema-typed client is widened inside this file,
// because supabase-js cannot express `.from(<runtime union table>).eq(<column>)`.
// Every exported helper below constrains table and column names against `Database`.
const dynamicClient = (): SupabaseClient => supabase as unknown as SupabaseClient;

/** Tables whose generated Row has `user_id: string`: the only tables the owned-row helpers accept. */
export type OwnedTableName = {
  [K in PublicTableName]: TableRow<K> extends { user_id: string } ? K : never;
}[PublicTableName];

/** Column names of table K: a typo in `orderBy`, `match`, `not` or `versionColumn` fails to compile. */
export type ColumnOf<K extends PublicTableName> = Extract<keyof TableRow<K>, string>;
type Scalar = string | number | boolean;

export type FetchPageParams = {
  [K in OwnedTableName]: {
    table: K;
    /** Columns to select. Explicit lists beat `*` — see each repository. */
    columns: string;
    /** The ordering column. Must be monotonic-ish and present in `columns`. */
    orderBy: ColumnOf<K>;
    userId: string;
    cursor?: Cursor | null;
    limit?: number;
    /** Extra equality filters, e.g. `{ status: 'active' }`. */
    match?: Partial<Record<ColumnOf<K>, Scalar | null>>;
    /** Extra inequality filters, e.g. `{ status: 'archived' }` to exclude it. */
    not?: Partial<Record<ColumnOf<K>, Scalar>>;
  };
}[OwnedTableName];

export type UpdateOwnedParams = {
  [K in OwnedTableName]: {
    table: K;
    id: string;
    userId: string;
    patch: Record<string, unknown>;
    columns?: string;
  };
}[OwnedTableName];

export type DeleteOwnedParams = {
  [K in OwnedTableName]: {
    table: K;
    id: string;
    userId: string;
  };
}[OwnedTableName];

export type InsertOwnedWithIdParams = {
  [K in OwnedTableName]: {
    table: K;
    row: Record<string, unknown> & { id: string };
    columns: string;
    expectedUserId?: string;
  };
}[OwnedTableName];

export type UpdateOwnedVersionedParams = {
  [K in OwnedTableName]: {
    table: K;
    id: string;
    patch: Record<string, unknown>;
    baseVersion: string | null;
    columns: string;
    versionColumn?: ColumnOf<K>;
    expectedUserId?: string;
  };
}[OwnedTableName];

export type FetchOwnedRowParams = {
  [K in OwnedTableName]: {
    table: K;
    id: string;
    columns: string;
  };
}[OwnedTableName];

export type DeleteOwnedIfPresentParams = {
  [K in OwnedTableName]: {
    table: K;
    id: string;
    expectedUserId?: string;
  };
}[OwnedTableName];

export type RepoResult<T> =
  | { ok: true; data: T }
  /**
   * `offline` marks a failure where the request never reached the server, as
   * distinct from one the server considered and refused. Callers that retry
   * (the offline queue) need that difference: a refusal should consume the
   * retry budget, a lost connection must not.
   */
  | { ok: false; error: string; offline?: boolean; status?: number; code?: string };
// `status` / `code` (R02.04) are optional and set only where a caller needs
// to tell an expired session (401 / PGRST301) or a duplicate (23505) apart.

export type ScopedUser =
  | { ok: true; userId: string }
  /**
   * F05 (SYN-03) / F06 (SYN-02): `offline` when the session could not be read or refreshed for lack
   * of a connection (or the read took longer than LOCAL_USER_TIMEOUT_MS). Assignable to `RepoResult`.
   */
  | { ok: false; error: string; offline?: boolean };

/**
 * Did this response come back without ever reaching PostgREST?
 *
 * ## Why this is not "did the call throw"
 *
 * It is natural to assume a connectivity failure surfaces as a thrown
 * exception, and this codebase did assume it: `store/logStore.ts` classified
 * a THROWN call as `network` and any returned `{ error }` as a real server
 * rejection. Against the actual client that rule never fires. supabase-js
 * catches the transport error itself and hands back a perfectly ordinary
 * result — observed live, with the app's own client and a failing transport:
 *
 *     { data: null,
 *       error: { message: 'TypeError: Network request failed', code: '' },
 *       status: 0 }
 *
 * No throw. So every offline write was being counted as a server REJECTION,
 * which consumed the terminal retry budget and rolled the optimistic row
 * back — the two things an offline-first queue must not do.
 *
 * `status` is the honest discriminator rather than message-sniffing: PostgREST
 * always answers with a real HTTP status, and supabase-js sets `0` on the one
 * path where there was no HTTP response at all.
 *
 * A MISSING status is deliberately NOT treated as offline. It would be the
 * more cautious-looking choice, but it is the wrong one: a real rejection
 * misread as a lost connection stops surfacing to the caller (`logHabit`
 * returns its optimistic `{ ok: true }` on the offline path), which is the
 * error-swallowing this layer exists to prevent. Only an explicit `0` — the
 * value the client actually sets when the request never completed — counts.
 */
export function isTransportFailure(status: number | null | undefined, error?: unknown): boolean {
  // a real HTTP status means the server answered, whatever the error object says
  if (typeof status === 'number' && status > 0) return false;
  if (status === 0) return true;
  // F05 (REP-13): no status at all (a thrown fetch, a refresh that never reached the auth server).
  // Only a recognised transport failure counts; anything else stays a rejection (see above).
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  if (typeof e.name === 'string' && TRANSPORT_ERROR_NAMES.has(e.name)) return true;
  return typeof e.message === 'string' && TRANSPORT_MESSAGE.test(e.message);
}

/**
 * F05: error names a transport failure carries. `AuthRetryableFetchError` is what supabase-js returns
 * when a session refresh could not reach the auth server.
 */
const TRANSPORT_ERROR_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'AuthRetryableFetchError']);
/**
 * Messages of a request that never completed. A bare "timeout" is deliberately NOT here: Postgres
 * `statement timeout` (57014) reached the server and arrives with a real status.
 */
const TRANSPORT_MESSAGE = /network request failed|failed to fetch|load failed|network error|request timed out|aborted/i;

/**
 * F05 (SYN-03): the server answered, but only for now: 408, 425, 429 and 5xx. Worth trying again
 * later without spending a retry. `0` is not here: that is `offline`.
 */
export function isTransientStatus(status: number | null | undefined): boolean {
  if (typeof status !== 'number') return false;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

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
  // ── Why getSession() and not getUser() ────────────────────────────────
  //
  // In supabase-js v2 `getUser()` ALWAYS issues `GET /auth/v1/user` — it is a
  // network round trip, every time. This function runs before every single
  // repository operation, so a screen that reads three collections paid for
  // three of them. Measured against the live project:
  //
  //   getUser() before each query   3 auth requests, 373 ms   total 1779 ms
  //   getSession() once, in parallel  0 auth requests,   0 ms   total  293 ms
  //
  // `getSession()` reads the persisted session locally and refreshes it only
  // when it is near expiry, so the id costs nothing in the common case.
  //
  // This is NOT a weakening of authorization. The id returned here is used
  // for the explicit `.eq('user_id', …)` filter, which is defence in depth —
  // RLS remains the boundary, and it evaluates `auth.uid()` from the JWT the
  // server verifies, not from anything this function returns. A client that
  // lied here would produce a query that RLS rejects. An expired session
  // likewise fails at the request, which is the correct outcome.
  //
  // F06 (SYN-02): bounded. Near expiry `getSession()` refreshes, and offline auth-js retries that
  // refresh for ~25 s before answering; every repository call waited for it. After 2 s, or when
  // the refresh could not reach the auth server, the answer is `offline` (the caller keeps the work
  // and tries later), never "Oturum bulunamadı." (which reads as signed out). A rejected read is a
  // failure value, not a throw into the repository.
  const b = await boundSession(() => supabase.auth.getSession(), LOCAL_USER_TIMEOUT_MS);
  const userId = b.session?.user?.id;
  if (userId) return { ok: true, userId };
  // F05: a refresh that failed for lack of a connection is `offline`, not a rejection (the queue keeps the tap)
  if (b.timedOut || isRetryableAuthError(b.error) || isTransportFailure(null, b.error)) {
    return { ok: false, error: OFFLINE_SESSION_ERROR, offline: true };
  }
  if (b.error) return { ok: false, error: errorMessage(b.error) };
  return { ok: false, error: 'Oturum bulunamadı.' };
}

/** F06: what a repository says when the session could not be refreshed for lack of a connection. */
export const OFFLINE_SESSION_ERROR = 'Çevrimdışısın; oturum bağlantı gelince yenilenecek.';

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
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
export async function fetchPage<T extends { id: string }>(params: FetchPageParams): Promise<RepoResult<Page<T>>> {
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_PAGE_SIZE, 200));

  let q = dynamicClient()
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

  const { data, error, status } = await q
    .order(params.orderBy, { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };

  // PostgREST types `.select(string)` (non-literal) as `GenericStringError[]`, so `as unknown as T[]` is required here.
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
export async function updateOwned<T>(params: UpdateOwnedParams): Promise<RepoResult<T>> {
  const { data, error, status } = await dynamicClient()
    .from(params.table)
    .update(params.patch)
    .eq('id', params.id)
    .eq('user_id', params.userId)
    .select(params.columns ?? '*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  if (!data) return { ok: false, error: 'Kayıt bulunamadı ya da erişim yok.' };
  return { ok: true, data: data as T };
}

export async function deleteOwned(params: DeleteOwnedParams): Promise<RepoResult<true>> {
  const { data, error, status } = await dynamicClient()
    .from(params.table)
    .delete()
    .eq('id', params.id)
    .eq('user_id', params.userId)
    .select('id');
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  // A delete that matched nothing is reported, not treated as success -- the
  // stores previously removed the row from local state either way.
  if (!data || data.length === 0) return { ok: false, error: 'Kayıt bulunamadı ya da erişim yok.' };
  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// R02.03 — outbox delivery helpers. Every one is owner-scoped, carries the
// transport status/code (offline / auth / 23505 decide the outcome), and
// refuses to run as an account other than the one that queued the command.
// ---------------------------------------------------------------------------

/** The command was queued by another account than the one signed in now. */
export function wrongAccountFor(expected: string | undefined, actual: string): RepoResult<never> | null {
  return expected !== undefined && expected !== actual ? { ok: false, error: 'Oturum başka bir hesaba ait.', status: 401 } : null;
}

/** Insert a row with a CLIENT-made id, so a re-delivery hits 23505 instead of a duplicate. */
export async function insertOwnedWithId<T>(params: InsertOwnedWithIdParams): Promise<RepoResult<T>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccountFor(params.expectedUserId, u.userId);
  if (wrong) return wrong;
  const { data, error, status } = await dynamicClient().from(params.table)
    .insert({ ...params.row, user_id: u.userId }).select(params.columns).single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: data as T };
}

/** Update only if the row is still at `baseVersion` (`row` null + `exists` = the version moved). */
export async function updateOwnedVersioned<T>(
  params: UpdateOwnedVersionedParams,
): Promise<RepoResult<{ row: T | null; exists: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccountFor(params.expectedUserId, u.userId);
  if (wrong) return wrong;
  const col = params.versionColumn ?? 'updated_at';
  let q = dynamicClient().from(params.table).update(params.patch).eq('id', params.id).eq('user_id', u.userId);
  if (params.baseVersion !== null) q = q.eq(col, params.baseVersion);
  const { data, error, status } = await q.select(params.columns).maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  if (data) return { ok: true, data: { row: data as T, exists: true } };
  const probe = await dynamicClient().from(params.table).select('id').eq('id', params.id).eq('user_id', u.userId).maybeSingle();
  if (probe.error) return { ok: false, error: probe.error.message, offline: isTransportFailure(probe.status, probe.error), status: probe.status, code: probe.error.code };
  return { ok: true, data: { row: null, exists: !!probe.data } };
}

/** The row as the server has it now, or null if it is gone. */
export async function fetchOwnedRow<T>(params: FetchOwnedRowParams): Promise<RepoResult<T | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await dynamicClient().from(params.table).select(params.columns)
    .eq('id', params.id).eq('user_id', u.userId).maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: (data ?? null) as T | null };
}

/** Delete if present; a row already gone is not an error (a re-delivered delete is one effect). */
export async function deleteOwnedIfPresent(params: DeleteOwnedIfPresentParams): Promise<RepoResult<{ deleted: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccountFor(params.expectedUserId, u.userId);
  if (wrong) return wrong;
  const { data, error, status } = await dynamicClient().from(params.table).delete()
    .eq('id', params.id).eq('user_id', u.userId).select('id');
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: { deleted: !!data && data.length > 0 } };
}
