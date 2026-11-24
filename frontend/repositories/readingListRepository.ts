/**
 * `reading_list` data access.  (plan §5 Rule 4, §13 pagination)
 *
 * Replaces the direct calls in `store/readingListStore.ts`, which had the
 * largest number of them (4 unscoped mutations plus an unbounded list read).
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, deleteOwnedIfPresent, fetchPage,
  insertOwnedWithId, isTransportFailure, updateOwned, updateOwnedVersioned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type ReadingStatus = 'want_to_read' | 'reading' | 'completed';
export type ReadingType = 'book' | 'article' | 'video' | 'podcast' | 'other';

export type ReadingItemRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  type: ReadingType;
  status: ReadingStatus;
  url: string | null;
  notes: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
};

const COLS = 'id,user_id,title,author,type,status,url,notes,rating,created_at,updated_at';

export async function fetchReadingListPage(
  cursor?: Cursor | null,
  limit?: number,
  opts?: { status?: ReadingStatus },
): Promise<RepoResult<Page<ReadingItemRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<ReadingItemRow>({
    table: 'reading_list', columns: COLS, orderBy: 'updated_at',
    userId: u.userId, cursor, limit,
    // Filtering by tab server-side, rather than fetching everything and
    // filtering in the component, is what makes a paginated tab coherent:
    // otherwise "page 2 of Reading" means "the next 30 of everything".
    match: opts?.status ? { status: opts.status } : undefined,
  });
}

/**
 * Total item count per status.
 *
 * The screen used to derive its tab badges by counting the in-memory array,
 * which was only correct because the array was the entire table. Once each
 * tab is paginated, counting what happens to be loaded would show "3" beside
 * a tab holding 200 items. These are `head: true` count queries — no rows
 * transferred, just the number.
 */
export async function fetchReadingCounts(): Promise<
  RepoResult<Record<ReadingStatus, number>>
> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const statuses: readonly ReadingStatus[] = ['want_to_read', 'reading', 'completed'];
  const countByStatus = (status: ReadingStatus) =>
    supabase
      .from('reading_list')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.userId)
      .eq('status', status);

  const results = await Promise.all(statuses.map((status) => countByStatus(status)));
  const out = { want_to_read: 0, reading: 0, completed: 0 } as Record<ReadingStatus, number>;
  for (let i = 0; i < statuses.length; i += 1) {
    const { count, error, status: httpStatus } = results[i];
    if (error) {
      return {
        ok: false,
        error: error.message,
        offline: isTransportFailure(httpStatus, error),
        status: httpStatus,
        code: error.code,
      };
    }
    out[statuses[i]] = count ?? 0;
  }
  return { ok: true, data: out };
}

export async function insertReadingItem(input: {
  title: string;
  author?: string | null;
  type: ReadingType;
  url?: string | null;
}): Promise<RepoResult<ReadingItemRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('reading_list')
    .insert({
      user_id: u.userId,
      title: input.title,
      author: input.author ?? null,
      type: input.type,
      url: input.url ?? null,
      status: 'want_to_read' as ReadingStatus,
    })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: data as ReadingItemRow };
}

async function patch(
  id: string,
  fields: Record<string, unknown>,
): Promise<RepoResult<ReadingItemRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<ReadingItemRow>({
    table: 'reading_list', id, userId: u.userId,
    patch: { ...fields, updated_at: new Date().toISOString() },
    columns: COLS,
  });
}

export const updateReadingStatus = (id: string, status: ReadingStatus) => patch(id, { status });
export const updateReadingRating = (id: string, rating: number | null) => patch(id, { rating });
export const updateReadingNotes = (id: string, notes: string) => patch(id, { notes });

export async function deleteReadingItem(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'reading_list', id, userId: u.userId });
}

// ---------------------------------------------------------------------------
// Unified offline outbox delivery helpers (idempotent, owner-scoped)
// ---------------------------------------------------------------------------

export function insertReadingItemWithId(
  row: {
    id: string;
    title: string;
    author?: string | null;
    type: ReadingType;
    status?: ReadingStatus;
    url?: string | null;
    notes?: string | null;
    rating?: number | null;
  },
  expectedUserId?: string,
): Promise<RepoResult<ReadingItemRow>> {
  return insertOwnedWithId<ReadingItemRow>({
    table: 'reading_list',
    row: {
      id: row.id,
      title: row.title,
      author: row.author ?? null,
      type: row.type,
      status: row.status ?? 'want_to_read',
      url: row.url ?? null,
      notes: row.notes ?? null,
      rating: row.rating ?? null,
    },
    columns: COLS,
    expectedUserId,
  });
}

export function updateReadingItemOwned(
  id: string,
  fields: Record<string, unknown>,
  expectedUserId?: string,
): Promise<RepoResult<{ row: ReadingItemRow | null; exists: boolean }>> {
  return updateOwnedVersioned<ReadingItemRow>({
    table: 'reading_list',
    id,
    patch: { ...fields, updated_at: new Date().toISOString() },
    baseVersion: null,
    columns: COLS,
    expectedUserId,
  });
}

export function deleteReadingItemIfPresent(
  id: string,
  expectedUserId?: string,
): Promise<RepoResult<{ deleted: boolean }>> {
  return deleteOwnedIfPresent({ table: 'reading_list', id, expectedUserId });
}
