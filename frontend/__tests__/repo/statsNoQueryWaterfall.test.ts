/**
 * Plan §28 Performance: "No blocking dashboard query waterfall".
 *
 * `app/tabs/stats.tsx`'s `loadData` used to `await` four independent things on
 * four separate lines — the 365-day heatmap, the 30-day per-habit rollup, the
 * habit list and the task list. None of them consumes another's output; they
 * were serialised purely because each `await` was written on its own line, so
 * the Stats tab paid four sequential round trips for work that needs one.
 * `app/tabs/today.tsx` already batches its five fetches with a single
 * `Promise.all`, so the pattern was present in the repo and simply unused here.
 *
 * WHY THIS IS A SOURCE-TEXT TEST AND WHAT THAT COSTS. The honest instrument
 * would be behavioural: render the screen, resolve nothing, and assert all
 * four requests are in flight at once. Rendering this screen pulls in the
 * chart stack, five stores and the supabase client, which buys a slow, brittle
 * test for a property that is entirely visible in the source. So this is a
 * structural check — and it is written with the defences this repo learned the
 * hard way, because a loose structural check is worse than none:
 *
 *   - COMMENTS ARE STRIPPED first. The block above `Promise.all` in
 *     `stats.tsx` names all four functions while explaining the fix; a raw
 *     `includes` would pass with the actual calls deleted.
 *   - SCOPE IS ANCHORED to `loadData`'s body, not the file. The same
 *     identifiers appear in the import list at the top.
 *   - The scanner's own assumptions are proven on fixtures below, not assumed.
 *
 * What it therefore does NOT prove: that the requests genuinely overlap at
 * runtime. It proves they are passed to one `Promise.all` rather than awaited
 * in sequence, which is the specific regression worth preventing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const stats = stripComments(readFileSync(join(ROOT, 'app', 'tabs', 'stats.tsx'), 'utf8'));

/** `loadData`'s body only — the imports at the top name the same functions. */
function loadDataBody(): string {
  const start = stats.indexOf('const loadData = useCallback');
  expect(start).toBeGreaterThan(-1);
  const end = stats.indexOf('useEffect(() => { loadData(); }', start);
  expect(end).toBeGreaterThan(start);
  return stats.slice(start, end);
}

/** The argument list of the first `Promise.all([...])` in a body. */
function promiseAllArgs(body: string): string {
  const i = body.indexOf('Promise.all([');
  if (i < 0) throw new Error('expected a Promise.all in loadData, but there is none');
  const end = body.indexOf('])', i);
  expect(end).toBeGreaterThan(i);
  return body.slice(i, end);
}

const FETCHES = [
  'fetchHabitLogsHeatmap',
  'fetchHabitIdsCompletedSince',
  'fetchHabits',
  'fetchTasks',
];

describe('§28 stats dashboard does not waterfall its queries', () => {
  const body = loadDataBody();

  it.each(FETCHES)('%s is batched inside the Promise.all', (fn) => {
    expect(promiseAllArgs(body)).toContain(fn);
  });

  it('no independent fetch is awaited on its own outside the batch', () => {
    // The real regression shape: someone adds a fifth query later and reaches
    // for `const x = await fetchThing()` because that is the shorter diff.
    // Anything matching `await fetch...(` outside the batch re-introduces the
    // waterfall this file exists to prevent.
    const batch = promiseAllArgs(body);
    const outside = body.replace(batch, '');
    const strays = outside.match(/await\s+fetch[A-Za-z]*\(/g) ?? [];
    expect(strays).toEqual([]);
  });

  it('the only sequential await before the batch is the session gate', () => {
    // The guard legitimately comes first — everything after it is pointless
    // with no session. It used to be `supabase.auth.getUser()`, which issues
    // GET /auth/v1/user on every call; it is now `currentUser()`, which reads
    // the persisted session locally. The invariant this test protects is
    // unchanged (exactly ONE sequential await ahead of the batch) and the
    // round trip it used to cost is gone. See lib/session.ts.
    const beforeBatch = body.slice(0, body.indexOf('Promise.all(['));
    const awaits = beforeBatch.match(/await\s+[A-Za-z.]+\(/g) ?? [];
    expect(awaits).toEqual(['await currentUser(']);
  });

  describe('scanner sanity — these defences actually defend', () => {
    it('stripComments removes calls that appear only in a comment', () => {
      const out = stripComments('// Promise.all([fetchHabits(), fetchTasks()])\nconst x = 1;');
      expect(out).not.toContain('fetchHabits');
      expect(out).toContain('const x = 1;');
    });

    it('promiseAllArgs throws rather than passing when there is no batch', () => {
      // Absence must fail loudly. A helper that returned '' here would make
      // every `toContain` above fail — but the `strays` assertion would pass
      // vacuously, which is the silent-false-pass family this repo keeps
      // meeting.
      expect(() => promiseAllArgs('const a = await one(); const b = await two();')).toThrow(
        /no ne|there is none/,
      );
    });

    it('the stray-await pattern really matches a sequential fetch', () => {
      expect('const r = await fetchSomething({ x: 1 });').toMatch(/await\s+fetch[A-Za-z]*\(/);
    });

    it('loadDataBody excludes the import block', () => {
      expect(loadDataBody()).not.toContain('import ');
    });
  });
});
