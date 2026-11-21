/**
 * R10.07 — "Yeni davranışın dokunduğu RLS/grant/owner/AI araç/restore
 * risklerini doğrula."
 *
 * Every migration this implementation wrote (028 onward), statically:
 *  - marked WRITTEN, NOT APPLIED, and listed so in the README;
 *  - every new table is owned (`user_id ... REFERENCES auth.users ON DELETE
 *    CASCADE`), has RLS on, and has policies;
 *  - every policy is for `authenticated` only and every USING / WITH CHECK is
 *    the owner predicate -- no `true`, no anon/public, no widening GRANT;
 *  - every SECURITY DEFINER function pins `search_path`, revokes EXECUTE from
 *    PUBLIC and anon, and is client-callable only with an `(SELECT auth.uid())` check;
 *  - a row that points at another owned row (habit, template, item) can only
 *    be written when THAT row is the user's too (EXISTS ... auth.uid()).
 * No live database is touched (S1/S2): this reads the files.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const README = readFileSync(join(DIR, 'README.md'), 'utf8');
const NEW = readdirSync(DIR).filter((f) => /^0(2[89]|[3-9]\d)_.*\.sql$/.test(f)).sort();
const stripComments = (raw: string) => raw.replace(/--[^\n]*/g, '');
const sqlOf = (f: string) => stripComments(readFileSync(join(DIR, f), 'utf8'));
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

it('covers the migrations this implementation wrote (028..035+)', () => {
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

// 036 and 040 (privilege hygiene) narrow access, which needs forms the blanket
// rule refused. Allowed, and nothing else (OWNER DECISION OD-05, 2026-11-21):
//  - GRANT EXECUTE ON FUNCTION <sig> TO authenticated, only after the same
//    file REVOKEd EXECUTE on that function FROM PUBLIC, anon;
//  - GRANT EXECUTE ON FUNCTION <sig> TO service_role, only after the same
//    file REVOKEd ALL/EXECUTE on that function FROM PUBLIC, anon, authenticated;
//  - GRANT INSERT (cols) / GRANT SELECT (cols) ON public.<t> TO authenticated,
//    each only after an earlier REVOKE on the same table;
//  - GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated, only
//    as the statement right after REVOKE ALL ON public.<t> FROM anon, PUBLIC;
//  - a SECURITY DEFINER function (any arity) that pins search_path to '',
//    'public' or 'public', 'pg_temp' and whose EXECUTE the same file revokes
//    from PUBLIC and anon; a client-callable one must also check auth.uid().
const SD_PATHS = [
  `SET search_path TO ''`,
  `SET search_path TO 'public'`,
  `SET search_path TO 'public', 'pg_temp'`,
];
const GRANT_FORMS: RegExp[] = [
  /^GRANT EXECUTE ON FUNCTION (public\.\w+\([^)]*\)) TO (authenticated|service_role);$/,
  /^GRANT (?:INSERT|SELECT) \([a-z_, ]+\) ON (public\.\w+) TO authenticated;$/,
  /^GRANT SELECT, INSERT, UPDATE, DELETE ON (public\.\w+) TO authenticated;$/,
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'p_user_id uuid, p_xp_amount integer' -> 'uuid, integer' (names and DEFAULTs dropped) */
function argTypes(args: string): string {
  return args
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => a.replace(/\s+DEFAULT\s+.*$/i, '').replace(/^\w+\s+/, ''))
    .join(', ');
}

export function grantViolations(rawSql: string): string[] {
  const sql = stripComments(rawSql);
  const out: string[] = [];
  const lines = sql.split('\n').map((l) => l.trim());
  const grants = lines.filter((l) => /\bGRANT\b/i.test(l) && !/^REVOKE\b/i.test(l));
  for (const g of grants) {
    const m = GRANT_FORMS.map((re) => re.exec(g)).find(Boolean);
    if (!m) {
      out.push(`disallowed-grant:${g}`);
      continue;
    }
    const isFn = g.startsWith('GRANT EXECUTE ON FUNCTION');
    const obj = m[1];
    const before = sql.slice(0, sql.indexOf(g));
    if (!before.includes(`ON ${isFn ? 'FUNCTION ' : ''}${obj} FROM`)) {
      out.push(`grant-without-revoke:${g}`);
    }
    if (g.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE')) {
      if (!before.trimEnd().endsWith(`REVOKE ALL ON ${obj} FROM anon, PUBLIC;`)) {
        out.push(`table-grant-without-immediate-revoke-all:${g}`);
      }
    }
    if (isFn) {
      const role = m[2];
      const expectedRevoke =
        role === 'service_role'
          ? new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION ${escapeRe(obj)} FROM PUBLIC, anon, authenticated;`)
          : new RegExp(`REVOKE EXECUTE ON FUNCTION ${escapeRe(obj)} FROM PUBLIC, anon;`);
      if (!expectedRevoke.test(before)) {
        out.push(`fn-grant-without-matching-revoke:${g}`);
      }
    }
  }
  if (/\bTO (anon|public)\b/i.test(sql)) out.push('opens-to-anon-or-public');
  if (/USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i.test(sql)) out.push('tautology-policy');
  if (/DISABLE ROW LEVEL SECURITY/i.test(sql)) out.push('disables-rls');
  return out;
}

export function securityDefinerViolations(rawSql: string): string[] {
  const sql = stripComments(rawSql);
  const out: string[] = [];
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)[\s\S]*?\$function\$;/g)]
    .filter((d) => /SECURITY DEFINER/.test(d[0]));
  if ((sql.match(/SECURITY DEFINER/g) ?? []).length !== defs.length) {
    out.push('unparsed-security-definer');
  }
  for (const d of defs) {
    const sig = `${d[1]}(${argTypes(d[2])})`;
    if (!SD_PATHS.some((p) => d[0].includes(p))) {
      out.push(`unpinned-search-path:${sig}`);
    }
    const revoke = new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION ${escapeRe(sig)} FROM PUBLIC, anon(, authenticated)?;`);
    if (!revoke.test(sql)) {
      out.push(`missing-revoke:${sig}`);
    }
    if (sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`)) {
      if (!/\(SELECT auth\.uid\(\)\)/.test(d[0])) {
        out.push(`client-definer-without-auth-uid:${sig}`);
      }
    }
  }
  return out;
}

export function policyViolations(rawSql: string): string[] {
  const sql = stripComments(rawSql);
  const out: string[] = [];
  const rawPolicies = (sql.match(/CREATE POLICY\b/gi) ?? []).length;
  const parsed = policies(sql);
  if (parsed.length !== rawPolicies) {
    out.push('policy-missing-for-or-to-clause');
  }
  for (const p of parsed) {
    if (p.to !== 'authenticated') out.push(`policy-not-authenticated:${p.name}`);
    const clauses = [...p.body.matchAll(/(USING|WITH CHECK)\s*\(([\s\S]*?)\)\s*(?=WITH CHECK|$)/g)].map((c) => c[2]);
    if (clauses.length === 0) out.push(`policy-empty-clauses:${p.name}`);
    for (const c of clauses) {
      if (!OWNER.test(c)) out.push(`policy-not-owner-bound:${p.name}`);
    }
  }
  return out;
}

it.each(NEW)('%s grants only narrowing forms and opens nothing to anon/public', (f) => {
  const sql = sqlOf(f);
  const lines = sql.split('\n').map((l) => l.trim());
  const grants = lines.filter((l) => /\bGRANT\b/i.test(l) && !/^REVOKE\b/i.test(l));
  for (const g of grants) {
    const m = GRANT_FORMS.map((re) => re.exec(g)).find(Boolean);
    expect([g, !!m]).toEqual([g, true]);
    const isFn = g.startsWith('GRANT EXECUTE ON FUNCTION');
    const obj = m![1];
    const before = sql.slice(0, sql.indexOf(g));
    expect([g, before.includes(`ON ${isFn ? 'FUNCTION ' : ''}${obj} FROM`)]).toEqual([g, true]);
    if (g.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE')) {
      expect([g, before.trimEnd().endsWith(`REVOKE ALL ON ${obj} FROM anon, PUBLIC;`)]).toEqual([g, true]);
    }
    if (isFn) {
      const role = m![2];
      const expectedRevoke =
        role === 'service_role'
          ? new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION ${escapeRe(obj)} FROM PUBLIC, anon, authenticated;`)
          : new RegExp(`REVOKE EXECUTE ON FUNCTION ${escapeRe(obj)} FROM PUBLIC, anon;`);
      expect([g, expectedRevoke.test(before)]).toEqual([g, true]);
    }
  }
  expect(sql).not.toMatch(/\bTO (anon|public)\b/i);
  expect(sql).not.toMatch(/USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i);
  expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
});

it.each(NEW)('%s: every SECURITY DEFINER function pins search_path, revokes PUBLIC and anon, and is client-callable only with an auth.uid() check', (f) => {
  const sql = sqlOf(f);
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)[\s\S]*?\$function\$;/g)]
    .filter((d) => /SECURITY DEFINER/.test(d[0]));
  expect((sql.match(/SECURITY DEFINER/g) ?? []).length).toBe(defs.length);
  for (const d of defs) {
    const sig = `${d[1]}(${argTypes(d[2])})`;
    expect([sig, SD_PATHS.some((p) => d[0].includes(p))]).toEqual([sig, true]);
    const revoke = new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION ${escapeRe(sig)} FROM PUBLIC, anon(, authenticated)?;`);
    expect([sig, revoke.test(sql)]).toEqual([sig, true]);
    if (sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`)) {
      expect([sig, /\(SELECT auth\.uid\(\)\)/.test(d[0])]).toEqual([sig, true]);
    }
  }
});

it.each(NEW)('%s: every policy, on a new or an existing table, is authenticated-only and owner-bound', (f) => {
  for (const p of policies(sqlOf(f))) {
    expect([p.name, p.to]).toEqual([p.name, 'authenticated']);
    const clauses = [...p.body.matchAll(/(USING|WITH CHECK)\s*\(([\s\S]*?)\)\s*(?=WITH CHECK|$)/g)].map((c) => c[2]);
    expect(clauses.length).toBeGreaterThan(0);
    for (const c of clauses) expect([p.name, OWNER.test(c)]).toEqual([p.name, true]);
  }
});

describe.each(NEW)('%s — every new table', (f) => {
  const sql = sqlOf(f);
  const ps = policies(sql);
  const ts = tables(sql);
  if (ts.length === 0) {
    it('(no new table)', () => { expect(ps.every((p) => p.to === 'authenticated')).toBe(true); });
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

describe('OD-05 synthetic negative controls: only narrowing forms pass', () => {
  it('(a) rejects GRANT EXECUTE ON FUNCTION ... TO authenticated without preceding REVOKE', () => {
    const bad = 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated;';
    expect(grantViolations(bad)).toContain(`grant-without-revoke:${bad}`);
    expect(grantViolations(bad)).toContain(`fn-grant-without-matching-revoke:${bad}`);
  });

  it('(a2) rejects GRANT EXECUTE ON FUNCTION ... TO service_role without full client REVOKE', () => {
    const bad = [
      'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon;',
      'GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;',
    ].join('\n');
    expect(grantViolations(bad)).toContain(
      'fn-grant-without-matching-revoke:GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;',
    );
  });

  it('(b) rejects parameterized SECURITY DEFINER with unquoted SET search_path TO public', () => {
    const bad = [
      'CREATE OR REPLACE FUNCTION public.f(p_id uuid)',
      ' RETURNS void LANGUAGE plpgsql SECURITY DEFINER',
      ' SET search_path TO public',
      'AS $function$ BEGIN NULL; END; $function$;',
      'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon, authenticated;',
    ].join('\n');
    expect(securityDefinerViolations(bad)).toEqual(['unpinned-search-path:public.f(uuid)']);
  });

  it('(c) rejects client-callable SECURITY DEFINER without (SELECT auth.uid()) check', () => {
    const bad = [
      'CREATE OR REPLACE FUNCTION public.f(p_id uuid DEFAULT NULL)',
      ' RETURNS void LANGUAGE plpgsql SECURITY DEFINER',
      " SET search_path TO 'public', 'pg_temp'",
      'AS $function$ BEGIN PERFORM 1; END; $function$;',
      'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon;',
      'GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated;',
    ].join('\n');
    expect(securityDefinerViolations(bad)).toEqual(['client-definer-without-auth-uid:public.f(uuid)']);
  });

  it('(d) rejects table-level CRUD GRANT without immediately preceding REVOKE ALL ... FROM anon, PUBLIC;', () => {
    const noRevoke = 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated;';
    expect(grantViolations(noRevoke)).toContain(`table-grant-without-immediate-revoke-all:${noRevoke}`);

    const wrongOrder = [
      'REVOKE ALL ON public.t FROM anon, PUBLIC;',
      'SELECT 1;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated;',
    ].join('\n');
    expect(grantViolations(wrongOrder)).toContain(
      'table-grant-without-immediate-revoke-all:GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated;',
    );
  });

  it('(e) rejects CREATE POLICY TO public USING (true) and non-owner predicates', () => {
    const bad = 'CREATE POLICY p ON public.t FOR SELECT TO public USING (true);';
    expect(grantViolations(bad)).toContain('opens-to-anon-or-public');
    expect(grantViolations(bad)).toContain('tautology-policy');
    expect(policyViolations(bad)).toContain('policy-not-authenticated:p');
    expect(policyViolations(bad)).toContain('policy-not-owner-bound:p');
  });

  it('(f) accepts valid narrowing forms cleanly', () => {
    const clean = [
      'CREATE OR REPLACE FUNCTION public.f(p_limit integer DEFAULT 50)',
      ' RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER',
      " SET search_path TO 'public', 'pg_temp'",
      'AS $function$ BEGIN IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION \'auth\'; END IF; END; $function$;',
      'REVOKE EXECUTE ON FUNCTION public.f(integer) FROM PUBLIC, anon;',
      'GRANT EXECUTE ON FUNCTION public.f(integer) TO authenticated;',
      'REVOKE ALL ON public.t FROM anon, PUBLIC;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated;',
      'REVOKE ALL ON public.secret FROM anon, PUBLIC, authenticated;',
      'GRANT SELECT (id, user_id) ON public.secret TO authenticated;',
      'CREATE POLICY secret_own ON public.secret FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);',
    ].join('\n');
    expect(grantViolations(clean)).toEqual([]);
    expect(securityDefinerViolations(clean)).toEqual([]);
    expect(policyViolations(clean)).toEqual([]);
  });
});
