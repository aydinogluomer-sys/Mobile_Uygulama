/**
 * F15 (DOM-12): single-source static guard for habit creation day resolution.
 *
 * Across `app`, `components`, `lib`, `store`, `services`, and `repositories`,
 * `habit.created_at` / `h.created_at` must NEVER be converted directly via
 * `ymd(...)`, `ymdFromIso(...)`, or `new Date(...)` outside `lib/habitCreatedDay.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'lib', 'store', 'services', 'repositories'] as const;
const CANONICAL = 'lib/habitCreatedDay.ts';

const DIRECT_HABIT_CREATED_AT_RE =
  /\b(?:ymd|ymdFromIso|new\s+Date)\s*\(\s*(?:new\s+Date\s*\(\s*)?\b(?:habit|h)\??\.created_at\b/;

export function findDirectHabitCreatedAtConversions(rawSource: string): string[] {
  const stripped = stripComments(rawSource);
  const hits: string[] = [];
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (DIRECT_HABIT_CREATED_AT_RE.test(lines[i])) {
      hits.push(`L${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

function walkTsFiles(relDir: string): string[] {
  const abs = join(FRONTEND, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const rel = `${relDir}/${entry}`;
    const full = join(FRONTEND, rel);
    if (statSync(full).isDirectory()) out.push(...walkTsFiles(rel));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

describe('F15 repo guard — habitCreatedDay is the single source for habit creation day', () => {
  const files = DIRS.flatMap(walkTsFiles);

  it('lib/habitCreatedDay.ts exists and scanner visits >240 production files', () => {
    expect(existsSync(join(FRONTEND, CANONICAL))).toBe(true);
    expect(files).toContain(CANONICAL);
    expect(files.length).toBeGreaterThan(240);
  });

  it('zero direct ymd / ymdFromIso / new Date conversions of habit.created_at or h.created_at outside lib/habitCreatedDay.ts', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === CANONICAL) continue;
      const hits = findDirectHabitCreatedAtConversions(readFileSync(join(FRONTEND, rel), 'utf8'));
      for (const h of hits) offenders.push(`${rel}:${h}`);
    }
    expect(offenders).toEqual([]);
  });

  it('(+) positive control: scanner catches legacy conversion patterns and ignores non-habit entities', () => {
    expect(findDirectHabitCreatedAtConversions('const c = ymd(new Date(habit.created_at));')).toHaveLength(1);
    expect(findDirectHabitCreatedAtConversions('const c = ymdFromIso(habit.created_at);')).toHaveLength(1);
    expect(findDirectHabitCreatedAtConversions('const c = ymdFromIso(habit?.created_at);')).toHaveLength(1);
    expect(findDirectHabitCreatedAtConversions('const c = ymdFromIso(h.created_at);')).toHaveLength(1);
    expect(findDirectHabitCreatedAtConversions('// ymd(new Date(habit.created_at))')).toEqual([]);
    expect(findDirectHabitCreatedAtConversions('const d = ymdFromIso(task.created_at);')).toEqual([]);
    expect(findDirectHabitCreatedAtConversions('const c = habitCreatedDay(habit);')).toEqual([]);
  });
});
