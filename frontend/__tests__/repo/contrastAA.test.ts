import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  accentsFor,
  contrastRatio,
  onColor,
  paletteFor,
  palettes,
  type ThemeMode,
} from '../../lib/tokens';
import { effectiveScrim } from '../../components/spatial/AtmosphericScreenCanvas';

const ROOT = join(__dirname, '..', '..');

function walkUiFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkUiFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function blendHexOver(underHex: string, overHex: string, alpha: number): string {
  const u = underHex.replace('#', '');
  const o = overHex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const uc = parseInt(u.slice(i, i + 2), 16);
    const oc = parseInt(o.slice(i, i + 2), 16);
    return Math.round(oc * alpha + uc * (1 - alpha));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const BANNED_TEXT_COLOR_RE =
  /(?:^|[{,;])\s*color\s*:\s*(?:colors|c)\.(?:textGhost|neutral500|neutral600|primaryDeep|border\w*|coolBlack\w*)\b/g;
const BANNED_PLACEHOLDER_RE =
  /placeholderTextColor=\{(?:colors|c)\.(?:textGhost|neutral500|neutral600)\}/g;

export function findTextContrastViolations(rel: string, raw: string): string[] {
  const clean = stripComments(raw);
  const hits: string[] = [];
  const lines = clean.split('\n');
  lines.forEach((line, idx) => {
    if (BANNED_TEXT_COLOR_RE.test(line)) {
      hits.push(`${rel}:${idx + 1}: banned text color token -> ${line.trim()}`);
    }
    BANNED_TEXT_COLOR_RE.lastIndex = 0;
    if (BANNED_PLACEHOLDER_RE.test(line)) {
      hits.push(`${rel}:${idx + 1}: banned placeholder token -> ${line.trim()}`);
    }
    BANNED_PLACEHOLDER_RE.lastIndex = 0;
  });
  return hits;
}

describe('F25 (DSA-05) — WCAG AA contrast across dark and light palettes', () => {
  const modes: readonly ThemeMode[] = ['dark', 'light'];

  it.each(modes)('(+) %s mode: text, textDim, textFaint reach >= 4.5:1 on bg, surface, surfaceAlt, surfaceHover', (mode) => {
    const p = paletteFor(mode);
    const surfaces = ['bg', 'surface', 'surfaceAlt', 'surfaceHover'] as const;
    const inks = ['text', 'textDim', 'textFaint'] as const;
    const failures: string[] = [];

    for (const fg of inks) {
      for (const bg of surfaces) {
        const ratio = contrastRatio(p[fg], p[bg]);
        if (ratio < 4.5) {
          failures.push(`${mode}: ${fg} (${p[fg]}) on ${bg} (${p[bg]}) = ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('(+) dark textFaint specifically reaches >= 4.5:1 on surfaceHover (regression guard for #928E82 -> #9A978C)', () => {
    expect(contrastRatio(palettes.dark.textFaint, palettes.dark.surfaceHover)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(modes)('(+) %s mode: semantic tokens reach >= 4.5:1 on bg and >= 3.0:1 on elevated/hover surfaces', (mode) => {
    const p = paletteFor(mode);
    const semantics = ['primary', 'success', 'warning', 'error', 'info'] as const;
    const cardSurfaces = ['surface', 'surfaceAlt', 'surfaceHover'] as const;
    const failures: string[] = [];

    for (const key of semantics) {
      const onBg = contrastRatio(p[key], p[bgKey()]);
      if (onBg < 4.5) failures.push(`${mode}: ${key} on bg = ${onBg.toFixed(2)}`);
      for (const sKey of cardSurfaces) {
        const onCard = contrastRatio(p[key], p[sKey]);
        if (onCard < 3.0) failures.push(`${mode}: ${key} on ${sKey} = ${onCard.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);

    function bgKey(): 'bg' {
      return 'bg';
    }
  });

  it.each(modes)('(+) %s mode: non-text tokens textGhost and borderStrong reach >= 3.0:1 UI-component threshold', (mode) => {
    const p = paletteFor(mode);
    for (const sKey of ['bg', 'surface', 'surfaceAlt'] as const) {
      expect(contrastRatio(p.textGhost, p[sKey])).toBeGreaterThanOrEqual(3.0);
    }
    for (const sKey of ['bg', 'surface'] as const) {
      expect(contrastRatio(p.borderStrong, p[sKey])).toBeGreaterThanOrEqual(3.0);
    }
  });

  it.each(modes)('(+) %s mode: journal paper sub-palette reaches >= 4.5:1 on paperSurface', (mode) => {
    const p = paletteFor(mode);
    for (const fg of ['paperText', 'paperTextDim', 'paperLabel'] as const) {
      expect(contrastRatio(p[fg], p.paperSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(modes)('(+) %s mode: every accent theme and error fill pairs with onColor() >= 4.5:1', (mode) => {
    const accents = accentsFor(mode);
    const p = paletteFor(mode);
    for (const theme of Object.values(accents)) {
      const labelHex = onColor(theme.primary);
      expect(contrastRatio(labelHex, theme.primary)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(onColor(p.error), p.error)).toBeGreaterThanOrEqual(4.5);
  });

  it('(+) light mode effectiveScrim guarantees textFaint >= 4.5:1 even over a pure black backdrop photo', () => {
    const scrimAlpha = effectiveScrim(0.58, 'light');
    expect(scrimAlpha).toBeGreaterThanOrEqual(0.9);
    const worstCaseSurface = blendHexOver('#000000', palettes.light.bg, scrimAlpha);
    expect(contrastRatio(palettes.light.textFaint, worstCaseSurface)).toBeGreaterThanOrEqual(4.5);
  });

  it('(-) zero banned low-contrast text or placeholder token usages remain across app/ and components/', () => {
    const allFiles = [...walkUiFiles('app'), ...walkUiFiles('components')];
    expect(allFiles.length).toBeGreaterThan(120);
    const violations = allFiles.flatMap((rel) =>
      findTextContrastViolations(rel, readFileSync(join(ROOT, rel), 'utf8')),
    );
    expect(violations).toEqual([]);
  });

  it('(-) scanner sensitivity: catches known sub-AA hex pairs and synthetic source violations while ignoring icons/borders/comments', () => {
    // Old textGhost (#56544B) on dark bg (#15140F) was 2.43:1 (< 3.0)
    expect(contrastRatio('#56544B', '#15140F')).toBeLessThan(3.0);
    // Old dark textFaint (#928E82) on surfaceHover (#322F26) was 4.08:1 (< 4.5)
    expect(contrastRatio('#928E82', '#322F26')).toBeLessThan(4.5);

    const syntheticBad = [
      'const s = StyleSheet.create({',
      '  a: { color: colors.textGhost },',
      '  b: { color: colors.neutral500 },',
      '  c: { color: colors.primaryDeep },',
      '  d: { color: c.borderStrong },',
      '  e: { color: c.coolBlack600 },',
      '});',
      '<TextInput placeholderTextColor={colors.neutral600} />',
    ].join('\n');
    expect(findTextContrastViolations('synthetic.tsx', syntheticBad)).toHaveLength(6);

    const syntheticSafe = [
      '// color: colors.textGhost',
      'const s = { borderColor: colors.textGhost, backgroundColor: colors.coolBlack800 };',
      '<Ionicons color={isPinned ? mod.color : colors.textGhost} />',
    ].join('\n');
    expect(findTextContrastViolations('safe.tsx', syntheticSafe)).toEqual([]);
  });
});
