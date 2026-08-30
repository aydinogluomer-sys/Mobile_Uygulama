import { create } from 'zustand';
import {
  fetchRecentLifeAreaLogs,
  upsertLifeAreaLogs,
} from '../repositories/lifeAreaRepository';
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
    const res = await fetchRecentLifeAreaLogs();
    if (res.ok && res.data.length > 0) {
      const latestDate = res.data[0].date;
      const vals: Partial<AreaValues> = {};
      for (const row of res.data.filter((r) => r.date === latestDate)) {
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
    const today = todayLocal();
    const { values } = get();
    const payload = Object.fromEntries(LIFE_AREAS.map((a) => [a.key, values[a.key]]));

    const res = await upsertLifeAreaLogs(today, payload);
    // A failed save no longer records a `lastSavedDate`, which is what the
    // UI reads to tell the user their check-in was stored.
    if (!res.ok) { set({ saving: false }); return; }

    set({ lastSavedDate: today, saving: false });
  },
}));
