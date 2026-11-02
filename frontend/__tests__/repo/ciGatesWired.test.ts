import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const CI_YML = join(REPO, '.github', 'workflows', 'ci.yml');
const RELEASE_YML = join(REPO, '.github', 'workflows', 'supabase-release-verify.yml');
const DENO_TEST = join(REPO, 'supabase', 'functions', '_shared', 'aiIdempotency_test.ts');

describe('Item #7 — CI/CD Deno 2, Postgres 17 Migration & Release Parity Gates', () => {
  const ci = readFileSync(CI_YML, 'utf8');

  it('ci.yml runs frontend verify, edge-deno-verify (Deno 2), and db-migrations-verify (Postgres 17)', () => {
    expect(ci).toContain('verify:');
    expect(ci).toContain('edge-deno-verify:');
    expect(ci).toContain('denoland/setup-deno@v2');
    expect(ci).toContain('deno check');
    expect(ci).toContain('deno test supabase/functions/_shared/aiIdempotency_test.ts');

    expect(ci).toContain('db-migrations-verify:');
    expect(ci).toContain('image: postgres:17');
    expect(ci).toContain('supabase/live_schema.sql');
    expect(ci).toContain('supabase/migrations/037_today_bootstrap_rpc.sql');
    expect(ci).toContain('public.get_today_bootstrap(CURRENT_DATE)');
  });

  it('checks every active canonical Edge Function and _shared module with deno check', () => {
    for (const target of [
      'supabase/functions/_shared/aiIdempotency.ts',
      'supabase/functions/_shared/coachContractSchema.ts',
      'supabase/functions/_shared/oauthState.ts',
      'supabase/functions/_shared/redirectAllowlist.ts',
      'supabase/functions/delete-account/index.ts',
      'supabase/functions/generate-routine/index.ts',
      'supabase/functions/google-auth/index.ts',
      'supabase/functions/notion-auth/index.ts',
      'supabase/functions/notion-sync/index.ts',
      'supabase/functions/spotify-auth/index.ts',
      'supabase/functions/subscription-webhook/index.ts',
    ]) {
      expect(ci).toContain(target);
    }
    expect(existsSync(DENO_TEST)).toBe(true);
  });

  it('the Edge check does not inherit the repo-root package.json (Deno would demand npm: packages in node_modules)', () => {
    const lf = ci.replace(/\r\n?/g, '\n'); // a Windows checkout may carry CRLF
    const job = lf.slice(lf.indexOf('edge-deno-verify:'), lf.indexOf('db-migrations-verify:'));
    expect(job).toMatch(/\n {4}env:\n {6}DENO_NO_PACKAGE_JSON: '1'\n/);
    const command = job.search(/run: \|\n\s+deno check/);
    expect(command).toBeGreaterThan(-1);
    expect(job.indexOf("DENO_NO_PACKAGE_JSON: '1'")).toBeLessThan(command);
  });

  it('ships manual workflow_dispatch release parity guard without live DB push commands', () => {
    expect(existsSync(RELEASE_YML)).toBe(true);
    const rel = readFileSync(RELEASE_YML, 'utf8');
    expect(rel).toContain('workflow_dispatch:');
    expect(rel).toContain('supabase/predeploy_guard.sh');
    expect(rel).toContain('tools/verify-edge-deployment.mjs');
    expect(rel).not.toMatch(/supabase\s+db\s+push/);
  });
});

