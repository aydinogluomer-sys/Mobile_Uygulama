/**
 * The repo <-> live migration mapping (2026-10-09) covers every file, proposes
 * a timestamped name for every unapplied one, and nothing was renamed: the
 * files are still numbered until the owner runs the documented steps.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const doc = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'implementation-v3', 'MIGRATION_MAPPING.md'), 'utf8');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const rows = doc.split('\n').filter((l) => l.startsWith('| `'));

it('nothing was renamed: every migration is still NNN_name.sql', () => {
  expect(files.every((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
});

it('every applied file (001..027) has a row with a confidence grade', () => {
  for (const f of files.filter((x) => Number(x.slice(0, 3)) <= 27)) {
    const row = rows.find((l) => l.startsWith(`| \`${f}\` |`));
    const graded = !!row && ['**KESİN**', '**KESİN\\***', '**OLASI**', '**YOK**'].some((g) => row.includes(g));
    expect([f, graded]).toEqual([f, true]);
  }
});

it('every unapplied file (028..) gets a later, increasing timestamped name', () => {
  let last = '20260908133800';
  for (const f of files.filter((x) => Number(x.slice(0, 3)) >= 28)) {
    const row = rows.find((l) => l.startsWith(`| \`${f}\` |`));
    const m = row ? /\| `(\d{14})_([a-z0-9_]+\.sql)` \|$/.exec(row.trim()) : null;
    expect([f, m ? m[2] : null]).toEqual([f, f.slice(4)]);
    expect(m![1] > last).toBe(true);
    last = m![1];
  }
});

it('the secret-bearing ledger row is flagged for redaction before any fetch is committed', () => {
  expect(doc).toContain('20260606134848_create_test_user_v2.sql   -> "-- redacted');
});
