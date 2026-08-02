import { useThemeStore } from '../store/themeStore';
import { ACCENTS, type AccentTheme } from './tokens';

/** Geçerli aksan temasını döndürür (themeStore.accent → ACCENTS). Render-anında okunur. */
export function useAccent(): AccentTheme {
  const accent = useThemeStore((s) => s.accent);
  return ACCENTS[accent];
}
