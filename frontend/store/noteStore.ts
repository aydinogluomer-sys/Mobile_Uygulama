import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type Note = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type NoteStore = {
  notes: Note[];
  loading: boolean;
  fetchNotes: () => Promise<void>;
  addNote: (title: string, content: string) => Promise<Note | null>;
  updateNote: (id: string, patch: { title?: string; content?: string; tags?: string[] }) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  search: (q: string) => Note[];
};

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  loading: false,

  fetchNotes: async () => {
    set({ loading: true });
    const { data } = await supabase
      .from('notes')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) set({ notes: data as Note[] });
    set({ loading: false });
  },

  addNote: async (title, content) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('notes')
      .insert({ user_id: user.id, title, content, tags: [] })
      .select()
      .single();
    if (error || !data) return null;
    set((s) => ({ notes: [data as Note, ...s.notes] }));
    return data as Note;
  },

  updateNote: async (id, patch) => {
    await supabase.from('notes').update(patch).eq('id', id);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  },

  removeNote: async (id) => {
    await supabase.from('notes').delete().eq('id', id);
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },

  search: (q) => {
    const lq = q.toLowerCase();
    return get().notes.filter(
      (n) => n.title.toLowerCase().includes(lq) || n.content.toLowerCase().includes(lq)
    );
  },
}));
