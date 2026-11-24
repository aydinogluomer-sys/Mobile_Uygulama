#!/usr/bin/env node
/**
 * Offline, zero-network owner rollout readiness preflight verifier.
 *
 * Verifies deterministic repository invariants before (and immediately after)
 * an owner production rollout against canonical project `kbcuolhjjnmhjaarxxmu`:
 *   1. Migration <-> Rollback 1:1 parity (`028`..`044`), `aderyth.rollback_confirm`,
 *      and `docs/implementation-v3/SQL_FOR_OWNER.md` coverage.
 *   2. `supabase/predeploy_guard.sh` integrity (`set -euo pipefail`, LF endings,
 *      fail-closed on empty/non-canonical ref, canonical `kbcuolhjjnmhjaarxxmu`).
 *   3. `supabase/functions/DEPLOYMENT.json` 1:1 directory parity (excluding `_shared`),
 *      `index.ts` entrypoints for all `deploy: true` functions, and `deno.json` + `deno.lock`.
 *   4. `frontend/lib/featureGates.ts` 8-gate boolean literal safety fence + post-rollout
 *      server prerequisite checklists.
 *
 * Usage:
 *   node tools/verify-owner-rollout-readiness.mjs [--json] [--post-rollout]
 *
 * Exit 0 = ready. Exit 1 = invariant violation or unknown CLI flag.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
export const DEFAULT_REPO_ROOT = resolve(dirname(THIS_FILE), '..');

export const CANONICAL_PROJECT_REF = 'kbcuolhjjnmhjaarxxmu';

export const EXPECTED_PENDING_MIGRATION_NUMBERS = Object.freeze(
  Array.from({ length: 17 }, (_, idx) => String(28 + idx).padStart(3, '0')),
);

export const EXPECTED_DEPLOYED_EDGE_FUNCTIONS = Object.freeze([
  'delete-account',
  'generate-routine',
  'notion-sync',
  'subscription-webhook',
]);

export const SCOPE_FEATURE_GATES = Object.freeze([
  'SPOTIFY_OAUTH_ENABLED',
  'NOTION_INTEGRATION_ENABLED',
  'GOOGLE_CALENDAR_INTEGRATION_ENABLED',
  'PAID_SUBSCRIPTIONS_ENABLED',
  'PUBLIC_SITE_URLS_LIVE',
]);

export const POST_ROLLOUT_FEATURE_GATES = Object.freeze([
  'COACH_ACTIONS_V2_ENABLED',
  'LOG_TIMEZONE_ENABLED',
  'LIGHT_THEME_ENABLED',
]);

export const ALL_FEATURE_GATES = Object.freeze([
  ...SCOPE_FEATURE_GATES,
  ...POST_ROLLOUT_FEATURE_GATES,
]);

/**
 * Exact server / release prerequisite checklists printed whenever any of the
 * post-rollout engineering flags is flipped to `true`.
 */
export const POST_ROLLOUT_PREREQUISITES = Object.freeze({
  LOG_TIMEZONE_ENABLED: Object.freeze([
    'Apply migration 033_habit_log_timezone.sql on canonical project kbcuolhjjnmhjaarxxmu.',
    'Run SQL_FOR_OWNER.md §2.6 read-only check: public.habit_logs.tz nullable text column and habit_logs_tz_check constraint exist.',
    'Confirm SELECT count(*) FROM public.xp_drift(); returns 0.',
  ]),
  COACH_ACTIONS_V2_ENABLED: Object.freeze([
    'Apply migrations 032_coach_actions_v2.sql, 034_coach_reminder_action.sql, and 035_coach_lighten_week.sql in order on kbcuolhjjnmhjaarxxmu.',
    'Run SQL_FOR_OWNER.md §2.8 read-only check: ai_actions_type_check reports has_lighten_week = true (all 10 action types present).',
    'Deploy generate-routine Edge Function from current tree after bash supabase/predeploy_guard.sh.',
    'Run SUPABASE_ACCESS_TOKEN=... node tools/verify-edge-deployment.mjs --project-ref kbcuolhjjnmhjaarxxmu and confirm exit 0.',
  ]),
  LIGHT_THEME_ENABLED: Object.freeze([
    'Obtain explicit owner approval for F25 light theme release (open decision j) in a dedicated PR.',
    'Ensure static colors imports are reduced to INTENTIONALLY_DARK so frontend/__tests__/repo/lightThemeGate.test.ts passes with 0 blockers.',
    'Verify Settings (app/tabs/settings.tsx) and tab header (app/tabs/_layout.tsx) theme toggles render and pass visual contrast checks.',
  ]),
});

const PENDING_MIGRATION_FILE_RE = /^0(2[89]|[3-9]\d)_[a-z0-9_]+\.sql$/;
const ROLLBACK_FILE_RE = /^\d{3}_[a-z0-9_]+\.rollback\.sql$/;
const ROLLBACK_CONFIRM_GUARD_RE =
  /current_setting\(\s*'aderyth\.rollback_confirm'\s*,\s*true\s*\)[^;]*?(?:<>|!=)\s*'([^']*)'\s*THEN\s*RAISE\s+EXCEPTION/i;

/**
 * Strips `--` line comments and block comments outside single-quoted SQL literals.
 * @param {string} sql
 * @returns {string}
 */
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
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
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Strips `//` and block comments outside JS/TS string and template literals.
 * @param {string} source
 * @returns {string}
 */
export function stripJsComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      const chunk = source.slice(i + 2, end);
      out += chunk.replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        const ch = source[i];
        out += ch;
        i += 1;
        if (ch === '\\' && i < source.length) {
          out += source[i];
          i += 1;
          continue;
        }
        if (ch === quote) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Maps `NNN_<name>.sql` to `NNN_<name>.rollback.sql`.
 * @param {string} migrationFile
 * @returns {string}
 */
export function rollbackFileNameFor(migrationFile) {
  return migrationFile.replace(/\.sql$/, '.rollback.sql');
}

/**
 * Check 1: Migration <-> Rollback 1:1 parity (`028`..`044`), `aderyth.rollback_confirm`,
 * and `docs/implementation-v3/SQL_FOR_OWNER.md` documentation coverage.
 *
 * @param {{
 *   repoRoot?: string;
 *   migrationsDir?: string;
 *   rollbacksDir?: string;
 *   ownerSqlDocPath?: string;
 * }} [options]
 */
export function checkMigrationRollbackParity(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const migrationsDir = options.migrationsDir ?? join(repoRoot, 'supabase', 'migrations');
  const rollbacksDir = options.rollbacksDir ?? join(repoRoot, 'supabase', 'rollbacks');
  const ownerSqlDocPath =
    options.ownerSqlDocPath ?? join(repoRoot, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md');

  /** @type {string[]} */
  const problems = [];

  if (!existsSync(migrationsDir)) {
    problems.push('supabase/migrations directory is missing.');
  }
  if (!existsSync(rollbacksDir)) {
    problems.push('supabase/rollbacks directory is missing.');
  }
  if (!existsSync(ownerSqlDocPath)) {
    problems.push('docs/implementation-v3/SQL_FOR_OWNER.md is missing.');
  }
  if (problems.length > 0) {
    return {
      id: 'migration-rollback-parity',
      ok: false,
      checkedMigrations: 0,
      migrations: [],
      problems,
    };
  }

  const allMigrationDirEntries = readdirSync(migrationsDir).sort();
  for (const entry of allMigrationDirEntries) {
    if (entry.endsWith('.rollback.sql')) {
      problems.push(`supabase/migrations/${entry}: rollback script must live in supabase/rollbacks/, never supabase/migrations/.`);
    }
  }

  const pendingMigrations = allMigrationDirEntries
    .filter((name) => !name.endsWith('.rollback.sql') && PENDING_MIGRATION_FILE_RE.test(name))
    .sort();

  for (const expectedNum of EXPECTED_PENDING_MIGRATION_NUMBERS) {
    const matches = pendingMigrations.filter((name) => name.startsWith(`${expectedNum}_`));
    if (matches.length === 0) {
      problems.push(`supabase/migrations: missing expected pending migration ${expectedNum}_*.sql.`);
    } else if (matches.length > 1) {
      problems.push(
        `supabase/migrations: duplicate migration number ${expectedNum} (${matches.join(', ')}).`,
      );
    }
  }

  const rollbackEntries = readdirSync(rollbacksDir).sort();
  const rollbackSet = new Set(rollbackEntries);
  const ownerDoc = readFileSync(ownerSqlDocPath, 'utf8').replace(/\r\n?/g, '\n');

  for (const migrationFile of pendingMigrations) {
    const num = migrationFile.slice(0, 3);
    const expectedRollback = rollbackFileNameFor(migrationFile);

    if (!rollbackSet.has(expectedRollback)) {
      problems.push(
        `missing rollback file supabase/rollbacks/${expectedRollback} for migration ${migrationFile}.`,
      );
    } else {
      const rawRollback = readFileSync(join(rollbacksDir, expectedRollback), 'utf8').replace(
        /\r\n?/g,
        '\n',
      );
      const code = stripSqlComments(rawRollback);
      const trimmed = code.trim();
      const guardMatch = ROLLBACK_CONFIRM_GUARD_RE.exec(code);

      if (!guardMatch) {
        problems.push(
          `supabase/rollbacks/${expectedRollback}: missing aderyth.rollback_confirm guard raising EXCEPTION.`,
        );
      } else if (guardMatch[1] !== num) {
        problems.push(
          `supabase/rollbacks/${expectedRollback}: aderyth.rollback_confirm checks '${guardMatch[1]}', expected '${num}'.`,
        );
      }

      const guardOutsideTx =
        guardMatch !== null && /\bCOMMIT\s*;/i.test(code.slice(0, guardMatch.index));
      if (!/^BEGIN\s*;/i.test(trimmed) || !/\bCOMMIT\s*;$/i.test(trimmed) || guardOutsideTx) {
        problems.push(
          `supabase/rollbacks/${expectedRollback}: rollback must wrap BEGIN; ... COMMIT; around the confirmation guard.`,
        );
      }
    }

    if (!ownerDoc.includes(migrationFile)) {
      problems.push(
        `docs/implementation-v3/SQL_FOR_OWNER.md does not document migration ${migrationFile}.`,
      );
    }
    if (!ownerDoc.includes(`supabase/rollbacks/${expectedRollback}`)) {
      problems.push(
        `docs/implementation-v3/SQL_FOR_OWNER.md does not document rollback supabase/rollbacks/${expectedRollback}.`,
      );
    }
  }

  const expectedRollbackSet = new Set(pendingMigrations.map(rollbackFileNameFor));
  for (const entry of rollbackEntries) {
    if (ROLLBACK_FILE_RE.test(entry) && !expectedRollbackSet.has(entry)) {
      problems.push(
        `supabase/rollbacks/${entry}: orphan rollback file with no matching pending migration.`,
      );
    }
  }

  return {
    id: 'migration-rollback-parity',
    ok: problems.length === 0,
    checkedMigrations: pendingMigrations.length,
    migrations: pendingMigrations,
    problems,
  };
}

/**
 * Resolves a real POSIX bash binary (skipping the Windows System32 WSL launcher stub).
 * @returns {string | null}
 */
function resolveBashBinary() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        ]
      : ['/usr/bin/bash', '/bin/bash', 'bash'];

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 3000 });
    if (probe.status === 0 && (probe.stdout ?? '').trim() === 'ok') {
      return candidate;
    }
  }
  return null;
}

/**
 * Check 2: Predeploy Guard Integrity (`supabase/predeploy_guard.sh`).
 *
 * @param {{
 *   repoRoot?: string;
 *   guardPath?: string;
 *   guardSource?: string;
 *   configTomlPath?: string;
 *   runBashProbes?: boolean;
 * }} [options]
 */
export function checkPredeployGuard(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const guardPath = options.guardPath ?? join(repoRoot, 'supabase', 'predeploy_guard.sh');
  const configTomlPath = options.configTomlPath ?? join(repoRoot, 'supabase', 'config.toml');
  const runBashProbes = options.runBashProbes ?? true;

  /** @type {string[]} */
  const problems = [];

  let rawGuard = options.guardSource;
  if (rawGuard === undefined) {
    if (!existsSync(guardPath)) {
      return {
        id: 'predeploy-guard',
        ok: false,
        canonicalRef: CANONICAL_PROJECT_REF,
        bashProbed: false,
        problems: ['supabase/predeploy_guard.sh is missing.'],
      };
    }
    rawGuard = readFileSync(guardPath, 'utf8');
  }

  if (rawGuard.includes('\r')) {
    problems.push('supabase/predeploy_guard.sh contains CR (\\r) line endings; LF is required for bash set -euo pipefail.');
  }

  const guard = rawGuard.replace(/\r\n?/g, '\n');
  const nonCommentLines = guard
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);

  if (!nonCommentLines.includes('set -euo pipefail')) {
    problems.push('supabase/predeploy_guard.sh must declare `set -euo pipefail`.');
  }

  const canonicalMatch = /^CANONICAL="([^"]+)"/m.exec(guard);
  if (!canonicalMatch || canonicalMatch[1] !== CANONICAL_PROJECT_REF) {
    problems.push(
      `supabase/predeploy_guard.sh must pin CANONICAL="${CANONICAL_PROJECT_REF}" (found ${canonicalMatch ? `"${canonicalMatch[1]}"` : 'none'}).`,
    );
  }

  const deniedMatch = /^DENIED="([a-z0-9]{20})"/m.exec(guard);
  if (!deniedMatch) {
    problems.push('supabase/predeploy_guard.sh must declare a 20-char DENIED project ref.');
  } else if (deniedMatch[1] === CANONICAL_PROJECT_REF) {
    problems.push('supabase/predeploy_guard.sh DENIED ref must not equal CANONICAL.');
  }

  if (!guard.includes('ref="${SUPABASE_PROJECT_REF:-}"')) {
    problems.push('supabase/predeploy_guard.sh must read SUPABASE_PROJECT_REF with empty fallback.');
  }
  if (!/\[\s+-n\s+"\$ref"\s*\]\s*\|\|\s*die\b/.test(guard)) {
    problems.push('supabase/predeploy_guard.sh must fail closed (`[ -n "$ref" ] || die ...`) when ref is empty.');
  }
  if (!/if\s+\[\s+"\$ref"\s*=\s*"\$DENIED"\s*\]\s*;\s*then[\s\S]*?\bdie\b/.test(guard)) {
    problems.push('supabase/predeploy_guard.sh must explicitly block the DENIED project ref.');
  }
  if (!/if\s+\[\s+"\$ref"\s*!=\s*"\$CANONICAL"\s*\]\s*;\s*then[\s\S]*?\bdie\b/.test(guard)) {
    problems.push(
      'supabase/predeploy_guard.sh must fail closed (`if [ "$ref" != "$CANONICAL" ]`) for any non-canonical ref.',
    );
  }

  if (options.guardSource === undefined) {
    if (!existsSync(configTomlPath)) {
      problems.push('supabase/config.toml is missing.');
    } else {
      const toml = readFileSync(configTomlPath, 'utf8').replace(/\r\n?/g, '\n');
      const projectIdMatch = /^\s*project_id\s*=\s*"([^"]*)"/m.exec(toml);
      if (!projectIdMatch || projectIdMatch[1] !== CANONICAL_PROJECT_REF) {
        problems.push(
          `supabase/config.toml must pin project_id = "${CANONICAL_PROJECT_REF}".`,
        );
      }
    }
  }

  let bashProbed = false;
  if (runBashProbes && problems.length === 0) {
    const bashBin = resolveBashBinary();
    if (bashBin) {
      const scratchRoot = mkdtempSync(join(tmpdir(), 'owner-rollout-guard-'));
      try {
        const scratchSupabase = join(scratchRoot, 'supabase');
        mkdirSync(scratchSupabase, { recursive: true });
        const scratchGuard = join(scratchSupabase, 'predeploy_guard.sh');
        writeFileSync(scratchGuard, guard, 'utf8');

        const baseEnv = {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: scratchRoot,
          TMPDIR: scratchRoot,
        };

        const emptyProbe = spawnSync(bashBin, ['supabase/predeploy_guard.sh'], {
          cwd: scratchRoot,
          encoding: 'utf8',
          env: { ...baseEnv, SUPABASE_PROJECT_REF: '' },
          timeout: 5000,
        });
        if (emptyProbe.status === 0) {
          problems.push(
            'supabase/predeploy_guard.sh exited 0 when SUPABASE_PROJECT_REF was empty (must fail closed).',
          );
        }

        const wrongProbe = spawnSync(bashBin, ['supabase/predeploy_guard.sh'], {
          cwd: scratchRoot,
          encoding: 'utf8',
          env: { ...baseEnv, SUPABASE_PROJECT_REF: 'non-canonical-ref-00' },
          timeout: 5000,
        });
        if (wrongProbe.status === 0) {
          problems.push(
            'supabase/predeploy_guard.sh exited 0 for a non-canonical SUPABASE_PROJECT_REF.',
          );
        }

        const canonicalProbe = spawnSync(bashBin, ['supabase/predeploy_guard.sh'], {
          cwd: scratchRoot,
          encoding: 'utf8',
          env: { ...baseEnv, SUPABASE_PROJECT_REF: CANONICAL_PROJECT_REF },
          timeout: 5000,
        });
        const canonicalOut = `${canonicalProbe.stdout ?? ''}${canonicalProbe.stderr ?? ''}`;
        if (
          canonicalProbe.status !== 0 ||
          !canonicalOut.includes(`deploy target OK: ${CANONICAL_PROJECT_REF}`)
        ) {
          problems.push(
            `supabase/predeploy_guard.sh did not succeed cleanly for canonical ref ${CANONICAL_PROJECT_REF}.`,
          );
        }
        bashProbed = true;
      } finally {
        rmSync(scratchRoot, { recursive: true, force: true });
      }
    }
  }

  return {
    id: 'predeploy-guard',
    ok: problems.length === 0,
    canonicalRef: CANONICAL_PROJECT_REF,
    bashProbed,
    problems,
  };
}

/**
 * Check 3: Edge Deployment Manifest (`supabase/functions/DEPLOYMENT.json`),
 * `deploy: true` entrypoints, and `deno.json` + `deno.lock` integrity.
 *
 * @param {{
 *   repoRoot?: string;
 *   functionsDir?: string;
 *   manifestPath?: string;
 *   denoJsonPath?: string;
 *   denoLockPath?: string;
 * }} [options]
 */
export function checkEdgeDeploymentReadiness(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const functionsDir = options.functionsDir ?? join(repoRoot, 'supabase', 'functions');
  const manifestPath = options.manifestPath ?? join(functionsDir, 'DEPLOYMENT.json');
  const denoJsonPath = options.denoJsonPath ?? join(functionsDir, 'deno.json');
  const denoLockPath = options.denoLockPath ?? join(functionsDir, 'deno.lock');

  /** @type {string[]} */
  const problems = [];

  if (!existsSync(functionsDir)) {
    return {
      id: 'edge-deployment',
      ok: false,
      deployedFunctions: [],
      problems: ['supabase/functions directory is missing.'],
    };
  }

  if (!existsSync(denoJsonPath)) {
    problems.push('supabase/functions/deno.json is missing.');
  } else {
    try {
      const denoCfg = JSON.parse(readFileSync(denoJsonPath, 'utf8'));
      if (!denoCfg || typeof denoCfg.imports !== 'object' || denoCfg.imports === null) {
        problems.push('supabase/functions/deno.json must contain an `imports` map.');
      }
    } catch (err) {
      problems.push(`supabase/functions/deno.json is invalid JSON: ${String(err)}`);
    }
  }

  if (!existsSync(denoLockPath)) {
    problems.push('supabase/functions/deno.lock is missing.');
  } else {
    try {
      const lockCfg = JSON.parse(readFileSync(denoLockPath, 'utf8'));
      if (!lockCfg || typeof lockCfg.version !== 'string') {
        problems.push('supabase/functions/deno.lock must declare a string `version`.');
      }
    } catch (err) {
      problems.push(`supabase/functions/deno.lock is invalid JSON: ${String(err)}`);
    }
  }

  if (!existsSync(manifestPath)) {
    problems.push('supabase/functions/DEPLOYMENT.json is missing.');
    return {
      id: 'edge-deployment',
      ok: false,
      deployedFunctions: [],
      problems,
    };
  }

  /** @type {{ functions?: Array<{ slug?: string; deploy?: unknown; verifyJwt?: unknown }> }} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    problems.push(`supabase/functions/DEPLOYMENT.json is invalid JSON: ${String(err)}`);
    return {
      id: 'edge-deployment',
      ok: false,
      deployedFunctions: [],
      problems,
    };
  }

  if (!manifest || !Array.isArray(manifest.functions) || manifest.functions.length === 0) {
    problems.push('supabase/functions/DEPLOYMENT.json must contain a non-empty `functions` array.');
    return {
      id: 'edge-deployment',
      ok: false,
      deployedFunctions: [],
      problems,
    };
  }

  const diskFunctionDirs = readdirSync(functionsDir)
    .filter((name) => name !== '_shared')
    .filter((name) => statSync(join(functionsDir, name)).isDirectory())
    .sort();

  const declaredSlugs = [];
  const seenSlugs = new Set();
  for (const entry of manifest.functions) {
    const slug = typeof entry?.slug === 'string' ? entry.slug : '';
    if (!slug) {
      problems.push('supabase/functions/DEPLOYMENT.json contains an entry with a missing `slug`.');
      continue;
    }
    if (seenSlugs.has(slug)) {
      problems.push(`supabase/functions/DEPLOYMENT.json declares duplicate slug "${slug}".`);
    }
    seenSlugs.add(slug);
    declaredSlugs.push(slug);

    if (typeof entry.deploy !== 'boolean') {
      problems.push(
        `supabase/functions/DEPLOYMENT.json entry "${slug}" must declare an explicit boolean \`deploy\`.`,
      );
    }
  }

  const diskSet = new Set(diskFunctionDirs);
  for (const dirName of diskFunctionDirs) {
    if (!seenSlugs.has(dirName)) {
      problems.push(
        `undeclared edge function directory supabase/functions/${dirName} is missing from DEPLOYMENT.json.`,
      );
    }
  }
  for (const slug of declaredSlugs) {
    if (!diskSet.has(slug)) {
      problems.push(
        `supabase/functions/DEPLOYMENT.json declares "${slug}", but supabase/functions/${slug}/ does not exist.`,
      );
    }
  }

  const deployedEntries = manifest.functions.filter((f) => f && f.deploy === true);
  const deployedSlugs = deployedEntries
    .map((f) => String(f.slug ?? ''))
    .filter(Boolean)
    .sort();

  const expectedSorted = [...EXPECTED_DEPLOYED_EDGE_FUNCTIONS].sort();
  if (JSON.stringify(deployedSlugs) !== JSON.stringify(expectedSorted)) {
    problems.push(
      `DEPLOYMENT.json deploy:true set [${deployedSlugs.join(', ')}] does not match expected [${expectedSorted.join(', ')}].`,
    );
  }

  for (const entry of deployedEntries) {
    const slug = String(entry.slug ?? '');
    if (!slug) continue;
    if (typeof entry.verifyJwt !== 'boolean') {
      problems.push(
        `supabase/functions/DEPLOYMENT.json deploy:true entry "${slug}" must pin boolean verifyJwt.`,
      );
    }
    const indexTs = join(functionsDir, slug, 'index.ts');
    if (!existsSync(indexTs)) {
      problems.push(
        `deploy:true edge function "${slug}" is missing entrypoint supabase/functions/${slug}/index.ts.`,
      );
    } else if (readFileSync(indexTs, 'utf8').trim().length === 0) {
      problems.push(
        `deploy:true edge function "${slug}" has an empty supabase/functions/${slug}/index.ts.`,
      );
    }
  }

  return {
    id: 'edge-deployment',
    ok: problems.length === 0,
    deployedFunctions: deployedSlugs,
    problems,
  };
}

/**
 * Check 4: Feature Gates Safety Fence (`frontend/lib/featureGates.ts`).
 *
 * Verifies all 8 release/scope gates are explicit boolean literals (`false` pre-rollout).
 * Whenever any of `COACH_ACTIONS_V2_ENABLED`, `LOG_TIMEZONE_ENABLED`, or `LIGHT_THEME_ENABLED`
 * is `true`, emits the exact server/release prerequisite checklist for that flag (failing closed
 * in pre-rollout mode unless `allowPostRolloutFlips: true` / `--post-rollout` is set).
 *
 * @param {{
 *   repoRoot?: string;
 *   featureGatesPath?: string;
 *   featureGatesSource?: string;
 *   allowPostRolloutFlips?: boolean;
 * }} [options]
 */
export function checkFeatureGatesFence(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const featureGatesPath =
    options.featureGatesPath ?? join(repoRoot, 'frontend', 'lib', 'featureGates.ts');
  const allowPostRolloutFlips = options.allowPostRolloutFlips ?? false;

  /** @type {string[]} */
  const problems = [];
  /** @type {Record<string, boolean | null>} */
  const values = {};
  /** @type {Array<{ gate: string; prerequisites: readonly string[] }>} */
  const prerequisiteChecklists = [];

  let rawSource = options.featureGatesSource;
  if (rawSource === undefined) {
    if (!existsSync(featureGatesPath)) {
      return {
        id: 'feature-gates',
        ok: false,
        values,
        prerequisiteChecklists,
        problems: ['frontend/lib/featureGates.ts is missing.'],
      };
    }
    rawSource = readFileSync(featureGatesPath, 'utf8');
  }

  const code = stripJsComments(rawSource.replace(/\r\n?/g, '\n'));
  const scopeSet = new Set(SCOPE_FEATURE_GATES);

  for (const gate of ALL_FEATURE_GATES) {
    const declRe = new RegExp(
      `\\bexport\\s+const\\s+${gate}\\s*(?::\\s*boolean\\s*)?=\\s*([^;\\n]+);`,
      'g',
    );
    const matches = [...code.matchAll(declRe)];
    if (matches.length === 0) {
      values[gate] = null;
      problems.push(
        `frontend/lib/featureGates.ts is missing explicit export \`export const ${gate} = false;\`.`,
      );
      continue;
    }
    if (matches.length > 1) {
      values[gate] = null;
      problems.push(`frontend/lib/featureGates.ts declares ${gate} multiple times.`);
      continue;
    }

    const rhs = matches[0][1].trim();
    if (rhs !== 'true' && rhs !== 'false') {
      values[gate] = null;
      problems.push(
        `frontend/lib/featureGates.ts ${gate} must be an explicit boolean literal (true or false), found \`${rhs}\`.`,
      );
      continue;
    }

    const boolVal = rhs === 'true';
    values[gate] = boolVal;

    if (!boolVal) continue;

    if (scopeSet.has(gate)) {
      problems.push(
        `frontend/lib/featureGates.ts scope gate ${gate} is true; must remain false (deferred outside MVP scope).`,
      );
      continue;
    }

    const prereqs =
      POST_ROLLOUT_PREREQUISITES[/** @type {keyof typeof POST_ROLLOUT_PREREQUISITES} */ (gate)] ??
      [];
    prerequisiteChecklists.push({ gate, prerequisites: prereqs });

    if (!allowPostRolloutFlips) {
      problems.push(
        `frontend/lib/featureGates.ts ${gate} is true before rollout; keep false pre-rollout or pass --post-rollout after verifying all server prerequisites listed for ${gate}.`,
      );
    }
  }

  return {
    id: 'feature-gates',
    ok: problems.length === 0,
    values,
    prerequisiteChecklists,
    problems,
  };
}

/**
 * Runs all four offline rollout readiness checks and returns a deterministic summary.
 *
 * @param {{
 *   repoRoot?: string;
 *   allowPostRolloutFlips?: boolean;
 *   runBashProbes?: boolean;
 * }} [options]
 */
export function verifyOwnerRolloutReadiness(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const allowPostRolloutFlips = options.allowPostRolloutFlips ?? false;

  const migrationRollbackParity = checkMigrationRollbackParity({ repoRoot });
  const predeployGuard = checkPredeployGuard({
    repoRoot,
    runBashProbes: options.runBashProbes ?? true,
  });
  const edgeDeployment = checkEdgeDeploymentReadiness({ repoRoot });
  const featureGates = checkFeatureGatesFence({ repoRoot, allowPostRolloutFlips });

  const problems = [
    ...migrationRollbackParity.problems,
    ...predeployGuard.problems,
    ...edgeDeployment.problems,
    ...featureGates.problems,
  ];

  return {
    ok: problems.length === 0,
    canonicalProjectRef: CANONICAL_PROJECT_REF,
    mode: allowPostRolloutFlips ? 'post-rollout' : 'pre-rollout',
    checks: {
      migrationRollbackParity,
      predeployGuard,
      edgeDeployment,
      featureGates,
    },
    prerequisiteChecklists: featureGates.prerequisiteChecklists,
    problems,
  };
}

/**
 * Formats a human-readable operator summary for terminal output.
 * @param {ReturnType<typeof verifyOwnerRolloutReadiness>} report
 * @returns {string}
 */
export function formatReadinessReport(report) {
  const statusTag = (ok) => (ok ? '[PASS]' : '[FAIL]');
  const lines = [
    `Owner Rollout Readiness (${report.mode}) — canonical target ${report.canonicalProjectRef}`,
    `${statusTag(report.checks.migrationRollbackParity.ok)} Migration <-> Rollback parity (${report.checks.migrationRollbackParity.checkedMigrations} migrations 028..044)`,
    `${statusTag(report.checks.predeployGuard.ok)} Predeploy guard integrity (set -euo pipefail, fail-closed${report.checks.predeployGuard.bashProbed ? ', bash-probed' : ''})`,
    `${statusTag(report.checks.edgeDeployment.ok)} Edge deployment manifest & Deno lock (${report.checks.edgeDeployment.deployedFunctions.join(', ') || 'none'})`,
    `${statusTag(report.checks.featureGates.ok)} Feature gates safety fence (${ALL_FEATURE_GATES.length} boolean literals)`,
  ];

  if (report.prerequisiteChecklists.length > 0) {
    lines.push('');
    lines.push('Server / release prerequisite checklist(s) for enabled post-rollout flag(s):');
    for (const item of report.prerequisiteChecklists) {
      lines.push(`  ${item.gate}:`);
      for (const step of item.prerequisites) {
        lines.push(`    - ${step}`);
      }
    }
  }

  if (report.problems.length > 0) {
    lines.push('');
    lines.push(`${report.problems.length} readiness violation(s):`);
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
    lines.push('');
    lines.push('Result: BLOCKED (exit 1)');
  } else {
    lines.push('');
    lines.push('Result: READY (exit 0)');
  }

  return lines.join('\n');
}

/**
 * CLI entrypoint with injectable writers for deterministic unit testing.
 *
 * @param {readonly string[]} [argv]
 * @param {{
 *   repoRoot?: string;
 *   runBashProbes?: boolean;
 *   writeOut?: (text: string) => void;
 *   writeErr?: (text: string) => void;
 * }} [options]
 * @returns {number}
 */
export function runCli(argv = process.argv.slice(2), options = {}) {
  const writeOut = options.writeOut ?? ((text) => console.log(text));
  const writeErr = options.writeErr ?? ((text) => console.error(text));

  const allowedFlags = new Set(['--json', '--post-rollout']);
  const unknownFlags = argv.filter((arg) => !allowedFlags.has(arg));
  if (unknownFlags.length > 0) {
    writeErr(
      `Unknown flag(s): ${unknownFlags.join(', ')}. Supported flags: --json, --post-rollout`,
    );
    return 1;
  }

  const jsonMode = argv.includes('--json');
  const allowPostRolloutFlips = argv.includes('--post-rollout');

  const report = verifyOwnerRolloutReadiness({
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    allowPostRolloutFlips,
    runBashProbes: options.runBashProbes ?? true,
  });

  if (jsonMode) {
    writeOut(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    writeOut(formatReadinessReport(report));
  } else {
    writeErr(formatReadinessReport(report));
  }

  return report.ok ? 0 : 1;
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(THIS_FILE) === realpathSync(resolve(process.argv[1]));
  } catch {
    return THIS_FILE === resolve(process.argv[1]);
  }
})();

if (isMainModule) {
  process.exit(runCli(process.argv.slice(2)));
}
