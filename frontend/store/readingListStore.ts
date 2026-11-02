import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import {
  deleteReadingItem,
  fetchReadingCounts,
  fetchReadingListPage,
  insertReadingItem,
  updateReadingNotes,
  updateReadingRating,
  updateReadingStatus,
  type ReadingItemRow,
  type ReadingStatus,
  type ReadingType,
} from '../repositories/readingListRepository';
import type { Cursor, Page } from '../repositories/shared';
import { hasPending, newOperationId, overlay } from '../lib/outbox';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type { ReadingStatus, ReadingType };
export type ReadingItem = ReadingItemRow;

export const READING_ENTITY = 'reading_item';
const STATUSES: ReadingStatus[] = ['want_to_read', 'reading', 'completed'];

const tabCacheKey = (status: ReadingStatus) => `reading:${status}:p1`;
const COUNTS_CACHE_KEY = 'reading:counts';

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

const withPendingTab = (status: ReadingStatus, rows: ReadingItem[]): ReadingItem[] => {
  const box = coreOutbox.state();
  if (!box) return rows;
  return overlay(box, READING_ENTITY, rows).filter((i) => (i.status ?? 'want_to_read') === status);
};

type TabState = {
  items: ReadingItem[];
  cursor: Cursor | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
};

const emptyTab = (): TabState => ({
  items: [], cursor: null, hasMore: false, loading: false, loadingMore: false,
});

/**
 * Reading list.
 *
 * ## Why the shape changed
 *
 * The store held one unbounded `items` array — the whole table — and the
 * screen derived both its three tabs and its three badge counts by filtering
 * it. That only worked because nothing was ever left out.
 *
 * Paginating a single shared array would have quietly broken both: "page 2 of
 * Reading" would mean "the next 30 of everything", and a badge would count
 * the loaded slice rather than the collection. So each tab now owns its own
 * page and cursor, filtered server-side, and the badges come from three
 * `head: true` count queries instead of from whatever is in memory.
 */
type ReadingListStore = {
  tabs: Record<ReadingStatus, TabState>;
  counts: Record<ReadingStatus, number>;
  error: string | null;
  /** Loads the first page of one tab (and refreshes the badge counts). */
  fetchItems: (status: ReadingStatus) => Promise<void>;
  loadMore: (status: ReadingStatus) => Promise<void>;
  refreshCounts: () => Promise<void>;
  addItem: (data: { title: string; author?: string; type: ReadingType; url?: string }) => Promise<boolean>;
  updateStatus: (id: string, status: ReadingStatus) => Promise<boolean>;
  updateRating: (id: string, rating: number) => Promise<boolean>;
  updateNotes: (id: string, notes: string) => Promise<boolean>;
  removeItem: (id: string) => Promise<boolean>;
  byStatus: (status: ReadingStatus) => ReadingItem[];
};

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  tabs: { want_to_read: emptyTab(), reading: emptyTab(), completed: emptyTab() },
  counts: { want_to_read: 0, reading: 0, completed: 0 },
  error: null,

  refreshCounts: async () => {
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<Record<ReadingStatus, number>>(uid, COUNTS_CACHE_KEY) : null;
    if (cached) {
      set({ counts: cached.data });
    }
    const res = await fetchReadingCounts();
    if (res.ok) {
      if (uid) void setCachedSnapshot(uid, COUNTS_CACHE_KEY, res.data);
      set({ counts: res.data });
    }
  },

  fetchItems: async (status) => {
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<Page<ReadingItem>>(uid, tabCacheKey(status)) : null;
    if (cached) {
      set((s) => ({
        tabs: {
          ...s.tabs,
          [status]: {
            items: withPendingTab(status, cached.data.rows),
            cursor: cached.data.nextCursor,
            hasMore: cached.data.hasMore,
            loading: false,
            loadingMore: false,
          },
        },
        error: null,
      }));
    } else {
      set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loading: true } }, error: null }));
    }

    const res = await fetchReadingListPage(null, undefined, { status });
    if (!res.ok) {
      if (cached) {
        set((s) => ({
          tabs: { ...s.tabs, [status]: { ...s.tabs[status], loading: false } },
          error: res.offline ? null : res.error,
        }));
      } else {
        set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loading: false } }, error: res.error }));
      }
      return;
    }
    if (uid) {
      void setCachedSnapshot(uid, tabCacheKey(status), res.data);
    }
    set((s) => ({
      tabs: {
        ...s.tabs,
        [status]: {
          items: withPendingTab(status, res.data.rows),
          cursor: res.data.nextCursor,
          hasMore: res.data.hasMore,
          loading: false,
          loadingMore: false,
        },
      },
      error: null,
    }));
    await get().refreshCounts();
  },

  loadMore: async (status) => {
    const tab = get().tabs[status];
    if (!tab.hasMore || !tab.cursor || tab.loading || tab.loadingMore) return;
    set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loadingMore: true } } }));
    const res = await fetchReadingListPage(tab.cursor, undefined, { status });
    if (!res.ok) {
      set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loadingMore: false } }, error: res.error }));
      return;
    }
    set((s) => {
      const cur = s.tabs[status];
      const seen = new Set(cur.items.map((i) => i.id));
      const fresh = res.data.rows.filter((i) => !seen.has(i.id));
      return {
        tabs: {
          ...s.tabs,
          [status]: {
            items: [...cur.items, ...fresh], cursor: res.data.nextCursor,
            hasMore: res.data.hasMore, loading: false, loadingMore: false,
          },
        },
      };
    });
  },

  addItem: async ({ title, author, type, url }) => {
    const res = await insertReadingItem({ title, author, type, url });
    if (res.ok) {
      // A new item is always `want_to_read`, so it belongs to that tab only.
      set((s) => ({
        tabs: {
          ...s.tabs,
          want_to_read: { ...s.tabs.want_to_read, items: [res.data, ...s.tabs.want_to_read.items] },
        },
        counts: { ...s.counts, want_to_read: s.counts.want_to_read + 1 },
        error: null,
      }));
      return true;
    }
    if (res.offline) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const now = new Date().toISOString();
      const payload = {
        title,
        author: author ?? null,
        type,
        status: 'want_to_read' as ReadingStatus,
        url: url ?? null,
        notes: null,
        rating: null,
      };
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'create', payload });
      if (queued.ok) {
        const optimistic: ReadingItem = {
          id,
          user_id: uid,
          ...payload,
          created_at: now,
          updated_at: now,
        };
        set((s) => ({
          tabs: {
            ...s.tabs,
            want_to_read: { ...s.tabs.want_to_read, items: [optimistic, ...s.tabs.want_to_read.items] },
          },
          counts: { ...s.counts, want_to_read: s.counts.want_to_read + 1 },
          error: null,
        }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  updateStatus: async (id, status) => {
    const findExisting = (): ReadingItem | null => {
      const tabs = get().tabs;
      for (const st of STATUSES) {
        const found = tabs[st].items.find((i) => i.id === id);
        if (found) return found;
      }
      return null;
    };

    const moveLocally = (row: ReadingItem) => {
      set((s) => {
        const tabs = { ...s.tabs };
        for (const st of STATUSES) {
          tabs[st] = { ...tabs[st], items: tabs[st].items.filter((i) => i.id !== id) };
        }
        tabs[status] = { ...tabs[status], items: [row, ...tabs[status].items] };
        return { tabs, error: null };
      });
    };

    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, READING_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { status } });
      if (!queued.ok) { set({ error: 'Çevrimdışı okuma durumu güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      const cur = findExisting();
      if (cur) moveLocally({ ...cur, status, updated_at: new Date().toISOString() });
      return true;
    }

    const res = await updateReadingStatus(id, status);
    if (res.ok) {
      moveLocally(res.data);
      await get().refreshCounts();
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { status } });
      if (queued.ok) {
        const cur = findExisting();
        if (cur) moveLocally({ ...cur, status, updated_at: new Date().toISOString() });
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  updateRating: async (id, rating) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, READING_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { rating } });
      if (!queued.ok) { set({ error: 'Çevrimdışı puan güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ tabs: patchInTabs(s.tabs, id, { rating }), error: null }));
      return true;
    }

    const res = await updateReadingRating(id, rating);
    if (res.ok) {
      set((s) => ({ tabs: replaceInTabs(s.tabs, res.data), error: null }));
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { rating } });
      if (queued.ok) {
        set((s) => ({ tabs: patchInTabs(s.tabs, id, { rating }), error: null }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  updateNotes: async (id, notes) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, READING_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { notes } });
      if (!queued.ok) { set({ error: 'Çevrimdışı not güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ tabs: patchInTabs(s.tabs, id, { notes }), error: null }));
      return true;
    }

    const res = await updateReadingNotes(id, notes);
    if (res.ok) {
      set((s) => ({ tabs: replaceInTabs(s.tabs, res.data), error: null }));
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'update', payload: { notes } });
      if (queued.ok) {
        set((s) => ({ tabs: patchInTabs(s.tabs, id, { notes }), error: null }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  removeItem: async (id) => {
    const removeFromTabs = () => {
      set((s) => {
        const tabs = { ...s.tabs };
        for (const st of STATUSES) {
          tabs[st] = { ...tabs[st], items: tabs[st].items.filter((i) => i.id !== id) };
        }
        return { tabs, error: null };
      });
    };

    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, READING_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'delete' });
      if (!queued.ok) { set({ error: 'Çevrimdışı okuma öğesi silinemedi.' }); return false; }
      void coreOutbox.flush();
      removeFromTabs();
      return true;
    }

    const res = await deleteReadingItem(id);
    if (res.ok) {
      removeFromTabs();
      await get().refreshCounts();
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: READING_ENTITY, entityId: id, kind: 'delete' });
      if (queued.ok) {
        removeFromTabs();
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  byStatus: (status) => get().tabs[status].items,
}));

function replaceInTabs(
  tabs: Record<ReadingStatus, TabState>,
  row: ReadingItem,
): Record<ReadingStatus, TabState> {
  const next = { ...tabs };
  for (const st of STATUSES) {
    next[st] = { ...next[st], items: next[st].items.map((i) => (i.id === row.id ? row : i)) };
  }
  return next;
}

function patchInTabs(
  tabs: Record<ReadingStatus, TabState>,
  id: string,
  patch: Partial<ReadingItem>,
): Record<ReadingStatus, TabState> {
  const next = { ...tabs };
  for (const st of STATUSES) {
    next[st] = {
      ...next[st],
      items: next[st].items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    };
  }
  return next;
}

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'readingList', store: useReadingListStore });
