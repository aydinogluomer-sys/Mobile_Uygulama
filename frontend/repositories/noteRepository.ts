/**
 * `notes` data access.  (plan §5 Rule 4, §13 pagination)
 *
 * Replaces the direct `supabase.from('notes')` calls that lived in
 * `store/noteStore.ts`. Three things change in the move, none of them
 * cosmetic:
 *
 *  1. `fetchNotes` had NO user filter and NO bound — it asked for every row
 *     in the table and relied entirely on RLS to narrow it. It is now keyset
 *     paginated and explicitly scoped.
 *  2. `updateNote`/`removeNote` were `.eq('id', id)` with no owner check.
 *  3. Every call discarded its result, so a rejected write still updated the
 *     UI. Each function now returns a `RepoResult` the caller must inspect.
 *
 * Search moved here too: the store filtered `get().notes` in memory, which
 * only ever searched the page that happened to be loaded.
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, fetchPage, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type NoteRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

const COLS = 'id,user_id,title,content,tags,created_at,updated_at';

export async function fetchNotesPage(
  cursor?: Cursor | null,
  limit?: number,
): Promise<RepoResult<Page<NoteRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<NoteRow>({
    table: 'notes', columns: COLS, orderBy: 'updated_at',
    userId: u.userId, cursor, limit,
  });
}

export async function insertNote(input: {
  title: string;
  content: string;
  tags?: string[];
}): Promise<RepoResult<NoteRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('notes')
    .insert({ user_id: u.userId, title: input.title, content: input.content, tags: input.tags ?? [] })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as NoteRow };
}

export async function updateNote(
  id: string,
  patch: { title?: string; content?: string; tags?: string[] },
): Promise<RepoResult<NoteRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<NoteRow>({
    table: 'notes', id, userId: u.userId,
    patch: { ...patch, updated_at: new Date().toISOString() },
    columns: COLS,
  });
}

export async function deleteNote(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'notes', id, userId: u.userId });
}

/**
 * Server-side search.
 *
 * The store's `search()` filtered the in-memory array, so it searched
 * whatever happened to be loaded and silently missed everything else — a
 * problem that gets worse, not better, once the list is paginated. `ilike`
 * across title and content puts the whole collection back in scope while
 * keeping the result bounded.
 */
export async function searchNotes(query: string, limit = 50): Promise<RepoResult<NoteRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const term = query.trim();
  if (!term) return { ok: true, data: [] };
  // Escape PostgREST's `or()` delimiters so a comma or paren in the query
  // cannot be read as filter syntax.
  const safe = term.replace(/[,()]/g, ' ');
  const { data, error } = await supabase
    .from('notes')
    .select(COLS)
    .eq('user_id', u.userId)
    .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    .order('updated_at', { ascending: false })
    .limit(Math.min(limit, 100));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as NoteRow[] };
}
