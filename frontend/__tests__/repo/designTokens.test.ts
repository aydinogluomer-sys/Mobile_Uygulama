/**
 * A colour that has a token is written as that token.
 *
 * ## What this is not
 *
 * It is not "no hex literals anywhere". 385 colours in the app have no token —
 * Tailwind-ish greys, a purple, a pink, several alpha variants. Inventing
 * names for those would be inventing design decisions, and a token called
 * `grey5` is not a design system, it is the same hex with more steps. Those
 * are counted, capped, and listed in `docs/DESIGN_TOKENS.md` for a person to
 * decide about.
 *
 * What this file does enforce is the part that is not a matter of taste: if a
 * colour is already in `lib/tokens.ts`, writing it out as a hex is a copy that
 * can drift. 1139 of them were replaced in one pass, verified to change no
 * rendered colour, and this keeps them from coming back one edit at a time.
 *
 * ## Why a ratchet on the rest
 *
 * A cap that only ever moves down turns "we did not get to it" into a fact the
 * build reports, instead of a number nobody looks at. It is deliberately not a
 * target of zero: zero would force someone to invent the names above.
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
  const body = block.slice(0, block.indexOf('\n};'));
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

describe('colours with no token are capped, not ignored', () => {
  /**
   * The count on the day the codemod ran. It may go DOWN as tokens are named
   * for the remaining colours; it must not go up, because going up means a
   * new off-palette colour was introduced by hand.
   */
  const CEILING = 385;

  it('does not grow', () => {
    const untokened = literals.filter((l) => !TOKENS.has(l.hex));
    expect(untokened.length).toBeLessThanOrEqual(CEILING);
  });

  it('the ceiling is not stale by a wide margin', () => {
    // If the real number falls well below the cap, the cap has stopped
    // meaning anything and should be lowered in the same commit that earned
    // it. 40 is a wide enough band not to thrash on a single screen's edit.
    const untokened = literals.filter((l) => !TOKENS.has(l.hex));
    expect(CEILING - untokened.length).toBeLessThanOrEqual(40);
  });
});
