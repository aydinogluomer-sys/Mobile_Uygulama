/**
 * F48 C9 (OD-07) — Live schema vs repository table queries & migration 036 invariants.
 *
 * Replaces the hardcoded 4-table `NOT APPLIED` list and `LIVE_SCHEMA_AUDIT.md`
 * markdown parsing so applying 028+ migrations and refreshing `live_schema.sql`
 * keeps this guard green automatically without losing coverage of unknown tables.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { presentInLiveSchema, readMigrationStatuses } from '../helpers/migrationStatus';
import { readSource } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(ROOT, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const README_PATH = join(MIGRATIONS_DIR, 'README.md');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      return e === '__tests__' || e === 'node_modules' || e === 'e2e' ? [] : walk(p);
    }
    return /\.(ts|tsx)$/.test(e) ? [p] : [];
  });
}

const used = new Set<string>();
for (const d of ['app', 'components', 'lib', 'services', 'store', 'hooks', 'repositories']
  .map((x) => join(ROOT, x))
  .concat(join(REPO_ROOT, 'supabase', 'functions'))) {
  for (const f of walk(d)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)) {
      used.add(m[1]);
    }
  }
}

const liveSchemaSql = readSource('..', 'supabase', 'live_schema.sql');
const statuses = readMigrationStatuses(MIGRATIONS_DIR, README_PATH);
const unappliedMigrationTables = new Set(
  statuses
    .filter((s) => s.header === 'NOT APPLIED')
    .flatMap((s) => s.objects.filter((o) => o.kind === 'table').map((o) => o.name)),
);

it('every table the code queries exists in live_schema.sql or in a tracked NOT APPLIED migration', () => {
  expect(used.size).toBeGreaterThan(30);
  const unaccounted = [...used]
    .filter(
      (t) =>
        !presentInLiveSchema(liveSchemaSql, { kind: 'table', name: t }) &&
        !unappliedMigrationTables.has(t),
    )
    .sort();
  expect(unaccounted).toEqual([]);
});

it('queried tables absent from live_schema.sql match the exact queried subset of NOT APPLIED migrations', () => {
  const missingFromLive = [...used]
    .filter((t) => !presentInLiveSchema(liveSchemaSql, { kind: 'table', name: t }))
    .sort();
  const expectedPending = [...used].filter((t) => unappliedMigrationTables.has(t)).sort();
  expect(missingFromLive).toEqual(expectedPending);
});

it('migration 036 status stays consistent and preserves its (habit_id, day) XP award ledger invariant', () => {
  const m036 = statuses.find((s) => s.number === 36);
  expect(m036).toBeDefined();
  expect(m036?.header).not.toBe('UNMARKED');
  expect(m036?.header).toBe(m036?.readmeRow);
  const sql = readSource('..', 'supabase', 'migrations', '036_live_audit_hardening.sql');
  expect(sql).toMatch(/PRIMARY KEY \(habit_id, day\)/);
  expect(sql).toMatch(/v_prev := greatest\(coalesce\(v_paid, 0\)/);
});
