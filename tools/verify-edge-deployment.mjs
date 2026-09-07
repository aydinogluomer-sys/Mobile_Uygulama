#!/usr/bin/env node
/**
 * Does production actually run what this repository says it should?
 *
 * Step 9 asked that question for the first time and got three different wrong
 * answers: google-auth had never been deployed while the client advertised it,
 * notion-auth was still the pre-hardening build, and a vulnerable spotify-auth
 * was still reachable. Every edge test was green, because tests read the
 * repository and nothing read production.
 *
 * This is a RELEASE-TIME check, deliberately not a pull-request one. It needs
 * a SUPABASE_ACCESS_TOKEN, and putting a token with production read access
 * into ordinary PR runs would trade one risk for a worse one. The
 * credential-free half of the guarantee lives in
 * frontend/__tests__/repo/edgeDeploymentManifest.test.ts, which runs in CI on
 * every push and stops a function from being added without declaring what
 * production is supposed to do with it.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... node tools/verify-edge-deployment.mjs [--project-ref REF]
 *
 * Exit 0 = production matches the manifest. Exit 1 = drift (or the token is
 * missing, which is not a pass).
 *
 * Three things are checked per function:
 *
 *   presence    declared deploy:true must exist; deploy:false must NOT. The
 *               second half is what keeps a decommissioned function from
 *               quietly coming back.
 *   verify_jwt  a public function that should be authenticated is the exact
 *               shape of the Step-4 exposure, so the flag is asserted rather
 *               than assumed.
 *   staleness   the deployment's updated_at is compared against the last git
 *               commit touching that function's source. Bundle hashes cannot
 *               be reproduced locally, but "source changed after the last
 *               deploy" is computable, and it is precisely the signal that was
 *               missing: notion-auth's source was hardened long after the
 *               build serving traffic.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'supabase', 'functions', 'DEPLOYMENT.json');
const DEFAULT_REF = 'kbcuolhjjnmhjaarxxmu';

const argRef = process.argv.indexOf('--project-ref');
const projectRef = argRef !== -1 ? process.argv[argRef + 1] : (process.env.SUPABASE_PROJECT_REF || DEFAULT_REF);
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is not set.');
  console.error('This check reads live deployment metadata, so it cannot run without one.');
  console.error('Get a token with `npx supabase login`, or from the Supabase dashboard.');
  process.exit(1);
}

/** Last commit that touched this function's source, as epoch ms (0 = unknown). */
function lastSourceCommitMs(slug) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', `supabase/functions/${slug}`], {
      cwd: REPO,
      encoding: 'utf8',
    }).trim();
    return iso ? Date.parse(iso) : 0;
  } catch {
    return 0;
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// Overridable so the comparison logic can be exercised against a recorded
// payload without a production token, and so a self-hosted project can point
// at its own API. Defaults to Supabase's.
const apiBase = process.env.SUPABASE_API_URL || 'https://api.supabase.com';

const res = await fetch(`${apiBase}/v1/projects/${projectRef}/functions`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`Supabase API returned ${res.status} listing functions for ${projectRef}.`);
  console.error('A 401 means the token is wrong or expired; a 403 means it cannot see this project.');
  process.exit(1);
}
const live = await res.json();
const bySlug = new Map(live.map((f) => [f.slug, f]));

const strict = process.argv.includes('--strict');
const problems = [];
const warnings = [];
const rows = [];

for (const want of manifest.functions) {
  const got = bySlug.get(want.slug);

  if (!want.deploy) {
    if (got) {
      problems.push(`${want.slug}: declared deploy:false but is DEPLOYED (version ${got.version}).`);
      rows.push([want.slug, 'should be absent', 'DEPLOYED', 'DRIFT']);
    } else {
      rows.push([want.slug, 'absent by decision', 'absent', 'OK']);
    }
    continue;
  }

  if (!got) {
    const missing = want.requiredSecrets?.length ? ` Requires: ${want.requiredSecrets.join(', ')}.` : '';
    problems.push(`${want.slug}: declared deploy:true but is NOT DEPLOYED.${missing}`);
    rows.push([want.slug, 'deployed', 'MISSING', 'DRIFT']);
    continue;
  }

  let status = 'OK';

  if (typeof want.verifyJwt === 'boolean' && got.verify_jwt !== want.verifyJwt) {
    problems.push(`${want.slug}: verify_jwt is ${got.verify_jwt}, manifest requires ${want.verifyJwt}.`);
    status = 'DRIFT';
  }

  const srcMs = lastSourceCommitMs(want.slug);
  const depMs = Number(got.updated_at) || 0;
  if (srcMs && depMs && srcMs > depMs) {
    const days = (srcMs - depMs) / 86_400_000;
    warnings.push(
      `${want.slug}: source last changed ${new Date(srcMs).toISOString()}, ` +
        `deployment is from ${new Date(depMs).toISOString()} (${days.toFixed(1)} days behind).`,
    );
    status = status === 'OK' ? `STALE?+${days.toFixed(1)}d` : status;
  }

  rows.push([want.slug, `deployed, verify_jwt=${want.verifyJwt}`, `v${got.version}, verify_jwt=${got.verify_jwt}`, status]);
}

for (const f of live) {
  if (!manifest.functions.some((m) => m.slug === f.slug)) {
    problems.push(`${f.slug}: deployed but not declared in DEPLOYMENT.json.`);
    rows.push([f.slug, 'undeclared', `v${f.version}`, 'DRIFT']);
  }
}

const w = (i) => Math.max(...rows.map((r) => r[i].length), 8);
const [w0, w1, w2] = [w(0), w(1), w(2)];
console.log(`Edge deployment parity — project ${projectRef}\n`);
console.log(`${'function'.padEnd(w0)}  ${'expected'.padEnd(w1)}  ${'live'.padEnd(w2)}  status`);
console.log(`${'-'.repeat(w0)}  ${'-'.repeat(w1)}  ${'-'.repeat(w2)}  ------`);
for (const r of rows) console.log(`${r[0].padEnd(w0)}  ${r[1].padEnd(w1)}  ${r[2].padEnd(w2)}  ${r[3]}`);

if (warnings.length) {
  // Advisory, not fatal by default. "Source commit is newer than the
  // deployment" does not prove the running bundle differs, and there are two
  // ways it lies, both observed in this repository:
  //
  //   deploy-then-commit  Step 4 shipped that way, leaving minutes of gap on a
  //                       function that is perfectly current.
  //   tracked-after-deploy subscription-webhook was deployed in June and first
  //                       committed in August, which reads as 51 days behind
  //                       while nothing about it had changed at all.
  //
  // So this is a prompt to look, not a verdict: check whether the commits in
  // the gap actually changed behaviour. notion-auth's 90 days were real -- the
  // source was hardened and production still minted unsigned state. Pass
  // --strict only in a pipeline that deploys every function from the tree and
  // can therefore expect exact ordering.
  console.warn(`\n${warnings.length} possible staleness (advisory — check the magnitude):`);
  for (const w of warnings) console.warn(`  ? ${w}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (strict && warnings.length) {
  console.error('\n--strict: treating staleness as failure.');
  process.exit(1);
}

console.log(`\nProduction matches the manifest${warnings.length ? ' (with staleness advisories above)' : ''}.`);
