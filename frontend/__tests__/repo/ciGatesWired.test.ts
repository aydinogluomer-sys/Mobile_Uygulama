import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const CI_YML = join(REPO, '.github', 'workflows', 'ci.yml');
const RELEASE_YML = join(REPO, '.github', 'workflows', 'supabase-release-verify.yml');
const FUNCTIONS_DIR = join(REPO, 'supabase', 'functions');
const DENO_JSON = join(FUNCTIONS_DIR, 'deno.json');
const DENO_LOCK = join(FUNCTIONS_DIR, 'deno.lock');

const PINNED_USES_RE = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s*v\d+/;

export function unpinnedUses(workflowYaml: string): string[] {
  const bad: string[] = [];
  for (const line of workflowYaml.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (!PINNED_USES_RE.test(m[1])) bad.push(m[1]);
  }
  return bad;
}

const REQUIRED_VERIFY_STEPS: readonly string[] = [
  'npm audit --omit=dev --audit-level=',
  'npx expo export --platform android',
  'npx expo export --platform ios',
  'npx expo export --platform web',
  'npx expo install --check',
  'npx expo prebuild --no-install --platform all',
  'npx expo-doctor',
];

export function missingVerifySteps(ciYaml: string): string[] {
  return REQUIRED_VERIFY_STEPS.filter((step) => !ciYaml.includes(step));
}

export function expectedDenoCheckTargets(functionsDir: string): string[] {
  const targets: string[] = [];
  const sharedDir = join(functionsDir, '_shared');
  for (const f of readdirSync(sharedDir).sort()) {
    if (f.endsWith('.ts') && !f.endsWith('_test.ts') && !f.endsWith('.test.ts')) {
      targets.push(`_shared/${f}`);
    }
  }
  for (const entry of readdirSync(functionsDir).sort()) {
    if (entry.startsWith('_')) continue;
    const full = join(functionsDir, entry);
    if (!statSync(full).isDirectory()) continue;
    for (const file of ['index.ts', 'handler.ts']) {
      if (existsSync(join(full, file))) targets.push(`${entry}/${file}`);
    }
  }
  return targets.sort();
}

export function parseCheckTaskTargets(checkCommand: string): string[] {
  return checkCommand
    .split(/\s+/)
    .filter((tok) => tok.endsWith('.ts'))
    .sort();
}

describe('Item #7, F08 & F21 (BLD-04, BLD-05, GAP2-04, EDG-10, BLD-06, TST-02) — CI/CD Hardening & Deno Task Parity', () => {
  const ci = readFileSync(CI_YML, 'utf8');
  const rel = readFileSync(RELEASE_YML, 'utf8');

  it('ci.yml and supabase-release-verify.yml run frozen deno task check/test and never hardcode manual deno check lists', () => {
    expect(ci).toContain('verify:');
    expect(ci).toContain('edge-deno-verify:');
    expect(ci).toMatch(/denoland\/setup-deno@[0-9a-f]{40} # v2/);
    expect(ci).toContain('deno task --config supabase/functions/deno.json check');
    expect(ci).toContain('deno task --config supabase/functions/deno.json test');
    expect(ci).not.toContain('deno check \\');
    expect(ci).not.toContain('deno test supabase/functions/_shared/aiIdempotency_test.ts');

    expect(rel).toContain('deno task --config supabase/functions/deno.json check');
    expect(rel).toContain('deno task --config supabase/functions/deno.json test');
    expect(rel).not.toContain('deno check \\');
    expect(rel).not.toContain('deno test supabase/functions/_shared/aiIdempotency_test.ts');

    expect(ci).toContain('db-migrations-verify:');
    expect(ci).toContain('image: postgres:17');
    expect(ci).toContain('supabase/live_schema.sql');
    expect(ci).toContain('supabase/migrations/037_today_bootstrap_rpc.sql');
    expect(ci).toContain('public.get_today_bootstrap(CURRENT_DATE)');
    expect(ci).toContain('supabase/migrations/039_focus_point_hardening.sql');
    expect(ci).toContain('f07-heal-req:refund');
    expect(ci).toContain('f07-preclaim-req:refund');
    expect(ci).toContain('supabase/migrations/040_privilege_hygiene.sql');
    expect(ci).toContain('040 requires 036');
    expect(ci).toContain('040 is not applied');
  });

  it('deno.json tasks.check covers every canonical index.ts, handler.ts, and non-test _shared/*.ts on disk, and deno.lock exists', () => {
    expect(existsSync(DENO_JSON)).toBe(true);
    expect(existsSync(DENO_LOCK)).toBe(true);
    const denoCfg = JSON.parse(readFileSync(DENO_JSON, 'utf8')) as { tasks?: { check?: string; test?: string } };
    expect(denoCfg.tasks?.check).toContain('--frozen');
    expect(denoCfg.tasks?.test).toContain('--frozen');

    const listed = parseCheckTaskTargets(denoCfg.tasks?.check ?? '');
    const onDisk = expectedDenoCheckTargets(FUNCTIONS_DIR);
    expect(listed).toEqual(onDisk);
    for (const relPath of listed) {
      expect(existsSync(join(FUNCTIONS_DIR, relPath))).toBe(true);
    }

    // Negative sanity: omitting a handler from tasks.check causes mismatch
    const dropped = parseCheckTaskTargets((denoCfg.tasks?.check ?? '').replace('generate-routine/handler.ts', ''));
    expect(dropped).not.toEqual(onDisk);
  });

  it('the Edge check does not inherit the repo-root package.json (Deno would demand npm: packages in node_modules)', () => {
    const lf = ci.replace(/\r\n?/g, '\n');
    const job = lf.slice(lf.indexOf('edge-deno-verify:'), lf.indexOf('db-migrations-verify:'));
    expect(job).toMatch(/\n {4}env:\n {6}DENO_NO_PACKAGE_JSON: '1'\n/);
    const command = job.indexOf('deno task --config supabase/functions/deno.json check');
    expect(command).toBeGreaterThan(-1);
    expect(job.indexOf("DENO_NO_PACKAGE_JSON: '1'")).toBeLessThan(command);
  });

  it('(+) hardens ci.yml with read-only permissions, cancel-in-progress concurrency, job timeouts and 40-hex SHA pins', () => {
    const lf = ci.replace(/\r\n?/g, '\n');
    expect(lf).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(lf).toMatch(/\nconcurrency:\n {2}group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/);

    const verifyJob = lf.slice(lf.indexOf('  verify:'), lf.indexOf('  edge-deno-verify:'));
    const edgeJob = lf.slice(lf.indexOf('  edge-deno-verify:'), lf.indexOf('  db-migrations-verify:'));
    const dbJob = lf.slice(lf.indexOf('  db-migrations-verify:'));
    expect(verifyJob).toMatch(/\n {4}timeout-minutes: 25\n/);
    expect(edgeJob).toMatch(/\n {4}timeout-minutes: 10\n/);
    expect(dbJob).toMatch(/\n {4}timeout-minutes: 15\n/);

    const usesCount = (lf.match(/^\s*(?:-\s*)?uses:/gm) ?? []).length;
    expect(usesCount).toBeGreaterThanOrEqual(5);
    expect(unpinnedUses(lf)).toEqual([]);
  });

  it('(+) ci.yml verify job runs audit, web export, SDK alignment, prebuild plugin check, expo-doctor and bundle env inlining check', () => {
    expect(missingVerifySteps(ci)).toEqual([]);
    expect(ci).toContain('EXPO_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321');
    expect(ci).toContain('grep -rl "127.0.0.1:54321" dist');
  });

  it('(+) ships hardened manual workflow_dispatch release parity guard without live DB push commands', () => {
    expect(existsSync(RELEASE_YML)).toBe(true);
    const lf = rel.replace(/\r\n?/g, '\n');
    expect(lf).toContain('workflow_dispatch:');
    expect(lf).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(lf).toMatch(/\nconcurrency:\n {2}group: supabase-release-verify\n {2}cancel-in-progress: false\n/);
    expect(lf).toMatch(/\n {4}timeout-minutes: 15\n/);
    expect(lf).toContain('supabase/predeploy_guard.sh');
    expect(lf).toContain('tools/verify-edge-deployment.mjs');
    expect(lf).not.toMatch(/supabase\s+db\s+push/);
    expect((lf.match(/^\s*(?:-\s*)?uses:/gm) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(unpinnedUses(lf)).toEqual([]);
  });

  it('(-) rejects unpinned mutable action tags and rejects a ci.yml missing --platform web', () => {
    expect(unpinnedUses('      - uses: actions/checkout@v5\n')).toEqual(['actions/checkout@v5']);
    const withoutWeb = ci.replace('npx expo export --platform web', 'echo skipped');
    expect(missingVerifySteps(withoutWeb)).toEqual(['npx expo export --platform web']);
  });
});
