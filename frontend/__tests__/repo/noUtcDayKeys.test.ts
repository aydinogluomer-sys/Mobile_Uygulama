/**
 * Repository invariant: no day key is ever derived from a UTC instant.
 * (task 1B-008)
 *
 * This test asserts a property of the SOURCE TEXT, not of runtime behaviour,
 * and says so rather than pretending otherwise. That is the right instrument
 * here: the defect is mechanical and repo-wide -- `toISOString()` truncated to
 * ten characters answers "what is the date in Greenwich", which at UTC+3 is
 * yesterday between 00:00 and 03:00 local. There is no behaviour to unit-test
 * in a screen component that merely holds the wrong string; what needs
 * guarding is that nobody writes the expression again.
 *
 * Behavioural coverage of the same defect lives in date.test.ts,
 * dateDerivation.test.ts and focusReport.test.ts, which exercise real
 * functions. This file is the regression fence, not the proof.
 *
 * Written BEFORE the fix and observed to fail with 12 violations, per R-01.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['app', 'components', 'lib', 'store'];

/**
 * Two patterns, for two reasons.
 *
 * `toISOString().slice(0, 10)` -- the caller built a UTC instant and truncated
 * it. Restricted to `toISOString()` on purpose: `.slice(0, 10)` applied to a
 * column that is already a `date` (habit_logs.completed_at, lib/supabase.ts:80)
 * is a harmless no-op, and flagging it would be a false positive.
 *
 * `.split('T')[0]` on ANY expression -- there is no benign use. A date-only
 * string contains no 'T', so the split does nothing; if it does something, the
 * subject was a timestamp and the result is the day in Greenwich.
 */
const DAY_KEY_FROM_UTC = [
  /toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\))/,
  /\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function violations(): string[] {
  const hits: string[] = [];
  for (const dir of SCANNED) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return; // açıklama satırı
        if (DAY_KEY_FROM_UTC.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}`);
      });
    }
  }
  return hits;
}

describe('AC-D09 -- no day key is derived from a UTC instant', () => {
  it('finds no toISOString().split/slice day key anywhere in app, components, lib or store', () => {
    const hits = violations();
    expect(hits).toEqual([]);
  });

  it('proves the scanner actually works', () => {
    // Guard against the check silently passing because it matches nothing.
    const flags = (line: string) => DAY_KEY_FROM_UTC.some((re) => re.test(line));
    expect(flags("const t = new Date().toISOString().split('T')[0];")).toBe(true);
    expect(flags('const t = d.toISOString().slice(0, 10);')).toBe(true);
    expect(flags("const day = (task.completed_at ?? '').split('T')[0];")).toBe(true);
    // Storing a full instant is correct; only truncating it is not.
    expect(flags('created_at: new Date().toISOString(),')).toBe(false);
    // Already a `date` column -- slicing it is a no-op, not a defect.
    expect(flags('logMap.set(log.completed_at.slice(0, 10), x);')).toBe(false);
  });

  it('scans a non-trivial number of files', () => {
    const count = SCANNED.reduce((n, d) => n + walk(join(ROOT, d)).length, 0);
    expect(count).toBeGreaterThan(80);
  });
});
