/**
 * `journal_entries` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/journalStore.ts`.
 *
 * `fetchEntries` was the one list read in this codebase that already had a
 * bound (`.limit(365)`), but it had **no `user_id` filter** — RLS was the only
 * thing narrowing it. The bound is kept and the scope made explicit.
 *
 * Journal content is the most sensitive text the app stores, which is why the
 * explicit filter matters here more than anywhere: a policy change that
 * loosened `journal_entries` would have leaked through this query silently.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, wrongAccountFor, type RepoResult } from './shared';

export type JournalEntryRow = {
  id: string;
  user_id: string;
  date: string;
  content: string;
  mood: number | null;
  /** Nullable in the schema; the store's old type claimed a plain boolean. */
  ai_summary: boolean | null;
  created_at: string;
};

const COLS = '*';

/** Newest first, bounded to a year — the window the journal screen renders. */
export async function fetchJournalEntries(limit = 365): Promise<RepoResult<JournalEntryRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('journal_entries')
    .select(COLS)
    .eq('user_id', u.userId)
    .order('date', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as JournalEntryRow[] };
}

/**
 * Free-text search across the caller's own entries.
 *
 * Journal content is the most sensitive text the app stores, so the owner
 * filter is explicit here for the same reason it is on `fetchJournalEntries`:
 * RLS is the backstop, not the only scope.
 *
 * `%` is stripped along with the `or()` delimiters — without it a lone `%`
 * typed into the palette becomes a wildcard matching every entry the user has
 * ever written, which is not what someone searching for a percent sign meant.
 */
export async function searchJournalEntries(
  query: string,
  limit = 8,
): Promise<RepoResult<JournalEntryRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const term = query.trim();
  if (!term) return { ok: true, data: [] };
  const safe = term.replace(/[,()%]/g, ' ');
  const { data, error } = await supabase
    .from('journal_entries')
    .select(COLS)
    .eq('user_id', u.userId)
    .ilike('content', `%${safe}%`)
    .order('date', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as JournalEntryRow[] };
}

export async function fetchJournalEntry(date: string): Promise<RepoResult<JournalEntryRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('journal_entries')
    .select(COLS)
    .eq('user_id', u.userId)
    .eq('date', date)
    .maybeSingle();
  // R02.03 — status/code travel so the outbox can tell offline from refused.
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status), status, code: error.code };
  return { ok: true, data: (data ?? null) as JournalEntryRow | null };
}

/**
 * Upsert on `(user_id, date)` — one entry per day.
 *
 * `user_id` is supplied here, never by the caller, so the conflict target
 * cannot be satisfied against another account's row.
 */
export async function upsertJournalEntry(input: {
  date: string;
  content: string;
  mood?: number | null;
  aiSummary?: boolean;
}, expectedUserId?: string): Promise<RepoResult<JournalEntryRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // R02.06 — a queued entry is only ever written as the account that queued it.
  const wrong = wrongAccountFor(expectedUserId, u.userId);
  if (wrong) return wrong;
  const row: Record<string, unknown> = {
    user_id: u.userId,
    date: input.date,
    content: input.content,
    mood: input.mood ?? null,
  };
  if (input.aiSummary !== undefined) row.ai_summary = input.aiSummary;
  const { data, error, status } = await supabase
    .from('journal_entries')
    .upsert(row, { onConflict: 'user_id,date' })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status), status, code: error.code };
  return { ok: true, data: data as unknown as JournalEntryRow };
}
