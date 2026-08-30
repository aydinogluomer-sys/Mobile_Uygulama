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
import type { Cursor } from '../repositories/shared';

export type { ReadingStatus, ReadingType };
export type ReadingItem = ReadingItemRow;

const STATUSES: ReadingStatus[] = ['want_to_read', 'reading', 'completed'];

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
    const res = await fetchReadingCounts();
    if (res.ok) set({ counts: res.data });
  },

  fetchItems: async (status) => {
    set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loading: true } }, error: null }));
    const res = await fetchReadingListPage(null, undefined, { status });
    if (!res.ok) {
      set((s) => ({ tabs: { ...s.tabs, [status]: { ...s.tabs[status], loading: false } }, error: res.error }));
      return;
    }
    set((s) => ({
      tabs: {
        ...s.tabs,
        [status]: {
          items: res.data.rows, cursor: res.data.nextCursor, hasMore: res.data.hasMore,
          loading: false, loadingMore: false,
        },
      },
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
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
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
  },

  updateStatus: async (id, status) => {
    const res = await updateReadingStatus(id, status);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    // The row moves between tabs, so it is removed from every tab and
    // re-inserted into its new one — leaving it in place would show the same
    // item under two statuses at once.
    set((s) => {
      const tabs = { ...s.tabs };
      for (const st of STATUSES) {
        tabs[st] = { ...tabs[st], items: tabs[st].items.filter((i) => i.id !== id) };
      }
      tabs[status] = { ...tabs[status], items: [res.data, ...tabs[status].items] };
      return { tabs, error: null };
    });
    await get().refreshCounts();
    return true;
  },

  updateRating: async (id, rating) => {
    const res = await updateReadingRating(id, rating);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({ tabs: replaceInTabs(s.tabs, res.data), error: null }));
    return true;
  },

  updateNotes: async (id, notes) => {
    const res = await updateReadingNotes(id, notes);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({ tabs: replaceInTabs(s.tabs, res.data), error: null }));
    return true;
  },

  removeItem: async (id) => {
    const res = await deleteReadingItem(id);
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => {
      const tabs = { ...s.tabs };
      for (const st of STATUSES) {
        tabs[st] = { ...tabs[st], items: tabs[st].items.filter((i) => i.id !== id) };
      }
      return { tabs, error: null };
    });
    await get().refreshCounts();
    return true;
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
