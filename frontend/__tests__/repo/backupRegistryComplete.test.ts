/**
 * R08.01 / F20 (SYN-20) — "veri registry": every table the app touches AND every
 * public table in live_schema.sql + migrations 028+ is either in the backup
 * registry or named in NOT_BACKED_UP with a reason.
 */
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
import * as fs from 'fs';
import * as path from 'path';
import { NOT_BACKED_UP, REGISTRY, SERVER_COLLECTIONS } from '../../lib/backupFormat';
import { EXPORT_FULL_TABLES } from '../../repositories/exportRepository';
import { EXPORT_EXTRA_TABLES, RESTORE_TABLES } from '../../repositories/restoreRepository';

const ROOT = path.join(__dirname, '../..');
const REPO = path.join(ROOT, '..');

function tablesTouched(): string[] {
  const out = new Set<string>();
  for (const dir of ['repositories', 'services', 'lib']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.ts')) continue;
      for (const m of fs.readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(/\.from\('([a-z_]+)'\)/g)) {
        out.add(m[1]);
      }
    }
  }
  return [...out].sort();
}

function publicSchemaTables(): string[] {
  const out = new Set<string>();
  const sources = [
    fs.readFileSync(path.join(REPO, 'supabase', 'live_schema.sql'), 'utf8'),
    ...fs
      .readdirSync(path.join(REPO, 'supabase', 'migrations'))
      .filter((f) => /^0.*\.sql$/.test(f))
      .map((f) => fs.readFileSync(path.join(REPO, 'supabase', 'migrations', f), 'utf8')),
  ];
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  for (const sql of sources) {
    for (const m of sql.matchAll(re)) {
      const schema = (m[1] ?? 'public').toLowerCase();
      if (schema === 'public') out.add(m[2]);
    }
  }
  return [...out].sort();
}

function unclassifiedTables(names: readonly string[], known: ReadonlySet<string>): string[] {
  return names.filter((t) => !known.has(t));
}

it('every table the app touches is backed up or deliberately excluded', () => {
  const known = new Set([...REGISTRY.map((c) => c.name), ...Object.keys(NOT_BACKED_UP)]);
  const touched = tablesTouched();
  expect(touched.length).toBeGreaterThan(25);
  expect(unclassifiedTables(touched, known)).toEqual([]);
});

it('every public table in live_schema.sql and migrations 0*.sql is classified in REGISTRY or NOT_BACKED_UP', () => {
  const known = new Set([...REGISTRY.map((c) => c.name), ...Object.keys(NOT_BACKED_UP)]);
  const schemaTables = publicSchemaTables();
  expect(schemaTables.length).toBeGreaterThanOrEqual(58);
  expect(unclassifiedTables(schemaTables, known)).toEqual([]);
  // Negatif kontrol: yeni sınıflandırılmamış bir tablo eklenirse yakalanır
  expect(unclassifiedTables([...schemaTables, 'zz_new_table'], known)).toEqual(['zz_new_table']);
});

it('an exclusion is never also in the registry, and each says why', () => {
  for (const [t, why] of Object.entries(NOT_BACKED_UP)) {
    expect(REGISTRY.some((c) => c.name === t)).toBe(false);
    expect(why.length).toBeGreaterThan(10);
  }
});

it('the export reads every registered server collection', () => {
  const cursorDrained = ['tasks', 'projects', 'goals', 'notes', 'bad_habits'];
  const singleReads = ['profiles', 'user_onboarding'];
  const readByExport = [...new Set([...EXPORT_FULL_TABLES, ...cursorDrained, ...EXPORT_EXTRA_TABLES, ...singleReads])];
  expect(readByExport.sort()).toEqual([...SERVER_COLLECTIONS].sort());
});

it('restore can write exactly the collections the registry calls restorable', () => {
  expect([...RESTORE_TABLES].sort()).toEqual(REGISTRY.filter((c) => c.restorable).map((c) => c.name).sort());
});

it('every non-restorable collection explains itself', () => {
  for (const c of REGISTRY.filter((x) => !x.restorable)) expect([c.name, (c.reason ?? '').length > 10]).toEqual([c.name, true]);
});

it('a child is restored after its parent', () => {
  for (const c of REGISTRY) {
    for (const parent of Object.values(c.relations ?? {})) {
      const p = REGISTRY.find((x) => x.name === parent)!;
      expect([c.name, parent, p.order <= c.order]).toEqual([c.name, parent, true]);
    }
  }
});
