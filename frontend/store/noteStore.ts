import { create } from 'zustand';
import {
  deleteNote as repoDelete,
  fetchNotesPage,
  insertNote,
  searchNotes as repoSearch,
  updateNote as repoUpdate,
  type NoteRow,
} from '../repositories/noteRepository';
import type { Cursor } from '../repositories/shared';

export type Note = NoteRow;

/**
 * Notes.
 *
 * ## What changed and why
 *
 * This store used to hold `supabase.from('notes')` calls directly. Three
 * defects came with that, all fixed by moving to `repositories/noteRepository`:
 *
 *  - `fetchNotes` asked for the whole table with no user filter and no bound.
 *  - `updateNote`/`removeNote` matched on `id` alone, leaving RLS as the only
 *    guard, and discarded their result — so a rejected write still updated
 *    the list on screen.
 *  - `search` filtered the in-memory array, which only ever searched what
 *    happened to be loaded. Paginating made that strictly worse, so search
 *    moved to the server in the same change rather than being left to rot.
 *
 * The list is keyset-paginated: `fetchNotes()` loads the first page and
 * `loadMore()` continues from the cursor. `hasMore` is what a list footer
 * should read; `error` is surfaced rather than swallowed.
 */
type NoteStore = {
  notes: Note[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  cursor: Cursor | null;
  fetchNotes: () => Promise<void>;
  loadMore: () => Promise<void>;
  addNote: (title: string, content: string) => Promise<Note | null>;
  updateNote: (id: string, patch: { title?: string; content?: string; tags?: string[] }) => Promise<boolean>;
  removeNote: (id: string) => Promise<boolean>;
  /** Server-side search across ALL notes, not just the loaded page. */
  search: (q: string) => Promise<Note[]>;
};

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
  cursor: null,

  fetchNotes: async () => {
    set({ loading: true, error: null });
    const res = await fetchNotesPage(null);
    if (!res.ok) {
      set({ loading: false, error: res.error });
      return;
    }
    // A refresh resets the cursor: continuing from a stale one would skip
    // whatever was inserted since.
    set({
      notes: res.data.rows,
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
    });
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    const res = await fetchNotesPage(cursor);
    if (!res.ok) {
      set({ loadingMore: false, error: res.error });
      return;
    }
    set((s) => {
      // Defensive de-dupe. Keyset paging should not repeat a row, but an
      // append that silently doubled an entry would be hard to notice.
      const seen = new Set(s.notes.map((n) => n.id));
      const fresh = res.data.rows.filter((n) => !seen.has(n.id));
      return {
        notes: [...s.notes, ...fresh],
        cursor: res.data.nextCursor,
        hasMore: res.data.hasMore,
        loadingMore: false,
      };
    });
  },

  addNote: async (title, content) => {
    const res = await insertNote({ title, content });
    if (!res.ok) {
      set({ error: res.error });
      return null;
    }
    set((s) => ({ notes: [res.data, ...s.notes], error: null }));
    return res.data;
  },

  updateNote: async (id, patch) => {
    const res = await repoUpdate(id, patch);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? res.data : n)), error: null }));
    return true;
  },

  removeNote: async (id) => {
    const res = await repoDelete(id);
    if (!res.ok) {
      // The row stays on screen. Removing it locally after a failed delete is
      // how the previous version told the user something had happened that
      // had not.
      set({ error: res.error });
      return false;
    }
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id), error: null }));
    return true;
  },

  search: async (q) => {
    const res = await repoSearch(q);
    if (!res.ok) {
      set({ error: res.error });
      return [];
    }
    return res.data;
  },
}));
