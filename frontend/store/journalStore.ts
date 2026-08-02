import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type JournalEntry = {
  id: string;
  user_id: string;
  date: string;
  content: string;
  mood: number | null;
  ai_summary: boolean;
  created_at: string;
};

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ loading: false });
      return;
    }
    const { data } = await supabase
      .from('journal_entries')
      .select('*')
      .order('date', { ascending: false })
      .limit(365);
    if (data) set({ entries: data as JournalEntry[] });
    set({ loading: false });
  },

  saveEntry: async (date, content, mood) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('journal_entries')
      .upsert({ user_id: user.id, date, content, mood }, { onConflict: 'user_id,date' })
      .select()
      .single();
    if (data) {
      set((s) => {
        const existing = s.entries.findIndex((e) => e.date === date);
        if (existing >= 0) {
          const updated = [...s.entries];
          updated[existing] = data as JournalEntry;
          return { entries: updated };
        }
        return { entries: [data as JournalEntry, ...s.entries] };
      });
    }
  },

  // Var olan günlük kaydının altına metin ekler (üzerine yazmaz).
  // AI Coach gibi journal'ı henüz çekmemiş ekranlardan da güvenli çağrılabilsin
  // diye mevcut içeriği doğrudan DB'den okur.
  appendEntry: async (date, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existing } = await supabase
      .from('journal_entries')
      .select('content, mood')
      .eq('user_id', user.id)
      .eq('date', date)
      .maybeSingle();

    const prev = existing?.content?.trim() ?? '';
    const merged = prev ? `${prev}\n\n${trimmed}` : trimmed;

    const { data } = await supabase
      .from('journal_entries')
      .upsert(
        { user_id: user.id, date, content: merged, mood: existing?.mood ?? null, ai_summary: true },
        { onConflict: 'user_id,date' }
      )
      .select()
      .single();

    if (data) {
      set((s) => {
        const idx = s.entries.findIndex((e) => e.date === date);
        if (idx >= 0) {
          const updated = [...s.entries];
          updated[idx] = data as JournalEntry;
          return { entries: updated };
        }
        return { entries: [data as JournalEntry, ...s.entries] };
      });
    }
  },

  getByDate: (date) => get().entries.find((e) => e.date === date),
}));
