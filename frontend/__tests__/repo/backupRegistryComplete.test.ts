/**
 * R08.01 — "veri registry": every table the app reads or writes is either in
 * the backup registry or named in NOT_BACKED_UP with a reason. A new table
 * that lands in neither turns this red.
 */
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
import * as fs from 'fs';
import * as path from 'path';
import { REGISTRY, NOT_BACKED_UP, SERVER_COLLECTIONS } from '../../lib/backupFormat';
import { RESTORE_TABLES, EXPORT_EXTRA_TABLES } from '../../repositories/restoreRepository';

const ROOT = path.join(__dirname, '../..');
function tablesTouched(): string[] {
  const out = new Set<string>();
  for (const dir of ['repositories', 'services', 'lib']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.ts')) continue;
      for (const m of fs.readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(/\.from\('([a-z_]+)'\)/g)) out.add(m[1]);
    }
  }
  return [...out].sort();
}

it('every table the app touches is backed up or deliberately excluded', () => {
  const known = new Set([...REGISTRY.map((c) => c.name), ...Object.keys(NOT_BACKED_UP)]);
  const touched = tablesTouched();
  expect(touched.length).toBeGreaterThan(25); // scanner sanity
  expect(touched.filter((t) => !known.has(t))).toEqual([]);
});

it('an exclusion is never also in the registry, and each says why', () => {
  for (const [t, why] of Object.entries(NOT_BACKED_UP)) {
    expect(REGISTRY.some((c) => c.name === t)).toBe(false);
    expect(why.length).toBeGreaterThan(10);
  }
});

it('the export reads every registered server collection', () => {
  const base = ['habits', 'habit_logs', 'tasks', 'projects', 'goals', 'notes', 'journal_entries', 'focus_sessions', 'bad_habits', 'webhooks'];
  expect([...new Set([...base, ...EXPORT_EXTRA_TABLES])].sort()).toEqual([...SERVER_COLLECTIONS].sort());
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
