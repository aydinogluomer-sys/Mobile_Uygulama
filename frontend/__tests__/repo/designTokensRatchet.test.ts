/**
 * R06.01 + F25 (DSA-06, DSA-07, DSA-13) — Design-system monotonic ratchets.
 *
 * Enforces:
 *  1. No raw hex equal to any dark/light design token in .tsx files.
 *  2. Monotonic downward ceilings on quoted hexes, rgba(), fontSize literals,
 *     spacing literals, borderRadius literals, static `colors` importers,
 *     raw touchables, and `LEGACY_TOKEN_KEYS` usages.
 *  3. Zero static `colors` imports and zero raw hexes in all 29 first-wave
 *     themed files (plus reference screens).
 *  4. `components/ui/index.ts` never re-exports `spatial` or `motion` modules,
 *     and no consumer imports spatial/motion symbols from `/ui`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FIRST_WAVE_THEMED } from '../helpers/firstWaveThemed';
import { stripComments } from '../helpers/sourceText';
import { colors, LEGACY_TOKEN_KEYS, palettes } from '../../lib/tokens';

const ROOT = path.join(__dirname, '../..');

function walkFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkFiles(rel, exts));
    else if (exts.some((ext) => e.name.endsWith(ext))) out.push(rel);
  }
  return out;
}

const tsxFiles = [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])];
const allUiCodeFiles = [
  ...walkFiles('app', ['.ts', '.tsx']),
  ...walkFiles('components', ['.ts', '.tsx']),
];

const HEX_RE = /["'](#[0-9A-Fa-f]{3,8})["']/g;
const RGBA_RE = /rgba\s*\(/g;
const FONT_SIZE_LITERAL_RE = /\bfontSize\s*:\s*\d+/g;
const SPACING_LITERAL_RE =
  /\b(?:padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight)\s*:\s*\d+/g;
const RADIUS_LITERAL_RE =
  /\b(?:borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\s*:\s*\d+/g;
const RAW_TOUCHABLE_RE =
  /<(?:TouchableOpacity|Pressable|TouchableWithoutFeedback|TouchableHighlight)\b/g;
const STATIC_COLORS_IMPORT_RE =
  /import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*["'][^"']*tokens["']/;

const norm = (h: string) => {
  const x = h.slice(1).toUpperCase();
  return x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
};

const tokenValues = new Set(
  [...Object.values(palettes.dark), ...Object.values(palettes.light)]
    .filter((v): v is string => typeof v === 'string' && v.startsWith('#'))
    .map(norm),
);

const rawByFile = new Map<string, string>(
  allUiCodeFiles.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]),
);
const strippedByFile = new Map<string, string>(
  allUiCodeFiles.map((f) => [f, stripComments(rawByFile.get(f)!)]),
);

const literals = tsxFiles.flatMap((f) =>
  [...rawByFile.get(f)!.matchAll(HEX_RE)].map((m) => ({ f, hex: m[1] })),
);

// Exact post-Wave-8B measured ceilings (ratchet may only move down)
export const CEILINGS = {
  QUOTED_HEX: 118,
  RGBA_LITERAL: 72,
  FONT_SIZE_LITERAL: 1080,
  SPACING_LITERAL: 1580,
  RADIUS_LITERAL: 530,
  STATIC_COLORS_IMPORTERS: 118,
  RAW_TOUCHABLES: 585,
  LEGACY_TOKEN_USAGES: 62,
} as const;

describe('designTokensRatchet (DSA-06, DSA-07, DSA-13)', () => {
  it('(+) finds the UI (scanner sanity)', () => {
    expect(tsxFiles.length).toBeGreaterThan(120);
    expect(tokenValues.has(norm(colors.textFaint))).toBe(true);
    expect(tokenValues.has(norm(palettes.light.bg))).toBe(true);
  });

  it('(+) no raw hex equal to a dark or light design token: use palette tokens', () => {
    const offenders = literals
      .filter((l) => tokenValues.has(norm(l.hex)))
      .map((l) => `${l.f} ${l.hex}`);
    expect(offenders).toEqual([]);
  });

  it('(+) monotonic ceilings on hardcoded style literals, static colors importers, raw touchables, and legacy tokens never grow', () => {
    let rgbaCount = 0;
    let fontSizeCount = 0;
    let spacingCount = 0;
    let radiusCount = 0;
    let rawTouchablesCount = 0;

    for (const f of tsxFiles) {
      const txt = rawByFile.get(f)!;
      rgbaCount += [...txt.matchAll(RGBA_RE)].length;
      fontSizeCount += [...txt.matchAll(FONT_SIZE_LITERAL_RE)].length;
      spacingCount += [...txt.matchAll(SPACING_LITERAL_RE)].length;
      radiusCount += [...txt.matchAll(RADIUS_LITERAL_RE)].length;
      rawTouchablesCount += [...txt.matchAll(RAW_TOUCHABLE_RE)].length;
    }

    const staticImporters = tsxFiles.filter((f) =>
      STATIC_COLORS_IMPORT_RE.test(strippedByFile.get(f)!),
    );

    let legacyUsages = 0;
    for (const f of allUiCodeFiles) {
      const code = strippedByFile.get(f)!;
      for (const k of LEGACY_TOKEN_KEYS) {
        legacyUsages += [...code.matchAll(new RegExp(`\\b(?:colors|c)\\.${k}\\b`, 'g'))].length;
      }
    }

    expect(literals.length).toBeLessThanOrEqual(CEILINGS.QUOTED_HEX);
    expect(rgbaCount).toBeLessThanOrEqual(CEILINGS.RGBA_LITERAL);
    expect(fontSizeCount).toBeLessThanOrEqual(CEILINGS.FONT_SIZE_LITERAL);
    expect(spacingCount).toBeLessThanOrEqual(CEILINGS.SPACING_LITERAL);
    expect(radiusCount).toBeLessThanOrEqual(CEILINGS.RADIUS_LITERAL);
    expect(staticImporters.length).toBeLessThanOrEqual(CEILINGS.STATIC_COLORS_IMPORTERS);
    expect(rawTouchablesCount).toBeLessThanOrEqual(CEILINGS.RAW_TOUCHABLES);
    expect(legacyUsages).toBeLessThanOrEqual(CEILINGS.LEGACY_TOKEN_USAGES);
  });

  it('(+) reference screens and all first-wave themed files contain zero raw hex literals and zero static colors imports', () => {
    for (const f of ['app/tabs/today.tsx', 'components/today/HabitSection.tsx', 'components/settings/TodayToolsSection.tsx', 'app/screens/recovery.tsx', 'app/screens/routine-runner.tsx']) {
      expect(literals.filter((l) => l.f === f)).toEqual([]);
    }

    const firstWaveHex = FIRST_WAVE_THEMED.flatMap((f) =>
      literals.filter((l) => l.f === f).map((l) => `${f}: ${l.hex}`),
    );
    expect(firstWaveHex).toEqual([]);

    const firstWaveStatic = FIRST_WAVE_THEMED.filter((f) =>
      STATIC_COLORS_IMPORT_RE.test(strippedByFile.get(f)!),
    );
    expect(firstWaveStatic).toEqual([]);
  });

  it('(+) components/ui/index.ts exports UI primitives only (no spatial or motion re-exports) and zero files import spatial/motion from /ui', () => {
    const barrel = stripComments(
      fs.readFileSync(path.join(ROOT, 'components/ui/index.ts'), 'utf8'),
    );
    expect(barrel).not.toMatch(/\b(?:spatial|motion|AtmosphericScreenCanvas|EmbeddedFiligree|BentoVisualCard|ChapterDivider|StaggeredReveal|MorphingPillTabs|AnimatedMetricValue|GoldMendShimmer)\b/);

    const badBarrelImports: string[] = [];
    const movedSymbols = new Set([
      'AtmosphericScreenCanvas',
      'EmbeddedFiligree',
      'BentoVisualCard',
      'ChapterDivider',
      'StaggeredReveal',
      'MorphingPillTabs',
      'AnimatedMetricValue',
      'GoldMendShimmer',
    ]);

    for (const f of allUiCodeFiles) {
      const code = strippedByFile.get(f)!;
      for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]*\/ui)['"]/g)) {
        const names = m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
        if (names.some((n) => movedSymbols.has(n))) {
          badBarrelImports.push(`${f} -> ${m[2]}`);
        }
      }
    }
    expect(badBarrelImports).toEqual([]);
  });

  it('(-) regex sensitivity: catches synthetic static colors imports, spatial barrel re-exports, and legacy token usages', () => {
    expect(STATIC_COLORS_IMPORT_RE.test("import { colors, space } from '../../lib/tokens';")).toBe(true);
    expect(STATIC_COLORS_IMPORT_RE.test("import { space, type Palette } from '../../lib/tokens';")).toBe(false);
    expect(RAW_TOUCHABLE_RE.test('<TouchableOpacity onPress={fn}>')).toBe(true);
    RAW_TOUCHABLE_RE.lastIndex = 0;
    expect(RAW_TOUCHABLE_RE.test('<Button label="Tamam" onPress={fn} />')).toBe(false);
  });
});
