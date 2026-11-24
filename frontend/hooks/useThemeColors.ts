import { useMemo } from 'react';
import { LIGHT_THEME_ENABLED } from '../lib/featureGates';
import { paletteFor, resolveThemeMode, type Palette, type ThemeMode } from '../lib/tokens';
import { useThemeStore } from '../store/themeStore';

/** Kapı kapalıyken her zaman 'dark'. */
export function useThemeMode(): ThemeMode {
  const isDark = useThemeStore((s) => s.isDark);
  return resolveThemeMode(isDark, LIGHT_THEME_ENABLED);
}

export function useThemeColors(): Palette {
  const mode = useThemeMode();
  return paletteFor(mode);
}

/** factory modül kapsamında SABİT bir işlev olmalıdır (useMemo bağımlılığı). */
export function useThemedStyles<T>(factory: (c: Palette) => T): T {
  const c = useThemeColors();
  return useMemo(() => factory(c), [c, factory]);
}
