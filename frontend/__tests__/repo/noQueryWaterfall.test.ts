/**
 * No screen waits for one read to finish before starting an unrelated one.
 *
 * ## The shape
 *
 * `stats.tsx` used to open with four reads on four separate `await` lines.
 * None consumed another's output — they were sequential only because each
 * `await` was written on its own line — so the tab waited for four round
 * trips where one would do. `statsNoQueryWaterfall.test.ts` pins the fix for
 * that screen specifically, including which four calls belong in the batch.
 *
 * This is the general version: the same mistake, anywhere. It is the easy
 * mistake to make, because `const a = await x(); const b = await y();` is the
 * shorter diff and reads perfectly well.
 *
 * ## What counts
 *
 * Two or more consecutive statements that `await` a read — a name starting
 * `fetch`/`list`/`load`/`get`/`search`/`count`/`query`, or one from a
 * repository — with nothing between them. Consecutive is the point: if the
 * second line uses the first line's result, there is a line between them or
 * the call takes it as an argument, and the wait is real.
 *
 * The scanner is validated by planting a waterfall and watching it appear,
 * because a detector that silently matches nothing is worse than none.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const AWAIT_CALL = /^\s*(?:const|let)?\s*(?:\[?[\w\s,:{}]*\]?\s*=\s*)?await\s+([A-Za-z_$][\w.]*)\s*\(/;
const IS_READ = /^(fetch|list|load|get|search|count|query)[A-Z_]|Repository|repo[A-Z]/;

/** Identifiers a line binds, e.g. `const [a, b] = await …` -> a, b. */
function bindings(line: string): string[] {
  const m = /^\s*(?:const|let|var)\s+([^=]+?)\s*=/.exec(line);
  if (!m) return [];
  return [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
}

/** The argument text of the awaited call, where a dependency would appear. */
function args(line: string): string {
  const open = line.indexOf('(');
  return open === -1 ? '' : line.slice(open);
}

function scan(code: string): { line: number; text: string }[][] {
  const lines = stripComments(code).split('\n');
  const runs: { line: number; text: string }[][] = [];
  let streak: { line: number; text: string }[] = [];
  let bound: string[] = [];

  const flush = () => {
    if (streak.length >= 2) runs.push(streak);
    streak = [];
    bound = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = AWAIT_CALL.exec(line);
    const name = m?.[1];
    const isRead = !!name && IS_READ.test(name.split('.').pop() ?? name);
    if (!isRead) { flush(); continue; }

    // A call that consumes something an earlier await in this run produced
    // genuinely has to wait — it is not a waterfall, it is a dependency. An
    // earlier version of this scanner missed that and reported
    // `fetchLogsFor(ids)` after `const ids = await fetchHabitIds()`; its own
    // test caught it.
    const consumesEarlier = bound.some((b) => new RegExp(`\\b${b}\\b`).test(args(line)));
    if (consumesEarlier) { flush(); }

    streak.push({ line: i + 1, text: line.trim() });
    bound.push(...bindings(line));
  }
  flush();
  return runs;
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
      out.push({ rel: `${dir}/${e.name}`, code: readFileSync(join(ROOT, dir, e.name), 'utf8') });
    }
  };
  for (const base of ['app', 'components', 'store', 'services']) walk(base, '');
  return out;
}

describe('the scanner finds waterfalls when there are any', () => {
  it('catches three independent reads in a row', () => {
    const planted = `
      async function load() {
        const a = await fetchHabits();
        const b = await fetchTasks();
        const c = await listTransactions();
        return [a, b, c];
      }`;
    const runs = scan(planted);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it('does not flag a read whose result the next line consumes', () => {
    // `ids` comes from the first call, so the second genuinely has to wait.
    const dependent = `
      async function load() {
        const ids = await fetchHabitIds();
        const rows = await fetchLogsFor(ids);
        return rows;
      }`;
    expect(scan(dependent)).toEqual([]);
  });

  it('does not flag a Promise.all batch', () => {
    const batched = `
      async function load() {
        const [a, b] = await Promise.all([fetchHabits(), fetchTasks()]);
        return [a, b];
      }`;
    expect(scan(batched)).toEqual([]);
  });
});

describe('no waterfall in the app', () => {
  const files = sources();

  it('finds the source (scanner sanity)', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('no screen, component, store or service issues independent reads in series', () => {
    const offenders = files.flatMap((f) =>
      scan(f.code).map((run) => `${f.rel}:${run[0].line} — ${run.length} reads in series: ${run.map((r) => r.text.slice(0, 40)).join(' | ')}`),
    );
    expect(offenders).toEqual([]);
  });
});
