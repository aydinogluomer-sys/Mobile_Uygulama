/**
 * Plan §24 Phase 4 — "skeleton states".
 *
 * Today 25 screens show a bare `ActivityIndicator` while loading. A spinner
 * says "something is happening"; a skeleton says "here is the shape of what
 * is coming", which is what makes a load feel shorter and stops the layout
 * jumping when content arrives.
 *
 * This asserts the primitive exists, is exported from the ui barrel like every
 * other primitive, respects reduce-motion (the codebase already honours it in
 * `components/seasonalMotion/useReducedMotion`), and is actually consumed.
 *
 * Source-text invariant, same instrument as `rule4NoDirectDbInUi.test.ts`.
 * Regexes are anchored to real lines: a previous coder's assertion false-passed
 * because a comment merely contained the matched text.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function findTsxMatches(dir: string, needle: RegExp): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) hits.push(...findTsxMatches(full, needle));
    else if (entry.endsWith('.tsx') && needle.test(readFileSync(full, 'utf8'))) hits.push(full);
  }
  return hits;
}

describe('§24 Phase 4 — skeleton states', () => {
  it('the primitive exists', () => {
    expect(existsSync(join(root, 'components/ui/Skeleton.tsx'))).toBe(true);
  });

  it('is exported from the ui barrel, like every other primitive', () => {
    const barrel = read('components/ui/index.ts');
    expect(barrel).toMatch(/^export .*Skeleton.* from '\.\/Skeleton';$/m);
  });

  it('honours reduce-motion rather than animating unconditionally', () => {
    const src = read('components/ui/Skeleton.tsx');
    expect(src).toMatch(/useReducedMotion|reduceMotion/);
  });

  it('uses the native driver for its shimmer', () => {
    const src = read('components/ui/Skeleton.tsx');
    expect(src).toMatch(/useNativeDriver:\s*true/);
  });

  // Scoped to the DEFAULT export's own JSX, not the whole file. A file-wide
  // match false-passes: `SkeletonLines` further down also sets
  // `pointerEvents="none"`, so deleting it from the primitive itself would
  // still satisfy a file-scoped regex. This is the same shallow-match trap
  // that has already bitten a repo-wide grep and two other guard tests in
  // this project -- the fix is always to anchor the scope, not the pattern.
  it('the primitive itself is non-interactive so it cannot swallow taps', () => {
    const src = read('components/ui/Skeleton.tsx');
    const start = src.indexOf('export default function Skeleton');
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf(String.fromCharCode(10) + 'export ', start + 1);
    const body = next === -1 ? src.slice(start) : src.slice(start, next);
    expect(body).toMatch(/pointerEvents=["'{]?none/);
    expect(body).toMatch(/accessibilityElementsHidden/);
  });

  it('is actually consumed by at least one screen', () => {
    const hits = findTsxMatches(join(root, 'app'), /Skeleton/);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('scanner sanity — the barrel regex needs a real export line, not a mention', () => {
    expect("// mentions Skeleton from './Skeleton';").not.toMatch(
      /^export .*Skeleton.* from '\.\/Skeleton';$/m,
    );
  });
});
