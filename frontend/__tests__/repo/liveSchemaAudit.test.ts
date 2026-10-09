/**
 * The read-only live schema audit (2026-10-09) stays honest against the code:
 * every table the app reads has a row, the rows' arithmetic matches the
 * summary, and its proposal (036) is written but not applied.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const audit = readFileSync(join(ROOT, '..', 'docs', 'implementation-v3', 'LIVE_SCHEMA_AUDIT.md'), 'utf8');
const rows = audit.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split(' | '));
const name = (r: string[]) => r[0].slice(3, -1);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return e === '__tests__' || e === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e) ? [p] : [];
  });
}
const used = new Set<string>();
for (const d of ['app', 'components', 'lib', 'services', 'store', 'hooks', 'repositories'].map((x) => join(ROOT, x)).concat(join(ROOT, '..', 'supabase', 'functions'))) {
  for (const f of walk(d)) for (const m of readFileSync(f, 'utf8').matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)) used.add(m[1]);
}

it('every table the code reads is in the audit', () => {
  const listed = new Set(rows.map(name));
  expect(used.size).toBeGreaterThan(30);
  expect([...used].filter((t) => !listed.has(t)).sort()).toEqual([]);
});

it('the summary numbers are the table\'s', () => {
  const live = rows.filter((r) => r[1] === 'evet');
  expect(audit).toContain(`| Canlı tablo (public) | ${live.length},`);
  const notInRepo = live.filter((r) => /hayır/.test(r[2])).length;
  expect(audit).toContain(`**${notInRepo}'sinin CREATE'i repoda yok**`);
  // queried by the app but not live (fail-open until 028/029); the others are device-local
  const missing = rows.filter((r) => r[1] === '**hayır**' && used.has(name(r))).map(name).sort();
  expect(missing).toEqual(['habit_checklist_checks', 'habit_checklist_items', 'habit_goal_versions', 'habit_pauses']);
});

it('the proposal is written, not applied, and the audit says nothing was changed', () => {
  const sql = readFileSync(join(ROOT, '..', 'supabase', 'migrations', '036_live_audit_hardening.sql'), 'utf8');
  expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
  expect(audit).toMatch(/\*\*Hiçbir şey değiştirilmedi\*\*/);
  // the S11 fix keys awards by (habit, day): a deleted and rewritten day is not paid twice
  expect(sql).toMatch(/PRIMARY KEY \(habit_id, day\)/);
  expect(sql).toMatch(/v_prev := greatest\(coalesce\(v_paid, 0\)/);
});
