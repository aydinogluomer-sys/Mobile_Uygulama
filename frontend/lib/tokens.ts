/**
 * Atlas Tasarım Token'ları — "Paper/Clay Editorial" dil sistemi (warm dark & warm paper light).
 * İlham: POS v2 Atlas Design Language. Tek clay accent, sıcak yüzeyler,
 * serif editöryel başlıklar, mono tabular sayılar, eyebrow etiketleri, keskin küçük radii.
 * Hardcoded hex yerine bunları kullan.
 */
import { Platform } from 'react-native';

// hex'e alpha eklemek için: hexA('#D97757', 0.14) → 'rgba(217,119,87,0.14)'
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** R06.04 — WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** R06.04 — WCAG contrast ratio between two #RRGGBB colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * R06.04 — the text colour for a FILLED background: white when it reaches
 * 4.5:1 there, otherwise the app's dark ink. (White on the clay accent is
 * only 3.1:1; the dark ink is 5.9:1.) Works for every accent theme.
 */
export function onColor(bgHex: string): string {
  return contrastRatio('#ffffff', bgHex) >= 4.5 ? '#ffffff' : '#15140F';
}

export const colors = {
  // Katmanlı sıcak yüzeyler (warm near-black, asla mavi)
  bg: '#15140F',
  bgElevated: '#1D1C17',
  surface: '#1D1C17',
  surfaceAlt: '#28261F',
  surfaceHover: '#322F26',
  bgSunk: '#100F0B',

  // Kıl-payı kenarlıklar (borderStrong: bg ve surface üstünde >= 3.0:1)
  border: '#383528',
  borderSubtle: '#28261F',
  borderStrong: '#69675C',

  // Sıcak ink metin
  text: '#EDEAE0',
  textDim: '#BFBBAE',
  // F25 (DSA-05): bg, surface, surfaceAlt ve surfaceHover dahil tüm koyu yüzeylerde >= 4.57:1 AA.
  textFaint: '#9A978C',
  // Yalnız metin-dışı (simge, ayraç, devre dışı kenar); bg/surface/surfaceAlt üstünde >= 3.08:1.
  textGhost: '#737165',

  // Marka — tek clay accent (cerrahi kullanım)
  primary: '#D97757',
  primaryBright: '#E08866',
  primaryDeep: '#B85C38',
  accent: '#D97757',
  primarySoft: 'rgba(217,119,87,0.14)',

  // Semantik — desatüre, editöryel
  success: '#87A678', // moss
  warning: '#D4A84A', // amber
  error: '#C76A6A',   // rust
  info: '#7C97C5',    // slate
  teal: '#7C97C5',    // alias → slate (Yapıldı/Tamamlanan'ı success'ten ayrı tutar)

  white: '#ffffff',
  black: '#000000',

  // ── Legacy neutrals ────────────────────────────────────────────────────
  //
  // ÇÖZÜLDÜ: eski rampalar yalnız geriye uyum içindir; yeni kod kullanamaz
  // (`LEGACY_TOKEN_KEYS`, `designTokensRatchet.test.ts`). Bkz. `docs/DESIGN_TOKENS.md`.
  neutral200: '#e5e7eb',
  neutral300: '#d1d5db',
  neutral400: '#9ca3af',
  neutral500: '#6b7280',

  coolBlack950: '#0a0a0a',
  coolBlack900: '#0f0f0f',
  coolBlack850: '#111111',
  coolBlack800: '#1a1a1a',
  coolBlack750: '#1f1f1f',
  coolBlack700: '#2a2a2a',
  coolBlack600: '#3a3a3a',

  // ── Journal "paper" surfaces ───────────────────────────────────────────
  //
  // The journal, its archive and its reader deliberately look like paper
  // rather than like the rest of the app: a warmer card, a gold hairline, a
  // softer body ink. That is a real sub-palette used across three screens,
  // not drift, so it is named by the role each colour plays there.
  paperSurface: '#211c18',
  paperBorder: '#3a3026',
  paperLabel: '#a88e6a',
  paperText: '#e3ddd0',
  paperTextDim: '#cfc9bc',

  // ── Selected-state tints ───────────────────────────────────────────────
  //
  // The background a card takes when it is chosen, in three flavours matching
  // the border it is paired with (`colors.accent`, `colors.error`, and the
  // capacity screens' green). Named because "the selected background" is a
  // role; the hexes themselves say nothing.
  selectedTint: '#1a1f2e',
  selectedTintError: '#1f1515',
  selectedTintSuccess: '#1f3d33',

  /** Warm amber hint text on the focus screen. */
  amberSoft: '#e0a458',
} as const;

export type ThemeMode = 'dark' | 'light';
export type Palette = { -readonly [K in keyof typeof colors]: string };

const lightPalette: Palette = {
  bg: '#F7F3EA',
  bgElevated: '#FBF9F3',
  surface: '#FBF9F3',
  surfaceAlt: '#EFE9DB',
  surfaceHover: '#E6DFCE',
  bgSunk: '#EDE6D6',
  border: '#D8CFBB',
  borderSubtle: '#E6DFCE',
  borderStrong: '#988B6D',
  text: '#1C1A14',
  textDim: '#4B473C',
  textFaint: '#625D50',
  textGhost: '#7F796A',
  primary: '#A44425',
  primaryBright: '#8F3A1F',
  primaryDeep: '#7F341D',
  accent: '#A44425',
  primarySoft: 'rgba(164,68,37,0.12)',
  success: '#516945',
  warning: '#7B5D1D',
  error: '#A93F3F',
  info: '#436298',
  teal: '#436298',
  white: '#ffffff',
  black: '#000000',
  neutral200: '#2F333A',
  neutral300: '#3F444D',
  neutral400: '#4B5563',
  neutral500: '#5B616D',
  coolBlack950: '#EDE6D6',
  coolBlack900: '#F2EDE0',
  coolBlack850: '#F5F0E4',
  coolBlack800: '#EFE9DB',
  coolBlack750: '#EAE3D3',
  coolBlack700: '#E0D8C5',
  coolBlack600: '#D3CAB5',
  paperSurface: '#FFFCF5',
  paperBorder: '#E2D8C3',
  paperLabel: '#7A5E2E',
  paperText: '#2A241C',
  paperTextDim: '#4D463A',
  selectedTint: '#E6ECF8',
  selectedTintError: '#F8E6E6',
  selectedTintSuccess: '#E3F1E9',
  amberSoft: '#875812',
};

export const palettes: Record<ThemeMode, Palette> = {
  dark: colors,
  light: lightPalette,
};

export function paletteFor(mode: ThemeMode): Palette {
  return palettes[mode];
}

export function resolveThemeMode(isDark: boolean, lightEnabled: boolean): ThemeMode {
  return lightEnabled && !isDark ? 'light' : 'dark';
}

export const LEGACY_TOKEN_KEYS: readonly string[] = [
  'neutral200',
  'neutral300',
  'neutral400',
  'neutral500',
  'coolBlack950',
  'coolBlack900',
  'coolBlack850',
  'coolBlack800',
  'coolBlack750',
  'coolBlack700',
  'coolBlack600',
];

/**
 * A token colour at an 8-bit alpha, written the way the literal was.
 *
 * `alphaHex(colors.accent, '20')` is EXACTLY `'#D9775720'` — the same bytes
 * React Native was already given. `hexA` above is not a substitute: it emits
 * `rgba(217, 119, 87, 0.125)`, a different string and a slightly different
 * value, so swapping the ~90 `#RRGGBBAA` literals for it would have been a
 * silent restyle rather than a rename.
 *
 * `aa` stays a two-character hex string for the same reason: it is what was
 * written, and converting to a 0–1 opacity would round.
 */
export function alphaHex(hex: string, aa: string): string {
  return `${hex}${aa}`;
}

// Aksan renk temaları (Atlas: clay varsayılan + moss/slate/amber) — runtime seçilebilir.
// Mimari not: yalnız render-anında okunan yüzeyler (primary Button, tab bar, Today hero)
// useAccent() ile bunu izler; StyleSheet'e gömülü tonlar varsayılan clay'de kalır.
export type AccentKey = 'clay' | 'moss' | 'slate' | 'amber';

export type AccentTheme = {
  key: AccentKey;
  label: string;
  primary: string;
  bright: string;
  deep: string;
  soft: string;
};

export const ACCENTS: Record<AccentKey, AccentTheme> = {
  clay:  { key: 'clay',  label: 'Clay',  primary: '#D97757', bright: '#E08866', deep: '#B85C38', soft: 'rgba(217,119,87,0.14)' },
  moss:  { key: 'moss',  label: 'Moss',  primary: '#87A678', bright: '#98B589', deep: '#3F6B4A', soft: 'rgba(135,166,120,0.14)' },
  slate: { key: 'slate', label: 'Slate', primary: '#7C97C5', bright: '#8FA9D2', deep: '#3B5BA5', soft: 'rgba(124,151,197,0.14)' },
  amber: { key: 'amber', label: 'Amber', primary: '#D4A84A', bright: '#DEB661', deep: '#B8842A', soft: 'rgba(212,168,74,0.14)' },
};

export const ACCENTS_LIGHT: Record<AccentKey, AccentTheme> = {
  clay:  { key: 'clay',  label: 'Clay',  primary: '#A44425', bright: '#8F3A1F', deep: '#7F341D', soft: 'rgba(164,68,37,0.12)' },
  moss:  { key: 'moss',  label: 'Moss',  primary: '#516945', bright: '#445A3A', deep: '#3E5035', soft: 'rgba(81,105,69,0.12)' },
  slate: { key: 'slate', label: 'Slate', primary: '#436298', bright: '#385287', deep: '#334B75', soft: 'rgba(67,98,152,0.12)' },
  amber: { key: 'amber', label: 'Amber', primary: '#7B5D1D', bright: '#6B5018', deep: '#5F4816', soft: 'rgba(123,93,29,0.12)' },
};

export function accentsFor(mode: ThemeMode): Record<AccentKey, AccentTheme> {
  return mode === 'light' ? ACCENTS_LIGHT : ACCENTS;
}

export const DEFAULT_ACCENT: AccentKey = 'clay';

// Alışkanlık kategorik renk paleti (F31 — Thefor F-7): koyu ve açık yüzeylerde >= 3.05:1 kontrast.
export type HabitHue = {
  readonly key: string;
  readonly label: string;
  readonly hex: string;
};

export const habitHues: readonly HabitHue[] = [
  { key: 'mercan', label: 'Mercan', hex: '#d46e5e' },
  { key: 'kehribar', label: 'Kehribar', hex: '#bd7c32' },
  { key: 'hardal', label: 'Hardal', hex: '#a1892b' },
  { key: 'zeytin', label: 'Zeytin', hex: '#749528' },
  { key: 'yosun', label: 'Yosun', hex: '#2a9d50' },
  { key: 'nane', label: 'Nane', hex: '#2a9d86' },
  { key: 'gökyüzü', label: 'Gökyüzü', hex: '#3195b9' },
  { key: 'mavi', label: 'Mavi', hex: '#628cd5' },
  { key: 'indigo', label: 'İndigo', hex: '#8282de' },
  { key: 'mor', label: 'Mor', hex: '#a576db' },
  { key: 'orkide', label: 'Orkide', hex: '#d35acf' },
  { key: 'gül', label: 'Gül', hex: '#d6668f' },
] as const;

// Gradient çiftleri (LinearGradient yoksa ilk renk solid kullanılır)
export const gradients = {
  primary: ['#D97757', '#B85C38'] as const,
  success: ['#87A678', '#3F6B4A'] as const,
  warm: ['#D4A84A', '#B85C38'] as const,
  ocean: ['#7C97C5', '#3B5BA5'] as const,
};

// 4pt boşluk ölçeği
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  h: 32,
  hh: 40,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
  full: 999,
} as const;

// Font aileleri — offline: platform serif/mono ile Instrument Serif/Geist Mono'yu yaklaşıkla
export const fontFamily = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace' }) as string,
};

// Tipografi ölçeği — serif editöryel başlıklar + sans gövde + mono metrik
export const font = {
  // Editöryel serif başlıklar (weight 400 — serif en iyi düzenli ağırlıkta durur)
  display: { fontFamily: fontFamily.serif, fontSize: 32, fontWeight: '400' as const, letterSpacing: -0.5 },
  title: { fontFamily: fontFamily.serif, fontSize: 24, fontWeight: '400' as const, letterSpacing: -0.3 },
  // Sans alt başlıklar
  h2: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodySm: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  // Eyebrow — küçük, uppercase, sıkı tracking
  overline: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  // Metrik — mono, tabular
  metric: { fontFamily: fontFamily.mono, fontSize: 26, fontWeight: '500' as const, letterSpacing: -0.5, fontVariant: ['tabular-nums'] as any },
};

export const tabularNums = { fontFamily: fontFamily.mono, fontVariant: ['tabular-nums'] as any };

// Gölge/glow — "barely there", sıcak
export const shadow = {
  sm: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.30, shadowRadius: 3, elevation: 2,
  },
  md: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 12, elevation: 6,
  },
  lg: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.38, shadowRadius: 22, elevation: 14,
  },
  // Clay glow (CTA) — yumuşak
  glow: (color: string = colors.primary) => ({
    shadowColor: color, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  }),
};

export type ThemeColors = typeof colors;
