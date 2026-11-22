# Design Tokens — Palettes, Contrast, Legacy Retirement, and Light-Theme Gate

## 1. Single Source of Truth (`frontend/lib/tokens.ts`)

`frontend/lib/tokens.ts` is the **sole** palette definition in the repository (`frontend/lib/theme.ts` was deleted in F25). `designTokens.test.ts` enforces `PALETTES = new Set(['lib/tokens.ts'])` so no parallel colour dictionary can reappear.

Two complete semantic palettes live side by side in `lib/tokens.ts`:

- `palettes.dark` (`export const colors = ...`): warm near-black editorial palette (`bg: '#15140F'`, `surface: '#1D1C17'`, `text: '#EDEAE0'`, `primary: '#D97757'`).
- `palettes.light`: warm archival paper palette (`bg: '#F7F3EA'`, `surface: '#FBF9F3'`, `text: '#1C1A14'`, `primary: '#A44425'`).
- `ACCENTS` & `ACCENTS_LIGHT` (`accentsFor(mode)`): runtime-selectable `clay`, `moss`, `slate`, and `amber` accent themes tuned for both modes (`onColor(theme.primary)` reaches >= 4.5:1 across all eight combinations).

## 2. Release Gate (`LIGHT_THEME_ENABLED`)

To prevent shipping a half-migrated UI where the top bar and tab bar render in light mode while unmigrated screens stay dark, user-facing theme controls are gated behind `LIGHT_THEME_ENABLED` in `frontend/lib/featureGates.ts` (`false` in F25):

- While `LIGHT_THEME_ENABLED === false`:
  - `resolveThemeMode(isDark, LIGHT_THEME_ENABLED)` always resolves `'dark'`.
  - Placebo toggles in `app/tabs/settings.tsx` (`ThemeModeRow`) and `app/tabs/_layout.tsx` (`"Tema değiştir"`) are hidden, and `"AMOLED dostu"` copy is removed.
  - `themeStore` persists device preference under `app_theme_mode` (`'dark' | 'light'`), cleans up legacy `app_theme_dark`, and synchronises OS chrome via `Appearance.setColorScheme('dark')` and root `<StatusBar style={mode === 'dark' ? 'light' : 'dark'} />`.
- Opening condition (`frontend/__tests__/repo/lightThemeGate.test.ts`):
  - `LIGHT_THEME_ENABLED` may only flip to `true` in a dedicated owner-approved commit once every static `colors` importer under `app/` and `components/` has migrated to `useThemeColors()` or been explicitly allow-listed in `INTENTIONALLY_DARK`.

## 3. Dynamic Theme Migration Pattern

**Rule: no new or migrated screen/component may statically import `colors` from `lib/tokens.ts`.**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: c.surface, padding: space.md, borderColor: c.border, borderWidth: 1 },
  });

export default function ExampleCard() {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.box}>
      <Text style={{ color: c.text }}>Merhaba</Text>
    </View>
  );
}
```

- `makeStyles` must live at module scope so `useThemedStyles` memoizes `[c, factory]` across re-renders without recreating stylesheets unless `ThemeMode` changes.
- Surface text uses `c.text` / `c.textDim` / `c.textFaint` — never `c.white` (reserved for dark fills, or prefer `onColor(fillHex)`).
- Module-scope tone tables map to `keyof Palette` (e.g. `{ warn: 'warning' }`) and resolve `c[tone]` inside render.
- First-wave migrated files (29 files: all 23 `components/ui/*.tsx` primitives, `AtmosphericScreenCanvas.tsx`, `MorphingPillTabs.tsx`, `app/_layout.tsx`, `app/tabs/_layout.tsx`, `app/tabs/settings.tsx`, `app/tabs/today.tsx`) enforce zero static `colors` imports and zero raw hex literals.

## 4. WCAG 2.1 AA Contrast Policy (`contrastAA.test.ts`)

Every palette mode enforces measured WCAG 2.1 contrast ratios:

- **Body & secondary text (`text`, `textDim`, `textFaint`)**: `>= 4.5:1` on all four surfaces (`bg`, `surface`, `surfaceAlt`, `surfaceHover`). Dark `textFaint` is `#9A978C` (4.57:1 on `surfaceHover`).
- **Semantic status & brand (`primary`, `success`, `warning`, `error`, `info`)**: `>= 4.5:1` on `bg` and `>= 3.0:1` on elevated/hover card surfaces.
- **Non-text UI chrome (`textGhost`, `borderStrong`)**: `>= 3.0:1` on `bg`/`surface`. `textGhost` (`#737165` dark / `#7F796A` light) is strictly non-text (icons, dividers, disabled chrome) and **forbidden** as readable text or input placeholder (`contrastAA.test.ts` scans `app/` and `components/`).
- **Atmospheric canvas scrim**: `effectiveScrim(scrim, 'light')` clamps to `>= 0.90` so `textFaint` maintains `>= 4.5:1` even over dark photography.

## 5. Retirement of Legacy Ramps & Monotonic Ratchets

- `neutral600` has been deleted; `LEGACY_TOKEN_KEYS` (`neutral200..500`, `coolBlack950..600`) are frozen for backward compatibility only and bound to a monotonic downward ceiling in `designTokensRatchet.test.ts`.
- `components/ui/index.ts` exports UI primitives only; spatial (`AtmosphericScreenCanvas`, `EmbeddedFiligree`, `BentoVisualCard`, `ChapterDivider`) and motion (`StaggeredReveal`, `MorphingPillTabs`, `AnimatedMetricValue`, `GoldMendShimmer`) live exclusively under `components/spatial` and `components/motion`.
- `designTokensRatchet.test.ts` locks monotonic downward ceilings on static `colors` importers, quoted hex literals, `rgba(`, `fontSize` literals, spacing literals, border-radius literals, raw touchables (`TouchableOpacity`/`Pressable`/`TouchableWithoutFeedback`/`TouchableHighlight`), and `LEGACY_TOKEN_KEYS`.
