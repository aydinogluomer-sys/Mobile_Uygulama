import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import type { OutboxCommand } from '../lib/outbox';
import { coreOutbox } from '../services/coreOutbox';
import {
  listJournalEntries as fetchJournalEntries,
  getJournalEntry as fetchJournalEntry,
  saveJournalEntry,
  pendingJournalCommands,
  resolveJournalConflict,
  JOURNAL_ENTITY,
  type JournalEntryRow,
  type ConflictChoice,
} from '../services/journalService';

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
  /** R07.01 — the outcome, so a failed save is never shown as saved. */
  saveEntry: (date: string, content: string, mood: number | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  appendEntry: (date: string, text: string) => Promise<void>;
  getByDate: (date: string) => JournalEntry | undefined;
  /** R02.05 — days whose edit met a newer text elsewhere; both are kept until resolved. */
  conflicts: () => OutboxCommand[];
  resolveConflict: (date: string, choice: ConflictChoice) => Promise<boolean>;
};

/**
 * R02.03 — the server text of each day as last seen: the base of the next
 * edit, so a change made elsewhere meanwhile is a conflict, not an overwrite.
 */
const serverContent = new Map<string, string>();
coreOutbox.onApplied((cmd) => {
  if (cmd.entity === JOURNAL_ENTITY) serverContent.set(cmd.entityId, String((cmd.payload as { content?: string }).content ?? ''));
});

/** The day as this device now holds it (delivered or not). */
function localRow(entries: JournalEntry[], date: string, content: string, mood: number | null, aiSummary?: boolean): JournalEntry {
  const cur = entries.find((e) => e.date === date);
  return {
    ...(cur ?? { id: `local:${date}`, user_id: '', date, ai_summary: null, created_at: new Date().toISOString() }),
    content, mood, ...(aiSummary !== undefined ? { ai_summary: aiSummary } : {}),
  } as JournalEntry;
}

/** Server rows with the unsent changes of this device laid over them (by day). */
function withPending(rows: JournalEntry[]): JournalEntry[] {
  let out = rows;
  for (const c of pendingJournalCommands()) {
    const p = c.payload as { content?: string; mood?: number | null; ai_summary?: boolean };
    const cur = out.find((e) => e.date === c.entityId);
    const row = {
      ...(cur ?? { id: `local:${c.entityId}`, user_id: c.userId, date: c.entityId, ai_summary: null, created_at: new Date(c.createdAt).toISOString() }),
      content: p.content ?? cur?.content ?? '',
      mood: p.mood !== undefined ? p.mood : (cur?.mood ?? null),
      ...(p.ai_summary !== undefined ? { ai_summary: p.ai_summary } : {}),
    } as JournalEntry;
    out = mergeEntry(out, row).entries;
  }
  return out;
}

export const useJournalStore = create<JournalStore>((set, get) => ({
  entries: [],
  loading: false,

  fetchEntries: async () => {
    set({ loading: true });
    await coreOutbox.ensure();
    const res = await fetchJournalEntries();
    if (!res.ok) { set((s) => ({ loading: false, entries: withPending(s.entries) })); return; }
    for (const e of res.data) serverContent.set(e.date, e.content ?? '');
    set({ entries: withPending(res.data), loading: false });
  },

  saveEntry: async (date, content, mood) => {
    // R02.03 — kept on the device first; delivered now if the network allows.
    const res = await saveJournalEntry({ date, content, mood, baseContent: serverContent.get(date) ?? null });
    if (!res.ok) return { ok: false, error: res.error };
    set((s) => ({ entries: withPending(mergeEntry(s.entries, localRow(s.entries, date, content, mood)).entries) }));
    if (!res.savedOnDevice) return { ok: false, error: 'Cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.' };
    return { ok: true };
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
    // Offline: append to what this device holds for the day (its unsent text
    // included) rather than dropping the note.
    const local = get().entries.find((e) => e.date === date);
    const base = existing.ok ? existing.data : null;
    if (existing.ok) serverContent.set(date, base?.content ?? '');
    const prevRow = existing.ok ? (pendingJournalCommands().some((c) => c.entityId === date) ? local : base) : local;

    const prev = prevRow?.content?.trim() ?? '';
    const merged = prev ? `${prev}

${trimmed}` : trimmed;

    const res = await saveJournalEntry({
      date, content: merged, mood: prevRow?.mood ?? null, aiSummary: true, baseContent: serverContent.get(date) ?? null,
    });
    if (!res.ok) return;
    set((s) => ({ entries: withPending(mergeEntry(s.entries, localRow(s.entries, date, merged, prevRow?.mood ?? null, true)).entries) }));
  },

  getByDate: (date) => get().entries.find((e) => e.date === date),

  conflicts: () => pendingJournalCommands().filter((c) => c.status === 'conflict'),

  resolveConflict: async (date, choice) => {
    const r = await resolveJournalConflict(date, choice);
    if (!r.ok) return false;
    await get().fetchEntries();
    return true;
  },
}));

/** Replaces the entry for a date, or prepends it when it is new. */
function mergeEntry(entries: JournalEntry[], row: JournalEntryRow): { entries: JournalEntry[] } {
  const idx = entries.findIndex((e) => e.date === row.date);
  if (idx < 0) return { entries: [row as JournalEntry, ...entries] };
  const next = [...entries];
  next[idx] = row as JournalEntry;
  return { entries: next };
}

// F04 (STO-20): the store and the server copies its conflict check compares against belong to the account.
registerAccountScoped({ name: 'journal', store: useJournalStore, onReset: () => serverContent.clear() });
