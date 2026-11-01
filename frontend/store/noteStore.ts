import { create } from 'zustand';
import type { NoteRow } from '../repositories/noteRepository';
import type { Cursor, Page } from '../repositories/shared';
import { overlay, type OutboxCommand } from '../lib/outbox';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';
import {
  listNotesPage as fetchNotesPage, findNotes as repoSearch,
  createNote, editNote, removeNote as svcRemove, resolveNoteConflict, pendingNoteCommands,
  NOTE_ENTITY, type ConflictChoice,
} from '../services/noteService';

export type Note = NoteRow;

const NOTES_CACHE_KEY = 'notes:p1';

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

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
  /** R02.05 — notes whose edit met a newer version elsewhere; both are kept until resolved. */
  conflicts: () => OutboxCommand[];
  resolveConflict: (id: string, choice: ConflictChoice) => Promise<boolean>;
};

/**
 * R02.03 — every write goes through the core outbox: kept on the device
 * first, shown at once, delivered after. `serverVersion` is each note's
 * `updated_at` as the server last reported it -- the base of the next edit.
 */
const serverVersion = new Map<string, string>();
const remember = (rows: readonly Note[]) => { for (const r of rows) if (r.updated_at) serverVersion.set(r.id, r.updated_at); };
const withPending = (rows: Note[]): Note[] => { const box = coreOutbox.state(); return box ? overlay(box, NOTE_ENTITY, rows) : rows; };
coreOutbox.onApplied((cmd, version) => {
  if (cmd.entity === NOTE_ENTITY && version) serverVersion.set(cmd.entityId, version);
});

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
  cursor: null,

  fetchNotes: async () => {
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY) : null;
    if (cached) {
      remember(cached.data.rows);
      set({
        notes: withPending(cached.data.rows),
        cursor: cached.data.nextCursor,
        hasMore: cached.data.hasMore,
        loading: false,
        error: null,
      });
    } else {
      set({ loading: true, error: null });
    }

    const res = await fetchNotesPage(null);
    if (!res.ok) {
      if (cached) {
        set({ loading: false, error: res.offline ? null : res.error });
      } else {
        set({ loading: false, error: res.error });
      }
      return;
    }
    remember(res.data.rows);
    if (uid) {
      void setCachedSnapshot(uid, NOTES_CACHE_KEY, res.data);
    }
    // A refresh resets the cursor: continuing from a stale one would skip
    // whatever was inserted since.
    set({
      // Unsent changes stay visible over a refetch until they are delivered.
      notes: withPending(res.data.rows),
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
      error: null,
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
      remember(res.data.rows);
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
    const res = await createNote({ title, content });
    if (!res.ok || !res.id) {
      set({ error: res.ok ? 'Not kaydedilemedi.' : res.error });
      return null;
    }
    const now = new Date().toISOString();
    const row: Note = { id: res.id, user_id: '', title, content, tags: [], created_at: now, updated_at: serverVersion.get(res.id) ?? now };
    set((s) => {
      const nextNotes = [row, ...s.notes.filter((n) => n.id !== row.id)];
      void safeUserId().then((uid) => {
        if (uid) void setCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY, { rows: nextNotes, nextCursor: s.cursor, hasMore: s.hasMore });
      });
      return { notes: nextNotes, error: res.savedOnDevice ? null : 'Not cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.' };
    });
    return row;
  },

  updateNote: async (id, patch) => {
    const res = await editNote(id, patch, serverVersion.get(id) ?? get().notes.find((n) => n.id === id)?.updated_at ?? null);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    // Shown at once; `updated_at` stays the server's until delivery reports a new one.
    set((s) => {
      const nextNotes = s.notes.map((n) => (n.id === id ? { ...n, ...patch, updated_at: serverVersion.get(id) ?? n.updated_at } : n));
      void safeUserId().then((uid) => {
        if (uid) void setCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY, { rows: nextNotes, nextCursor: s.cursor, hasMore: s.hasMore });
      });
      return { notes: nextNotes, error: null };
    });
    return true;
  },

  removeNote: async (id) => {
    const res = await svcRemove(id);
    if (!res.ok) {
      // Not even queued: the row stays on screen.
      set({ error: res.error });
      return false;
    }
    // Queued (and tombstoned): hidden now, and a late edit cannot bring it back.
    set((s) => {
      const nextNotes = s.notes.filter((n) => n.id !== id);
      void safeUserId().then((uid) => {
        if (uid) void setCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY, { rows: nextNotes, nextCursor: s.cursor, hasMore: s.hasMore });
      });
      return { notes: nextNotes, error: null };
    });
    return true;
  },

  conflicts: () => pendingNoteCommands().filter((c) => c.status === 'conflict'),

  resolveConflict: async (id, choice) => {
    const title = get().notes.find((n) => n.id === id)?.title ?? '';
    const r = await resolveNoteConflict(id, choice, title);
    if (!r.ok) { set({ error: r.error ?? 'Çakışma çözülemedi.' }); return false; }
    await get().fetchNotes();
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
