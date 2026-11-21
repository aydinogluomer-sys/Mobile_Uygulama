/**
 * F08 (BLD-13) — the auth-template script may only ever write to the canonical project.
 *
 * `scripts/configure-supabase-recovery-template.mjs` PATCHes the Supabase Management API for the
 * project named by the local `.env`. Before F08 nothing stopped a `.env` aimed at another project
 * (the denied one included). The guard now runs right after the ref is derived — dry run included,
 * before any fetch — so every process case below finishes without a network call.
 *
 * The denied ref is NOT written in this file (crossProjectIsolation rule A): it is read at run time
 * from its single source, the `DENIED=` line of supabase/predeploy_guard.sh.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');
const SCRIPT = join(FRONTEND, 'scripts', 'configure-supabase-recovery-template.mjs');
const GUARD_LIB = join(FRONTEND, 'scripts', 'lib', 'canonicalProjectRef.mjs');
const CANONICAL = 'kbcuolhjjnmhjaarxxmu';
const FAKE_TOKEN = 'sahte-token-F08-should-never-print';

function deniedRef(): string {
  const guard = readFileSync(join(REPO, 'supabase', 'predeploy_guard.sh'), 'utf8');
  const m = /^DENIED="([^"]*)"/m.exec(guard);
  if (!m || !m[1]) throw new Error('DENIED line not found in supabase/predeploy_guard.sh');
  return m[1];
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', SUPABASE_ACCESS_TOKEN: FAKE_TOKEN };
  // Windows needs SystemRoot for node to start at all; it carries nothing project-related.
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

/** Runs the real script from `<tmp>/frontend` with a fixture `.env` and optionally `<tmp>/supabase/config.toml`. */
function runScript(url: string, configToml: string | null, args: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'f08-recovery-'));
  try {
    const cwd = join(root, 'frontend');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, '.env'), `EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=fixture-anon\n`);
    if (configToml !== null) {
      mkdirSync(join(root, 'supabase'), { recursive: true });
      writeFileSync(join(root, 'supabase', 'config.toml'), configToml);
    }
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv(), encoding: 'utf8', timeout: 20000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Evaluates an ES-module snippet against scripts/lib/canonicalProjectRef.mjs in a child node. */
function runLib(body: string) {
  const src = `import * as lib from ${JSON.stringify(pathToFileURL(GUARD_LIB).href)};\n${body}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: childEnv(), encoding: 'utf8', timeout: 20000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const CANONICAL_TOML = `project_id = "${CANONICAL}"\n`;

describe('BLD-13 — canonical-project guard of configure-supabase-recovery-template.mjs', () => {
  it('(+) supabase/config.toml pins the canonical project and the library reads it', () => {
    const toml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');
    expect(toml).toMatch(new RegExp(`^\\s*project_id\\s*=\\s*"${CANONICAL}"`, 'm'));
    const r = runLib(`process.stdout.write(lib.readCanonicalProjectRef(${JSON.stringify(join(REPO, 'supabase', 'config.toml'))}));`);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(CANONICAL);
  });

  it('(+) the canonical ref passes without calling exit; projectRefFromUrl parses the host', () => {
    const r = runLib(
      [
        'let calls = 0;',
        `const ok = lib.assertCanonicalProjectRef(lib.projectRefFromUrl('https://${CANONICAL}.supabase.co'), '${CANONICAL}', () => { calls++; });`,
        "process.stdout.write(JSON.stringify({ ok, calls, bad: lib.projectRefFromUrl('not a url'), other: lib.projectRefFromUrl('https://example.com') }));",
      ].join('\n'),
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, calls: 0, bad: '', other: '' });
    expect(r.stderr).toBe('');
  });

  it('(-) a non-canonical or empty ref calls exit(2) and says REDDEDİLDİ', () => {
    const r = runLib(
      [
        'const codes = [];',
        "lib.assertCanonicalProjectRef('aaaaaaaaaaaaaaaaaaaa', 'kbcuolhjjnmhjaarxxmu', (c) => codes.push(c));",
        "lib.assertCanonicalProjectRef('', 'kbcuolhjjnmhjaarxxmu', (c) => codes.push(c));",
        "lib.assertCanonicalProjectRef('kbcuolhjjnmhjaarxxmu', '', (c) => codes.push(c));",
        'process.stdout.write(JSON.stringify(codes));',
      ].join('\n'),
    );
    expect(JSON.parse(r.stdout)).toEqual([2, 2, 2]);
    expect(r.stderr).toContain('REDDEDİLDİ');
  });

  it('(-) the script refuses the denied project before any request: exit 2, no token printed', () => {
    const denied = deniedRef();
    const r = runScript(`https://${denied}.supabase.co`, CANONICAL_TOML, ['--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('REDDEDİLDİ');
    expect(r.stderr).toContain(`${denied} kanonik değil`);
    expect(r.stdout + r.stderr).not.toContain(FAKE_TOKEN);
    expect(r.stdout).not.toContain('Endpoint:');
  });

  it('(-) the script refuses any other project too (allowlist, not a blacklist), dry run included', () => {
    const r = runScript('https://aaaaaaaaaaaaaaaaaaaa.supabase.co', CANONICAL_TOML);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('REDDEDİLDİ');
    expect(r.stdout + r.stderr).not.toContain(FAKE_TOKEN);
    expect(r.stdout).not.toContain('DRY RUN');
  });

  it('(-) an unreadable config.toml is a refusal (fail-closed), even for the canonical URL', () => {
    const r = runScript(`https://${CANONICAL}.supabase.co`, null, ['--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('REDDEDİLDİ');
    expect(r.stdout + r.stderr).not.toContain(FAKE_TOKEN);
  });

  it('(-) a config.toml without project_id is a refusal as well', () => {
    const r = runScript(`https://${CANONICAL}.supabase.co`, '[api]\nport = 54321\n', ['--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('REDDEDİLDİ');
  });

  it('(+) the guard runs before the endpoint is built and before the first fetch in the script', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const guard = src.indexOf('assertCanonicalProjectRef(projectRef');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf('const endpoint'));
    expect(guard).toBeLessThan(src.indexOf('fetch('));
    expect(guard).toBeLessThan(src.indexOf('if (!APPLY)'));
  });
});
