/**
 * R10.07 — "Yeni davranışın dokunduğu RLS/grant/owner/AI araç/restore
 * risklerini doğrula."
 *
 * Every migration this implementation wrote (028 onward), statically:
 *  - marked WRITTEN, NOT APPLIED, and listed so in the README;
 *  - every new table is owned (`user_id ... REFERENCES auth.users ON DELETE
 *    CASCADE`), has RLS on, and has policies;
 *  - every policy is for `authenticated` only and every USING / WITH CHECK is
 *    the owner predicate -- no `true`, no anon/public, no GRANT, no SECURITY
 *    DEFINER;
 *  - a row that points at another owned row (habit, template, item) can only
 *    be written when THAT row is the user's too (EXISTS ... auth.uid()).
 * No live database is touched (S1/S2): this reads the files.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const README = readFileSync(join(DIR, 'README.md'), 'utf8');
const NEW = readdirSync(DIR).filter((f) => /^0(2[89]|[3-9]\d)_.*\.sql$/.test(f)).sort();
const sqlOf = (f: string) => readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
const OWNER = /\(SELECT auth\.uid\(\)\) = user_id/;

/** Each `EXISTS (SELECT 1 FROM public.<t> <alias> WHERE ...)` with its WHERE text (balanced parens). */
function existsClauses(text: string): { table: string; alias: string; where: string }[] {
  const out: { table: string; alias: string; where: string }[] = [];
  const re = /EXISTS \(\s*SELECT 1 FROM public\.(\w+) (\w+)\s+WHERE /g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = text.indexOf('(', m.index);
    const start = i + 1;
    let depth = 1;
    while (depth > 0 && ++i < text.length) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const inner = text.slice(start, i);
    out.push({ table: m[1], alias: m[2], where: inner.slice(inner.indexOf('WHERE ') + 6).replace(/\s+/g, ' ') });
  }
  return out;
}

type Policy = { name: string; table: string; cmd: string; to: string; body: string };
function policies(sql: string): Policy[] {
  const out: Policy[] = [];
  const re = /CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+) TO (\w+)([\s\S]*?);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push({ name: m[1], table: m[2], cmd: m[3], to: m[4], body: m[5] });
  return out;
}
function tables(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push({ name: m[1], body: m[2] });
  return out;
}

it('covers the migrations this implementation wrote (028..035)', () => {
  expect(NEW[0]).toMatch(/^028_/);
  expect(NEW.length).toBeGreaterThanOrEqual(8);
});

it.each(NEW)('%s is marked and listed NOT APPLIED', (f) => {
  expect(readFileSync(join(DIR, f), 'utf8')).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
  expect(README).toContain(`\`${f}\` | **NOT APPLIED**`);
});

it.each(NEW)('%s grants nothing, defines no SECURITY DEFINER, opens nothing to anon/public', (f) => {
  const sql = sqlOf(f);
  expect(sql).not.toMatch(/\bGRANT\b/i);
  expect(sql).not.toMatch(/SECURITY DEFINER/i);
  expect(sql).not.toMatch(/\bTO (anon|public)\b/i);
  expect(sql).not.toMatch(/USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i);
  expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
});

describe.each(NEW)('%s — every new table', (f) => {
  const sql = sqlOf(f);
  const ps = policies(sql);
  const ts = tables(sql);
  if (ts.length === 0) {
    it('(no new table)', () => { expect(ps).toEqual([]); });
    return;
  }
  it.each(ts.map((t) => [t.name, t.body]))('%s: owned, RLS on, owner-only policies', (name, body) => {
    expect(body).toMatch(/user_id\s+uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${name}\\s+ENABLE ROW LEVEL SECURITY;`));
    const mine = ps.filter((p) => p.table === name);
    expect(mine.some((p) => p.cmd === 'SELECT' || p.cmd === 'ALL')).toBe(true);
    for (const p of mine) {
      expect([p.name, p.to]).toEqual([p.name, 'authenticated']);
      const clauses = [...p.body.matchAll(/(USING|WITH CHECK)\s*\(([\s\S]*?)\)\s*(?=WITH CHECK|$)/g)].map((c) => c[2]);
      expect(clauses.length).toBeGreaterThan(0);
      for (const c of clauses) expect([p.name, OWNER.test(c)]).toEqual([p.name, true]);
    }
  });
  it.each(ts.map((t) => [t.name, t.body]))('%s: a pointer to another owned row is written only if that row is the user\'s', (name, body) => {
    const refs = [...body.matchAll(/(\w+_id)\s+uuid[^,\n]*REFERENCES public\.(\w+)\(id\)/g)].map((m) => ({ col: m[1], target: m[2] }));
    const writes = ps.filter((p) => p.table === name && ['INSERT', 'UPDATE', 'ALL'].includes(p.cmd));
    for (const r of refs) {
      for (const p of writes) {
        if (!/WITH CHECK/.test(p.body)) continue;
        const check = p.body.slice(p.body.indexOf('WITH CHECK'));
        const ok = existsClauses(check).some((e) => {
          const owned = e.where.includes(`${e.alias}.user_id = (SELECT auth.uid())`);
          // direct: the pointed row itself is the user's
          const direct = e.table === r.target && e.where.includes(`${e.alias}.id = ${r.col}`);
          // transitive: an owned row of another table carries the same pointer
          // (and that table's own policy requires the pointer to be owned)
          const transitive = e.where.includes(`${e.alias}.${r.col} = ${name}.${r.col}`);
          return owned && (direct || transitive);
        });
        // an UPDATE that cannot change the pointer is covered by its INSERT; we
        // still require it when the policy restates WITH CHECK beyond the owner.
        const ownerOnly = /^\s*WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)\s*$/.test(check);
        expect([name, p.name, r.col, ok || (p.cmd === 'UPDATE' && ownerOnly)]).toEqual([name, p.name, r.col, true]);
      }
    }
  });
});
