import { Appearance } from 'react-native';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_THEME_ENABLED } from '../lib/featureGates';
import {
  ACCENTS,
  DEFAULT_ACCENT,
  resolveThemeMode,
  type AccentKey,
  type ThemeMode,
} from '../lib/tokens';
import type { SeasonalMotionIntensity } from '../components/seasonalMotion/types';
import { DEFAULT_SEASONAL_MOTION_INTENSITY } from '../components/seasonalMotion/config';

const MODE_KEY = 'app_theme_mode';
const LEGACY_DARK_KEY = 'app_theme_dark';
const SEASONAL_KEY = 'app_seasonal_motion';
const ACCENT_KEY = 'app_accent';

function isAccentKey(v: string | null): v is AccentKey {
  return v !== null && Object.prototype.hasOwnProperty.call(ACCENTS, v);
}

export function applyColorScheme(mode: ThemeMode): void {
  try {
    if (typeof Appearance?.setColorScheme === 'function') {
      Appearance.setColorScheme(mode);
    }
  } catch {
    // react-native-web veya desteklemeyen ortamlarda sessizce atla
  }
}

type ThemeStore = {
  isDark: boolean;
  // Takvim arka planı mevsimsel ambient hareket yoğunluğu (contract §5, §13)
  seasonalMotion: SeasonalMotionIntensity;
  // Aksan rengi (clay/moss/slate/amber) — render-anında okunan yüzeylere uygulanır
  accent: AccentKey;
  toggle: () => void;
  setDark: (v: boolean) => void;
  setSeasonalMotion: (v: SeasonalMotionIntensity) => void;
  setAccent: (a: AccentKey) => void;
  load: () => Promise<void>;
};

export const useThemeStore = create<ThemeStore>((set, get) => ({
  isDark: true,
  seasonalMotion: DEFAULT_SEASONAL_MOTION_INTENSITY,
  accent: DEFAULT_ACCENT,

  setDark: (next) => {
    set({ isDark: next });
    const mode: ThemeMode = next ? 'dark' : 'light';
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => {});
    applyColorScheme(resolveThemeMode(next, LIGHT_THEME_ENABLED));
  },

  toggle: () => {
    const next = !get().isDark;
    get().setDark(next);
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
      const [modeRaw, sm, ac] = await Promise.all([
        AsyncStorage.getItem(MODE_KEY),
        AsyncStorage.getItem(SEASONAL_KEY),
        AsyncStorage.getItem(ACCENT_KEY),
        AsyncStorage.removeItem(LEGACY_DARK_KEY).catch(() => {}),
      ]);
      const isDark = modeRaw === 'light' ? false : true;
      const seasonalMotion = (sm === 'off' || sm === 'subtle' || sm === 'normal')
        ? sm
        : DEFAULT_SEASONAL_MOTION_INTENSITY;
      const accent: AccentKey = isAccentKey(ac) ? ac : DEFAULT_ACCENT;
      set({ isDark, seasonalMotion, accent });
      applyColorScheme(resolveThemeMode(isDark, LIGHT_THEME_ENABLED));
    } catch {
      // AsyncStorage hata verirse varsayılanlar (dark + subtle + clay)
      applyColorScheme(resolveThemeMode(true, LIGHT_THEME_ENABLED));
    }
  },
}));
