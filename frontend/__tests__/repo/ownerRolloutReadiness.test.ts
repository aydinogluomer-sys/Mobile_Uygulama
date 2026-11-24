/**
 * Owner rollout preflight readiness verifier tests (`tools/verify-owner-rollout-readiness.mjs`).
 *
 * Proves:
 *   (+) Live repository passes all four offline readiness invariants and exits 0 (human & `--json`).
 *   (-) Negative synthetic mutations fail closed (exit 1):
 *       - missing rollback file for a `028..044` migration,
 *       - rollback script missing `aderyth.rollback_confirm` check or carrying mismatched number,
 *       - `028..044` migration undocumented in `docs/implementation-v3/SQL_FOR_OWNER.md`,
 *       - undeclared edge function directory missing from `DEPLOYMENT.json` or missing `index.ts`,
 *       - missing `deno.lock` (or `deno.json`),
 *       - broken `predeploy_guard.sh` (`set -euo pipefail` absent, non-canonical ref, or fail-open),
 *       - feature gate non-boolean expression, premature flip, and post-rollout server prerequisite output.
 */
import { execFileSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { runInThisContext } from 'vm';
import { stripComments } from '../helpers/sourceText';

type PrerequisiteChecklist = {
  gate: string;
  prerequisites: readonly string[];
};

type MigrationParityResult = {
  id: 'migration-rollback-parity';
  ok: boolean;
  checkedMigrations: number;
  migrations: string[];
  problems: string[];
};

type PredeployGuardResult = {
  id: 'predeploy-guard';
  ok: boolean;
  canonicalRef: string;
  bashProbed: boolean;
  problems: string[];
};

type EdgeDeploymentResult = {
  id: 'edge-deployment';
  ok: boolean;
  deployedFunctions: string[];
  problems: string[];
};

type FeatureGatesResult = {
  id: 'feature-gates';
  ok: boolean;
  values: Record<string, boolean | null>;
  prerequisiteChecklists: PrerequisiteChecklist[];
  problems: string[];
};

type ReadinessReport = {
  ok: boolean;
  canonicalProjectRef: string;
  mode: 'pre-rollout' | 'post-rollout';
  checks: {
    migrationRollbackParity: MigrationParityResult;
    predeployGuard: PredeployGuardResult;
    edgeDeployment: EdgeDeploymentResult;
    featureGates: FeatureGatesResult;
  };
  prerequisiteChecklists: PrerequisiteChecklist[];
  problems: string[];
};

type VerifierModule = {
  CANONICAL_PROJECT_REF: string;
  EXPECTED_PENDING_MIGRATION_NUMBERS: readonly string[];
  EXPECTED_DEPLOYED_EDGE_FUNCTIONS: readonly string[];
  ALL_FEATURE_GATES: readonly string[];
  POST_ROLLOUT_PREREQUISITES: Readonly<Record<string, readonly string[]>>;
  checkMigrationRollbackParity: (options?: {
    repoRoot?: string;
    migrationsDir?: string;
    rollbacksDir?: string;
    ownerSqlDocPath?: string;
  }) => MigrationParityResult;
  checkPredeployGuard: (options?: {
    repoRoot?: string;
    guardPath?: string;
    guardSource?: string;
    configTomlPath?: string;
    runBashProbes?: boolean;
  }) => PredeployGuardResult;
  checkEdgeDeploymentReadiness: (options?: {
    repoRoot?: string;
    functionsDir?: string;
    manifestPath?: string;
    denoJsonPath?: string;
    denoLockPath?: string;
  }) => EdgeDeploymentResult;
  checkFeatureGatesFence: (options?: {
    repoRoot?: string;
    featureGatesPath?: string;
    featureGatesSource?: string;
    allowPostRolloutFlips?: boolean;
  }) => FeatureGatesResult;
  verifyOwnerRolloutReadiness: (options?: {
    repoRoot?: string;
    allowPostRolloutFlips?: boolean;
    runBashProbes?: boolean;
  }) => ReadinessReport;
  formatReadinessReport: (report: ReadinessReport) => string;
  runCli: (
    argv?: readonly string[],
    options?: {
      repoRoot?: string;
      runBashProbes?: boolean;
      writeOut?: (text: string) => void;
      writeErr?: (text: string) => void;
    },
  ) => number;
};

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'tools', 'verify-owner-rollout-readiness.mjs');
const QUICKSTART_PATH = join(REPO_ROOT, 'docs', 'implementation-v3', 'OWNER_ROLLOUT_QUICKSTART.md');

/**
 * Loads the ESM `.mjs` verifier directly into Jest without modifying `jest.config.js`.
 * Uses Node's unwrapped builtin `module.createRequire` (`require(esm)` in Node 22.13+ / 24+ / 26+)
 * so Jest's CJS VM wrapper does not choke on ESM syntax, with a deterministic `vm` fallback.
 */
function loadVerifierModule(): VerifierModule {
  const builtinModule =
    typeof process.getBuiltinModule === 'function'
      ? (process.getBuiltinModule('node:module') as typeof import('module') | undefined)
      : undefined;

  if (builtinModule && typeof builtinModule.createRequire === 'function') {
    const hostRequire = builtinModule.createRequire(SCRIPT_PATH);
    return hostRequire(SCRIPT_PATH) as VerifierModule;
  }

  const raw = readFileSync(SCRIPT_PATH, 'utf8');
  const rewritten = raw
    .replace(/^#![^\n]*\n/, '')
    .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(SCRIPT_PATH).href))
    .replace(
      /import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/g,
      (_m, bindings: string, spec: string) => `const {${bindings}} = require('${spec}');`,
    )
    .replace(/\bexport\s+const\s+([A-Za-z0-9_]+)\s*=/g, 'const $1 = exports.$1 =')
    .replace(
      /\bexport\s+function\s+([A-Za-z0-9_]+)\s*\(/g,
      'exports.$1 = $1; function $1(',
    );

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const wrapper = runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {\n${rewritten}\n})`,
    { filename: SCRIPT_PATH },
  ) as (
    exportsObj: Record<string, unknown>,
    req: NodeRequire,
    modObj: { exports: Record<string, unknown> },
    file: string,
    dir: string,
  ) => void;
  wrapper(mod.exports, createRequire(SCRIPT_PATH), mod, SCRIPT_PATH, dirname(SCRIPT_PATH));
  return mod.exports as VerifierModule;
}

const verifier = loadVerifierModule();

function withTempDir(prefix: string, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Owner Rollout Readiness Preflight (`tools/verify-owner-rollout-readiness.mjs`)', () => {
  describe('(+) live repository passes all owner rollout readiness checks (exit 0)', () => {
    it('passes all four readiness domains in-process with zero violations', () => {
      const report = verifier.verifyOwnerRolloutReadiness({ repoRoot: REPO_ROOT });

      expect(report.ok).toBe(true);
      expect(report.canonicalProjectRef).toBe('kbcuolhjjnmhjaarxxmu');
      expect(report.mode).toBe('pre-rollout');
      expect(report.problems).toEqual([]);
      expect(report.prerequisiteChecklists).toEqual([]);

      expect(report.checks.migrationRollbackParity.ok).toBe(true);
      expect(report.checks.migrationRollbackParity.checkedMigrations).toBe(17);

      expect(report.checks.predeployGuard.ok).toBe(true);
      expect(report.checks.edgeDeployment.ok).toBe(true);
      expect(report.checks.edgeDeployment.deployedFunctions).toEqual([
        'delete-account',
        'generate-routine',
        'notion-sync',
        'subscription-webhook',
      ]);

      expect(report.checks.featureGates.ok).toBe(true);
      for (const gate of verifier.ALL_FEATURE_GATES) {
        expect(report.checks.featureGates.values[gate]).toBe(false);
      }
      const strippedGates = stripComments(
        readFileSync(join(REPO_ROOT, 'frontend', 'lib', 'featureGates.ts'), 'utf8'),
      );
      expect(strippedGates).not.toMatch(/=\s*true\s*;/);
    });

    it('executes as a Node ESM CLI in both human and --json modes with exit code 0', () => {
      const humanOut = execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(humanOut).toContain('Result: READY (exit 0)');
      expect(humanOut).toContain('kbcuolhjjnmhjaarxxmu');

      const jsonRaw = execFileSync(process.execPath, [SCRIPT_PATH, '--json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(jsonRaw) as ReadinessReport;
      expect(parsed.ok).toBe(true);
      expect(parsed.problems).toEqual([]);
      expect(parsed.checks.migrationRollbackParity.checkedMigrations).toBe(17);
    });

    it('ships OWNER_ROLLOUT_QUICKSTART.md referencing SQL_FOR_OWNER.md and all 6 rollout steps', () => {
      expect(existsSync(QUICKSTART_PATH)).toBe(true);
      const quickstart = readFileSync(QUICKSTART_PATH, 'utf8');
      expect(quickstart.includes('\r')).toBe(false);
      expect(quickstart).toContain('SQL_FOR_OWNER.md');
      expect(quickstart).toContain('verify-owner-rollout-readiness.mjs');
      expect(quickstart).toContain('kbcuolhjjnmhjaarxxmu');
      expect(quickstart).toContain('xp_drift()');
      expect(quickstart).toContain('042');
      expect(quickstart).toContain('039');
      expect(quickstart).toContain('verify-edge-deployment.mjs');
      expect(quickstart).toContain('purge_ai_retention()');
      expect(quickstart).toContain('LOG_TIMEZONE_ENABLED');
      expect(quickstart).toContain('COACH_ACTIONS_V2_ENABLED');
    });
  });

  describe('(-) negative synthetic mutations fail closed (exit 1)', () => {
    it('catches a missing rollback file for a 028..044 migration', () => {
      withTempDir('rollout-missing-rb-', (dir) => {
        const migrationsDir = join(dir, 'migrations');
        const rollbacksDir = join(dir, 'rollbacks');
        cpSync(join(REPO_ROOT, 'supabase', 'migrations'), migrationsDir, { recursive: true });
        cpSync(join(REPO_ROOT, 'supabase', 'rollbacks'), rollbacksDir, { recursive: true });

        unlinkSync(join(rollbacksDir, '035_coach_lighten_week.rollback.sql'));

        const res = verifier.checkMigrationRollbackParity({
          migrationsDir,
          rollbacksDir,
          ownerSqlDocPath: join(REPO_ROOT, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md'),
        });

        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(
          expect.arrayContaining([
            expect.stringContaining('035_coach_lighten_week.rollback.sql'),
          ]),
        );
      });
    });

    it('catches a rollback script missing aderyth.rollback_confirm or checking the wrong migration number', () => {
      withTempDir('rollout-bad-confirm-', (dir) => {
        const migrationsDir = join(dir, 'migrations');
        const rollbacksDir = join(dir, 'rollbacks');
        cpSync(join(REPO_ROOT, 'supabase', 'migrations'), migrationsDir, { recursive: true });
        cpSync(join(REPO_ROOT, 'supabase', 'rollbacks'), rollbacksDir, { recursive: true });

        // Mutation A: strip the aderyth.rollback_confirm guard entirely from 033
        writeFileSync(
          join(rollbacksDir, '033_habit_log_timezone.rollback.sql'),
          [
            '-- ROLLBACK of 033_habit_log_timezone.sql',
            '-- STATUS: WRITTEN, NOT APPLIED.',
            'BEGIN;',
            'ALTER TABLE public.habit_logs DROP COLUMN IF EXISTS tz;',
            'COMMIT;',
            '',
          ].join('\n'),
          'utf8',
        );

        // Mutation B: wrong confirmation number ('034' instead of '044') on 044
        const rb044Path = join(rollbacksDir, '044_ai_messages_and_retention.rollback.sql');
        const rb044 = readFileSync(rb044Path, 'utf8').replace("<> '044'", "<> '034'");
        writeFileSync(rb044Path, rb044, 'utf8');

        const res = verifier.checkMigrationRollbackParity({
          migrationsDir,
          rollbacksDir,
          ownerSqlDocPath: join(REPO_ROOT, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md'),
        });

        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              '033_habit_log_timezone.rollback.sql: missing aderyth.rollback_confirm guard',
            ),
            expect.stringContaining(
              "044_ai_messages_and_retention.rollback.sql: aderyth.rollback_confirm checks '034', expected '044'",
            ),
          ]),
        );
      });
    });

    it('catches a 028..044 migration omitted from SQL_FOR_OWNER.md', () => {
      withTempDir('rollout-undoc-sql-', (dir) => {
        const docPath = join(dir, 'SQL_FOR_OWNER.md');
        const strippedDoc = readFileSync(
          join(REPO_ROOT, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md'),
          'utf8',
        ).replace(/042_numeric_measures_and_willpower/g, '042_removed_from_doc');
        writeFileSync(docPath, strippedDoc, 'utf8');

        const res = verifier.checkMigrationRollbackParity({
          repoRoot: REPO_ROOT,
          ownerSqlDocPath: docPath,
        });

        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(
          expect.arrayContaining([
            expect.stringContaining('042_numeric_measures_and_willpower.sql'),
          ]),
        );
      });
    });

    it('catches an undeclared edge function directory missing from DEPLOYMENT.json and a missing entrypoint', () => {
      withTempDir('rollout-undeclared-edge-', (dir) => {
        const functionsDir = join(dir, 'functions');
        cpSync(join(REPO_ROOT, 'supabase', 'functions'), functionsDir, { recursive: true });

        // Add an undeclared function directory
        mkdirSync(join(functionsDir, 'rogue-shadow-fn'), { recursive: true });
        writeFileSync(join(functionsDir, 'rogue-shadow-fn', 'index.ts'), 'export {};\n', 'utf8');

        // Remove index.ts from a deploy:true function
        unlinkSync(join(functionsDir, 'delete-account', 'index.ts'));

        const res = verifier.checkEdgeDeploymentReadiness({ functionsDir });

        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              'undeclared edge function directory supabase/functions/rogue-shadow-fn is missing from DEPLOYMENT.json',
            ),
            expect.stringContaining(
              'deploy:true edge function "delete-account" is missing entrypoint supabase/functions/delete-account/index.ts',
            ),
          ]),
        );
      });
    });

    it('catches a missing deno.lock (and fails runCli with exit code 1)', () => {
      withTempDir('rollout-no-denolock-', (dir) => {
        const functionsDir = join(dir, 'supabase', 'functions');
        mkdirSync(join(dir, 'supabase'), { recursive: true });
        cpSync(join(REPO_ROOT, 'supabase', 'functions'), functionsDir, { recursive: true });
        unlinkSync(join(functionsDir, 'deno.lock'));

        const edgeRes = verifier.checkEdgeDeploymentReadiness({ functionsDir });
        expect(edgeRes.ok).toBe(false);
        expect(edgeRes.problems).toContain('supabase/functions/deno.lock is missing.');

        // Also verify full CLI exit code 1 when deno.lock is missing in a synthetic repoRoot
        cpSync(join(REPO_ROOT, 'supabase', 'migrations'), join(dir, 'supabase', 'migrations'), {
          recursive: true,
        });
        cpSync(join(REPO_ROOT, 'supabase', 'rollbacks'), join(dir, 'supabase', 'rollbacks'), {
          recursive: true,
        });
        cpSync(
          join(REPO_ROOT, 'supabase', 'predeploy_guard.sh'),
          join(dir, 'supabase', 'predeploy_guard.sh'),
        );
        cpSync(join(REPO_ROOT, 'supabase', 'config.toml'), join(dir, 'supabase', 'config.toml'));
        mkdirSync(join(dir, 'docs', 'implementation-v3'), { recursive: true });
        cpSync(
          join(REPO_ROOT, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md'),
          join(dir, 'docs', 'implementation-v3', 'SQL_FOR_OWNER.md'),
        );
        mkdirSync(join(dir, 'frontend', 'lib'), { recursive: true });
        cpSync(
          join(REPO_ROOT, 'frontend', 'lib', 'featureGates.ts'),
          join(dir, 'frontend', 'lib', 'featureGates.ts'),
        );

        const stderrChunks: string[] = [];
        const exitCode = verifier.runCli([], {
          repoRoot: dir,
          runBashProbes: false,
          writeOut: () => undefined,
          writeErr: (txt) => stderrChunks.push(txt),
        });
        expect(exitCode).toBe(1);
        expect(stderrChunks.join('\n')).toContain('supabase/functions/deno.lock is missing.');
      });
    });

    it('catches predeploy_guard.sh missing set -euo pipefail or failing open on empty ref', () => {
      const realGuard = readFileSync(join(REPO_ROOT, 'supabase', 'predeploy_guard.sh'), 'utf8');

      const withoutStrictMode = verifier.checkPredeployGuard({
        guardSource: realGuard.replace('set -euo pipefail', '# strict mode removed'),
        runBashProbes: false,
      });
      expect(withoutStrictMode.ok).toBe(false);
      expect(withoutStrictMode.problems).toContain(
        'supabase/predeploy_guard.sh must declare `set -euo pipefail`.',
      );

      const withoutEmptyCheck = verifier.checkPredeployGuard({
        guardSource: realGuard.replace('[ -n "$ref" ] || die', '# fail-open'),
        runBashProbes: false,
      });
      expect(withoutEmptyCheck.ok).toBe(false);
      expect(withoutEmptyCheck.problems).toEqual(
        expect.arrayContaining([expect.stringContaining('fail closed')]),
      );
    });

    it('catches non-boolean feature gate expressions and prints server prerequisites when post-rollout flags flip', () => {
      const realGates = readFileSync(join(REPO_ROOT, 'frontend', 'lib', 'featureGates.ts'), 'utf8');

      // Non-boolean runtime expression is rejected
      const dynamicGate = verifier.checkFeatureGatesFence({
        featureGatesSource: realGates.replace(
          'export const LOG_TIMEZONE_ENABLED = false;',
          'export const LOG_TIMEZONE_ENABLED = Boolean(process.env.EXPO_PUBLIC_TZ);',
        ),
      });
      expect(dynamicGate.ok).toBe(false);
      expect(dynamicGate.problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining('LOG_TIMEZONE_ENABLED must be an explicit boolean literal'),
        ]),
      );

      // Flipping COACH_ACTIONS_V2_ENABLED + LOG_TIMEZONE_ENABLED + LIGHT_THEME_ENABLED pre-rollout fails closed AND emits checklists
      const flippedSource = realGates
        .replace('export const COACH_ACTIONS_V2_ENABLED = false;', 'export const COACH_ACTIONS_V2_ENABLED = true;')
        .replace('export const LOG_TIMEZONE_ENABLED = false;', 'export const LOG_TIMEZONE_ENABLED = true;')
        .replace('export const LIGHT_THEME_ENABLED = false;', 'export const LIGHT_THEME_ENABLED = true;');

      const preRolloutFlip = verifier.checkFeatureGatesFence({
        featureGatesSource: flippedSource,
        allowPostRolloutFlips: false,
      });
      expect(preRolloutFlip.ok).toBe(false);
      expect(preRolloutFlip.prerequisiteChecklists.map((c) => c.gate)).toEqual([
        'COACH_ACTIONS_V2_ENABLED',
        'LOG_TIMEZONE_ENABLED',
        'LIGHT_THEME_ENABLED',
      ]);
      expect(
        preRolloutFlip.prerequisiteChecklists.find((c) => c.gate === 'COACH_ACTIONS_V2_ENABLED')
          ?.prerequisites,
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('032_coach_actions_v2.sql'),
          expect.stringContaining('generate-routine'),
        ]),
      );

      // In --post-rollout mode, those 3 flags pass while still printing checklists, whereas scope gates STILL fail closed
      const postRolloutFlip = verifier.checkFeatureGatesFence({
        featureGatesSource: flippedSource,
        allowPostRolloutFlips: true,
      });
      expect(postRolloutFlip.ok).toBe(true);
      expect(postRolloutFlip.prerequisiteChecklists).toHaveLength(3);

      const scopeFlip = verifier.checkFeatureGatesFence({
        featureGatesSource: realGates.replace(
          'export const SPOTIFY_OAUTH_ENABLED = false;',
          'export const SPOTIFY_OAUTH_ENABLED = true;',
        ),
        allowPostRolloutFlips: true,
      });
      expect(scopeFlip.ok).toBe(false);
      expect(scopeFlip.problems).toEqual(
        expect.arrayContaining([expect.stringContaining('SPOTIFY_OAUTH_ENABLED')]),
      );
    });
  });
});
