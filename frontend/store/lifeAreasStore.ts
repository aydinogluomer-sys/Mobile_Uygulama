import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { todayLocal } from '../lib/date';

export const LIFE_AREAS = [
  { key: 'saglik', label: 'Sağlık', color: '#10b981' },
  { key: 'kariyer', label: 'Kariyer', color: '#6366f1' },
  { key: 'egitim', label: 'Eğitim', color: '#f59e0b' },
  { key: 'finans', label: 'Finans', color: '#06b6d4' },
  { key: 'aile', label: 'Aile', color: '#ec4899' },
  { key: 'sosyal', label: 'Sosyal', color: '#8b5cf6' },
  { key: 'ruhsal', label: 'Ruhsal', color: '#84cc16' },
  { key: 'hobiler', label: 'Hobiler', color: '#f97316' },
] as const;

export type AreaKey = typeof LIFE_AREAS[number]['key'];

export type AreaValues = Record<AreaKey, number>;

const DEFAULT_VALUES: AreaValues = {
  saglik: 5, kariyer: 5, egitim: 5, finans: 5,
  aile: 5, sosyal: 5, ruhsal: 5, hobiler: 5,
};

type LifeAreasStore = {
  values: AreaValues;
  lastSavedDate: string | null;
  loading: boolean;
  saving: boolean;
  loadLatest: () => Promise<void>;
  setValue: (area: AreaKey, value: number) => void;
  save: () => Promise<void>;
};

export const useLifeAreasStore = create<LifeAreasStore>((set, get) => ({
  values: { ...DEFAULT_VALUES },
  lastSavedDate: null,
  loading: false,
  saving: false,

  loadLatest: async () => {
    set({ loading: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }

    const { data } = await supabase
      .from('life_area_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(8);

    if (data && data.length > 0) {
      const latestDate = data[0].date as string;
      const dayRows = data.filter((r: any) => r.date === latestDate);
      const vals: Partial<AreaValues> = {};
      for (const row of dayRows) {
        vals[row.area as AreaKey] = row.value;
      }
      set({ values: { ...DEFAULT_VALUES, ...vals }, lastSavedDate: latestDate });
    }
    set({ loading: false });
  },

  setValue: (area, value) => {
    set((s) => ({ values: { ...s.values, [area]: value } }));
  },

  save: async () => {
    set({ saving: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ saving: false }); return; }
    const today = todayLocal();
    const { values } = get();

    const rows = LIFE_AREAS.map((a) => ({
      user_id: user.id,
      date: today,
      area: a.key,
      value: values[a.key],
    }));

    await supabase
      .from('life_area_logs')
      .upsert(rows, { onConflict: 'user_id,date,area' });

    set({ lastSavedDate: today, saving: false });
  },
}));
