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

// F02: a rollback script filed inside this directory would be applied FORWARD (the Supabase CLI
// applies every .sql file it finds here, and so does the CI loop): the most dangerous mistake the
// rollback contract can make. Rollbacks live in supabase/rollbacks/. One file here is named after a
// rollback and is NOT one in this sense: 014 is a "compatibility rollback" of 013's vocabulary that
// was itself applied FORWARD on 2026-08-31, a numbered migration like the others. It is the only
// exemption, and only because it predates 028.
const FORWARD_MIGRATIONS_NAMED_ROLLBACK = ['014_recovery_vocabulary_compat_rollback.sql'];
const hidingRollbacks = (files: string[]) =>
  files.filter((f) => /rollback/i.test(f) && !FORWARD_MIGRATIONS_NAMED_ROLLBACK.includes(f));

it('no rollback script is hiding inside supabase/migrations (the CLI would apply it forward)', () => {
  expect(hidingRollbacks(readdirSync(DIR))).toEqual([]);
});

it('the rollback check sees a misplaced script and spares only the historic forward migration (synthetic listing)', () => {
  const listing = ['036_live_audit_hardening.sql', 'README.md'];
  expect(hidingRollbacks([...listing, '036_live_audit_hardening.rollback.sql'])).toEqual(['036_live_audit_hardening.rollback.sql']);
  expect(hidingRollbacks([...listing, '038_rollback_036.sql'])).toEqual(['038_rollback_036.sql']);
  expect(hidingRollbacks([...listing, '037_ROLLBACK.SQL'])).toEqual(['037_ROLLBACK.SQL']);
  expect(hidingRollbacks([...listing, '014_recovery_vocabulary_compat_rollback.sql'])).toEqual([]);
  expect(hidingRollbacks(listing)).toEqual([]);
});

it('the one exemption is a real, applied, pre-028 forward migration (it cannot grow into a loophole)', () => {
  for (const f of FORWARD_MIGRATIONS_NAMED_ROLLBACK) {
    expect(readdirSync(DIR)).toContain(f);
    expect(Number(f.slice(0, 3))).toBeLessThan(28);
    expect(NEW).not.toContain(f);
    expect(README).toMatch(new RegExp(`\`${f}\` \\| \`\\d{14}\``)); // listed with the ledger version it was applied as
  }
});

it.each(NEW)('%s is marked and listed NOT APPLIED', (f) => {
  expect(readFileSync(join(DIR, f), 'utf8')).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
  expect(README).toContain(`\`${f}\` | **NOT APPLIED**`);
});

// 036 (live-audit hardening) narrows access, which needs two forms the
// blanket rule refused. Allowed, and nothing else:
//  - GRANT EXECUTE ON FUNCTION ... TO authenticated, or GRANT INSERT (cols) ON
//    ... TO authenticated, each right after a REVOKE of the same object;
//  - a SECURITY DEFINER function that pins its search_path and whose EXECUTE
//    the same file revokes from PUBLIC, anon and authenticated.
it.each(NEW)('%s grants only narrowing forms, defines no client-callable SECURITY DEFINER, opens nothing to anon/public', (f) => {
  const sql = sqlOf(f);
  const grants = sql.split('\n').filter((l) => /\bGRANT\b/i.test(l) && !/^\s*REVOKE\b/i.test(l));
  for (const g of grants) {
    const m = /^GRANT (EXECUTE ON FUNCTION (public\.\w+\([^)]*\))|INSERT \([a-z_, ]+\) ON (public\.\w+)) TO authenticated;$/.exec(g.trim());
    expect([g, !!m]).toEqual([g, true]);
    const obj = (m![2] ?? m![3])!;
    expect([g, sql.slice(0, sql.indexOf(g)).includes(`ON ${m![2] ? 'FUNCTION ' : ''}${obj} FROM`)]).toEqual([g, true]);
  }
  for (const d of sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(\)[\s\S]*?\$function\$;/g)) {
    if (!/SECURITY DEFINER/.test(d[0])) continue;
    expect([d[1], /SET search_path TO 'public'/.test(d[0])]).toEqual([d[1], true]);
    expect([d[1], sql.includes(`REVOKE EXECUTE ON FUNCTION ${d[1]}() FROM PUBLIC, anon, authenticated;`)]).toEqual([d[1], true]);
  }
  const definers = (sql.match(/SECURITY DEFINER/g) ?? []).length;
  const pinned = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.\w+\(\)[\s\S]*?\$function\$;/g)].filter((d) => /SECURITY DEFINER/.test(d[0])).length;
  expect(definers).toBe(pinned);
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
