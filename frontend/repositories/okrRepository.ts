/**
 * `okrs` + `key_results` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/okrStore.ts`, which had the most of any
 * store (5) and loaded both tables unfiltered and unbounded in parallel.
 *
 * The two tables are one repository because they are one aggregate: a key
 * result has no meaning without its objective, and the store always loaded
 * and rendered them together. Splitting them would produce two files that
 * only ever get called in pairs.
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, deleteOwnedIfPresent,
  insertOwnedWithId, isTransportFailure, updateOwned, updateOwnedVersioned,
  type RepoResult,
} from './shared';

export type OkrRow = {
  id: string;
  user_id: string;
  objective: string;
  year: number;
  quarter: number;
  created_at: string;
};

export type KeyResultRow = {
  id: string;
  okr_id: string;
  user_id: string;
  title: string;
  current_value: number;
  target_value: number;
  unit: string | null;
  created_at: string;
};

const OKR_COLS = 'id,user_id,objective,year,quarter,created_at';
const KR_COLS = 'id,okr_id,user_id,title,current_value,target_value,unit,created_at';

/**
 * Both tables for the current user, newest objective first.
 *
 * Bounded by quarter count rather than by keyset paging: an OKR set is a
 * small, naturally-windowed collection (a handful of objectives per quarter),
 * and "load more objectives" is not a gesture this screen has. The bound
 * exists so the query cannot grow without limit over years of use.
 */
export async function fetchOkrs(opts?: { quarters?: number }): Promise<
  RepoResult<{ okrs: OkrRow[]; keyResults: KeyResultRow[] }>
> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const limit = Math.max(1, Math.min(opts?.quarters ?? 8, 40));

  const okrRes = await supabase
    .from('okrs')
    .select(OKR_COLS)
    .eq('user_id', u.userId)
    .order('year', { ascending: false })
    .order('quarter', { ascending: false })
    .limit(limit);
  if (okrRes.error) {
    return {
      ok: false,
      error: okrRes.error.message,
      offline: isTransportFailure(okrRes.status, okrRes.error),
      status: okrRes.status,
      code: okrRes.error.code,
    };
  }
  const okrs = (okrRes.data ?? []) as unknown as OkrRow[];

  if (okrs.length === 0) return { ok: true, data: { okrs: [], keyResults: [] } };

  // Scoped to the objectives actually loaded, so the second query cannot
  // return key results for objectives the caller does not have.
  const krRes = await supabase
    .from('key_results')
    .select(KR_COLS)
    .eq('user_id', u.userId)
    .in('okr_id', okrs.map((o) => o.id))
    .order('created_at', { ascending: true });
  if (krRes.error) {
    return {
      ok: false,
      error: krRes.error.message,
      offline: isTransportFailure(krRes.status, krRes.error),
      status: krRes.status,
      code: krRes.error.code,
    };
  }

  return {
    ok: true,
    data: { okrs, keyResults: (krRes.data ?? []) as unknown as KeyResultRow[] },
  };
}

export async function insertObjective(input: {
  objective: string;
  year: number;
  quarter: number;
}): Promise<RepoResult<OkrRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('okrs')
    .insert({ user_id: u.userId, objective: input.objective, year: input.year, quarter: input.quarter })
    .select(OKR_COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: data as unknown as OkrRow };
}

export async function insertKeyResult(input: {
  okrId: string;
  title: string;
  targetValue: number;
  unit?: string | null;
}): Promise<RepoResult<KeyResultRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // NOTE: objective ownership is enforced by RLS, not here -- see
  // `008_child_row_ownership.sql`. A client-side check would be a
  // round trip that an attacker simply skips.

  const { data, error, status } = await supabase
    .from('key_results')
    .insert({
      user_id: u.userId,
      okr_id: input.okrId,
      title: input.title,
      current_value: 0,
      target_value: input.targetValue,
      unit: input.unit ?? null,
    })
    .select(KR_COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: data as unknown as KeyResultRow };
}

export async function updateKeyResultValue(
  id: string,
  currentValue: number,
): Promise<RepoResult<KeyResultRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const value = Number.isFinite(currentValue) ? Math.max(0, currentValue) : 0;
  return updateOwned<KeyResultRow>({
    table: 'key_results', id, userId: u.userId, patch: { current_value: value }, columns: KR_COLS,
  });
}

export async function deleteObjective(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'okrs', id, userId: u.userId });
}

export async function deleteKeyResult(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'key_results', id, userId: u.userId });
}

// ---------------------------------------------------------------------------
// Unified offline outbox delivery helpers (idempotent, owner-scoped)
// ---------------------------------------------------------------------------

export function insertObjectiveWithId(
  row: { id: string; objective: string; year: number; quarter: number },
  expectedUserId?: string,
): Promise<RepoResult<OkrRow>> {
  return insertOwnedWithId<OkrRow>({
    table: 'okrs',
    row,
    columns: OKR_COLS,
    expectedUserId,
  });
}

export function insertKeyResultWithId(
  row: {
    id: string;
    okr_id: string;
    title: string;
    current_value?: number;
    target_value: number;
    unit?: string | null;
  },
  expectedUserId?: string,
): Promise<RepoResult<KeyResultRow>> {
  const curVal = typeof row.current_value === 'number' && Number.isFinite(row.current_value)
    ? Math.max(0, row.current_value)
    : 0;
  return insertOwnedWithId<KeyResultRow>({
    table: 'key_results',
    row: {
      id: row.id,
      okr_id: row.okr_id,
      title: row.title,
      current_value: curVal,
      target_value: row.target_value,
      unit: row.unit ?? null,
    },
    columns: KR_COLS,
    expectedUserId,
  });
}

export function updateKeyResultOwned(
  id: string,
  patch: Record<string, unknown>,
  expectedUserId?: string,
): Promise<RepoResult<{ row: KeyResultRow | null; exists: boolean }>> {
  const next = { ...patch };
  if (typeof next.current_value === 'number') {
    next.current_value = Number.isFinite(next.current_value) ? Math.max(0, next.current_value) : 0;
  }
  return updateOwnedVersioned<KeyResultRow>({
    table: 'key_results',
    id,
    patch: next,
    baseVersion: null,
    columns: KR_COLS,
    expectedUserId,
  });
}

export function deleteObjectiveIfPresent(
  id: string,
  expectedUserId?: string,
): Promise<RepoResult<{ deleted: boolean }>> {
  return deleteOwnedIfPresent({ table: 'okrs', id, expectedUserId });
}

export function deleteKeyResultIfPresent(
  id: string,
  expectedUserId?: string,
): Promise<RepoResult<{ deleted: boolean }>> {
  return deleteOwnedIfPresent({ table: 'key_results', id, expectedUserId });
}
