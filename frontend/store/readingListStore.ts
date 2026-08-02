import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type ReadingType = 'book' | 'article' | 'video' | 'podcast' | 'other';
export type ReadingStatus = 'want_to_read' | 'reading' | 'completed';

export type ReadingItem = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  type: ReadingType;
  status: ReadingStatus;
  url: string | null;
  notes: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
};

type ReadingListStore = {
  items: ReadingItem[];
  loading: boolean;
  fetchItems: () => Promise<void>;
  addItem: (data: { title: string; author?: string; type: ReadingType; url?: string }) => Promise<void>;
  updateStatus: (id: string, status: ReadingStatus) => Promise<void>;
  updateRating: (id: string, rating: number) => Promise<void>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  byStatus: (status: ReadingStatus) => ReadingItem[];
};

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  items: [],
  loading: false,

  fetchItems: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }
    const { data } = await supabase
      .from('reading_list')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) set({ items: data as ReadingItem[] });
    set({ loading: false });
  },

  addItem: async ({ title, author, type, url }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !title.trim()) return;
    const { data } = await supabase
      .from('reading_list')
      .insert({ user_id: user.id, title: title.trim(), author: author?.trim() || null, type, url: url?.trim() || null })
      .select()
      .single();
    if (data) set((s) => ({ items: [data as ReadingItem, ...s.items] }));
  },

  updateStatus: async (id, status) => {
    await supabase.from('reading_list').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, status } : i) }));
  },

  updateRating: async (id, rating) => {
    await supabase.from('reading_list').update({ rating, updated_at: new Date().toISOString() }).eq('id', id);
    set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, rating } : i) }));
  },

  updateNotes: async (id, notes) => {
    await supabase.from('reading_list').update({ notes, updated_at: new Date().toISOString() }).eq('id', id);
    set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, notes } : i) }));
  },

  removeItem: async (id) => {
    await supabase.from('reading_list').delete().eq('id', id);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },

  byStatus: (status) => get().items.filter((i) => i.status === status),
}));
