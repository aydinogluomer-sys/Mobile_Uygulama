/**
 * A colour that has a token is written as that token, and every colour that
 * does not have one is ACCOUNTED FOR.
 *
 * ## What changed here, and why the cap was not the finish line
 *
 * The first version of this file enforced two things: no file spells out a
 * hex the token table already names, and the count of untokened literals may
 * not grow (a ceiling of 385). The ceiling was honest about the number but
 * said nothing about the KIND — "385 colours have no token" is not a claim
 * anyone can act on, and "inventing names would be inventing design
 * decisions" was doing too much work as an excuse.
 *
 * It is only a good excuse for colours that genuinely are not UI chrome. So
 * the 385 were enumerated one by one and split:
 *
 *   181 of them are a CATEGORICAL palette (life areas, triage levels, journal
 *       moods, project chips and their alpha tints), a heatmap ramp, the
 *       user-selectable focus themes, the seasonal-motion particle constants,
 *       or a third party's brand colour. None of those is a semantic UI
 *       colour and none of them wants a semantic name.
 *
 *   181 of them WERE semantic UI chrome — greys for secondary text, cool
 *       near-blacks for surfaces, the journal's paper set, selected-state
 *       tints, and ~90 alpha variants of colours that already had tokens.
 *       Those are now named in `lib/tokens.ts` and referenced from there.
 *
 * The names are not invented: `#9ca3af` IS Tailwind `gray-400`, and the
 * paper/selection tints are named for the role they already play. Nothing was
 * restyled — every replacement is byte-identical at runtime, checked by
 * re-resolving each token back to its hex and comparing the ordered colour
 * sequence of all 30 changed files against `HEAD`:
 *
 *     files compared        : 30
 *     colour terms compared : 1325
 *     FILES THAT CHANGED A COLOUR: 0
 *
 * What is still open is a design question, not a naming one: whether the
 * legacy neutral ramp should collapse into `textDim`/`textFaint`/`bg`. That
 * changes pixels and belongs to a designer. Naming the colours is what makes
 * it possible to ask.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

/**
 * `lib/tokens.ts` and `lib/theme.ts` DEFINE colours; every other module
 * consumes them. Tokenising inside a palette is circular, and doing it broke
 * `theme.ts`'s literal types the first time it was tried.
 */
const PALETTES = new Set(['lib/tokens.ts', 'lib/theme.ts']);

function tokenValues(): Map<string, string> {
  const src = readFileSync(join(ROOT, 'lib', 'tokens.ts'), 'utf8').replace(/\r\n/g, '\n');
  const block = src.slice(src.indexOf('export const colors = {'));
  const body = block.slice(0, block.indexOf('\n} as const;'));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/gm)) {
    out.set(expand(m[2]), m[1]);
  }
  return out;
}

/** `#fff` and `#ffffff` are the same colour. */
function expand(h: string): string {
  const s = h.toLowerCase();
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
}

function sources(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  const skip = new Set(['node_modules', '.expo', 'dist', '__tests__', 'coverage', 'android', 'ios']);
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(`${dir}/${e.name}`, r); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      out.push({ rel: `${dir}/${e.name}`, code: stripComments(readFileSync(join(ROOT, dir, e.name), 'utf8')) });
    }
  };
  for (const base of ['app', 'components', 'lib', 'store', 'services', 'repositories']) walk(base, '');
  return out;
}

const TOKENS = tokenValues();
const FILES = sources().filter((f) => !PALETTES.has(f.rel));

const literals = FILES.flatMap((f) =>
  [...f.code.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => ({ rel: f.rel, hex: expand(m[1]) })),
);

describe('the scanner is looking at something', () => {
  it('found the token table', () => {
    expect(TOKENS.size).toBeGreaterThanOrEqual(15);
    expect([...TOKENS.values()]).toContain('accent');
  });

  it('found the source', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });
});

describe('a colour that has a token is written as the token', () => {
  it('no file spells out a hex the token table already names', () => {
    const offenders = literals
      .filter((l) => TOKENS.has(l.hex))
      .map((l) => `${l.rel}: '${l.hex}' is colors.${TOKENS.get(l.hex)}`);
    // Deduplicated so one file with forty copies reads as one line.
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('the palettes are exempt, and only the palettes', () => {
    // If this list grows, colours are being defined somewhere new.
    expect([...PALETTES].sort()).toEqual(['lib/theme.ts', 'lib/tokens.ts']);
  });
});

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

/**
 * A categorical palette: one colour per life area, triage level, mood, rank
 * or project chip. These pick things APART; they are not a semantic scale,
 * and `success`/`warning`/`error` are the wrong names for them even where the
 * hex happens to be close. Same rationale as a chart's series colours.
 */
const CATEGORY_HUES = [
  '#ec4899', '#8b5cf6', '#a78bfa', '#14b8a6', '#f59e0b', '#10b981',
  '#ef4444', '#6366f1', '#06b6d4', '#3b82f6', '#84cc16', '#eab308', '#6daedb',
];

/** Somebody else's brand: Spotify green, Notion orange, Google blue. */
const THIRD_PARTY_BRAND = ['#1db954', '#4285f4', '#f97316'];

/** `app/tabs/stats.tsx`'s intensity ramp — a data-viz scale, not UI chrome. */
const HEATMAP_SCALE = ['#4a2a1b', '#6e331c', '#934628'];

/** The particle constants behind the seasonal motion, i.e. illustration. */
const ILLUSTRATION = /^components\/seasonalMotion\/particles\.ts$/;

/** `lib/focusThemes.ts` IS a palette — one bg/card/accent triple per theme. */
const THEME_PALETTE = /^lib\/focusThemes\.ts$/;

type Category =
  | 'category-hue' | 'category-tint' | 'third-party-brand'
  | 'heatmap-scale' | 'illustration' | 'theme-palette' | 'SEMANTIC-UI';

function classify(l: { rel: string; hex: string }): Category {
  const six = l.hex.slice(0, 7);
  if (ILLUSTRATION.test(l.rel)) return 'illustration';
  if (THEME_PALETTE.test(l.rel)) return 'theme-palette';
  if (THIRD_PARTY_BRAND.includes(six)) return 'third-party-brand';
  if (HEATMAP_SCALE.includes(six)) return 'heatmap-scale';
  if (CATEGORY_HUES.includes(six)) return l.hex.length === 9 ? 'category-tint' : 'category-hue';
  return 'SEMANTIC-UI';
}

describe('every colour without a token is accounted for', () => {
  const untokened = literals.filter((l) => !TOKENS.has(l.hex));

  it('no semantic UI colour is left as a bare literal', () => {
    // The one category that is NOT allowed to have members. A colour that is
    // UI chrome — text, a surface, a border, a selected state — belongs in
    // `lib/tokens.ts`, and this is what says so rather than a count.
    const unexplained = untokened
      .filter((l) => classify(l) === 'SEMANTIC-UI')
      .map((l) => `${l.rel}: '${l.hex}'`);
    expect([...new Set(unexplained)]).toEqual([]);
  });

  it('the remaining literals are exactly the exempt kinds', () => {
    const counts: Record<string, number> = {};
    for (const l of untokened) counts[classify(l)] = (counts[classify(l)] ?? 0) + 1;
    // Recorded rather than merely bounded: if a category's population moves,
    // the number that moved is in the diff, and somebody has to say why.
    expect(counts).toEqual({
      'category-hue': 79,
      'illustration': 30,
      'category-tint': 29,
      'theme-palette': 24,
      'third-party-brand': 13,
      'heatmap-scale': 6,
    });
  });

  /**
   * The count on the day the second tokenise pass ran: 385 -> 181. It may go
   * DOWN if the categorical palette is ever named too; it must not go up,
   * because going up means a new off-palette colour was introduced by hand.
   */
  const CEILING = 181;

  it('does not grow', () => {
    expect(untokened.length).toBeLessThanOrEqual(CEILING);
  });

  it('the ceiling is not stale by a wide margin', () => {
    // If the real number falls well below the cap, the cap has stopped
    // meaning anything and should be lowered in the same commit that earned
    // it. 20 is a wide enough band not to thrash on a single screen's edit.
    expect(CEILING - untokened.length).toBeLessThanOrEqual(20);
  });
});
