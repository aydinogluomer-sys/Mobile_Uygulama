import { LIGHT_THEME_ENABLED } from './featureGates';
import { useThemeStore } from '../store/themeStore';
import { accentsFor, resolveThemeMode, type AccentTheme } from './tokens';

/** Geçerli aksan temasını döndürür (themeStore.accent → accentsFor). Render-anında okunur. */
export function useAccent(): AccentTheme {
  const accent = useThemeStore((s) => s.accent);
  const isDark = useThemeStore((s) => s.isDark);
  return accentsFor(resolveThemeMode(isDark, LIGHT_THEME_ENABLED))[accent];
}
