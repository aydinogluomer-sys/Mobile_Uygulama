/**
 * The canonical `generate-routine` must handle every mode the app sends.
 *
 * ## The defect this exists to prevent
 *
 * `/supabase/functions` is nominally the source of truth for edge functions.
 * It was not. The canonical `generate-routine` handled two modes:
 *
 *     const COST = { coach: 5, routine: 25 } as const;
 *     const mode = body?.mode === 'coach' ? 'coach' : 'routine';
 *
 * while the deployed function (v11) and the client both worked in four. The
 * selector has no rejection branch — an unrecognised mode falls through to
 * `'routine'`. So redeploying from the canonical tree, in good faith, would
 * have made `summarize` and `insights` silently answer with the routine
 * system prompt (JSON habit list instead of prose) and charge 25 Focus Points
 * instead of 3 and 5. No error, no log, a plausible-looking wrong answer and
 * a five- to eight-fold overcharge.
 *
 * A test that only read the function would not have caught this — two modes
 * is perfectly self-consistent. The drift is only visible by comparing the
 * function against its CALLERS, which is what this does: it extracts the
 * modes the app actually sends from the client source, and asserts the
 * canonical function has a branch for each.
 *
 * This reads source text rather than invoking the function because the
 * function is Deno + a live Anthropic key; the property being protected is a
 * structural one (does a branch exist), which source is sufficient to answer.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { edgeSource } from '../helpers/edgeSource';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const fn = stripComments(edgeSource('generate-routine'));

/** Every `mode: '<x>'` sent to `generate-routine` from app/ + store/ + lib/. */
function modesSentByClient(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const src = stripComments(readFileSync(p, 'utf8'));
      if (!src.includes('generate-routine')) continue;
      // `body: { mode: 'summarize', transcript }` and friends.
      for (const m of src.matchAll(/mode:\s*'([a-z_]+)'/g)) found.add(m[1]);
    }
  };
  for (const d of ['app', 'store', 'lib']) walk(join(ROOT, d));
  return [...found].sort();
}

describe('generate-routine — canonical source matches its callers', () => {
  const clientModes = modesSentByClient();

  it('the client really does send more than one mode (scanner sanity)', () => {
    // If the scanner silently found nothing, every assertion below would pass
    // vacuously — which is precisely the failure this file exists to catch.
    expect(clientModes.length).toBeGreaterThan(1);
    expect(clientModes).toContain('coach');
  });

  it.each(['coach', 'summarize', 'insights'])(
    "the canonical function has an explicit branch for mode '%s'",
    (mode) => {
      expect(fn).toContain(`body?.mode === '${mode}'`);
    },
  );

  it('every mode the client sends is handled explicitly or is the default', () => {
    // 'routine' is the fall-through default and has no `body?.mode ===` test,
    // so it is checked against the cost table instead.
    const unhandled = clientModes.filter(
      (m) => m !== 'routine' && !fn.includes(`body?.mode === '${m}'`),
    );
    expect(unhandled).toEqual([]);
  });

  it('every mode the client sends is priced — an unpriced mode would be free or NaN', () => {
    const costLine = fn.match(/const COST = \{([^}]*)\}/)?.[1] ?? '';
    const priced = [...costLine.matchAll(/([a-z_]+)\s*:\s*\d+/g)].map((m) => m[1]).sort();
    for (const mode of clientModes) expect(priced).toContain(mode);
  });

  it('mode selection falls through to routine, so an unpriced mode cannot reach COST[undefined]', () => {
    expect(fn).toMatch(/:\s*'routine';/);
  });
});
