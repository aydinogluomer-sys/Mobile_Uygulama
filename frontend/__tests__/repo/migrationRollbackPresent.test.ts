/**
 * F02: every migration from 028 on has a rollback script, and the scripts keep their contract.
 *
 * ## Why this file exists
 *
 * Migrations 028..037 are written but not applied (the owner applies them, OD-02). Until F02
 * they existed only in the forward direction: an owner who applied one on a Supabase branch,
 * saw a problem and wanted to go back had no tested way to do it (DB1-15). Worse, rolling 036
 * back naively would have made `xp_drift()` report users forever (DB2-07): the ledger keeps the
 * highest award of a day that was deleted and written again with less, `total_xp` was raised by
 * it once, `habit_logs` no longer carries it.
 *
 * The behaviour itself (apply, roll back, compare the catalog, apply again) runs on a real
 * Postgres 17 in the `db-migrations-verify` CI job, because jest cannot run SQL. This file
 * locks what jest CAN lock, so the SQL proof cannot quietly lose its footing:
 *
 *   - every `NNN_*.sql` from 028 on has `supabase/rollbacks/NNN_*.rollback.sql`, and nothing
 *     else lives there (an orphan script, or one filed under migrations/, would be applied or
 *     forgotten);
 *   - each script is one transaction, asks for its OWN number in `aderyth.rollback_confirm`
 *     before it does anything, never cascades, never drops a schema, never touches `auth`;
 *   - the scripts really undo what the migrations did: the tables, the column, the constraint
 *     lists, the policy, the function body (byte for byte against the live dump), the grants
 *     (derived from the migration's own REVOKEs and the live dump's GRANTs, not retyped);
 *   - 036 moves the ledger's excess XP into `purged_xp` BEFORE it drops the ledger, and checks
 *     the books itself; 032/034/035 never delete a row of a newer type;
 *   - the fingerprint that the CI diff relies on can see what the rollback changes (ACLs are
 *     normalised with `acldefault`, so an object REVOKEd and GRANTed back prints like an
 *     untouched one);
 *   - CI runs the cycle in the right order, against the throwaway database only;
 *   - the owner documents list every script.
 *
 * The denied Supabase project is never written into this file; the guard script declares it and
 * this test reads it from there at run time (crossProjectIsolation.test.ts rules A and B).
 *
 * Positive and negative cases are both here: every check of `rollbackProblems` is also fed
 * synthetic text that contains exactly the defect it exists to catch.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { at } from '../helpers/sourceText';

// ---------------------------------------------------------------------------------------
// the contract as pure functions
// ---------------------------------------------------------------------------------------

export type RollbackProblem =
  | 'missing-status-marker'
  | 'missing-confirm-guard'
  | 'confirm-number-mismatch'
  | 'missing-transaction'
  | 'uses-cascade'
  | 'drops-schema'
  | 'touches-auth-schema';

/** Removes `--` line comments and block comments that sit outside single-quoted strings. */
const stripSqlComments = (sql: string): string => {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
};

/** The guard: `IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> 'NNN' THEN RAISE EXCEPTION`. */
const CONFIRM_GUARD = /current_setting\(\s*'aderyth\.rollback_confirm'\s*,\s*true\s*\)[^;]*?(?:<>|!=)\s*'([^']*)'\s*THEN\s*RAISE\s+EXCEPTION/i;

/** CASCADE that is not the action of an `ON DELETE` / `ON UPDATE` clause (that one re-creates a foreign key). */
const CASCADE = /(?<!\bON\s+(?:DELETE|UPDATE)\s+)\bCASCADE\b/i;

const DROP_SCHEMA = /\bDROP\s+SCHEMA\b/i;

/**
 * A statement that CHANGES something in the `auth` schema. Only the target counts: reading
 * `auth.uid()` in a policy, or a foreign key REFERENCES auth.users(id), changes nothing there.
 */
const AUTH_TARGETS: RegExp[] = [
  /\b(?:ALTER|DROP)\s+(?:MATERIALIZED\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|ROUTINE|AGGREGATE|SEQUENCE|TYPE|DOMAIN|INDEX|EXTENSION)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?auth"?\s*\./i,
  /\b(?:ALTER|DROP)\s+(?:POLICY|TRIGGER|RULE)\s+(?:IF\s+EXISTS\s+)?(?:"[^"]*"|\w+)\s+ON\s+(?:ONLY\s+)?"?auth"?\s*\./i,
  /\b(?:ALTER|DROP)\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?"?auth"?(?![\w."])/i,
  /\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+(?:(?:TABLE|FUNCTION|PROCEDURE|ROUTINE|SEQUENCE|TYPE|DOMAIN|ALL\s+\w+\s+IN\s+SCHEMA|SCHEMA)\s+)?"?auth"?(?:\s*\.|\s+(?:TO|FROM)\b)/i,
  /\bTRUNCATE\b[^;]*?\bauth\s*\./i,
  /\b(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO)\s+"?auth"?\s*\./i,
];

/**
 * Every contract violation of ONE rollback script (empty = fine). Pure: the file name gives the
 * number the confirmation must carry; the text is checked as written, with comments removed
 * for everything except the status marker (which lives in a comment).
 *
 * `missing-transaction` covers three defects: `BEGIN;` does not open the script, `COMMIT;` does
 * not close it, or the confirmation guard runs OUTSIDE that transaction. The last one matters
 * most: a guard that fails before `BEGIN;` leaves the rest of the script free to run for a
 * client that does not stop on errors; inside the transaction a failed guard aborts it and every
 * later statement is refused.
 */
export function rollbackProblems(fileName: string, text: string): RollbackProblem[] {
  const raw = text.replace(/\r\n?/g, '\n');
  const code = stripSqlComments(raw);
  const trimmed = code.trim();
  const number = /^(\d{3})_/.exec(fileName)?.[1];
  const problems: RollbackProblem[] = [];

  if (!/STATUS: WRITTEN, NOT APPLIED/.test(raw)) problems.push('missing-status-marker');

  const guard = CONFIRM_GUARD.exec(code);
  if (!guard) problems.push('missing-confirm-guard');
  else if (guard[1] !== number) problems.push('confirm-number-mismatch');

  const guardOutside = guard !== null && /\bCOMMIT\s*;/i.test(code.slice(0, guard.index));
  if (!/^BEGIN\s*;/i.test(trimmed) || !/\bCOMMIT\s*;$/i.test(trimmed) || guardOutside) problems.push('missing-transaction');

  if (CASCADE.test(code)) problems.push('uses-cascade');
  if (DROP_SCHEMA.test(code)) problems.push('drops-schema');
  if (AUTH_TARGETS.some((re) => re.test(code))) problems.push('touches-auth-schema');
  return problems;
}

/** `028_habit_pauses_and_goal_versions.sql` -> `028_habit_pauses_and_goal_versions.rollback.sql` */
export function rollbackNameFor(migrationFile: string): string {
  if (!/^\d{3}_.+\.sql$/.test(migrationFile) || /\.rollback\.sql$/.test(migrationFile)) {
    throw new Error(`not a forward migration file name: ${migrationFile}`);
  }
  return migrationFile.replace(/\.sql$/, '.rollback.sql');
}

/** The migrations that need a rollback: the ones written after the last applied migration (028 on). */
const MIGRATION_FILE = /^0(2[89]|[3-9]\d)_.*\.sql$/;

/** What may live in `supabase/rollbacks/`. */
const ROLLBACK_DIR_FIXED = ['README.md', 'catalog_fingerprint.sql'];
const ROLLBACK_FILE = /^\d{3}_[a-z0-9_]+\.rollback\.sql$/;

type DirReport = { missing: string[]; orphans: string[]; unexpected: string[] };

/**
 * Compares the migration list with the rollback directory listing. Injectable lists, so the
 * negative cases need no files on disk.
 *  - missing    a migration without its `.rollback.sql`
 *  - orphans    a `.rollback.sql` without the migration it claims to undo
 *  - unexpected anything else (a stray script, a backup file, a draft)
 */
function checkRollbackDir(migrations: string[], listing: string[]): DirReport {
  const wanted = new Set(migrations.map(rollbackNameFor));
  const bodies = new Set(migrations.map((m) => m.replace(/\.sql$/, '')));
  const missing = [...wanted].filter((w) => !listing.includes(w)).sort();
  const orphans = listing.filter((f) => ROLLBACK_FILE.test(f) && !bodies.has(f.replace(/\.rollback\.sql$/, ''))).sort();
  const unexpected = listing.filter((f) => !ROLLBACK_DIR_FIXED.includes(f) && !ROLLBACK_FILE.test(f)).sort();
  return { missing, orphans, unexpected };
}

/**
 * The text between the dollar quotes of `CREATE OR REPLACE FUNCTION public.<name>(`. Reads both the
 * live dump (quoted identifiers, `$$`) and hand-written SQL (plain identifiers, `$function$`).
 */
const functionBody = (sql: string, name: string): string => {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION (?:"public"|public)\\.(?:"${name}"|${name})\\(`).exec(sql);
  if (!head) throw new Error(`function ${name} is not defined in this text`);
  const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(head.index));
  if (!open) throw new Error(`function ${name} has no dollar-quoted body`);
  const start = head.index + open.index + open[0].length;
  const end = sql.indexOf(open[1], start);
  if (end < 0) throw new Error(`function ${name} body is not closed`);
  return sql.slice(start, end);
};

// ---------------------------------------------------------------------------------------
// the inputs
// ---------------------------------------------------------------------------------------

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');
const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations');
const ROLLBACKS_DIR = join(REPO, 'supabase', 'rollbacks');

const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_FILE.test(f)).sort();
const LISTING = existsSync(ROLLBACKS_DIR) ? readdirSync(ROLLBACKS_DIR).sort() : [];
const SCRIPTS = LISTING.filter((f) => ROLLBACK_FILE.test(f));
const numberOf = (file: string): string => file.slice(0, 3);

const scriptText = (script: string): string => read(`supabase/rollbacks/${script}`);
const scriptCode = (script: string): string => stripSqlComments(scriptText(script));
const migrationText = (file: string): string => read(`supabase/migrations/${file}`);
const migrationCode = (file: string): string => stripSqlComments(migrationText(file));
const scriptFor = (num: string): string => {
  const hit = SCRIPTS.find((s) => s.startsWith(`${num}_`));
  if (!hit) throw new Error(`no rollback script for ${num}`);
  return hit;
};
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

const live = read('supabase/live_schema.sql');
const ci = read('.github/workflows/ci.yml');
const ownerDoc = read('docs/implementation-v3/SQL_FOR_OWNER.md');
const rollbackReadme = read('supabase/rollbacks/README.md');
const migrationsReadme = read('supabase/migrations/README.md');
const fingerprint = read('supabase/rollbacks/catalog_fingerprint.sql');
const guardSh = read('supabase/predeploy_guard.sh');

// ---------------------------------------------------------------------------------------
describe('the scan sees the migrations and the rollbacks (it is not silently empty)', () => {
  it('finds migrations 028..037 and one rollback script for each', () => {
    expect(MIGRATIONS[0]).toMatch(/^028_/);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(10);
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('every migration from 028 on has a rollback script', () => {
  it.each(MIGRATIONS.map((m) => [m, rollbackNameFor(m)]))('%s -> %s exists', (_migration, script) => {
    expect(existsSync(join(ROLLBACKS_DIR, script))).toBe(true);
  });

  it('the rollback directory holds the scripts, the fingerprint and the README, nothing else', () => {
    expect(checkRollbackDir(MIGRATIONS, LISTING)).toEqual({ missing: [], orphans: [], unexpected: [] });
  });

  it('a fake 029_x.sql migration with no partner is reported as missing (synthetic listing)', () => {
    const report = checkRollbackDir(['028_a.sql', '029_x.sql'], ['README.md', 'catalog_fingerprint.sql', '028_a.rollback.sql']);
    expect(report.missing).toEqual(['029_x.rollback.sql']);
    expect(report.orphans).toEqual([]);
    expect(report.unexpected).toEqual([]);
  });

  it('a rollback script without its migration is an orphan; a stray file is unexpected (synthetic listing)', () => {
    const report = checkRollbackDir(['028_a.sql'], ['README.md', 'catalog_fingerprint.sql', '028_a.rollback.sql', '030_gone.rollback.sql', '028_a.rollback.sql.bak', 'notes.txt']);
    expect(report.orphans).toEqual(['030_gone.rollback.sql']);
    expect(report.unexpected).toEqual(['028_a.rollback.sql.bak', 'notes.txt']);
    expect(report.missing).toEqual([]);
  });

  it('a complete synthetic directory is clean', () => {
    const report = checkRollbackDir(['028_a.sql', '029_b.sql'], ['028_a.rollback.sql', '029_b.rollback.sql', 'README.md', 'catalog_fingerprint.sql']);
    expect(report).toEqual({ missing: [], orphans: [], unexpected: [] });
  });

  it('rollbackNameFor maps a migration to its partner and refuses names that are not forward migrations', () => {
    expect(rollbackNameFor('028_habit_pauses_and_goal_versions.sql')).toBe('028_habit_pauses_and_goal_versions.rollback.sql');
    expect(() => rollbackNameFor('028_x.rollback.sql')).toThrow();
    expect(() => rollbackNameFor('README.md')).toThrow();
    expect(() => rollbackNameFor('28_short.sql')).toThrow();
  });
});

describe('every rollback script keeps the contract', () => {
  it.each(SCRIPTS)('%s: no contract violation', (script) => {
    expect({ script, problems: rollbackProblems(script, scriptText(script)) }).toEqual({ script, problems: [] });
  });

  it.each(SCRIPTS)('%s: marked WRITTEN, NOT APPLIED, one transaction, asks for its OWN number', (script) => {
    const text = scriptText(script);
    const code = scriptCode(script).trim();
    expect(text).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(code.startsWith('BEGIN;')).toBe(true);
    expect(code.endsWith('COMMIT;')).toBe(true);
    const guard = CONFIRM_GUARD.exec(code);
    expect(guard?.[1]).toBe(numberOf(script));
    // the message tells the owner the exact command
    expect(code).toContain(`SET aderyth.rollback_confirm = ''${numberOf(script)}'';`);
    // the guard raises P0001 and sits inside the transaction
    expect(code).toMatch(/USING ERRCODE = 'P0001'/);
    expect(code.indexOf('BEGIN;')).toBeLessThan(guard!.index);
    // nothing of the script runs outside the transaction: a single BEGIN, a single COMMIT
    expect(code.match(/\bBEGIN\s*;/gi)).toHaveLength(1);
    expect(code.match(/\bCOMMIT\s*;/gi)).toHaveLength(1);
  });

  it.each(SCRIPTS)('%s: nothing but BEGIN and the confirmation guard comes before the first change', (script) => {
    const code = scriptCode(script);
    const guardAt = CONFIRM_GUARD.exec(code)!.index;
    expect(code.slice(0, guardAt)).not.toMatch(/\b(?:DROP|ALTER|UPDATE|DELETE|INSERT|CREATE|GRANT|REVOKE|TRUNCATE)\b/i);
    // and something does come after it: the guard is not the whole script
    const afterGuard = code.slice(at(code, 'END $guard$;') + 'END $guard$;'.length);
    expect(afterGuard).toMatch(/\b(?:DROP|ALTER|UPDATE|DELETE|INSERT|CREATE|GRANT|REVOKE|TRUNCATE)\b/i);
  });

  it('the destructive scripts say so in their first lines (data loss is stated up front)', () => {
    for (const num of ['028', '029', '030', '031', '033']) {
      expect(scriptText(scriptFor(num)).split('\n').slice(0, 3).join('\n')).toMatch(/Destructive/);
    }
    expect(scriptText(scriptFor('036')).split('\n').slice(0, 3).join('\n')).toMatch(/REOPENS/);
  });

  it('no script reaches a live project or names the denied one', () => {
    const denied = /^DENIED="([^"]+)"/m.exec(guardSh)?.[1] ?? '';
    expect(denied).toMatch(/^[a-z]{20}$/); // positive control: the guard still declares it
    const LIVE = /supabase\s+(?:db\s+(?:push|pull|reset|remote)|link|functions\s+deploy|migration\s+repair|secrets|projects|login|start)\b|\.supabase\.co\b|--db-url/;
    for (const file of LISTING) {
      const text = read(`supabase/rollbacks/${file}`);
      expect({ file, live: LIVE.test(text), denied: text.includes(denied) }).toEqual({ file, live: false, denied: false });
    }
    expect(readFileSync(__filename, 'utf8')).not.toContain(denied);
  });
});

describe('rollbackProblems catches each defect (synthetic scripts)', () => {
  /** A script that satisfies the whole contract; each case below breaks exactly one thing. */
  const clean = (num: string, body = 'DROP TABLE IF EXISTS public.thing;'): string =>
    [
      `-- ROLLBACK of ${num}_thing.sql`,
      '-- STATUS: WRITTEN, NOT APPLIED.',
      'BEGIN;',
      '',
      'DO $guard$',
      'BEGIN',
      `  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '${num}' THEN`,
      `    RAISE EXCEPTION 'run: SET aderyth.rollback_confirm = ''${num}'';'`,
      "      USING ERRCODE = 'P0001';",
      '  END IF;',
      'END $guard$;',
      '',
      body,
      '',
      'COMMIT;',
      '',
    ].join('\n');
  const name = '033_thing.rollback.sql';

  it('a clean script has no problem', () => {
    expect(rollbackProblems(name, clean('033'))).toEqual([]);
  });

  it('CRLF line endings are read the same way', () => {
    expect(rollbackProblems(name, clean('033').replace(/\n/g, '\r\n'))).toEqual([]);
  });

  it('missing-status-marker: no STATUS line', () => {
    expect(rollbackProblems(name, clean('033').replace('STATUS: WRITTEN, NOT APPLIED.', 'STATUS: applied'))).toEqual(['missing-status-marker']);
  });

  it('missing-confirm-guard: no confirmation block at all', () => {
    const text = ['-- STATUS: WRITTEN, NOT APPLIED.', 'BEGIN;', 'DROP TABLE IF EXISTS public.thing;', 'COMMIT;', ''].join('\n');
    expect(rollbackProblems(name, text)).toEqual(['missing-confirm-guard']);
  });

  it('missing-confirm-guard: a guard that only compares and never raises', () => {
    const text = clean('033').replace("RAISE EXCEPTION 'run: SET aderyth.rollback_confirm = ''033'';'\n      USING ERRCODE = 'P0001';", 'NULL;');
    expect(rollbackProblems(name, text)).toContain('missing-confirm-guard');
  });

  it('confirm-number-mismatch: the guard asks for another script\'s number', () => {
    expect(rollbackProblems(name, clean('034'))).toEqual(['confirm-number-mismatch']);
    expect(rollbackProblems('034_thing.rollback.sql', clean('033'))).toEqual(['confirm-number-mismatch']);
  });

  it('missing-transaction: no BEGIN, no COMMIT', () => {
    expect(rollbackProblems(name, clean('033').replace('BEGIN;\n', ''))).toEqual(['missing-transaction']);
    expect(rollbackProblems(name, clean('033').replace('COMMIT;\n', ''))).toEqual(['missing-transaction']);
  });

  it('missing-transaction: the guard runs before BEGIN (outside the transaction)', () => {
    const text = clean('033');
    const guardStart = text.indexOf('DO $guard$');
    const guardEnd = text.indexOf('END $guard$;') + 'END $guard$;'.length;
    const guard = text.slice(guardStart, guardEnd);
    const moved = text.replace(guard, '').replace('BEGIN;', `${guard}\nBEGIN;`);
    expect(rollbackProblems(name, moved)).toContain('missing-transaction');
  });

  it('missing-transaction: the transaction is closed before the guard', () => {
    const text = clean('033').replace('BEGIN;', 'BEGIN;\nCOMMIT;\nBEGIN;');
    expect(rollbackProblems(name, text)).toContain('missing-transaction');
  });

  it('uses-cascade: DROP TABLE x CASCADE', () => {
    expect(rollbackProblems(name, clean('033', 'DROP TABLE x CASCADE;'))).toEqual(['uses-cascade']);
    expect(rollbackProblems(name, clean('033', 'DROP TABLE x\n  CASCADE;'))).toEqual(['uses-cascade']);
    expect(rollbackProblems(name, clean('033', "EXECUTE 'DROP TABLE x cascade';"))).toEqual(['uses-cascade']);
  });

  it('uses-cascade is NOT raised by the ON DELETE CASCADE action that re-creates a foreign key (038 needs it)', () => {
    const fk = 'ALTER TABLE public.habit_xp_awards ADD CONSTRAINT habit_xp_awards_habit_id_fkey FOREIGN KEY (habit_id) REFERENCES public.habits(id) ON DELETE CASCADE;';
    expect(rollbackProblems(name, clean('033', fk))).toEqual([]);
    expect(rollbackProblems(name, clean('033', fk.replace('ON DELETE CASCADE', 'ON UPDATE CASCADE')))).toEqual([]);
    expect(rollbackProblems(name, clean('033', fk.replace('ON DELETE CASCADE', 'ON\n    DELETE\n    CASCADE')))).toEqual([]);
  });

  it('uses-cascade ignores the word in comments', () => {
    expect(rollbackProblems(name, clean('033', '-- never DROP ... CASCADE here\nDROP TABLE IF EXISTS public.thing;'))).toEqual([]);
    expect(rollbackProblems(name, clean('033', '/* DROP TABLE x CASCADE */\nDROP TABLE IF EXISTS public.thing;'))).toEqual([]);
  });

  it('drops-schema: DROP SCHEMA', () => {
    expect(rollbackProblems(name, clean('033', 'DROP SCHEMA IF EXISTS aderyth_test;'))).toEqual(['drops-schema']);
  });

  it('touches-auth-schema: ALTER / DROP / GRANT / REVOKE / TRUNCATE / DML aimed at auth', () => {
    for (const bad of [
      'ALTER TABLE auth.users ADD COLUMN x int;',
      'DROP FUNCTION auth.uid();',
      'DROP POLICY p ON auth.users;',
      'ALTER SCHEMA auth OWNER TO postgres;',
      'GRANT SELECT ON auth.users TO anon;',
      'GRANT USAGE ON SCHEMA auth TO anon;',
      'REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM anon;',
      'TRUNCATE auth.users;',
      'DELETE FROM auth.users;',
      'DROP TABLE IF EXISTS "auth"."users";',
    ]) {
      expect({ bad, problems: rollbackProblems(name, clean('033', bad)) }).toEqual({ bad, problems: ['touches-auth-schema'] });
    }
  });

  it('touches-auth-schema is NOT raised by reading auth.uid() or by referencing auth.users (no false alarm)', () => {
    for (const fine of [
      'CREATE POLICY "System can manage weekly xp" ON public.weekly_xp USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));',
      'ALTER TABLE public.t ADD CONSTRAINT t_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;',
      'GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid) TO PUBLIC, authenticated;',
      'REVOKE INSERT (id, email, username) ON public.profiles FROM authenticated;',
      'SELECT auth.uid();',
      "RAISE NOTICE 'auth.users is untouched';",
    ]) {
      expect({ fine, problems: rollbackProblems(name, clean('033', fine)) }).toEqual({ fine, problems: [] });
    }
  });

  it('reports every problem of a script that has several', () => {
    const text = ['SELECT 1;', 'DROP SCHEMA x CASCADE;', 'ALTER TABLE auth.users DROP COLUMN y;'].join('\n');
    expect([...rollbackProblems(name, text)].sort()).toEqual([
      'drops-schema',
      'missing-confirm-guard',
      'missing-status-marker',
      'missing-transaction',
      'touches-auth-schema',
      'uses-cascade',
    ]);
  });

  it('the real 036 script restores a policy that calls auth.uid() and is still clean', () => {
    const text = scriptText(scriptFor('036'));
    expect(text).toContain('auth.uid() = user_id');
    expect(rollbackProblems(scriptFor('036'), text)).toEqual([]);
  });

  it('the comment stripper keeps quoted text and drops comments', () => {
    expect(stripSqlComments("SELECT 'a -- b'; -- gone\nSELECT 2; /* gone */ SELECT 3;")).toBe("SELECT 'a -- b'; \nSELECT 2;   SELECT 3;");
    // an apostrophe inside a comment does not open a string
    expect(stripSqlComments("-- don't\nSELECT 1;")).toBe('\nSELECT 1;');
  });
});

// ---------------------------------------------------------------------------------------
describe('the scripts really undo what the migrations did (derived from the files, not retyped)', () => {
  const createdTables = (code: string): string[] => [...code.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1]);
  const droppedTables = (code: string): string[] => [...code.matchAll(/DROP TABLE (?:IF EXISTS )?public\.(\w+)\s*;/g)].map((m) => m[1]);

  it.each(['028', '029', '030', '031', '036'])('%s: every table the migration creates is dropped, nothing else', (num) => {
    const created = createdTables(migrationCode(MIGRATIONS.find((m) => m.startsWith(`${num}_`))!));
    const dropped = droppedTables(scriptCode(scriptFor(num)));
    expect(created.length).toBeGreaterThan(0);
    expect([...dropped].sort()).toEqual([...created].sort());
  });

  it.each(['028', '029', '030', '031'])('%s: a table is dropped before the table it points at (children first)', (num) => {
    const sql = migrationCode(MIGRATIONS.find((m) => m.startsWith(`${num}_`))!);
    const order = droppedTables(scriptCode(scriptFor(num)));
    for (const table of createdTables(sql)) {
      const body = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)![1];
      for (const parent of [...body.matchAll(/REFERENCES public\.(\w+)\(/g)].map((m) => m[1])) {
        if (!order.includes(parent)) continue; // a parent from an earlier migration (habits) stays
        expect({ table, parent, childFirst: order.indexOf(table) < order.indexOf(parent) }).toEqual({ table, parent, childFirst: true });
      }
    }
  });

  it('028..031 and 037 use IF EXISTS everywhere they drop, so a second run is a no-op', () => {
    for (const num of ['028', '029', '030', '031', '033', '037']) {
      const code = scriptCode(scriptFor(num));
      const drops = code.match(/\bDROP\s+(?:TABLE|FUNCTION|COLUMN|CONSTRAINT)\b[^;]*;/gi) ?? [];
      expect(drops.length).toBeGreaterThan(0);
      for (const d of drops) expect({ num, d, ifExists: /IF EXISTS/i.test(d) }).toEqual({ num, d, ifExists: true });
    }
  });

  it('033: the column and the constraint the migration adds are the ones dropped', () => {
    const mig = migrationCode(MIGRATIONS.find((m) => m.startsWith('033_'))!);
    const col = /ADD COLUMN IF NOT EXISTS (\w+)/.exec(mig)![1];
    const constraint = /ADD CONSTRAINT (\w+)/.exec(mig)![1];
    const rb = scriptCode(scriptFor('033'));
    expect(rb).toContain(`ALTER TABLE public.habit_logs DROP COLUMN IF EXISTS ${col};`);
    expect(rb).toContain(`ALTER TABLE public.habit_logs DROP CONSTRAINT IF EXISTS ${constraint};`);
    // the constraint goes first (dropping the column would remove it too; the order just stays explicit)
    expect(rb.indexOf(`DROP CONSTRAINT IF EXISTS ${constraint}`)).toBeLessThan(rb.indexOf(`DROP COLUMN IF EXISTS ${col}`));
  });

  it('037: the function the migration creates, with its signature, is the one dropped', () => {
    const mig = migrationCode(MIGRATIONS.find((m) => m.startsWith('037_'))!);
    const sig = /CREATE OR REPLACE FUNCTION public\.(\w+)\((\w+) (\w+)/.exec(mig)!;
    expect(sig.slice(1)).toEqual(['get_today_bootstrap', 'p_today', 'date']);
    expect(scriptCode(scriptFor('037'))).toContain(`DROP FUNCTION IF EXISTS public.${sig[1]}(${sig[3]});`);
  });

  it('the coach CHECK lists chain: 035 -> the list 034 wrote, 034 -> the list 032 wrote, 032 -> the live list', () => {
    const listOf = (text: string): string[] => {
      const m = /CHECK \(\(?\s*(?:"?action_type"?\s+IN\s+\(|"?action_type"?\s*=\s*ANY\s*\(ARRAY\[)([\s\S]*?)(?:\)\)|\]\)\))/.exec(text);
      return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    };
    const liveList = listOf(live.slice(at(live, 'CONSTRAINT "ai_actions_type_check"')));
    expect(liveList).toEqual(['propose_habit', 'propose_habit_plan', 'log_habit']);
    const m032 = listOf(migrationCode(MIGRATIONS.find((m) => m.startsWith('032_'))!));
    const m034 = listOf(migrationCode(MIGRATIONS.find((m) => m.startsWith('034_'))!));
    expect(m032.length).toBe(8);
    expect(m034.length).toBe(9);
    expect(listOf(scriptCode(scriptFor('035')))).toEqual(m034);
    expect(listOf(scriptCode(scriptFor('034')))).toEqual(m032);
    expect(listOf(scriptCode(scriptFor('032')))).toEqual(liveList);
  });

  it('032 / 034 / 035 never delete user data: NOT VALID, a conditional VALIDATE, no DELETE or TRUNCATE', () => {
    for (const num of ['032', '034', '035']) {
      const code = scriptCode(scriptFor(num));
      expect(code).toMatch(/\) NOT VALID;/);
      expect(code).toContain('VALIDATE CONSTRAINT ai_actions_type_check');
      expect(code).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM public\.ai_conversation_actions/);
      expect(code).toContain('RAISE NOTICE');
      expect(code).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/i);
      // the constraint is dropped before it is added again, with the name the migrations use
      expect(code.indexOf('DROP CONSTRAINT IF EXISTS ai_actions_type_check')).toBeLessThan(code.indexOf('ADD CONSTRAINT ai_actions_type_check'));
    }
  });

  it('every destructive statement of every script is a DROP of an object its migration created (no stray UPDATE / DELETE)', () => {
    for (const num of ['028', '029', '030', '031', '033', '037']) {
      expect(scriptCode(scriptFor(num))).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('036 (DB1-15, DB2-07): the ledger, the books, the policy and every grant go back to the live dump', () => {
  const rb036 = scriptCode(scriptFor('036'));
  const rb036Raw = scriptText(scriptFor('036'));
  const mig036 = migrationCode(MIGRATIONS.find((m) => m.startsWith('036_'))!);

  it('the XP the ledger holds and habit_logs does not is moved into purged_xp BEFORE the ledger is dropped', () => {
    const update = at(rb036, 'UPDATE public.profiles');
    const drop = at(rb036, 'DROP TABLE public.habit_xp_awards;');
    expect(update).toBeLessThan(drop);
    // the arithmetic: per habit and day, what the ledger paid minus what the log still carries, never negative
    expect(collapse(rb036)).toContain('sum(greatest(a.xp_awarded - coalesce(l.xp, 0), 0))');
    expect(collapse(rb036)).toContain('LEFT JOIN public.habit_logs l ON l.habit_id = a.habit_id AND l.completed_at = a.day');
    expect(collapse(rb036)).toContain('SET purged_xp = coalesce(p.purged_xp, 0) + x.excess');
    // ... and the function that keeps writing the ledger is replaced before the table disappears
    expect(at(rb036, 'CREATE OR REPLACE FUNCTION public.fn_habit_log_award()')).toBeLessThan(drop);
  });

  it('the books are counted before anything changes and checked at the end, inside the transaction', () => {
    const before = at(rb036, 'CREATE TEMP TABLE _rb036 ON COMMIT DROP AS');
    expect(rb036.slice(before)).toContain('count(*)::int AS drift_before FROM public.xp_drift()');
    expect(before).toBeLessThan(at(rb036, 'UPDATE public.profiles'));
    const check = at(rb036, 'DO $assert$');
    expect(check).toBeGreaterThan(at(rb036, 'GRANT INSERT ON public.profiles TO anon, authenticated;'));
    expect(rb036.slice(check)).toMatch(/count\(\*\)::int INTO v_after FROM public\.xp_drift\(\)/);
    expect(rb036.slice(check)).toMatch(/IF v_after > v_before THEN\s+RAISE EXCEPTION/);
    expect(rb036.indexOf('COMMIT;')).toBeGreaterThan(check);
  });

  it('refuses when 036 is not applied and when 038 (which uses the ledger) still is', () => {
    expect(rb036).toContain("to_regclass('public.habit_xp_awards') IS NULL");
    expect(rb036).toContain("proname = 'fn_habit_log_guard'");
    expect(rb036).toContain('038 is still applied');
    expect(rb036).toContain('036 is not applied');
  });

  it('fn_habit_log_award is restored byte for byte from the live dump', () => {
    // raw text on both sides: the body carries its own comments, and md5(prosrc) hashes them
    const restored = functionBody(rb036Raw, 'fn_habit_log_award');
    const liveBody = functionBody(live, 'fn_habit_log_award');
    expect(liveBody.length).toBeGreaterThan(300);
    expect(restored).toBe(liveBody);
    // the attributes the fingerprint hashes around the body
    expect(rb036).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_habit_log_award\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public'\s+AS \$function\$/);
    // and the migration replaced exactly this function (so that is what must come back)
    expect(mig036).toContain('CREATE OR REPLACE FUNCTION public.fn_habit_log_award()');
  });

  it('the weekly_xp policy is the live one, character for character', () => {
    const liveLine = /CREATE POLICY "System can manage weekly xp" ON "public"\."weekly_xp"[^;]*;/.exec(live)![0];
    const norm = (s: string): string => collapse(s).replace(/"/g, '');
    const restored = /CREATE POLICY "System can manage weekly xp" ON public\.weekly_xp[^;]*;/.exec(rb036)![0];
    expect(norm(restored)).toBe(norm(liveLine));
    expect(mig036).toContain('DROP POLICY IF EXISTS "System can manage weekly xp" ON public.weekly_xp;');
    // the policy is dropped before it is created, so a second pass cannot fail on "already exists"
    expect(rb036.indexOf('DROP POLICY IF EXISTS "System can manage weekly xp"')).toBeLessThan(rb036.indexOf('CREATE POLICY "System can manage weekly xp"'));
  });

  it('every table-level GRANT / REVOKE of 036 has its inverse, except on the ledger that is dropped', () => {
    const lines = (code: string): string[] =>
      code.split('\n').map((l) => l.trim()).filter((l) => /^(?:GRANT|REVOKE) [^;]* ON public\.\w+ (?:TO|FROM) [^;]+;$/.test(l));
    const inverse = (l: string): string =>
      l.startsWith('REVOKE ') ? l.replace(/^REVOKE /, 'GRANT ').replace(/ FROM /, ' TO ') : l.replace(/^GRANT /, 'REVOKE ').replace(/ TO /, ' FROM ');
    const forward = lines(mig036).filter((l) => !l.includes('public.habit_xp_awards'));
    expect(forward.length).toBe(4); // weekly_xp, user_subscriptions, profiles (revoke), profiles (column grant)
    const back = new Set(lines(rb036).map(collapse));
    for (const l of forward) expect({ l, inverse: inverse(l), present: back.has(collapse(inverse(l))) }).toEqual({ l, inverse: inverse(l), present: true });
    // nothing is granted back that the migration did not take away
    expect(lines(rb036).filter((l) => !forward.map((f) => collapse(inverse(f))).includes(collapse(l)))).toEqual([]);
  });

  it('EXECUTE is granted back exactly as the live dump had it: PUBLIC, plus anon / authenticated where the dump names them', () => {
    const revoked = [...mig036.matchAll(/^REVOKE EXECUTE ON FUNCTION public\.(\w+)\(([^)]*)\) FROM ([^;]+);$/gm)].map((m) => ({ name: m[1], args: collapse(m[2]) }));
    expect(revoked).toHaveLength(27); // one REVOKE per function; four of them (the ones the app calls) are re-granted to authenticated
    const names = [...new Set(revoked.map((r) => r.name))];
    expect(names).toHaveLength(27);

    const dumpRoles = new Map<string, Set<string>>();
    for (const m of live.matchAll(/^GRANT ALL ON FUNCTION "public"\."(\w+)"\([^)]*\) TO "(\w+)";$/gm)) {
      dumpRoles.set(m[1], (dumpRoles.get(m[1]) ?? new Set()).add(m[2]));
    }
    const dumpRevokedFromPublic = (name: string): boolean => new RegExp(`^REVOKE ALL ON FUNCTION "public"\\."${name}"\\([^)]*\\) FROM PUBLIC;$`, 'm').test(live);

    const granted = new Map<string, { args: string; roles: Set<string> }>();
    for (const m of rb036.matchAll(/^GRANT EXECUTE ON FUNCTION public\.(\w+)\(([^)]*)\) TO ([^;]+);$/gm)) {
      expect({ duplicate: m[1], seen: granted.has(m[1]) }).toEqual({ duplicate: m[1], seen: false });
      granted.set(m[1], { args: collapse(m[2]), roles: new Set(m[3].split(',').map((r) => r.trim())) });
    }
    expect([...granted.keys()].sort()).toEqual([...names].sort());

    for (const name of names) {
      const roles = dumpRoles.get(name) ?? new Set<string>();
      const expected = new Set<string>([
        ...(dumpRevokedFromPublic(name) ? [] : ['PUBLIC']),
        ...(roles.has('anon') ? ['anon'] : []),
        ...(roles.has('authenticated') ? ['authenticated'] : []),
      ]);
      expect({ name, roles: [...granted.get(name)!.roles].sort() }).toEqual({ name, roles: [...expected].sort() });
      // the signature written in the rollback is the one the migration revoked
      const forwardArgs = new Set(revoked.filter((r) => r.name === name).map((r) => r.args));
      expect({ name, sameSignature: forwardArgs.has(granted.get(name)!.args) }).toEqual({ name, sameSignature: true });
    }
  });

  it('service_role is never mentioned: 036 never took EXECUTE from it, so nothing is granted back to it', () => {
    expect(mig036).not.toMatch(/service_role/);
    expect(rb036).not.toMatch(/service_role/);
  });

  it('nothing in 036 is touched twice: the ledger drop and the function replacement each appear once', () => {
    expect(rb036.match(/DROP TABLE public\.habit_xp_awards;/g)).toHaveLength(1);
    expect(rb036.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------
describe('catalog_fingerprint.sql can see what a rollback changes', () => {
  it('is one read-only SELECT, sorted with the C collation', () => {
    const code = stripSqlComments(fingerprint).trim();
    expect(code.startsWith('SELECT line FROM (')).toBe(true);
    expect(code.endsWith('ORDER BY line COLLATE "C";')).toBe(true);
    expect(code.match(/;/g)).toHaveLength(1);
    expect(/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|SET)\b/i.test(code)).toBe(false);
  });

  it('ACLs of NULL print like the default ACL (an object REVOKEd and GRANTed back must equal an untouched one)', () => {
    expect(fingerprint).toContain("acldefault('r', c.relowner)");
    expect(fingerprint).toContain("acldefault('f', p.proowner)");
  });

  it('ACLs are sorted before printing, so GRANT order cannot matter', () => {
    expect(fingerprint.match(/string_agg\(x::text, ',' ORDER BY x::text\)/g)).toHaveLength(3);
  });

  it('covers tables, columns, column ACLs, constraints, indexes, policies, triggers and functions', () => {
    for (const prefix of ['T', 'C', 'A', 'K', 'I', 'P', 'G', 'F']) expect(fingerprint).toContain(`'${prefix}|'`);
    expect(fingerprint).toContain('pg_get_constraintdef(oid)'); // prints NOT VALID, so an unvalidated CHECK differs
    expect(fingerprint).toContain('md5(p.prosrc)'); // the restored function body
    expect(fingerprint).toContain('p.prosecdef');
    expect(fingerprint).toContain('p.proconfig');
    expect(fingerprint).toContain('relrowsecurity');
  });

  it('looks at the public schema only', () => {
    expect(fingerprint).toContain("n.nspname = 'public'");
    expect(fingerprint).toContain("table_schema = 'public'");
    expect(fingerprint).toContain("schemaname = 'public'");
    expect(fingerprint).toContain("'public'::regnamespace");
  });
});

// ---------------------------------------------------------------------------------------
describe('the owner documents list every script', () => {
  it('rollbacks/README names every script and the confirmation variable', () => {
    expect(rollbackReadme).toContain('aderyth.rollback_confirm');
    for (const script of SCRIPTS) expect({ script, named: rollbackReadme.includes(script) }).toEqual({ script, named: true });
  });

  it('rollbacks/README states the order (newest to oldest), the destructive scripts and xp_drift', () => {
    expect(rollbackReadme).toMatch(/büyükten küçüğe/);
    expect(rollbackReadme).toContain('xp_drift()');
    expect(rollbackReadme).toContain('036');
    expect(rollbackReadme).toContain('038');
  });

  it('SQL_FOR_OWNER.md section 1 has a "Geri alma" column and every 028..037 row names its script', () => {
    const lines = ownerDoc.split('\n');
    const header = lines.find((l) => /^\| # \| Dosya \|/.test(l));
    expect(header).toBeDefined();
    expect(header).toContain('| Geri alma |');
    const at1 = lines.indexOf(header!);
    expect(lines[at1 + 1]).toBe('|---|---|---|---|---|---|');
    const rows = lines.slice(at1 + 2).filter((l) => /^\| 0\d\d \|/.test(l));
    const section1 = lines.slice(at1 + 2, at1 + 2 + rows.length);
    expect(section1).toEqual(rows); // one unbroken table
    expect(rows.map((r) => r.slice(2, 5))).toEqual(MIGRATIONS.map(numberOf));
    for (const row of rows) {
      const migration = MIGRATIONS.find((m) => m.startsWith(row.slice(2, 5)))!;
      expect({ row: migration, cells: row.split('|').length - 2 }).toEqual({ row: migration, cells: 6 });
      expect({ migration, names: row.includes(`\`supabase/rollbacks/${rollbackNameFor(migration)}\``) }).toEqual({ migration, names: true });
    }
    const row036 = rows.find((r) => r.startsWith('| 036 |'))!;
    expect(row036).toContain('038');
  });

  it('SQL_FOR_OWNER.md explains how to run a rollback and has the read-only queries (2.10)', () => {
    expect(ownerDoc).toContain("SET aderyth.rollback_confirm = 'NNN';");
    expect(ownerDoc).toMatch(/Geri alma nasıl çalıştırılır/);
    expect(ownerDoc).toContain('-- 2.10');
    const queries = ownerDoc.slice(at(ownerDoc, '-- 2.10'));
    expect(queries).toContain('select * from public.xp_drift();');
    expect(queries).toContain("to_regclass('public.habit_xp_awards') as m036");
    expect(queries).toContain("column_name='tz'");
    expect(queries).toContain("conname = 'ai_actions_type_check'");
  });

  it('migrations/README.md points at the rollbacks and keeps its migration table intact', () => {
    expect(migrationsReadme).toMatch(/^## Rollbacks$/m);
    expect(migrationsReadme).toContain('supabase/rollbacks/');
    expect(migrationsReadme).toContain("SET aderyth.rollback_confirm = 'NNN';");
    for (const file of MIGRATIONS) expect(migrationsReadme).toContain(`\`${file}\` | **NOT APPLIED**`);
  });
});

// ---------------------------------------------------------------------------------------
describe('ci.yml runs the cycle: forward, roll back newest to oldest, compare with the baseline, forward again', () => {
  const job = ci.slice(at(ci, '\n  db-migrations-verify:'));
  const step = (name: string): number => at(job, `- name: ${name}`);
  /** The text of one step: from its `- name:` line to the next step, comment line or job key. */
  const block = (name: string): string => {
    const start = step(name);
    const rest = job.slice(start + 1);
    const end = rest.search(/\n {6}(?:- name:|#)/);
    return end < 0 ? rest : rest.slice(0, end);
  };

  const STEPS = {
    live: 'Apply live_schema.sql baseline',
    baseline: 'Fingerprint baseline catalog (live_schema.sql only)',
    verify037: 'Verify 037_today_bootstrap_rpc.sql works even before 028..036 are applied',
    forward: 'Apply forward migrations 028+ and verify RLS-isolated single-RTT bootstrap',
    behaviour: 'Behavioural SQL tests',
    forwardFp: 'Fingerprint forward catalog (028..last)',
    refuse: 'Rollback scripts must refuse without their own confirmation (negative controls)',
    cycle: 'Roll back newest to oldest (rollback cycle)',
    compare: 'Rolled-back catalog must equal the baseline, xp_drift must be empty',
    second: 'Second rollback pass changes nothing (036 refuses once it is gone)',
    reapply: 'Re-apply forward migrations (apply, roll back, apply again)',
    drift: 'Rollback 036 keeps the XP books straight when the ledger holds more than habit_logs (DB2-07)',
    coach: 'Coach CHECK rollbacks keep rows of a newer type (NOT VALID, nothing deleted)',
    probe: 'Fingerprint prints a NULL ACL and the explicit default ACL alike (self-test)',
  } as const;

  it('the steps exist and run in the order of the contract', () => {
    const order = [STEPS.live, STEPS.baseline, STEPS.verify037, STEPS.forward, STEPS.behaviour, STEPS.forwardFp, STEPS.refuse, STEPS.cycle, STEPS.compare, STEPS.second, STEPS.reapply, STEPS.drift, STEPS.coach, STEPS.probe];
    const positions = order.map((s) => step(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(order.length);
  });

  it('the baseline is taken from live_schema.sql alone: before 037 and before any 028+ migration', () => {
    expect(block(STEPS.baseline)).toContain('supabase/rollbacks/catalog_fingerprint.sql');
    expect(block(STEPS.baseline)).toContain('"$RUNNER_TEMP/fp_baseline.txt"');
    expect(step(STEPS.baseline)).toBeGreaterThan(step(STEPS.live));
    expect(step(STEPS.baseline)).toBeLessThan(step(STEPS.verify037));
  });

  it('the forward fingerprint comes after the behavioural tests and before the first rollback', () => {
    expect(block(STEPS.forwardFp)).toContain('"$RUNNER_TEMP/fp_forward_1.txt"');
    expect(step(STEPS.forwardFp)).toBeGreaterThan(step(STEPS.behaviour));
    expect(step(STEPS.forwardFp)).toBeLessThan(step(STEPS.refuse));
  });

  it('the rollbacks run newest to oldest, each confirmed with its OWN number, and any failure stops the step', () => {
    const run = block(STEPS.cycle);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('sort -r');
    expect(run).toContain('supabase/rollbacks/[0-9][0-9][0-9]_*.rollback.sql');
    expect(run).toContain(`-c "SET aderyth.rollback_confirm = '\${num}'" -f "$rb"`);
    expect(run).toContain('-v ON_ERROR_STOP=1');
    expect(run).toContain('-ge 28');
  });

  it('the rolled-back catalog is compared with the baseline by diff -u, and xp_drift must be empty', () => {
    const run = block(STEPS.compare);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_baseline.txt" "$RUNNER_TEMP/fp_rolled_back.txt"');
    expect(run).toContain('SELECT count(*) FROM public.xp_drift()');
    expect(run).toContain('test "${drift}" = "0"');
    expect(step(STEPS.compare)).toBeGreaterThan(step(STEPS.cycle));
  });

  it('forward again: the second forward fingerprint must equal the first and the behavioural tests run again', () => {
    const run = block(STEPS.reapply);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_forward_1.txt" "$RUNNER_TEMP/fp_forward_2.txt"');
    expect(run).toContain('bash supabase/tests/run.sh');
    expect(run.indexOf('diff -u')).toBeLessThan(run.indexOf('bash supabase/tests/run.sh'));
    expect(run).toContain('supabase/migrations/[0-9][0-9][0-9]_*.sql');
    expect(job.match(/bash supabase\/tests\/run\.sh/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('the negative controls: no confirmation, a neighbour\'s confirmation, 038 present, and nothing changed', () => {
    const run = block(STEPS.refuse);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('ran without any confirmation');
    expect(run).toContain('ran with the confirmation of');
    expect(run).toContain("grep -q \"aderyth.rollback_confirm = '${num}'\"");
    expect(run).toContain('fn_habit_log_guard');
    expect(run).toContain('038 is still applied');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_forward_1.txt" "$RUNNER_TEMP/fp_after_refusals.txt"');
    // a client that does not stop on errors (psql without ON_ERROR_STOP, a script runner) must get no further either,
    // and that attempt has to happen BEFORE the catalog is compared with the forward one
    const lenient = 'psql -X -f "$rb" > /dev/null 2>&1 || true';
    expect(run).toContain(lenient);
    expect(run.indexOf(lenient)).toBeLessThan(run.indexOf('fp_after_refusals.txt'));
    // a failing refusal check ends the step: every check is either an `if psql` with an exit 1 or a grep / diff under -e
    expect((run.match(/exit 1/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('the second pass: 036 must refuse once the ledger is gone, everything else is a no-op, the catalog stays the baseline', () => {
    const run = block(STEPS.second);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('036 is not applied');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_baseline.txt" "$RUNNER_TEMP/fp_rolled_back_2.txt"');
  });

  it('the DB2-07 step seeds a real imbalance, proves it, and checks both the refusal and the transfer', () => {
    const run = block(STEPS.drift);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('SELECT drift FROM public.xp_drift()');
    expect(run).toContain('test "${drift}" -gt 0'); // the fixture is not vacuous
    expect(run).toContain('l.xp > 0 AND l.xp < a.xp_awarded'); // lower, not zero
    expect(run).toContain('would add xp_drift rows');
    expect(run).toContain("SELECT purged_xp FROM public.profiles WHERE id = '${uid}'");
    expect(run).toContain("to_regclass('public.habit_xp_awards') IS NULL");
    expect(run).toContain('supabase/migrations/036_live_audit_hardening.sql'); // forward again at the end
    expect(run).toMatch(/INSERT INTO public\.habits[\s\S]*?'boolean'/); // a tracking_type the live CHECK accepts
  });

  it('the coach CHECK step proves the no-data-loss contract on a real row', () => {
    const run = block(STEPS.coach);
    expect(run).toContain("'lighten_week'");
    expect(run).toContain('left NOT VALID');
    expect(run).toContain('SELECT convalidated FROM pg_constraint');
    expect(run).toContain('a new write of the removed type was accepted');
  });

  it('the fingerprint self-test: a NULL ACL and the explicit default ACL print alike (a scratch role owns a table and a function, all dropped again)', () => {
    const run = block(STEPS.probe);
    expect(run).toContain('zz_fingerprint_probe');
    // objects of a role without default privileges are the only ones that keep a NULL ACL (everything postgres owns has an explicit one)
    expect(run).toContain('CREATE ROLE zz_fp_probe_owner NOLOGIN');
    expect(run).toContain('SET ROLE zz_fp_probe_owner');
    expect(run).toContain('relacl IS NULL');
    expect(run).toContain('proacl IS NULL');
    // the REVOKE / GRANT round trip, and proof that it stored the default ACL explicitly
    expect(run).toContain('REVOKE ALL ON FUNCTION public.zz_fingerprint_probe() FROM PUBLIC');
    expect(run).toContain('GRANT EXECUTE ON FUNCTION public.zz_fingerprint_probe() TO PUBLIC');
    expect(run).toContain('REVOKE INSERT ON public.zz_fingerprint_probe FROM zz_fp_probe_owner');
    expect(run).toContain('GRANT INSERT ON public.zz_fingerprint_probe TO zz_fp_probe_owner');
    expect(run).toContain('relacl IS NOT NULL');
    expect(run).toContain('proacl IS NOT NULL');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_probe_before.txt" "$RUNNER_TEMP/fp_probe_after.txt"');
    // the probe really shows up in the fingerprint (an empty file would make the diff pass for nothing)
    expect(run).toMatch(/test "\$\(wc -l < "\$RUNNER_TEMP\/fp_probe_before\.txt"\)" -ge 3/);
    // and the scratch objects, the schema privileges and the role are gone afterwards
    expect(run).toContain('DROP FUNCTION public.zz_fingerprint_probe()');
    expect(run).toContain('DROP TABLE public.zz_fingerprint_probe');
    expect(run).toContain('REVOKE USAGE, CREATE ON SCHEMA public FROM zz_fp_probe_owner');
    expect(run).toContain('DROP ROLE zz_fp_probe_owner');
    // it is the last step of the job, so no comparison above can see the scratch objects
    expect(step(STEPS.probe)).toBeGreaterThan(step(STEPS.coach));
  });

  it('every step added for the cycle stops on the first error', () => {
    for (const s of [STEPS.refuse, STEPS.cycle, STEPS.compare, STEPS.second, STEPS.reapply, STEPS.drift, STEPS.coach, STEPS.probe]) {
      expect({ s, strict: block(s).includes('set -euo pipefail') }).toEqual({ s, strict: true });
    }
  });

  it('every call of the fingerprint file is read-only psql output, never a write', () => {
    const calls = job.split('\n').filter((l) => l.includes('catalog_fingerprint.sql') && !l.trim().startsWith('#'));
    // baseline, forward 1, after refusals, rolled back, rolled back 2, forward 2 (a later phase may add more)
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const READ_ONLY_CALL = /psql -X -At -v ON_ERROR_STOP=1 -f supabase\/rollbacks\/catalog_fingerprint\.sql(?: \| grep '[a-z_]+')? > "\$RUNNER_TEMP\/fp_[a-z_0-9]+\.txt"$/;
    for (const l of calls) expect({ l, ok: READ_ONLY_CALL.test(l.trim()) }).toEqual({ l, ok: true });
  });

  it('no new step contacts a project: no push, link, db-url, deploy or project reference', () => {
    const canonical = /^CANONICAL="([^"]+)"/m.exec(guardSh)?.[1] ?? '';
    const denied = /^DENIED="([^"]+)"/m.exec(guardSh)?.[1] ?? '';
    expect(canonical).toMatch(/^[a-z]{20}$/);
    expect(denied).toMatch(/^[a-z]{20}$/);
    expect(job).not.toMatch(/supabase\s+(?:db\s+(?:push|pull|reset|remote)|link|functions\s+deploy|migration\s+repair|secrets|projects|login|start)\b/);
    expect(job).not.toContain('--db-url');
    expect(job).not.toMatch(/db push/);
    expect(job).not.toContain('.supabase.co');
    // the whole workflow file, as the plan words it ("ci.yml içinde db push / --db-url yok")
    expect(ci).not.toMatch(/db push/);
    expect(ci).not.toContain('--db-url');
    expect(ci).toContain('supabase/rollbacks/catalog_fingerprint.sql');
    expect(ci).toContain('rollback_confirm');
    expect(ci).toContain('diff -u');
    expect(job).not.toContain(canonical);
    expect(job).not.toContain(denied);
    // the database is the job's own throwaway service
    expect(job).toMatch(/PGHOST: 127\.0\.0\.1/);
    expect(job).toContain('image: postgres:17');
  });

  it('the pre-existing steps are still there, unchanged in name (nothing was deleted or reordered)', () => {
    for (const s of [
      'Checkout',
      'Bootstrap local Postgres 17 auth/extensions stubs',
      STEPS.live,
      STEPS.verify037,
      STEPS.forward,
      STEPS.behaviour,
    ]) expect(job).toContain(`- name: ${s}`);
    expect(job).toContain('supabase/migrations/037_today_bootstrap_rpc.sql');
    expect(job).toContain('public.get_today_bootstrap(CURRENT_DATE)');
  });
});
