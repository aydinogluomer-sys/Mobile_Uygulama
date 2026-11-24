import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { create } from 'zustand';
import type { NoteRow } from '../repositories/noteRepository';
import type { Cursor, Page } from '../repositories/shared';
import { overlay, type OutboxCommand } from '../lib/outbox';
import { safeUserIdOf } from '../lib/outboxEngine';
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
const loadLatest = createLatest();

const safeUserId = (): Promise<string | null> => safeUserIdOf(currentUser);

async function persistNotesCache(state: Pick<NoteStore, 'notes' | 'cursor' | 'hasMore'>): Promise<void> {
  const uid = await safeUserId();
  if (!uid) return;
  await setCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY, {
    rows: state.notes,
    nextCursor: state.cursor,
    hasMore: state.hasMore,
  });
}

/**
 * Notes.
 *
 * This store used to hold `supabase.from('notes')` calls directly; those moved
 * to `repositories/noteRepository`, and writes run through `services/noteService`
 * on top of the shared core outbox.
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
    const run = loadLatest.begin();
    try {
      await coreOutbox.ensure();
      if (!run.isCurrent()) return;
      const uid = await safeUserId();
      if (!run.isCurrent()) return;
      const cached = uid ? await readCachedSnapshot<Page<Note>>(uid, NOTES_CACHE_KEY) : null;
      if (!run.isCurrent()) return;
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
      if (!run.isCurrent()) return;
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
      set({
        notes: withPending(res.data.rows),
        cursor: res.data.nextCursor,
        hasMore: res.data.hasMore,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } finally {
      run.done();
      if (loadLatest.pending() === 0 && get().loading) set({ loading: false });
    }
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    const run = loadLatest.begin();
    set({ loadingMore: true });
    try {
      const res = await fetchNotesPage(cursor);
      if (!run.isCurrent()) return;
      if (!res.ok) {
        set({ loadingMore: false, error: res.error });
        return;
      }
      set((s) => {
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
    } finally {
      run.done();
    }
  },

  addNote: async (title, content) => {
    const res = await createNote({ title, content });
    if (!res.ok || !res.id) {
      set({ error: res.ok ? 'Not kaydedilemedi.' : res.error });
      return null;
    }
    const now = new Date().toISOString();
    const row: Note = { id: res.id, user_id: '', title, content, tags: [], created_at: now, updated_at: serverVersion.get(res.id) ?? now };
    set((s) => ({
      notes: [row, ...s.notes.filter((n) => n.id !== row.id)],
      error: res.savedOnDevice ? null : 'Not cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.',
    }));
    void persistNotesCache(get());
    return row;
  },

  updateNote: async (id, patch) => {
    const res = await editNote(id, patch, serverVersion.get(id) ?? get().notes.find((n) => n.id === id)?.updated_at ?? null);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updated_at: serverVersion.get(id) ?? n.updated_at } : n)),
      error: res.savedOnDevice ? null : 'Not cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.',
    }));
    void persistNotesCache(get());
    return true;
  },

  removeNote: async (id) => {
    const res = await svcRemove(id);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      error: res.savedOnDevice ? null : 'Not cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.',
    }));
    void persistNotesCache(get());
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

// F04 (STO-20): the store and the server versions its conflict check compares against belong to the account.
registerAccountScoped({ name: 'note', store: useNoteStore, onReset: () => serverVersion.clear() });
