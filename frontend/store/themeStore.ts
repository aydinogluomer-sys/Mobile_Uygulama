import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dark, light, type Theme } from '../lib/theme';
import { type AccentKey, DEFAULT_ACCENT, ACCENTS } from '../lib/tokens';
import type { SeasonalMotionIntensity } from '../components/seasonalMotion/types';
import { DEFAULT_SEASONAL_MOTION_INTENSITY } from '../components/seasonalMotion/config';

const STORAGE_KEY = 'app_theme_dark';
const SEASONAL_KEY = 'app_seasonal_motion';
const ACCENT_KEY = 'app_accent';

type ThemeStore = {
  isDark: boolean;
  theme: Theme;
  // Takvim arka planı mevsimsel ambient hareket yoğunluğu (contract §5, §13)
  seasonalMotion: SeasonalMotionIntensity;
  // Aksan rengi (clay/moss/slate/amber) — render-anında okunan yüzeylere uygulanır
  accent: AccentKey;
  toggle: () => void;
  setSeasonalMotion: (v: SeasonalMotionIntensity) => void;
  setAccent: (a: AccentKey) => void;
  load: () => Promise<void>;
};

export const useThemeStore = create<ThemeStore>((set, get) => ({
  isDark: true,
  theme: dark,
  seasonalMotion: DEFAULT_SEASONAL_MOTION_INTENSITY,
  accent: DEFAULT_ACCENT,

  toggle: () => {
    const next = !get().isDark;
    set({ isDark: next, theme: next ? dark : light });
    AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0').catch(() => {});
  },

  setSeasonalMotion: (v) => {
    set({ seasonalMotion: v });
    AsyncStorage.setItem(SEASONAL_KEY, v).catch(() => {});
  },

  setAccent: (a) => {
    set({ accent: a });
    AsyncStorage.setItem(ACCENT_KEY, a).catch(() => {});
  },

  load: async () => {
    try {
      const [val, sm, ac] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(SEASONAL_KEY),
        AsyncStorage.getItem(ACCENT_KEY),
      ]);
      const isDark = val === null ? true : val === '1';
      const seasonalMotion = (sm === 'off' || sm === 'subtle' || sm === 'normal')
        ? sm
        : DEFAULT_SEASONAL_MOTION_INTENSITY;
      const accent: AccentKey = (ac && ac in ACCENTS) ? (ac as AccentKey) : DEFAULT_ACCENT;
      set({ isDark, theme: isDark ? dark : light, seasonalMotion, accent });
    } catch {
      // AsyncStorage hata verirse varsayılanlar (dark + subtle + clay)
    }
  },
}));
