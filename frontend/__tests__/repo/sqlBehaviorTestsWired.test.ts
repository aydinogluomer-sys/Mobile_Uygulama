/**
 * F01: the SQL behaviour gate is wired into CI, and what used to keep it red stays fixed.
 *
 * ## Why this file exists
 *
 * Jest cannot run SQL. Until F01 nothing exercised the database's security properties
 * (client write bans, SECURITY DEFINER hygiene, `xp_drift() = 0`, tenant isolation, spend and
 * claim races) on a real Postgres, and the one job that could have, `db-migrations-verify`,
 * had been red since it was added: its fixture inserted `tracking_type = 'binary'`, which the
 * live CHECK rejects (DB1-05), so the job died before it reached its isolation check.
 *
 * So this file does what jest can: it locks WHERE and HOW the SQL tests run.
 *
 *   - every `INSERT INTO public.habits` fixture is valid against the live CHECK;
 *   - the runner step sits in `db-migrations-verify`, after the migrations;
 *   - the deploy guard is no longer fed the value it is supposed to check (BLD-14), and the
 *     guard steps are EXECUTED against the real guard and against guards that accept
 *     everything, so a negative control that lost its `exit 1` cannot hide behind its text;
 *   - nothing here can reach a live project, and the runners refuse a non-local host or a
 *     database that does not look like the throwaway CI one (also proven by really running
 *     them, because a static match on the word REFUSED would survive a broken case pattern);
 *   - run.sh's own fail paths (unexpected red, stale known-red entry, missing or duplicated
 *     result, harness error) are proven by running it against a fake `psql`;
 *   - the test names are unique, complete and reconciled with the known-red list;
 *   - the known-red list is well formed and tied to real functions (and may be empty: F09
 *     deletes every line of it).
 *
 * The denied Supabase project is never written into this file. The guard script declares it,
 * so the test reads it from there at run time (crossProjectIsolation.test.ts rules A and B).
 *
 * Positive and negative cases are both here: each helper is also fed synthetic text that
 * contains the exact defect it exists to catch.
 */
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { at } from '../helpers/sourceText';

// Many tests below start bash processes (the real runners, the real guard steps, run.sh against a
// fake psql). A busy Windows host needs well over the default 5 seconds for some of them.
jest.setTimeout(120000);

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');

const TESTS_DIR = 'supabase/tests';
const testFiles = (): string[] =>
  readdirSync(join(REPO, TESTS_DIR))
    .filter((f) => /\.(sql|sh)$/.test(f))
    .sort();
const numberedTests = (): string[] => testFiles().filter((f) => f !== 'run.sh');

// ---------------------------------------------------------------------------------------
// bash and process helpers
// ---------------------------------------------------------------------------------------

/**
 * The bash the scripts are started with.
 *
 * A bare `bash` is not safe on Windows: from PowerShell, cmd or a VS Code terminal it resolves
 * to C:\Windows\System32\bash.exe, the WSL launcher, which exits 1 ("execvpe(/bin/bash) failed")
 * when no distro is installed and, even with one, would not receive the PG* variables these tests
 * set, so the refusal cases would pass for the wrong reason. Git for Windows ships the bash the
 * repo's own gates use. `GIT_BASH` overrides the search (a non-standard Git install).
 */
const resolveBash = (): string => {
  if (process.env.GIT_BASH) return process.env.GIT_BASH;
  if (process.platform !== 'win32') return 'bash';
  const roots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined,
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, 'Git', 'bin', 'bash.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'bash';
};
const BASH = resolveBash();

/** Forward slashes: a Windows path both Node and the MSYS bash accept, with no escaping to get wrong. */
const fwd = (p: string): string => p.replace(/\\/g, '/');

/** The current environment minus every libpq variable and the project ref, plus `extra` (undefined deletes). */
const hermeticEnv = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^PG/.test(key) || key === 'SUPABASE_PROJECT_REF') delete env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
};

/** Puts `dir` first on PATH, whichever case this platform spells the variable in. */
const withPathFront = (env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv => {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  return { ...env, [key]: `${dir}${delimiter}${env[key] ?? ''}` };
};

let tmpRoot = '';
beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aderyth-f01-'));
});
afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------
// text helpers (each one is exercised on synthetic input further down)
// ---------------------------------------------------------------------------------------

/** Parses the allowed values out of the live `habits_tracking_type_check` CHECK. */
const allowedTrackingTypes = (liveSchemaSql: string): string[] => {
  const m = /CONSTRAINT "habits_tracking_type_check" CHECK \([\s\S]*?ARRAY\[([^\]]*)\]/.exec(liveSchemaSql);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

/** Splits a SQL list at top-level commas, respecting single-quoted strings and parentheses. */
const splitSqlList = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (inString) {
      current += c;
      if (c === "'") {
        if (list[i + 1] === "'") { current += "'"; i++; } else inString = false;
      }
      continue;
    }
    if (c === "'") { inString = true; current += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
};

/** Returns the parenthesised groups that follow `VALUES`, honouring quoted strings. */
const valueTuples = (text: string, from: number): string[] => {
  const tuples: string[] = [];
  let i = from;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] !== '(') break;
    let depth = 0;
    let inString = false;
    const start = i + 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "'") { if (text[i + 1] === "'") i++; else inString = false; }
        continue;
      }
      if (c === "'") inString = true;
      else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    tuples.push(text.slice(start, i));
    i++;
  }
  return tuples;
};

/** Returns tracking_type literals used by `INSERT INTO public.habits` statements in a YAML/SQL text. */
const habitsFixtureTrackingTypes = (text: string): string[] => {
  const found: string[] = [];
  const head = /INSERT\s+INTO\s+public\.habits\s*\(([^)]*)\)\s*VALUES/gi;
  for (const m of text.matchAll(head)) {
    const columns = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
    const idx = columns.indexOf('tracking_type');
    if (idx < 0) continue;
    for (const tuple of valueTuples(text, (m.index ?? 0) + m[0].length)) {
      const value = splitSqlList(tuple)[idx] ?? '';
      found.push(value.replace(/^'|'$/g, ''));
    }
  }
  return found;
};

/**
 * Returns every test result name declared in SQL or shell test sources, with repeats.
 * Dynamic families (names built with `format(...)` or carrying a dot, like
 * `T02a_anon_execute.<function>/<n>`) are not static declarations and are not returned.
 * run.sh finds the same names (it flattens each SQL file to one line first), so a call split
 * over several lines is a declaration for both.
 */
const declaredResultNames = (sources: string[]): string[] => {
  const names: string[] = [];
  for (const src of sources) {
    for (const m of src.matchAll(/\b(?:res|expect_denied|expect_allowed|expect_no_effect)\(\s*'(T\d\d[A-Za-z0-9_]*)'/g)) names.push(m[1]);
    for (const m of src.matchAll(/^[ \t]*(?:report|info)[ \t]+(T\d\d[A-Za-z0-9_]*)\b/gm)) names.push(m[1]);
    for (const m of src.matchAll(/RESULT\|(T\d\d[A-Za-z0-9_]*)\|/g)) names.push(m[1]);
  }
  return names;
};

type ExpectedFailure = { name: string; comment: string };

/** Parses expected_failures.txt: strips comments and blank lines, keeps each name with its comment. */
const parseExpectedFailureLines = (text: string): ExpectedFailure[] =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return {
        name: (hash >= 0 ? line.slice(0, hash) : line).trim(),
        comment: hash >= 0 ? line.slice(hash + 1).trim() : '',
      };
    })
    .filter((e) => e.name.length > 0);

/** Parses expected_failures.txt: strips comments/blank lines, returns names. */
const parseExpectedFailures = (text: string): string[] => parseExpectedFailureLines(text).map((e) => e.name);

/** Removes `-- ...` and block comments from SQL, leaving quoted strings and dollar-quoted bodies alone. */
const stripSqlComments = (sql: string): string => {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end < 0 ? sql.length : end + tag[0].length;
        out += sql.slice(i, stop); i = stop; continue;
      }
    }
    out += c; i++;
  }
  return out;
};

/** Removes the `$q$ ... $q$` bodies the tests hand to expect_denied / expect_allowed / expect_no_effect. */
const withoutQuotedProbes = (sql: string): string => sql.replace(/\$q\$[\s\S]*?\$q\$/g, "''");

/** "name/nargs" of every SECURITY DEFINER function in a pg_dump that does not pin search_path. */
const unpinnedSecurityDefiners = (dump: string): string[] => {
  const out: string[] = [];
  const re = /CREATE OR REPLACE FUNCTION "public"\."([A-Za-z0-9_]+)"\(([\s\S]*?)\) RETURNS [\s\S]*?\bAS \$[A-Za-z_]*\$/g;
  for (const m of dump.matchAll(re)) {
    const header = m[0];
    if (!/SECURITY DEFINER/.test(header) || /SET "search_path"/.test(header)) continue;
    out.push(`${m[1]}/${splitSqlList(m[2]).length}`);
  }
  return out.sort();
};

/**
 * The `run:` script of the workflow step whose name starts with `prefix` (a one-line `run: cmd`
 * or a `run: |` block). The workflows here are indented six spaces for `- name:`, eight for the
 * step keys and ten for a block body; no YAML dependency is needed for that.
 */
const stepRun = (yaml: string, prefix: string): string => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`      - name: ${prefix}`));
  if (start < 0) throw new Error(`no workflow step is named ${JSON.stringify(prefix)}`);
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}- /.test(lines[i]) || /^ {0,4}\S/.test(lines[i])) break; // the next step, or a key of the job
    const m = /^ {8}run:(?: (.*))?$/.exec(lines[i]);
    if (!m) continue;
    const inline = (m[1] ?? '').trim();
    if (!/^\|[-+]?$/.test(inline)) return inline;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && !lines[j].startsWith(' '.repeat(10))) break;
      body.push(lines[j].slice(10));
    }
    return `${body.join('\n').replace(/\n+$/, '')}\n`;
  }
  throw new Error(`the step ${JSON.stringify(prefix)} has no run:`);
};

// ---------------------------------------------------------------------------------------
// the inputs
// ---------------------------------------------------------------------------------------
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/supabase-release-verify.yml');
const live = read('supabase/live_schema.sql');
const runSh = read(`${TESTS_DIR}/run.sh`);
const concurrencySh = read(`${TESTS_DIR}/05_concurrency_spend.sh`);
const hygieneSql = read(`${TESTS_DIR}/02_security_definer_hygiene.sql`);
const expectedText = read(`${TESTS_DIR}/expected_failures.txt`);
const guard = read('supabase/predeploy_guard.sh');
const sqlTests = numberedTests().filter((f) => f.endsWith('.sql'));
/** The project the repository may target, as the guard declares it (naming it is allowed; the denied one is not). */
const canonical = /^CANONICAL="([^"]+)"/m.exec(guard)?.[1] ?? '';

/** Test result names that must exist: deleting a test is a change someone has to defend. */
const REQUIRED_NAMES = [
  ...'abcdefghijklmnopq'.split('').map((c) => `T01${c}`),
  'T01z1', 'T01z2', 'T01z3', 'T01z4', 'T01z5',
  'T02c', 'T02d', 'T02e',
  'T03a', 'T03b', 'T03c', 'T03d',
  'T04a', 'T04b', 'T04c', 'T04d', 'T04e', 'T04f',
  'T05a', 'T05b', 'T05c', 'T05d', 'T05e', 'T05f',
];

// ---------------------------------------------------------------------------------------
describe('DB1-05: every habits fixture is valid against the live CHECK', () => {
  const allowed = allowedTrackingTypes(live);

  it('reads the live CHECK (the parser is not silently empty)', () => {
    expect(allowed).toEqual(['boolean', 'numeric', 'duration', 'abstinence']);
  });

  it('ci.yml has habits fixtures and each tracking_type is one the live CHECK accepts', () => {
    const used = habitsFixtureTrackingTypes(ci);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((v) => !allowed.includes(v))).toEqual([]);
  });

  it('the SQL tests have habits fixtures and each one is valid too', () => {
    const used = sqlTests.flatMap((f) => habitsFixtureTrackingTypes(read(`${TESTS_DIR}/${f}`)));
    expect(used.length).toBeGreaterThanOrEqual(2);
    expect(used.filter((v) => !allowed.includes(v))).toEqual([]);
  });

  it('catches the original defect: the old fixture used a value the CHECK rejects (synthetic)', () => {
    const old =
      "INSERT INTO public.habits (id, user_id, name, tracking_type, status) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Sabah Yürüyüşü', 'binary', 'active')";
    expect(habitsFixtureTrackingTypes(old)).toEqual(['binary']);
    expect(allowed).not.toContain('binary');
    const fixed = old.replace("'binary'", "'boolean'");
    expect(habitsFixtureTrackingTypes(fixed)).toEqual(['boolean']);
    expect(allowed).toContain('boolean');
  });

  it('reads several rows and quoted commas correctly (synthetic)', () => {
    const multi =
      "INSERT INTO public.habits (name, tracking_type) VALUES ('a, b', 'numeric'), ('it''s', 'bogus');";
    expect(habitsFixtureTrackingTypes(multi)).toEqual(['numeric', 'bogus']);
    expect(habitsFixtureTrackingTypes('INSERT INTO public.habits (name) VALUES (\'x\');')).toEqual([]);
  });
});

describe('ci.yml: the behavioural gate is a db-migrations-verify step that runs after the migrations', () => {
  const STEP = '- name: Behavioural SQL tests (grants, RLS, SECURITY DEFINER hygiene, xp_drift, concurrency)';

  it('runs `bash supabase/tests/run.sh` after "Apply forward migrations 028+"', () => {
    // the real `run:` line, not the first textual mention (a comment could come earlier)
    const runLine = ci.search(/^ {8}run: bash supabase\/tests\/run\.sh$/m);
    expect(runLine).toBeGreaterThan(at(ci, 'Apply forward migrations 028+'));
    expect(runLine).toBeGreaterThan(at(ci, STEP));
  });

  it('is a step of the db-migrations-verify job, after the 028+ step', () => {
    const header = '\n  db-migrations-verify:';
    const job = at(ci, header);
    const step = at(ci, STEP);
    expect(step).toBeGreaterThan(job);
    // No other job header sits between the job's own header and the step. Steps may follow it:
    // F02 appends the rollback cycle (fingerprint, roll back, re-apply) after this one.
    expect(/^ {2}[a-z][\w-]*:\s*$/m.test(ci.slice(job + header.length, step))).toBe(false);
  });

  it('invokes the runner through bash (no executable bit assumed) and not from a shell snippet', () => {
    expect(ci).toMatch(/^ {8}run: bash supabase\/tests\/run\.sh$/m);
  });

  it('the job supplies a local database through job-level env (the runner refuses anything else)', () => {
    const job = ci.slice(at(ci, '\n  db-migrations-verify:'));
    expect(job).toMatch(/PGHOST: 127\.0\.0\.1/);
    expect(job).toContain('image: postgres:17');
  });
});

describe('BLD-14: the deploy guard is not fed the value it is meant to check', () => {
  /** Lines that run the guard under bash, comments excluded. */
  const guardInvocations = (text: string): string[] =>
    text.split('\n').filter((l) => !/^\s*#/.test(l) && /\bbash\s+"?[^\s"]*predeploy_guard\.sh/.test(l));

  it('ci.yml runs the guard only without the ref variable, or as a negative control', () => {
    // ci.yml has no job-level ref and deploys nothing, so there is nothing for a plain call to check.
    const lines = guardInvocations(ci);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const clean = /env -u SUPABASE_PROJECT_REF\s+bash\s/.test(line);
      const negative = /SUPABASE_PROJECT_REF=not-the-canonical-ref\s+bash\s/.test(line);
      expect({ line: line.trim(), ok: clean || negative }).toEqual({ line: line.trim(), ok: true });
    }
  });

  it('ci.yml: positive run from config.toml plus the two negative controls', () => {
    expect(ci).toContain('run: env -u SUPABASE_PROJECT_REF bash supabase/predeploy_guard.sh');
    expect(ci).toContain('SUPABASE_PROJECT_REF=not-the-canonical-ref bash supabase/predeploy_guard.sh');
    expect(ci).toContain('printf \'project_id = "not-the-canonical-ref"\\n\'');
    expect(ci).toContain('predeploy_guard.sh accepted a non-canonical ref');
    expect(ci).toContain('predeploy_guard.sh accepted a drifted config.toml');
  });

  it('the release workflow checks BOTH the job-level ref the parity step uses and the config.toml pin', () => {
    // tools/verify-edge-deployment.mjs queries the project named by the job-level
    // SUPABASE_PROJECT_REF with SUPABASE_ACCESS_TOKEN and has no canonical check of its own, so the
    // guard must keep checking that variable as it stands (constitution A.1: never loosened).
    // `env -u` alone would check config.toml instead and stop checking the target actually used.
    const lines = stepRun(release, 'Enforce canonical project ref guard').split('\n').map((l) => l.trim());
    expect(lines).toContain('bash supabase/predeploy_guard.sh');
    expect(lines).toContain('env -u SUPABASE_PROJECT_REF bash supabase/predeploy_guard.sh');
  });

  it('the release workflow keeps the job-level ref the parity step reads, and it is the canonical one', () => {
    expect(canonical).toMatch(/^[a-z]{20}$/); // positive control: the guard still declares it
    expect(release).toMatch(new RegExp(`^ {6}SUPABASE_PROJECT_REF: ${canonical}$`, 'm'));
    expect(release).toContain('--project-ref "$SUPABASE_PROJECT_REF"');
  });

  it('the old tautology (a real ref assigned in front of the guard) is gone', () => {
    const tautology = /SUPABASE_PROJECT_REF=[a-z]{20}\b\s+bash\s+supabase\/predeploy_guard\.sh/;
    expect(tautology.test(ci)).toBe(false);
    expect(tautology.test(release)).toBe(false);
    // and the pattern really matches the old line (synthetic)
    expect(tautology.test('run: SUPABASE_PROJECT_REF=abcdefghijklmnopqrst bash supabase/predeploy_guard.sh')).toBe(true);
    expect(tautology.test('run: SUPABASE_PROJECT_REF=not-the-canonical-ref bash supabase/predeploy_guard.sh')).toBe(false);
  });

  it('the step extractor reads one-line and block scripts (synthetic)', () => {
    const yaml = [
      '    steps:',
      '      - name: One liner',
      '        run: echo one',
      '',
      '      - name: Block',
      '        run: |',
      '          echo a',
      '            echo b',
      '',
      '      - name: After',
      '        run: echo after',
    ].join('\n');
    expect(stepRun(yaml, 'One liner')).toBe('echo one');
    expect(stepRun(yaml, 'Block')).toBe('echo a\n  echo b\n');
    expect(() => stepRun(yaml, 'Missing')).toThrow();
  });
});

describe('BLD-14: the guard steps are executed, so a negative control cannot lose its teeth unnoticed', () => {
  const steps = {
    positive: stepRun(ci, 'Verify canonical project ref guard'),
    nonCanonicalRef: stepRun(ci, 'Guard must refuse a non-canonical ref'),
    driftedConfig: stepRun(ci, 'Guard must refuse a drifted config.toml'),
  };

  /** A scratch checkout: the given guard script and a config.toml pinned to `pin`. */
  const scratch = (guardSource: string, pin: string): string => {
    const dir = mkdtempSync(join(tmpRoot, 'guard-'));
    mkdirSync(join(dir, 'supabase'));
    mkdirSync(join(dir, 'tmp')); // the drifted-config control calls `mktemp -d`; keep its directory in here
    writeFileSync(join(dir, 'supabase', 'predeploy_guard.sh'), guardSource);
    writeFileSync(join(dir, 'supabase', 'config.toml'), `project_id = "${pin}"\n`);
    return dir;
  };

  /** Runs a step's script the way GitHub runs it on ubuntu: `bash -eo pipefail`. */
  const runScript = (dir: string, script: string, extra: Record<string, string | undefined> = {}) => {
    const r = spawnSync(BASH, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: hermeticEnv({ TMPDIR: fwd(join(dir, 'tmp')), ...extra }),
    });
    return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  const statuses = (dir: string) => ({
    positive: runScript(dir, steps.positive).status,
    nonCanonicalRef: runScript(dir, steps.nonCanonicalRef).status,
    driftedConfig: runScript(dir, steps.driftedConfig).status,
  });

  it('with the real guard and the real pin all three steps pass', () => {
    const dir = scratch(guard, canonical);
    expect(statuses(dir)).toEqual({ positive: 0, nonCanonicalRef: 0, driftedConfig: 0 });
    expect(runScript(dir, steps.positive).output).toContain(`deploy target OK: ${canonical}`);
  });

  it('with a guard that accepts everything the positive step passes and both controls fail', () => {
    const dir = scratch('#!/usr/bin/env bash\nexit 0\n', canonical);
    expect(statuses(dir)).toEqual({ positive: 0, nonCanonicalRef: 1, driftedConfig: 1 });
  });

  it('with a guard that ignores config.toml the positive step fails (it really reads the pin)', () => {
    const envOnly = `#!/usr/bin/env bash\n[ "\${SUPABASE_PROJECT_REF:-}" = "${canonical}" ] || exit 1\n`;
    const dir = scratch(envOnly, canonical);
    expect(statuses(dir).positive).toBe(1);
  });

  it('a config.toml that drifted to another project fails the positive step with the real guard', () => {
    const dir = scratch(guard, 'not-the-canonical-ref');
    expect(runScript(dir, steps.positive).status).not.toBe(0);
  });

  it('release step: a wrong job-level ref is blocked, the canonical one passes, a drifted pin is blocked', () => {
    const script = stepRun(release, 'Enforce canonical project ref guard');
    const good = scratch(guard, canonical);
    expect(runScript(good, script, { SUPABASE_PROJECT_REF: canonical }).status).toBe(0);
    // the regression this fix prevents: with `env -u` only, this wrong target would have passed
    expect(runScript(good, script, { SUPABASE_PROJECT_REF: 'not-the-canonical-ref' }).status).not.toBe(0);
    const drifted = scratch(guard, 'not-the-canonical-ref');
    expect(runScript(drifted, script, { SUPABASE_PROJECT_REF: canonical }).status).not.toBe(0);
  });
});

describe('nothing in this phase can reach a live project', () => {
  /** Where a project-bound CLI command must never appear (the spec's scope, plus the release workflow). */
  const commandSurfaces = (): Record<string, string> => ({
    '.github/workflows/ci.yml': ci,
    '.github/workflows/supabase-release-verify.yml': release,
    ...Object.fromEntries(testFiles().map((f) => [`${TESTS_DIR}/${f}`, read(`${TESTS_DIR}/${f}`)])),
  });
  /**
   * Where the denied project must never be named. The owner runbook is in scope here and NOT above:
   * it legitimately spells out `supabase db push` and `functions deploy` for the owner to run.
   */
  const refSurfaces = (): Record<string, string> => ({
    ...commandSurfaces(),
    'docs/implementation-v3/SQL_FOR_OWNER.md': read('docs/implementation-v3/SQL_FOR_OWNER.md'),
  });
  // `--project-ref` is deliberately not listed: the manual release workflow hands it to the
  // read-only tools/verify-edge-deployment.mjs, which is not a project-mutating command.
  const LIVE_COMMANDS = /supabase\s+(?:db\s+(?:push|pull|reset|remote)|link|functions\s+deploy|migration\s+repair|secrets|projects|login|start)\b|\.supabase\.co\b/;

  it('no workflow or test file invokes a project-bound supabase CLI command or names a project host', () => {
    const hits = Object.entries(commandSurfaces()).filter(([, text]) => LIVE_COMMANDS.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it('the pattern really catches the commands it names (synthetic)', () => {
    for (const bad of ['supabase db push', 'supabase  link', 'supabase functions deploy foo', 'supabase migration repair 1', 'https://x.supabase.co/rest']) {
      expect(LIVE_COMMANDS.test(bad)).toBe(true);
    }
    expect(LIVE_COMMANDS.test('bash supabase/tests/run.sh')).toBe(false);
  });

  it('the owner runbook is not scanned for commands (it documents them for the owner), and still exists', () => {
    expect(Object.keys(commandSurfaces())).not.toContain('docs/implementation-v3/SQL_FOR_OWNER.md');
    expect(Object.keys(refSurfaces())).toContain('docs/implementation-v3/SQL_FOR_OWNER.md');
  });

  it('the denied project (read from the guard at run time) appears in none of this phase\'s files', () => {
    const denied = /^DENIED="([^"]+)"/m.exec(guard)?.[1] ?? '';
    expect(denied).toMatch(/^[a-z]{20}$/); // positive control: the guard still declares it
    const hits = Object.entries(refSurfaces()).filter(([, text]) => text.includes(denied)).map(([path]) => path);
    expect(hits).toEqual([]);
    expect(readFileSync(__filename, 'utf8')).not.toContain(denied);
  });
});

describe('the runners refuse anything but a local database', () => {
  const REFUSE = /^case "\$\{PGHOST:-\}" in\n {2}127\.0\.0\.1\|localhost\|::1\) ;;\n {2}\*\) echo "REFUSED:/m;

  /** Offset of the first line that is not a comment and mentions psql. */
  const firstPsqlCall = (text: string): number => {
    let offset = 0;
    for (const line of text.split('\n')) {
      if (!/^\s*#/.test(line) && /\bpsql\b|\bPSQL=/.test(line)) return offset;
      offset += line.length + 1;
    }
    return -1;
  };

  it('run.sh and 05 carry the PGHOST case with a REFUSED branch, before any psql call', () => {
    for (const [name, text] of [['run.sh', runSh], ['05_concurrency_spend.sh', concurrencySh]] as const) {
      expect({ name, refuses: REFUSE.test(text) }).toEqual({ name, refuses: true });
      const call = firstPsqlCall(text);
      // `echo "REFUSED:` is the branch itself; the bare word also sits in the header comment
      expect({ name, found: call > 0, ordered: at(text, 'echo "REFUSED:') < call }).toEqual({ name, found: true, ordered: true });
    }
    expect(runSh).toContain('MIN_RESULTS=');
    expect(runSh).toMatch(/PGHOSTADDR/);
    expect(runSh).toMatch(/PGSERVICE/);
  });

  // Run the real scripts: a static match on the word REFUSED would survive a broken case pattern.
  const attempt = (script: string, env: Record<string, string | undefined>) =>
    spawnSync(BASH, [script], { cwd: REPO, encoding: 'utf8', env: hermeticEnv(env) });

  it('the resolved bash runs, otherwise these checks would pass by never running', () => {
    const probe = spawnSync(BASH, ['-c', 'echo probe'], { encoding: 'utf8' });
    // BASH is part of the compared object, so a failure names the executable that was tried. On
    // Windows a WSL stub is what a bare `bash` finds outside Git Bash: set GIT_BASH to Git's bash.exe.
    expect({ bash: BASH, stdout: (probe.stdout ?? '').trim(), status: probe.status }).toEqual({ bash: BASH, stdout: 'probe', status: 0 });
  });

  const scripts = [`${TESTS_DIR}/run.sh`, `${TESTS_DIR}/05_concurrency_spend.sh`];
  const refusals: [string, Record<string, string | undefined>][] = [
    ['PGHOST unset', {}],
    ['a remote PGHOST', { PGHOST: 'db.example.test' }],
    ['a name that merely starts like localhost', { PGHOST: 'localhost.example.test' }],
    ['a remote PGHOSTADDR behind a local PGHOST', { PGHOST: '127.0.0.1', PGHOSTADDR: '10.1.2.3' }],
    ['a connection service entry', { PGHOST: '127.0.0.1', PGSERVICE: 'anything' }],
  ];
  for (const script of scripts) {
    for (const [label, env] of refusals) {
      it(`${script} exits 2 with REFUSED for ${label}`, () => {
        const r = attempt(script, env);
        expect({ script, label, status: r.status, refused: /REFUSED/.test(r.stderr ?? '') }).toEqual({ script, label, status: 2, refused: true });
      });
    }
  }
});

describe('the runners also refuse a local database that does not look like the throwaway CI one', () => {
  const fingerprintOf = (text: string): string => /^FINGERPRINT_SQL="(.*)"$/m.exec(text)?.[1] ?? '';

  it('run.sh and 05 carry the same read-only catalog fingerprint', () => {
    const sql = fingerprintOf(runSh);
    expect(sql).toMatch(/^SELECT /);
    expect(fingerprintOf(concurrencySh)).toBe(sql);
    // GoTrue's auth.users has encrypted_password, the CI stub does not; a hosted project's role is no superuser
    expect(sql).toContain("a.attname = 'encrypted_password'");
    expect(sql).toContain("current_setting('is_superuser') = 'on'");
    expect(/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|TRUNCATE)\b/i.test(sql)).toBe(false);
  });

  it('the fingerprint runs before the cleanup trap and before anything is written', () => {
    const marker = (text: string, needle: string): number => at(text, needle);
    expect(marker(runSh, '\nFINGERPRINT_SQL=')).toBeLessThan(marker(runSh, '\ntrap cleanup EXIT'));
    expect(marker(runSh, '\nFINGERPRINT_SQL=')).toBeLessThan(marker(runSh, 'CREATE SCHEMA aderyth_test'));
    expect(marker(concurrencySh, '\nFINGERPRINT_SQL=')).toBeLessThan(marker(concurrencySh, '\ntrap cleanup EXIT'));
    expect(marker(concurrencySh, '\nFINGERPRINT_SQL=')).toBeLessThan(marker(concurrencySh, 'INSERT INTO auth.users'));
    for (const text of [runSh, concurrencySh]) {
      expect(text).toContain('[ "$fingerprint" != "t" ]');
      expect(text).toContain('REFUSED: the target does not look like the throwaway CI database');
    }
  });
});

describe('run.sh: its own fail paths, proven by running it against a fake psql', () => {
  // The fake replays canned server output and records which kind of call it got, so these tests
  // never need a database. It is what makes every exit code of run.sh testable on any machine.
  const FAKE_PSQL = [
    '#!/usr/bin/env bash',
    '# Replays canned server output; talks to no database. Used only by the run.sh logic tests.',
    'f=""; c=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -f) f="$2"; shift 2 ;;',
    '    -c) c="$2"; shift 2 ;;',
    '    -v|-o) shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    'if [ -n "$c" ]; then',
    '  echo c >>"$FAKE_LOG"',
    '  [ -z "${FAKE_C_STATUS:-}" ] || exit "$FAKE_C_STATUS"',
    '  case "$c" in *encrypted_password*) printf \'%s\\n\' "${FAKE_FINGERPRINT:-t}" ;; esac',
    '  exit 0',
    'fi',
    'if [ -z "$f" ]; then echo stdin >>"$FAKE_LOG"; cat >/dev/null; exit 0; fi',
    'name="$(basename "$f")"',
    'echo "f:$name" >>"$FAKE_LOG"',
    'if [ -f "$FAKE_CANNED/$name.out" ]; then',
    '  while IFS= read -r line; do printf \'psql:%s:1: NOTICE:  %s\\n\' "$f" "$line" >&2; done <"$FAKE_CANNED/$name.out"',
    'fi',
    'if [ -f "$FAKE_CANNED/$name.status" ]; then exit "$(cat "$FAKE_CANNED/$name.status")"; fi',
    'exit 0',
    '',
  ].join('\n');

  type GateCase = {
    /** files written next to run.sh: name -> content */
    files: Record<string, string>;
    /** what the fake psql prints (as server NOTICEs) while it "runs" a .sql file: name -> RESULT lines */
    canned: Record<string, string[]>;
    /** exit status of the fake psql for a .sql file */
    psqlStatus?: Record<string, number>;
    expected: string;
    env?: Record<string, string | undefined>;
  };

  const SQL = '01_synthetic.sql';
  const SH = '02_synthetic.sh';
  const filler = (n: number): string[] => Array.from({ length: n }, (_, i) => `RESULT|T91z_filler.${String(i + 1).padStart(2, '0')}|PASS|ok`);

  /** A run that reconciles: 147 results (4 + 1 + 1 + 140 from the SQL file, 1 from the shell test); the one red test is the one that is listed. */
  const healthy = (): GateCase => ({
    files: {
      [SQL]: [
        "SELECT aderyth_test.res('T91a_plain', true, '');",
        "SELECT aderyth_test.expect_denied('T91b_denied', $q$SELECT 1$q$);",
        "SELECT aderyth_test.expect_no_effect('T91c_no_effect', $q$SELECT 1$q$);",
        'SELECT aderyth_test.res(',
        "  'T91d_wrapped', true, 'the name sits on the next line');",
        '',
      ].join('\n'),
      [SH]: '#!/usr/bin/env bash\nreport() { echo "RESULT|$1|$([ "$2" = 1 ] && echo PASS || echo FAIL)|$3"; }\nreport T92a_shell_ok 1 fine\n',
    },
    canned: {
      [SQL]: [
        'RESULT|T91a_plain|PASS|ok',
        'RESULT|T91b_denied|PASS|42501',
        'RESULT|T91c_no_effect|PASS|rows=0',
        'RESULT|T91d_wrapped|PASS|ok',
        'RESULT|T02a_anon_execute.all|PASS|none',
        'RESULT|T02b_search_path.loose/0|FAIL|search_path is not pinned',
        ...filler(140),
      ],
    },
    expected: 'T02b_search_path.loose/0   # TST-01\n',
  });

  const canned = (c: GateCase, change: (lines: string[]) => string[]): GateCase => ({ ...c, canned: { ...c.canned, [SQL]: change(c.canned[SQL]) } });
  const setVerdict = (name: string, verdict: string) => (lines: string[]): string[] =>
    lines.map((l) => (l.startsWith(`RESULT|${name}|`) ? l.replace(/\|(PASS|FAIL|INFO)\|/, `|${verdict}|`) : l));
  const without = (name: string) => (lines: string[]): string[] => lines.filter((l) => !l.startsWith(`RESULT|${name}|`));

  const runGate = (c: GateCase) => {
    const dir = mkdtempSync(join(tmpRoot, 'gate-'));
    const bin = join(dir, 'bin');
    const cannedDir = join(dir, 'canned');
    mkdirSync(bin);
    mkdirSync(cannedDir);
    writeFileSync(join(bin, 'psql'), FAKE_PSQL, { mode: 0o755 });
    copyFileSync(join(REPO, TESTS_DIR, 'run.sh'), join(dir, 'run.sh'));
    writeFileSync(join(dir, 'expected_failures.txt'), c.expected);
    for (const [name, content] of Object.entries(c.files)) writeFileSync(join(dir, name), content);
    for (const [name, lines] of Object.entries(c.canned)) writeFileSync(join(cannedDir, `${name}.out`), `${lines.join('\n')}\n`);
    for (const [name, status] of Object.entries(c.psqlStatus ?? {})) writeFileSync(join(cannedDir, `${name}.status`), `${status}\n`);
    writeFileSync(join(dir, 'calls.log'), '');
    const env = withPathFront(
      hermeticEnv({
        PGHOST: '127.0.0.1',
        FAKE_LOG: fwd(join(dir, 'calls.log')),
        FAKE_CANNED: fwd(cannedDir),
        ...c.env,
      }),
      bin,
    );
    const r = spawnSync(BASH, ['run.sh'], { cwd: dir, encoding: 'utf8', env });
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean);
    return { status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, calls };
  };

  type Scenario = {
    label: string;
    change: (c: GateCase) => GateCase;
    status: number;
    /** fragments that must appear in the combined output */
    includes?: string[];
    /** the exact psql calls the run made, in order (a refused target must see only the fingerprint) */
    calls?: string[];
    /** the psql calls the run must START with */
    callsStart?: string[];
  };
  const scenarios: Scenario[] = [
    { label: 'the failing set equals the known-red list (exit 0); the fingerprint is the first psql call', change: (c) => c, status: 0, includes: ['OK: the failing set equals expected_failures.txt', 'SUMMARY: results=147'], callsStart: ['c', 'stdin', `f:${SQL}`] },
    { label: 'a red test that is not listed is UNEXPECTED (exit 1)', change: (c) => canned(c, setVerdict('T91b_denied', 'FAIL')), status: 1, includes: ['UNEXPECTED FAILURES', 'T91b_denied'] },
    { label: 'a listed test that turned green is STALE (exit 1)', change: (c) => canned(c, setVerdict('T02b_search_path.loose/0', 'PASS')), status: 1, includes: ['STALE expected_failures.txt', 'T02b_search_path.loose/0'] },
    { label: 'an EMPTY known-red list with nothing red passes: the state F09 leaves behind (exit 0)', change: (c) => ({ ...canned(c, setVerdict('T02b_search_path.loose/0', 'PASS')), expected: '# nothing is known-red any more\n' }), status: 0, includes: ['expected_failures=0'] },
    { label: 'an indented known-red entry means what the jest parser says it means (exit 0)', change: (c) => ({ ...c, expected: '    T02b_search_path.loose/0   # TST-01\n' }), status: 0 },
    { label: 'a result name reported twice is DUPLICATE (exit 4)', change: (c) => canned(c, (l) => [...l, 'RESULT|T91a_plain|PASS|again']), status: 4, includes: ['DUPLICATE RESULT NAMES', 'T91a_plain'] },
    { label: 'fewer results than MIN_RESULTS is TOO FEW (exit 4)', change: (c) => canned(c, (l) => l.filter((x) => !x.includes('T91z_filler'))), status: 4, includes: ['TOO FEW RESULTS'] },
    { label: 'a declared test that never reports is MISSING (exit 4)', change: (c) => canned(c, without('T91c_no_effect')), status: 4, includes: ['MISSING RESULTS', 'T91c_no_effect'] },
    { label: 'a declaration split over two lines is still a declaration (exit 4 when silent)', change: (c) => canned(c, without('T91d_wrapped')), status: 4, includes: ['MISSING RESULTS', 'T91d_wrapped'] },
    { label: 'a vanished result family is MISSING RESULT FAMILY (exit 4)', change: (c) => canned(c, without('T02a_anon_execute.all')), status: 4, includes: ['MISSING RESULT FAMILY', 'T02a_anon_execute.'] },
    { label: 'an unparseable RESULT line is rejected (exit 4)', change: (c) => canned(c, (l) => [...l, 'RESULT|bad name with spaces|PASS|x']), status: 4, includes: ['UNPARSEABLE RESULT LINES'] },
    { label: 'a malformed known-red entry is rejected (exit 4)', change: (c) => ({ ...c, expected: `${c.expected}T02b bad name   # TST-01\n` }), status: 4, includes: ['MALFORMED expected_failures.txt'] },
    { label: 'a SQL error in a test file is a HARNESS ERROR (exit 3)', change: (c) => ({ ...c, psqlStatus: { [SQL]: 3 } }), status: 3, includes: [`HARNESS ERROR in ${SQL}`] },
    { label: 'a failing shell test is a HARNESS ERROR (exit 3)', change: (c) => ({ ...c, files: { ...c.files, [SH]: '#!/usr/bin/env bash\nexit 7\n' } }), status: 3, includes: [`HARNESS ERROR in ${SH}`] },
    { label: 'a file outside the NN_name convention is a HARNESS ERROR (exit 3)', change: (c) => ({ ...c, files: { ...c.files, '6_oops.sql': 'SELECT 1;\n' } }), status: 3, includes: ['does not follow the NN_<name>.sql|sh convention'] },
    { label: 'a database that does not look like the CI one is REFUSED before anything is written (exit 2)', change: (c) => ({ ...c, env: { FAKE_FINGERPRINT: 'f' } }), status: 2, includes: ['REFUSED: the target does not look like the throwaway CI database'], calls: ['c'] },
    { label: 'an unreachable database is a HARNESS ERROR, not a pass (exit 3)', change: (c) => ({ ...c, env: { FAKE_C_STATUS: '2' } }), status: 3, includes: ['HARNESS ERROR: the database could not be queried'] },
  ];
  for (const s of scenarios) {
    it(s.label, () => {
      const r = runGate(s.change(healthy()));
      const missing = (s.includes ?? []).filter((fragment) => !r.text.includes(fragment));
      expect({ label: s.label, status: r.status, missing }).toEqual({ label: s.label, status: s.status, missing: [] });
      if (s.calls) expect({ label: s.label, calls: r.calls }).toEqual({ label: s.label, calls: s.calls });
      if (s.callsStart) expect({ label: s.label, calls: r.calls.slice(0, s.callsStart.length) }).toEqual({ label: s.label, calls: s.callsStart });
    });
  }

  it('05 refuses a target that does not look like the CI database before writing any fixture', () => {
    const dir = mkdtempSync(join(tmpRoot, 'five-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'psql'), FAKE_PSQL, { mode: 0o755 });
    writeFileSync(join(dir, 'calls.log'), '');
    copyFileSync(join(REPO, TESTS_DIR, '05_concurrency_spend.sh'), join(dir, '05_concurrency_spend.sh'));
    const env = withPathFront(
      hermeticEnv({ PGHOST: '127.0.0.1', FAKE_LOG: fwd(join(dir, 'calls.log')), FAKE_CANNED: fwd(dir), FAKE_FINGERPRINT: 'f' }),
      bin,
    );
    const r = spawnSync(BASH, ['05_concurrency_spend.sh'], { cwd: dir, encoding: 'utf8', env });
    expect({ status: r.status, refused: /REFUSED: the target does not look like/.test(r.stderr ?? '') }).toEqual({ status: 2, refused: true });
    expect(readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean)).toEqual(['c']);
  });
});

describe('test names: unique, complete and reconciled with the known-red list', () => {
  const sources = numberedTests().map((f) => read(`${TESTS_DIR}/${f}`));
  const names = declaredResultNames(sources);

  it('every static result name is declared exactly once', () => {
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    expect(repeated).toEqual([]);
  });

  it('declares at least 30 static names, including every required one (T01a-q, T01z1-5, T02c-e, T03a-d, T04a-f, T05a-f)', () => {
    expect(names.length).toBeGreaterThanOrEqual(30);
    const prefixes = names.map((n) => /^T\d\d[a-z0-9]*/.exec(n)?.[0] ?? '');
    expect(REQUIRED_NAMES.filter((r) => !prefixes.includes(r))).toEqual([]);
  });

  it('the helper ignores dynamic families and finds repeats (synthetic)', () => {
    const dynamic = "PERFORM aderyth_test.res(format('T02a_anon_execute.%s/%s', r.proname, r.pronargs), false, r.sig);\nPERFORM aderyth_test.res('T02a_anon_execute.all', true, 'x');";
    expect(declaredResultNames([dynamic])).toEqual([]);
    const twice = "SELECT aderyth_test.res('T09a_x', true, '');\nSELECT aderyth_test.expect_denied('T09a_x', $q$SELECT 1$q$);\nSELECT aderyth_test.expect_no_effect('T09e_v', $q$SELECT 1$q$);\nSELECT aderyth_test.res(\n  'T09f_split', true, '');\nreport T09b_y 1 d\ninfo T09c_z d\necho \"RESULT|T09d_w|PASS|\"";
    expect(declaredResultNames([twice])).toEqual(['T09a_x', 'T09a_x', 'T09e_v', 'T09f_split', 'T09b_y', 'T09c_z', 'T09d_w']);
  });

  it('the two dynamic families are produced by 02 and required by run.sh', () => {
    // the static-name check cannot see names that carry a dot; deleting a family block would otherwise be silent
    expect(hygieneSql).toContain("format('T02a_anon_execute.%s/%s'");
    expect(hygieneSql).toContain("'T02a_anon_execute.all'");
    expect(hygieneSql).toContain("format('T02b_search_path.%s/%s'");
    expect(hygieneSql).toContain("'T02b_search_path.all'");
    expect(runSh).toMatch(/for family in T02a_anon_execute\. T02b_search_path\.; do/);
    expect(runSh).toContain('MISSING RESULT FAMILY');
  });

  it('the helpers behind the probes exist, and T04e pins the error text of the function\'s own guard', () => {
    for (const fn of ['res', 'expect_denied', 'expect_no_effect', 'expect_allowed']) {
      expect(runSh).toContain(`CREATE FUNCTION aderyth_test.${fn}(`);
    }
    expect(runSh).toContain('p_message text DEFAULT NULL');
    const t04e = /expect_denied\('T04e_no_subject_raises_42501'[\s\S]*?\);/.exec(read(`${TESTS_DIR}/04_today_bootstrap_isolation.sql`))?.[0] ?? '';
    expect(t04e).toContain("'authentication required'");
  });

  it('every test file is NN_<name>.sql|sh with a unique number, and run.sh globs two digits', () => {
    const files = numberedTests();
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.filter((f) => !/^\d\d_[a-z0-9_]+\.(sql|sh)$/.test(f))).toEqual([]);
    const numbers = files.map((f) => f.slice(0, 2));
    expect(numbers.filter((n, i) => numbers.indexOf(n) !== i)).toEqual([]);
    // a one-digit glob would silently skip 10_*.. which the plan reserves for later phases
    expect(runSh).toContain('"$here"/[0-9][0-9]_*');
    expect(runSh).not.toMatch(/0\[0-9\]_\*/);
  });
});

describe('expected_failures.txt: well formed, justified, tied to real functions', () => {
  const entries = parseExpectedFailureLines(expectedText);

  it('every name is a result name and every entry carries a finding id (an empty list passes: F09 empties it)', () => {
    for (const e of entries) {
      expect({ name: e.name, shape: /^T\d\d[a-z0-9]*_[A-Za-z0-9_./-]+$/.test(e.name) }).toEqual({ name: e.name, shape: true });
      expect({ name: e.name, finding: /\b[A-Z]{2,4}\d?-V?\d{2}\b/.test(e.comment) }).toEqual({ name: e.name, finding: true });
    }
    expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length);
  });

  it('states its closing phase in the header while it has entries', () => {
    // F09 deletes every entry in one commit; with nothing left to close, the header is no longer required
    if (entries.length > 0) {
      expect(expectedText).toMatch(/^# Closing phase for EVERY entry below: F\d\d\b/m);
    }
  });

  it('never lists a security result as known-red without saying so loudly (P0 and a closing phase)', () => {
    const protectedFamily = /^(T01|T02a|T03|T04|T05[a-d])/;
    const quiet = entries
      .filter((e) => protectedFamily.test(e.name))
      .filter((e) => !(/\bP0\b/.test(e.comment) && /\bF\d\d\b/.test(e.comment)))
      .map((e) => e.name);
    expect(quiet).toEqual([]);
  });

  it('every T02b entry is a real SECURITY DEFINER function without a pinned search_path in the live dump', () => {
    const unpinned = unpinnedSecurityDefiners(live);
    expect(unpinned.length).toBeGreaterThan(10);
    const unknown = entries
      .filter((e) => e.name.startsWith('T02b_search_path.'))
      .map((e) => e.name.slice('T02b_search_path.'.length))
      .filter((n) => !unpinned.includes(n));
    expect(unknown).toEqual([]);
  });

  it('parses names, drops comment-only and blank lines (synthetic)', () => {
    expect(parseExpectedFailures('T02b_x # a\n# only comment\n\n')).toEqual(['T02b_x']);
    expect(parseExpectedFailures('  T02b_y/1   # TST-01  \r\n   # c\r\n')).toEqual(['T02b_y/1']);
    expect(parseExpectedFailures('')).toEqual([]);
  });

  it('the checks above hold vacuously for an empty list, so deleting every line is not a guard change (synthetic)', () => {
    const empty = parseExpectedFailureLines('# nothing is known-red any more\n');
    expect(empty).toEqual([]);
    expect(empty.filter((e) => !/^T\d\d[a-z0-9]*_[A-Za-z0-9_./-]+$/.test(e.name))).toEqual([]);
  });

  it('the dump scan finds an unpinned function and skips a pinned one (synthetic)', () => {
    const dump = [
      'CREATE OR REPLACE FUNCTION "public"."loose"("a" "uuid", "b" integer DEFAULT 30) RETURNS "void"',
      '    LANGUAGE "plpgsql" SECURITY DEFINER',
      '    AS $$ begin end; $$;',
      'CREATE OR REPLACE FUNCTION "public"."tight"() RETURNS "void"',
      '    LANGUAGE "plpgsql" SECURITY DEFINER',
      '    SET "search_path" TO \'public\'',
      '    AS $$ begin end; $$;',
      'CREATE OR REPLACE FUNCTION "public"."invoker"() RETURNS "void"',
      '    LANGUAGE "plpgsql"',
      '    AS $$ begin end; $$;',
    ].join('\n');
    expect(unpinnedSecurityDefiners(dump)).toEqual(['loose/2']);
  });
});

describe('the SQL tests stay pure, honest and rolled back', () => {
  const bodies = sqlTests.map((f) => ({ f, text: read(`${TESTS_DIR}/${f}`) }));

  it('contain no psql meta-commands (they must run unchanged in the harness and under CI psql)', () => {
    const hits = bodies.filter(({ text }) => /^\s*\\[A-Za-z]/m.test(stripSqlComments(text))).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it('change no privileges or policies (that is a migration, and migrationRlsGuard owns migrations)', () => {
    const hits = bodies
      .filter(({ text }) => /\b(?:GRANT|REVOKE|CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+POLICY|ENABLE\s+ROW\s+LEVEL)\b/i.test(stripSqlComments(text)))
      .map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it('never write profiles.total_xp directly outside an expect_denied probe (drift may only come from the triggers)', () => {
    const offenders = bodies
      .filter(({ text }) => {
        const bare = withoutQuotedProbes(stripSqlComments(text));
        return /UPDATE\s+public\.profiles[\s\S]*?\btotal_xp\s*=/i.test(bare)
          || /INSERT\s+INTO\s+public\.profiles\s*\([^)]*\btotal_xp\b/i.test(bare);
      })
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('03 and 04 end in ROLLBACK and never COMMIT (their fixtures must not outlive them)', () => {
    for (const prefix of ['03_', '04_']) {
      const text = stripSqlComments(bodies.find(({ f }) => f.startsWith(prefix))?.text ?? '');
      expect({ prefix, rollsBack: /\bROLLBACK;\s*$/.test(text.trim()), commits: /\bCOMMIT\b/i.test(text) })
        .toEqual({ prefix, rollsBack: true, commits: false });
    }
  });

  it('the probe stripper keeps real statements and drops quoted probes (synthetic)', () => {
    const sql = "-- UPDATE public.profiles SET total_xp = 1\nSELECT aderyth_test.expect_denied('T01d_x', $q$UPDATE public.profiles SET total_xp = 9$q$);";
    expect(/total_xp/.test(withoutQuotedProbes(stripSqlComments(sql)))).toBe(false);
    expect(/total_xp/.test(withoutQuotedProbes(stripSqlComments('UPDATE public.profiles SET total_xp = 9;')))).toBe(true);
  });
});
