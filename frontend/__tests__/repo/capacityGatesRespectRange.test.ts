/**
 * KD-08 — every `dailyLoad(` call is one of two kinds, and each kind applies
 * the date envelope in its own way.
 *
 * - ACTIVATION GATES sum every active habit and must pass them through
 *   `habitsInRangeOn(...)` first, or an ended habit eats today's capacity.
 * - DAY WALKS sum the habits that carried work on one specific day; that list
 *   comes from `carriesDayLoad`, whose `withinLifetime` already excludes days
 *   outside the range.
 *
 * A NEW `dailyLoad(` call in an unlisted file fails here until someone decides
 * which kind it is -- that decision is the whole point of the guard.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

const GATES = [
  'app/tabs/timeline.tsx',
  'lib/routineProposal.ts',
  'lib/starterPlan.ts',
  'services/capacityService.ts',
];
const DAY_WALKS = [
  'app/screens/insights.tsx',
  'app/screens/weekly-review.tsx',
  'app/screens/monthly-review.tsx',
];

/** Argument text of every `dailyLoad(` call, paren-balanced. */
function dailyLoadCalls(src: string): string[] {
  const out: string[] = [];
  const re = /\bdailyLoad\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '__tests__', '.expo', '.git', 'dist'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(relative(ROOT, p).split('\\').join('/'));
  }
  return acc;
}

describe('KD-08 — activation gates filter by the date envelope', () => {
  it.each(GATES)('%s passes its habits through habitsInRangeOn', (f) => {
    const calls = dailyLoadCalls(read(f));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/habitsInRangeOn\(/);
  });
});

describe('KD-08 — day walks get their habits from carriesDayLoad', () => {
  it.each(DAY_WALKS)('%s builds its per-day list with carriesDayLoad', (f) => {
    const src = read(f);
    expect(dailyLoadCalls(src).length).toBeGreaterThan(0);
    expect(src).toMatch(/carriesDayLoad\(/);
  });
});

describe('KD-08 — no unclassified dailyLoad caller', () => {
  it('every file that calls dailyLoad is a listed gate or day walk', () => {
    const known = new Set([...GATES, ...DAY_WALKS, 'lib/capacity.ts']);
    const callers = walk(ROOT).filter((f) => dailyLoadCalls(read(f)).length > 0);
    expect(callers.filter((f) => !known.has(f))).toEqual([]);
  });
});
