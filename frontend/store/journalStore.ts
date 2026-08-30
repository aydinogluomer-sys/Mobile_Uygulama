import { create } from 'zustand';
import {
  fetchJournalEntries,
  fetchJournalEntry,
  upsertJournalEntry,
  type JournalEntryRow,
} from '../repositories/journalRepository';

/**
 * Re-exported from the repository so there is one definition of the row.
 * The local copy typed `ai_summary` as a plain boolean, which the column is
 * not — it is nullable, and an entry saved without an AI summary has null.
 */
export type JournalEntry = JournalEntryRow;

type JournalStore = {
  entries: JournalEntry[];
  loading: boolean;
  fetchEntries: () => Promise<void>;
  saveEntry: (date: string, content: string, mood: number | null) => Promise<void>;
  appendEntry: (date: string, text: string) => Promise<void>;
  getByDate: (date: string) => JournalEntry | undefined;
};

export const useJournalStore = create<JournalStore>((set, get) => ({
  entries: [],
  loading: false,

  fetchEntries: async () => {
    set({ loading: true });
    const res = await fetchJournalEntries();
    if (!res.ok) { set({ loading: false }); return; }
    set({ entries: res.data, loading: false });
  },

  saveEntry: async (date, content, mood) => {
    const res = await upsertJournalEntry({ date, content, mood });
    if (!res.ok) return;
    set((s) => mergeEntry(s.entries, res.data));
  },

  // Var olan günlük kaydının altına metin ekler (üzerine yazmaz).
  // AI Coach gibi journal'ı henüz çekmemiş ekranlardan da güvenli çağrılabilsin
  // diye mevcut içeriği doğrudan DB'den okur.
  appendEntry: async (date, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Reads the CURRENT entry from the database rather than from local state:
    // this is called from screens (AI Coach) that never fetched the journal,
    // and appending to a stale local copy would drop whatever was written in
    // between.
    const existing = await fetchJournalEntry(date);
    if (!existing.ok) return;

    const prev = existing.data?.content?.trim() ?? '';
    const merged = prev ? `${prev}

${trimmed}` : trimmed;

    const res = await upsertJournalEntry({
      date, content: merged, mood: existing.data?.mood ?? null, aiSummary: true,
    });
    if (!res.ok) return;
    set((s) => mergeEntry(s.entries, res.data));
  },

  getByDate: (date) => get().entries.find((e) => e.date === date),
}));

/** Replaces the entry for a date, or prepends it when it is new. */
function mergeEntry(entries: JournalEntry[], row: JournalEntryRow): { entries: JournalEntry[] } {
  const idx = entries.findIndex((e) => e.date === row.date);
  if (idx < 0) return { entries: [row as JournalEntry, ...entries] };
  const next = [...entries];
  next[idx] = row as JournalEntry;
  return { entries: next };
}
