#!/usr/bin/env node
/**
 * Automated, fail-closed owner production rollout & live verification CLI.
 *
 * Automates `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md` and
 * `docs/implementation-v3/SQL_FOR_OWNER.md` against canonical Supabase project
 * `kbcuolhjjnmhjaarxxmu` once the owner supplies `SUPABASE_ACCESS_TOKEN`.
 *
 * Safety invariants:
 *   1. Refuses any empty or non-canonical `--project-ref` / `SUPABASE_PROJECT_REF`
 *      before running any command or network call (fail-closed).
 *   2. Never invokes `supabase db push` or `supabase config push`.
 *   3. Never prints or writes `SUPABASE_ACCESS_TOKEN` or bearer credentials.
 *   4. Enforces the `Y02` two-phase client/schema rule: `--mode all` requires
 *      `--confirm-no-legacy-clients` before Phase B (`039`) can run.
 *   5. Halts immediately (exit code 1) if any SQL query fails or `public.xp_drift()`
 *      returns a non-zero count at any mandatory drift gate.
 *
 * Usage:
 *   node tools/execute-owner-rollout.mjs --mode <preflight|phase-a|phase-b|edge|cron|verify-live|all>
 *     [--dry-run] [--confirm-no-legacy-clients] [--json] [--out <path>]
 *     [--project-ref kbcuolhjjnmhjaarxxmu] [--api-url https://api.supabase.com]
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_PROJECT_REF,
  DEFAULT_REPO_ROOT,
  verifyOwnerRolloutReadiness as runOwnerRolloutReadiness,
} from './verify-owner-rollout-readiness.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);

export { CANONICAL_PROJECT_REF, DEFAULT_REPO_ROOT, runOwnerRolloutReadiness };

export const DEFAULT_API_BASE = 'https://api.supabase.com';

export const VALID_MODES = Object.freeze([
  'preflight',
  'phase-a',
  'phase-b',
  'edge',
  'cron',
  'verify-live',
  'all',
]);

/**
 * Canonical 18-migration rollout catalog (`028..045`), partitioned into:
 *   - `phase-a` (13 migrations: `028..038, 042, 045` — expand before/with new client)
 *   - `phase-b` (5 migrations: `039, 040, 041, 043, 044` — tighten after new client)
 * Ledger versions match `docs/implementation-v3/MIGRATION_MAPPING.md` 1:1.
 */
export const MIGRATION_CATALOG = Object.freeze([
  Object.freeze({
    num: '028',
    file: '028_habit_pauses_and_goal_versions.sql',
    ledgerVersion: '20261010000100',
    ledgerName: 'habit_pauses_and_goal_versions',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql: "to_regclass('public.habit_pauses') IS NOT NULL",
  }),
  Object.freeze({
    num: '029',
    file: '029_habit_checklists.sql',
    ledgerVersion: '20261010000200',
    ledgerName: 'habit_checklists',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql: "to_regclass('public.habit_checklist_items') IS NOT NULL",
  }),
  Object.freeze({
    num: '030',
    file: '030_routine_runner.sql',
    ledgerVersion: '20261010000300',
    ledgerName: 'routine_runner',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql: "to_regclass('public.routine_templates') IS NOT NULL",
  }),
  Object.freeze({
    num: '031',
    file: '031_moods_and_review_actions.sql',
    ledgerVersion: '20261010000400',
    ledgerName: 'moods_and_review_actions',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql: "to_regclass('public.mood_definitions') IS NOT NULL",
  }),
  Object.freeze({
    num: '032',
    file: '032_coach_actions_v2.sql',
    ledgerVersion: '20261010000500',
    ledgerName: 'coach_actions_v2',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_actions_type_check' AND pg_get_constraintdef(oid) LIKE '%lighten_today%')",
  }),
  Object.freeze({
    num: '033',
    file: '033_habit_log_timezone.sql',
    ledgerVersion: '20261010000600',
    ledgerName: 'habit_log_timezone',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'habit_logs' AND column_name = 'tz')",
  }),
  Object.freeze({
    num: '034',
    file: '034_coach_reminder_action.sql',
    ledgerVersion: '20261010000700',
    ledgerName: 'coach_reminder_action',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_actions_type_check' AND pg_get_constraintdef(oid) LIKE '%edit_reminder_time%')",
  }),
  Object.freeze({
    num: '035',
    file: '035_coach_lighten_week.sql',
    ledgerVersion: '20261010000800',
    ledgerName: 'coach_lighten_week',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_actions_type_check' AND pg_get_constraintdef(oid) LIKE '%lighten_week%')",
  }),
  Object.freeze({
    num: '036',
    file: '036_live_audit_hardening.sql',
    ledgerVersion: '20261010000900',
    ledgerName: 'live_audit_hardening',
    phase: 'phase-a',
    checkXpDriftAfter: true,
    targetCheckSql: "to_regclass('public.habit_xp_awards') IS NOT NULL",
  }),
  Object.freeze({
    num: '037',
    file: '037_today_bootstrap_rpc.sql',
    ledgerVersion: '20261010001000',
    ledgerName: 'today_bootstrap_rpc',
    phase: 'phase-a',
    checkXpDriftAfter: false,
    targetCheckSql: "to_regprocedure('public.get_today_bootstrap(date)') IS NOT NULL",
  }),
  Object.freeze({
    num: '038',
    file: '038_xp_streak_integrity.sql',
    ledgerVersion: '20261010001100',
    ledgerName: 'xp_streak_integrity',
    phase: 'phase-a',
    checkXpDriftAfter: true,
    targetCheckSql: "to_regprocedure('public.fn_habit_log_guard()') IS NOT NULL",
  }),
  Object.freeze({
    num: '042',
    file: '042_numeric_measures_and_willpower.sql',
    ledgerVersion: '20261010001500',
    ledgerName: 'numeric_measures_and_willpower',
    phase: 'phase-a',
    checkXpDriftAfter: true,
    targetCheckSql:
      "to_regprocedure('public.spend_willpower(date,numeric,integer,boolean)') IS NOT NULL",
  }),
  Object.freeze({
    num: '045',
    file: '045_task_estimated_minutes.sql',
    ledgerVersion: '20261010001800',
    ledgerName: 'task_estimated_minutes',
    phase: 'phase-a',
    checkXpDriftAfter: true,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'estimated_minutes')",
  }),
  Object.freeze({
    num: '039',
    file: '039_focus_point_hardening.sql',
    ledgerVersion: '20261010001200',
    ledgerName: 'focus_point_hardening',
    phase: 'phase-b',
    checkXpDriftAfter: true,
    targetCheckSql: "to_regclass('public.ai_messages_user_request_uniq') IS NOT NULL",
  }),
  Object.freeze({
    num: '040',
    file: '040_privilege_hygiene.sql',
    ledgerVersion: '20261010001300',
    ledgerName: 'privilege_hygiene',
    phase: 'phase-b',
    checkXpDriftAfter: true,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'archive_f13')",
  }),
  Object.freeze({
    num: '041',
    file: '041_rls_initplan_and_indexes.sql',
    ledgerVersion: '20261010001400',
    ledgerName: 'rls_initplan_and_indexes',
    phase: 'phase-b',
    checkXpDriftAfter: true,
    targetCheckSql:
      "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_parent_task_id_fkey' AND confdeltype = 'c')",
  }),
  Object.freeze({
    num: '043',
    file: '043_profile_time_zone.sql',
    ledgerVersion: '20261010001600',
    ledgerName: 'profile_time_zone',
    phase: 'phase-b',
    checkXpDriftAfter: true,
    targetCheckSql: "to_regprocedure('public.set_profile_time_zone(text)') IS NOT NULL",
  }),
  Object.freeze({
    num: '044',
    file: '044_ai_messages_and_retention.sql',
    ledgerVersion: '20261010001700',
    ledgerName: 'ai_messages_and_retention',
    phase: 'phase-b',
    checkXpDriftAfter: true,
    targetCheckSql: "to_regprocedure('public.purge_ai_retention()') IS NOT NULL",
  }),
]);

export const PHASE_A_MIGRATIONS = Object.freeze(
  MIGRATION_CATALOG.filter((m) => m.phase === 'phase-a').map((m) => m.num),
);

export const PHASE_B_MIGRATIONS = Object.freeze(
  MIGRATION_CATALOG.filter((m) => m.phase === 'phase-b').map((m) => m.num),
);

export const NEW_RLS_TABLES = Object.freeze([
  'habit_pauses',
  'habit_goal_versions',
  'habit_checklist_items',
  'habit_checklist_checks',
  'routine_templates',
  'routine_template_versions',
  'routine_sessions',
  'mood_definitions',
  'mood_checkins',
  'review_next_actions',
]);

export const EDGE_DEPLOY_ORDER = Object.freeze([
  'generate-routine',
  'delete-account',
  'subscription-webhook',
  'notion-sync',
]);

export const CRON_JOB_NAME = 'purge-ai-retention';
export const CRON_SCHEDULE = '17 3 * * *';
export const CRON_COMMAND = 'SELECT public.purge_ai_retention()';

export const SQL_QUERIES = Object.freeze({
  preflight01LatestMigrations:
    'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;',
  preflight03HabitLogsTz:
    "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'habit_logs' AND column_name = 'tz';",
  xpDriftCount: 'SELECT count(*)::int AS drift FROM public.xp_drift();',
  preflight06DependentViews: [
    'SELECT DISTINCT c.relname AS dependent_relation, c.relkind',
    'FROM pg_depend d',
    'JOIN pg_rewrite r ON r.oid = d.objid',
    'JOIN pg_class c ON c.oid = r.ev_class',
    "WHERE d.refobjid IN ('public.habit_logs'::regclass, 'public.habits'::regclass)",
    "  AND c.relname NOT IN ('habit_logs', 'habits');",
  ].join('\n'),
  preflight07TaskEstimateColumns: [
    'SELECT column_name, data_type, is_nullable',
    'FROM information_schema.columns',
    "WHERE table_schema = 'public'",
    "  AND table_name = 'tasks'",
    "  AND column_name IN ('estimated_minutes', 'estimate_source');",
  ].join('\n'),
  preflightDb111UsernameRepairs: [
    'SELECT count(*) FILTER (WHERE username IS NOT NULL)::int AS with_name,',
    '       count(*) FILTER (',
    '         WHERE username <> btrim(username)',
    '            OR char_length(username) NOT BETWEEN 3 AND 32',
    "            OR username ~ '[[:cntrl:]<>]'",
    '       )::int AS will_be_repaired',
    'FROM public.profiles;',
  ].join('\n'),
  preflightDb212F13Counts: [
    "SELECT 'user_pets' AS t, count(*)::int AS row_count FROM public.user_pets",
    "UNION ALL SELECT 'user_inventory', count(*)::int FROM public.user_inventory",
    "UNION ALL SELECT 'user_quests', count(*)::int FROM public.user_quests",
    "UNION ALL SELECT 'user_skills', count(*)::int FROM public.user_skills",
    "UNION ALL SELECT 'boss_contributors', count(*)::int FROM public.boss_contributors",
    "UNION ALL SELECT 'user_challenges', count(*)::int FROM public.user_challenges;",
  ].join('\n'),
  rls61NewTablesRowSecurity: [
    'SELECT tablename, rowsecurity',
    'FROM pg_tables',
    "WHERE schemaname = 'public'",
    `  AND tablename IN (${NEW_RLS_TABLES.map((t) => `'${t}'`).join(', ')})`,
    'ORDER BY tablename;',
  ].join('\n'),
  rls62ZeroAnonPublicPolicies: [
    'SELECT tablename, policyname, roles',
    'FROM pg_policies',
    "WHERE schemaname = 'public'",
    `  AND tablename IN (${NEW_RLS_TABLES.map((t) => `'${t}'`).join(', ')})`,
    "  AND NOT (roles = '{authenticated}');",
  ].join('\n'),
  cronExtensionCheck: "SELECT 1 AS installed FROM pg_extension WHERE extname = 'pg_cron';",
  cronSchedulePurge:
    "SELECT cron.schedule('purge-ai-retention', '17 3 * * *', $$SELECT public.purge_ai_retention()$$);",
  cronVerifyJob:
    "SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'purge-ai-retention';",
  y01_1_publicTablesRls: [
    'SELECT c.relname AS table_name,',
    '       c.relrowsecurity AS rls_enabled,',
    "       (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count",
    'FROM pg_class c',
    'JOIN pg_namespace n ON n.oid = c.relnamespace',
    "WHERE n.nspname = 'public' AND c.relkind = 'r'",
    'ORDER BY c.relname;',
  ].join('\n'),
  y01_2_schemaMigrations: [
    'SELECT version, name, array_length(statements, 1) AS statement_count',
    'FROM supabase_migrations.schema_migrations',
    'ORDER BY version DESC;',
  ].join('\n'),
  y01_3_rpcPrivilegeMatrix: [
    'SELECT p.oid::regprocedure::text AS rpc_signature,',
    '       p.prosecdef AS security_definer,',
    '       p.provolatile AS volatility,',
    "       coalesce(array_to_string(p.proconfig, ', '), '') AS config,",
    "       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,",
    "       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,",
    "       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec",
    'FROM pg_proc p',
    'JOIN pg_namespace n ON n.oid = p.pronamespace',
    "WHERE n.nspname = 'public'",
    '  AND p.proname IN (',
    "    'get_today_bootstrap',",
    "    'spend_willpower',",
    "    'set_profile_time_zone',",
    "    'purge_ai_retention',",
    "    'cleanup_old_ai_calls',",
    "    'spend_focus_points',",
    "    'spend_focus_points_v2',",
    "    'refund_focus_points',",
    "    'ai_request_begin',",
    "    'get_weekly_leaderboard',",
    "    'get_global_leaderboard',",
    "    'get_user_rank',",
    "    'xp_drift'",
    '  )',
    'ORDER BY 1;',
  ].join('\n'),
});

/**
 * Redacts any explicit secret value, `sbp_*` personal access token, or HTTP Bearer credential.
 *
 * @param {string} text
 * @param {string} [secretToken]
 * @returns {string}
 */
export function redactSecrets(text, secretToken = '') {
  let safe = String(text ?? '');
  if (secretToken && secretToken.trim().length > 0) {
    safe = safe.split(secretToken.trim()).join('[REDACTED]');
  }
  safe = safe.replace(/\bsbp_[A-Za-z0-9_-]+/g, '[REDACTED]');
  safe = safe.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  return safe;
}

/**
 * Parses CLI arguments fail-closed (unknown flags or missing flag values throw).
 *
 * @param {readonly string[]} argv
 */
export function parseCliArgs(argv) {
  /** @type {{ mode: string | null; dryRun: boolean; json: boolean; outPath: string | null; confirmNoLegacyClients: boolean; projectRef: string | null; apiBase: string | null }} */
  const parsed = {
    mode: null,
    dryRun: false,
    json: false,
    outPath: null,
    confirmNoLegacyClients: false,
    projectRef: null,
    apiBase: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--confirm-no-legacy-clients') {
      parsed.confirmNoLegacyClients = true;
      continue;
    }
    if (arg === '--mode') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new Error('Missing value for --mode. Expected one of: ' + VALID_MODES.join(', '));
      }
      parsed.mode = val;
      i += 1;
      continue;
    }
    if (arg === '--out') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new Error('Missing file path for --out.');
      }
      parsed.outPath = val;
      i += 1;
      continue;
    }
    if (arg === '--project-ref') {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new Error('Missing value for --project-ref.');
      }
      parsed.projectRef = val;
      i += 1;
      continue;
    }
    if (arg === '--api-url') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new Error('Missing value for --api-url.');
      }
      parsed.apiBase = val;
      i += 1;
      continue;
    }
    throw new Error(
      `Unknown CLI argument "${arg}". Supported flags: --mode, --dry-run, --confirm-no-legacy-clients, --json, --out, --project-ref, --api-url`,
    );
  }

  if (!parsed.mode || !VALID_MODES.includes(parsed.mode)) {
    throw new Error(
      `Invalid or missing --mode "${parsed.mode ?? ''}". Must be one of: ${VALID_MODES.join(', ')}`,
    );
  }

  return parsed;
}

/**
 * Enforces canonical project ref fail-closed before any action can occur.
 *
 * @param {string | null | undefined} projectRef
 * @returns {string}
 */
export function assertCanonicalProjectRef(projectRef) {
  const normalized = typeof projectRef === 'string' ? projectRef.trim() : '';
  if (!normalized) {
    throw new Error(
      `ROLLOUT BLOCKED: projectRef is empty. Expected canonical project "${CANONICAL_PROJECT_REF}" (fail-closed).`,
    );
  }
  if (normalized !== CANONICAL_PROJECT_REF) {
    throw new Error(
      `ROLLOUT BLOCKED: non-canonical projectRef "${normalized}" rejected. Only "${CANONICAL_PROJECT_REF}" is permitted.`,
    );
  }
  return normalized;
}

/**
 * Verifies that `MIGRATION_CATALOG` matches `docs/implementation-v3/MIGRATION_MAPPING.md`
 * and that every `.sql` file exists on disk under `supabase/migrations/`.
 *
 * @param {string} repoRoot
 */
export function verifyCatalogAgainstRepo(repoRoot = DEFAULT_REPO_ROOT) {
  const migrationsDir = join(repoRoot, 'supabase', 'migrations');
  const mappingPath = join(repoRoot, 'docs', 'implementation-v3', 'MIGRATION_MAPPING.md');

  if (!existsSync(migrationsDir)) {
    throw new Error('supabase/migrations directory is missing.');
  }
  if (!existsSync(mappingPath)) {
    throw new Error('docs/implementation-v3/MIGRATION_MAPPING.md is missing.');
  }

  const mappingDoc = readFileSync(mappingPath, 'utf8').replace(/\r\n?/g, '\n');

  for (const spec of MIGRATION_CATALOG) {
    const sqlPath = join(migrationsDir, spec.file);
    if (!existsSync(sqlPath)) {
      throw new Error(`Missing migration SQL file: supabase/migrations/${spec.file}`);
    }
    const body = readFileSync(sqlPath, 'utf8').trim();
    if (!body) {
      throw new Error(`Empty migration SQL file: supabase/migrations/${spec.file}`);
    }
    const expectedMappingFragment = `| \`${spec.file}\` | \`${spec.ledgerVersion}_${spec.ledgerName}.sql\` |`;
    if (!mappingDoc.includes(expectedMappingFragment)) {
      throw new Error(
        `MIGRATION_MAPPING.md drift for ${spec.file}: expected "${expectedMappingFragment}".`,
      );
    }
  }
}

/**
 * Reads `supabase/functions/DEPLOYMENT.json` and builds the exact 4-function
 * Edge deployment plan (`deploy: true` only, `--no-verify-jwt` when `verifyJwt === false`).
 *
 * @param {string} [repoRoot]
 * @param {string} [projectRef]
 */
export function buildEdgeDeployPlan(
  repoRoot = DEFAULT_REPO_ROOT,
  projectRef = CANONICAL_PROJECT_REF,
) {
  assertCanonicalProjectRef(projectRef);
  const manifestPath = join(repoRoot, 'supabase', 'functions', 'DEPLOYMENT.json');
  if (!existsSync(manifestPath)) {
    throw new Error('supabase/functions/DEPLOYMENT.json is missing.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || !Array.isArray(manifest.functions)) {
    throw new Error('supabase/functions/DEPLOYMENT.json has an invalid functions array.');
  }

  const deployEntries = manifest.functions.filter((fn) => fn && fn.deploy === true);
  const bySlug = new Map(deployEntries.map((fn) => [String(fn.slug), fn]));

  const expectedSorted = [...EDGE_DEPLOY_ORDER].sort();
  const actualSorted = [...bySlug.keys()].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `DEPLOYMENT.json deploy:true slugs [${actualSorted.join(', ')}] do not match expected [${expectedSorted.join(', ')}].`,
    );
  }

  return EDGE_DEPLOY_ORDER.map((slug) => {
    const entry = bySlug.get(slug);
    if (!entry || typeof entry.verifyJwt !== 'boolean') {
      throw new Error(`DEPLOYMENT.json entry "${slug}" must declare boolean verifyJwt.`);
    }
    const args = ['supabase', 'functions', 'deploy', slug];
    if (entry.verifyJwt === false) {
      args.push('--no-verify-jwt');
    }
    args.push('--project-ref', projectRef);
    return {
      slug,
      verifyJwt: entry.verifyJwt,
      noVerifyJwtFlag: entry.verifyJwt === false,
      command: `npx ${args.join(' ')}`,
      npxArgs: args,
    };
  });
}

/**
 * Resolves a real POSIX bash binary (skipping the Windows System32 WSL launcher stub).
 *
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
 * Runs `supabase/predeploy_guard.sh` fail-closed against `projectRef`.
 *
 * @param {{
 *   repoRoot?: string;
 *   projectRef: string;
 *   spawnImpl?: typeof spawnSync;
 * }} options
 */
export function runPredeployGuard(options) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const projectRef = assertCanonicalProjectRef(options.projectRef);
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const guardRel = 'supabase/predeploy_guard.sh';
  const guardAbs = join(repoRoot, 'supabase', 'predeploy_guard.sh');

  if (!existsSync(guardAbs)) {
    throw new Error('supabase/predeploy_guard.sh is missing.');
  }

  const bashBin = options.spawnImpl ? 'bash' : resolveBashBinary();
  if (!bashBin) {
    throw new Error('No POSIX bash binary available to execute supabase/predeploy_guard.sh.');
  }

  const res = spawnImpl(bashBin, [guardRel], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_PROJECT_REF: projectRef,
    },
    timeout: 10000,
  });

  const combined = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (res.status !== 0 || !combined.includes(`deploy target OK: ${projectRef}`)) {
    throw new Error(
      `supabase/predeploy_guard.sh failed (exit ${res.status ?? 'null'}): ${combined || 'missing confirmation output'}`,
    );
  }

  return {
    ok: true,
    output: `deploy target OK: ${projectRef}`,
  };
}

/**
 * Executes a single SQL statement/script against the Supabase Management API
 * `POST ${apiBase}/v1/projects/${projectRef}/database/query`.
 *
 * @param {{
 *   sql: string;
 *   label: string;
 *   projectRef: string;
 *   apiBase: string;
 *   accessToken: string;
 *   fetchImpl: typeof fetch;
 * }} params
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function executeManagementSql(params) {
  const projectRef = assertCanonicalProjectRef(params.projectRef);
  const token = (params.accessToken ?? '').trim();
  if (!token) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN is required for live execution (not set). Pass --dry-run for offline plan verification.',
    );
  }
  if (typeof params.fetchImpl !== 'function') {
    throw new Error('No fetch implementation available for Supabase Management API calls.');
  }

  const base = (params.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const endpoint = `${base}/v1/projects/${projectRef}/database/query`;

  let response;
  try {
    response = await params.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: params.sql }),
    });
  } catch (err) {
    const safeMsg = redactSecrets(err instanceof Error ? err.message : String(err), token);
    throw new Error(`Management API network failure during "${params.label}": ${safeMsg}`);
  }

  let bodyText = '';
  let payload = null;
  if (response && typeof response.json === 'function' && typeof response.text !== 'function') {
    payload = await response.json();
  } else {
    bodyText = await response.text();
    if (bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = { raw: bodyText };
      }
    } else {
      payload = [];
    }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && ('message' in payload || 'error' in payload)
        ? String(payload.message ?? payload.error)
        : bodyText || `HTTP ${response.status}`;
    const safeDetail = redactSecrets(detail, token);
    const err = new Error(
      `SQL "${params.label}" failed with HTTP ${response.status}: ${safeDetail}`,
    );
    /** @type {Error & { status?: number; sqlErrorDetail?: string }} */ (err).status =
      response.status;
    /** @type {Error & { status?: number; sqlErrorDetail?: string }} */ (err).sqlErrorDetail =
      safeDetail;
    throw err;
  }

  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) {
    return payload.rows;
  }
  if (
    payload &&
    typeof payload === 'object' &&
    ('error' in payload || 'message' in payload)
  ) {
    const safeDetail = redactSecrets(String(payload.message ?? payload.error), token);
    throw new Error(`SQL "${params.label}" returned error payload: ${safeDetail}`);
  }
  throw new Error(
    `SQL "${params.label}" returned unexpected non-array payload from Management API (fail-closed).`,
  );
}

/**
 * Extracts a fail-closed numeric drift count from `SELECT count(*)::int AS drift FROM public.xp_drift();`.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} contextLabel
 * @returns {number}
 */
export function extractXpDriftCount(rows, contextLabel) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `xp_drift() gate (${contextLabel}) returned an empty result set; expected numeric drift count (fail-closed).`,
    );
  }
  const first = rows[0];
  if (first && typeof first === 'object' && ('drift' in first || 'count' in first)) {
    const rawVal = 'drift' in first ? first.drift : first.count;
    const numeric = Number(rawVal);
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw new Error(
        `xp_drift() gate (${contextLabel}) returned invalid drift value "${String(rawVal)}" (fail-closed).`,
      );
    }
    return numeric;
  }
  // If a caller/mock returned raw drift rows instead of count(*), any row means drift > 0.
  return rows.length;
}

/**
 * Asserts `SELECT count(*)::int AS drift FROM public.xp_drift();` equals `0`.
 *
 * @param {{
 *   contextLabel: string;
 *   projectRef: string;
 *   apiBase: string;
 *   accessToken: string;
 *   fetchImpl: typeof fetch;
 *   allowMissingFunction?: boolean;
 * }} params
 */
async function verifyZeroXpDrift(params) {
  try {
    const rows = await executeManagementSql({
      sql: SQL_QUERIES.xpDriftCount,
      label: `xp_drift (${params.contextLabel})`,
      projectRef: params.projectRef,
      apiBase: params.apiBase,
      accessToken: params.accessToken,
      fetchImpl: params.fetchImpl,
    });
    const drift = extractXpDriftCount(rows, params.contextLabel);
    if (drift !== 0) {
      throw new Error(
        `XP DRIFT GATE FAILED (${params.contextLabel}): public.xp_drift() count is ${drift} (MUST be 0). Halting rollout immediately.`,
      );
    }
    return { exists: true, drift: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      params.allowMissingFunction &&
      /xp_drift[\s\S]*does not exist|42883/i.test(msg)
    ) {
      return { exists: false, drift: 0 };
    }
    throw err;
  }
}

/**
 * Builds the deterministic `--dry-run` execution plan for any mode with zero network/token access.
 *
 * @param {{
 *   mode: string;
 *   repoRoot?: string;
 *   projectRef?: string;
 * }} params
 */
export function buildDryRunPlan(params) {
  const repoRoot = params.repoRoot ?? DEFAULT_REPO_ROOT;
  const projectRef = assertCanonicalProjectRef(params.projectRef ?? CANONICAL_PROJECT_REF);
  verifyCatalogAgainstRepo(repoRoot);

  const edgeFunctions = buildEdgeDeployPlan(repoRoot, projectRef);
  const phaseASpecs = MIGRATION_CATALOG.filter((m) => m.phase === 'phase-a');
  const phaseBSpecs = MIGRATION_CATALOG.filter((m) => m.phase === 'phase-b');

  const stages =
    params.mode === 'all'
      ? ['preflight', 'phase-a', 'phase-b', 'edge', 'cron', 'verify-live']
      : [params.mode];

  return {
    stages,
    preflight: stages.includes('preflight')
      ? {
          offlineReadinessCheck: 'verify-owner-rollout-readiness.mjs',
          predeployGuard: 'supabase/predeploy_guard.sh',
          readOnlyQueries: [
            '0.1 latest schema_migrations',
            '0.3 habit_logs.tz check',
            '0.4 public.xp_drift() === 0',
            '0.6 dependent views on habits/habit_logs === 0',
            '0.7 tasks.estimated_minutes & estimate_source check',
            'DB1-11 profiles.username repair count',
            'DB2-12 F13 table row counts',
          ],
        }
      : null,
    phaseA: stages.includes('phase-a')
      ? {
          migrationCount: phaseASpecs.length,
          migrations: phaseASpecs.map((m) => ({
            num: m.num,
            file: m.file,
            ledgerVersion: m.ledgerVersion,
            ledgerName: m.ledgerName,
            checkXpDriftAfter: m.checkXpDriftAfter,
          })),
          xpDriftGatesAfter: phaseASpecs.filter((m) => m.checkXpDriftAfter).map((m) => m.num),
        }
      : null,
    phaseB: stages.includes('phase-b')
      ? {
          migrationCount: phaseBSpecs.length,
          migrations: phaseBSpecs.map((m) => ({
            num: m.num,
            file: m.file,
            ledgerVersion: m.ledgerVersion,
            ledgerName: m.ledgerName,
            checkXpDriftAfter: m.checkXpDriftAfter,
          })),
          xpDriftGatesAfter: phaseBSpecs.filter((m) => m.checkXpDriftAfter).map((m) => m.num),
          postPhaseRlsChecks: ['6.1 10 new tables rowsecurity = true', '6.2 0 anon/public policies'],
        }
      : null,
    edge: stages.includes('edge')
      ? {
          predeployGuard: 'supabase/predeploy_guard.sh',
          functionCount: edgeFunctions.length,
          functions: edgeFunctions,
          postDeployChecks: [
            'supabase/migrations zero renamed files',
            `node tools/verify-edge-deployment.mjs --project-ref ${projectRef}`,
          ],
        }
      : null,
    cron: stages.includes('cron')
      ? {
          jobName: CRON_JOB_NAME,
          schedule: CRON_SCHEDULE,
          command: CRON_COMMAND,
        }
      : null,
    verifyLive: stages.includes('verify-live')
      ? {
          sqlQueries: ['Y01-1', 'Y01-2', 'Y01-3', 'Y01-5'],
          edgeParityVerifier: `node tools/verify-edge-deployment.mjs --project-ref ${projectRef}`,
        }
      : null,
  };
}

/**
 * Executes `preflight`: offline readiness + `predeploy_guard.sh` + live read-only SQL §0 & §3 checks.
 */
async function executePreflightStage(ctx) {
  const readiness = runOwnerRolloutReadiness({
    repoRoot: ctx.repoRoot,
    runBashProbes: ctx.runBashProbes,
  });
  if (!readiness.ok) {
    throw new Error(
      `Offline rollout readiness failed (${readiness.problems.length} violation(s)): ${readiness.problems.join(' | ')}`,
    );
  }

  const guardResult = runPredeployGuard({
    repoRoot: ctx.repoRoot,
    projectRef: ctx.projectRef,
    spawnImpl: ctx.spawnImpl,
  });

  if (ctx.dryRun) {
    return {
      stage: 'preflight',
      ok: true,
      dryRun: true,
      offlineReadinessOk: true,
      predeployGuardOk: guardResult.ok,
      liveChecks: null,
    };
  }

  const latestMigrations = await executeManagementSql({
    sql: SQL_QUERIES.preflight01LatestMigrations,
    label: '0.1 latest schema_migrations',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const tzRows = await executeManagementSql({
    sql: SQL_QUERIES.preflight03HabitLogsTz,
    label: '0.3 habit_logs.tz check',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const xpDrift = await verifyZeroXpDrift({
    contextLabel: 'preflight 0.4',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
    allowMissingFunction: true,
  });

  const depViewRows = await executeManagementSql({
    sql: SQL_QUERIES.preflight06DependentViews,
    label: '0.6 dependent views on habits/habit_logs',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const dependentViewsCount =
    depViewRows.length === 1 &&
    ('count' in depViewRows[0] || 'dependent_views' in depViewRows[0])
      ? Number(depViewRows[0].count ?? depViewRows[0].dependent_views ?? 0)
      : depViewRows.length;

  if (dependentViewsCount !== 0) {
    throw new Error(
      `Preflight 0.6 failed: found ${dependentViewsCount} dependent view(s) on public.habits/public.habit_logs (MUST be 0 before 042).`,
    );
  }

  const taskEstimateCols = await executeManagementSql({
    sql: SQL_QUERIES.preflight07TaskEstimateColumns,
    label: '0.7 tasks.estimated_minutes & estimate_source check',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const usernameRepairs = await executeManagementSql({
    sql: SQL_QUERIES.preflightDb111UsernameRepairs,
    label: 'DB1-11 profiles.username repair count',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  let f13TableCounts = [];
  try {
    f13TableCounts = await executeManagementSql({
      sql: SQL_QUERIES.preflightDb212F13Counts,
      label: 'DB2-12 F13 table counts',
      projectRef: ctx.projectRef,
      apiBase: ctx.apiBase,
      accessToken: ctx.accessToken,
      fetchImpl: ctx.fetchImpl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/does not exist|42P01/i.test(msg)) {
      throw err;
    }
    f13TableCounts = [{ note: 'F13 tables already relocated from public schema (040 applied).' }];
  }

  return {
    stage: 'preflight',
    ok: true,
    dryRun: false,
    offlineReadinessOk: true,
    predeployGuardOk: guardResult.ok,
    liveChecks: {
      latestMigrations,
      habitLogsTzColumnCount: Number(tzRows[0]?.count ?? 0),
      xpDrift,
      dependentViewsCount: 0,
      taskEstimateColumns: taskEstimateCols,
      usernameRepairs: usernameRepairs[0] ?? null,
      f13TableCounts,
    },
  };
}

/**
 * Applies an ordered migration phase (`phase-a` or `phase-b`) idempotently and fail-closed.
 *
 * @param {'phase-a' | 'phase-b'} phaseName
 * @param {object} ctx
 */
async function executeMigrationPhaseStage(phaseName, ctx) {
  const specs = MIGRATION_CATALOG.filter((m) => m.phase === phaseName);

  if (ctx.dryRun) {
    return {
      stage: phaseName,
      ok: true,
      dryRun: true,
      migrations: specs.map((s) => ({
        num: s.num,
        file: s.file,
        ledgerVersion: s.ledgerVersion,
        ledgerName: s.ledgerName,
        status: 'planned',
        checkXpDriftAfter: s.checkXpDriftAfter,
      })),
    };
  }

  const migrationsDir = join(ctx.repoRoot, 'supabase', 'migrations');
  const results = [];

  for (const spec of specs) {
    const probeSql = [
      'SELECT EXISTS (',
      '  SELECT 1 FROM supabase_migrations.schema_migrations',
      `  WHERE version IN ('${spec.ledgerVersion}', '${spec.num}')`,
      `     OR name = '${spec.ledgerName}'`,
      ') AS recorded,',
      `(${spec.targetCheckSql}) AS target_present;`,
    ].join('\n');

    const probeRows = await executeManagementSql({
      sql: probeSql,
      label: `probe ${spec.num} (${spec.ledgerVersion})`,
      projectRef: ctx.projectRef,
      apiBase: ctx.apiBase,
      accessToken: ctx.accessToken,
      fetchImpl: ctx.fetchImpl,
    });

    const alreadyRecorded = Boolean(probeRows[0]?.recorded);
    const targetPresentBefore = Boolean(probeRows[0]?.target_present);

    let status = 'skipped_already_recorded';
    if (!alreadyRecorded) {
      const sqlFilePath = join(migrationsDir, spec.file);
      const sqlBody = readFileSync(sqlFilePath, 'utf8').replace(/\r\n?/g, '\n');

      await executeManagementSql({
        sql: sqlBody,
        label: `apply ${spec.file}`,
        projectRef: ctx.projectRef,
        apiBase: ctx.apiBase,
        accessToken: ctx.accessToken,
        fetchImpl: ctx.fetchImpl,
      });

      const recordSql = [
        'INSERT INTO supabase_migrations.schema_migrations (version, name)',
        `VALUES ('${spec.ledgerVersion}', '${spec.ledgerName}')`,
        'ON CONFLICT (version) DO NOTHING;',
      ].join('\n');

      await executeManagementSql({
        sql: recordSql,
        label: `record schema_migrations ${spec.ledgerVersion}_${spec.ledgerName}`,
        projectRef: ctx.projectRef,
        apiBase: ctx.apiBase,
        accessToken: ctx.accessToken,
        fetchImpl: ctx.fetchImpl,
      });

      status = targetPresentBefore ? 'applied_idempotent_and_recorded' : 'applied_and_recorded';
    }

    let xpDriftChecked = false;
    if (spec.checkXpDriftAfter) {
      await verifyZeroXpDrift({
        contextLabel: `after migration ${spec.num}`,
        projectRef: ctx.projectRef,
        apiBase: ctx.apiBase,
        accessToken: ctx.accessToken,
        fetchImpl: ctx.fetchImpl,
        allowMissingFunction: false,
      });
      xpDriftChecked = true;
    }

    results.push({
      num: spec.num,
      file: spec.file,
      ledgerVersion: spec.ledgerVersion,
      ledgerName: spec.ledgerName,
      status,
      xpDriftChecked,
    });
  }

  let postPhaseRls = null;
  if (phaseName === 'phase-b') {
    const rls61Rows = await executeManagementSql({
      sql: SQL_QUERIES.rls61NewTablesRowSecurity,
      label: '6.1 new tables rowsecurity = true',
      projectRef: ctx.projectRef,
      apiBase: ctx.apiBase,
      accessToken: ctx.accessToken,
      fetchImpl: ctx.fetchImpl,
    });

    const rowSecMap = new Map(
      rls61Rows.map((r) => [String(r.tablename ?? ''), Boolean(r.rowsecurity)]),
    );
    const missingOrDisabled = NEW_RLS_TABLES.filter((tbl) => rowSecMap.get(tbl) !== true);
    if (missingOrDisabled.length > 0) {
      throw new Error(
        `Phase B RLS check 6.1 failed: expected all 10 new tables to have rowsecurity = true; failing tables: [${missingOrDisabled.join(', ')}].`,
      );
    }

    const rls62Rows = await executeManagementSql({
      sql: SQL_QUERIES.rls62ZeroAnonPublicPolicies,
      label: '6.2 zero anon/public policies on new tables',
      projectRef: ctx.projectRef,
      apiBase: ctx.apiBase,
      accessToken: ctx.accessToken,
      fetchImpl: ctx.fetchImpl,
    });

    if (rls62Rows.length > 0) {
      throw new Error(
        `Phase B RLS check 6.2 failed: found ${rls62Rows.length} non-authenticated policy row(s) on new tables (MUST be 0).`,
      );
    }

    postPhaseRls = {
      checkedTables: NEW_RLS_TABLES.length,
      allRowSecurityTrue: true,
      nonAuthenticatedPolicies: 0,
    };
  }

  return {
    stage: phaseName,
    ok: true,
    dryRun: false,
    migrations: results,
    ...(postPhaseRls ? { postPhaseRls } : {}),
  };
}

/**
 * Lists `.sql` migration filenames in `supabase/migrations` to detect accidental CLI renames.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function listMigrationSqlFiles(repoRoot) {
  const dir = join(repoRoot, 'supabase', 'migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Runs `tools/verify-edge-deployment.mjs` in a child Node process without leaking secrets.
 */
function runEdgeDeploymentVerifier(ctx) {
  const token = (ctx.accessToken ?? '').trim();
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required to run verify-edge-deployment.mjs.');
  }
  const spawnImpl = ctx.spawnImpl ?? spawnSync;
  const verifierScript = join(ctx.repoRoot, 'tools', 'verify-edge-deployment.mjs');
  const res = spawnImpl(
    process.execPath,
    [verifierScript, '--project-ref', ctx.projectRef],
    {
      cwd: ctx.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_PROJECT_REF: ctx.projectRef,
        SUPABASE_ACCESS_TOKEN: token,
        SUPABASE_API_URL: ctx.apiBase,
      },
      timeout: 30000,
    },
  );

  const combined = redactSecrets(`${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim(), token);
  if (res.status !== 0) {
    throw new Error(
      `verify-edge-deployment.mjs failed (exit ${res.status ?? 'null'}): ${combined}`,
    );
  }
  return {
    ok: true,
    output: combined,
  };
}

/**
 * Executes `edge`: predeploy guard + 4 `deploy: true` Edge Functions + migration rename guard + live parity check.
 */
async function executeEdgeStage(ctx) {
  const plan = buildEdgeDeployPlan(ctx.repoRoot, ctx.projectRef);

  if (ctx.dryRun) {
    return {
      stage: 'edge',
      ok: true,
      dryRun: true,
      deployedFunctions: plan,
      migrationsUnchanged: true,
      edgeParityVerified: false,
    };
  }

  const token = (ctx.accessToken ?? '').trim();
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required for Edge deployment.');
  }

  runPredeployGuard({
    repoRoot: ctx.repoRoot,
    projectRef: ctx.projectRef,
    spawnImpl: ctx.spawnImpl,
  });

  const beforeMigrations = listMigrationSqlFiles(ctx.repoRoot);
  if (!beforeMigrations.every((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))) {
    throw new Error(
      'supabase/migrations contains non-canonical filenames before Edge deploy (expected NNN_<name>.sql).',
    );
  }

  const spawnImpl = ctx.spawnImpl ?? spawnSync;
  const npxBin = process.platform === 'win32' && !ctx.spawnImpl ? 'npx.cmd' : 'npx';

  for (const item of plan) {
    const res = spawnImpl(npxBin, item.npxArgs, {
      cwd: ctx.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_PROJECT_REF: ctx.projectRef,
        SUPABASE_ACCESS_TOKEN: token,
      },
      timeout: 180000,
    });
    if (res.status !== 0) {
      const safeOut = redactSecrets(`${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim(), token);
      throw new Error(
        `Edge Function deploy failed for "${item.slug}" (exit ${res.status ?? 'null'}): ${safeOut}`,
      );
    }
  }

  const afterMigrations = listMigrationSqlFiles(ctx.repoRoot);
  if (
    JSON.stringify(beforeMigrations) !== JSON.stringify(afterMigrations) ||
    !afterMigrations.every((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
  ) {
    throw new Error(
      'ROLLOUT BLOCKED: supabase/migrations files changed or were renamed during Edge deploy.',
    );
  }

  const parity = runEdgeDeploymentVerifier(ctx);

  return {
    stage: 'edge',
    ok: true,
    dryRun: false,
    deployedFunctions: plan.map((p) => ({
      slug: p.slug,
      verifyJwt: p.verifyJwt,
      noVerifyJwtFlag: p.noVerifyJwtFlag,
    })),
    migrationsUnchanged: true,
    edgeParityVerified: parity.ok,
  };
}

/**
 * Executes `cron`: checks `pg_cron`; schedules `purge-ai-retention` idempotently or emits actionable Dashboard notice.
 */
async function executeCronStage(ctx) {
  if (ctx.dryRun) {
    return {
      stage: 'cron',
      ok: true,
      dryRun: true,
      pgCronInstalled: null,
      scheduled: false,
      jobName: CRON_JOB_NAME,
      schedule: CRON_SCHEDULE,
      notice: null,
    };
  }

  const extRows = await executeManagementSql({
    sql: SQL_QUERIES.cronExtensionCheck,
    label: 'check pg_cron extension',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  if (extRows.length === 0) {
    const notice =
      `ACTION REQUIRED: pg_cron extension is not yet enabled on project ${ctx.projectRef}. ` +
      'Enable pg_cron in Supabase Dashboard -> Database -> Extensions, then re-run: ' +
      'node tools/execute-owner-rollout.mjs --mode cron';
    ctx.notices.push(notice);
    return {
      stage: 'cron',
      ok: true,
      dryRun: false,
      pgCronInstalled: false,
      scheduled: false,
      jobName: CRON_JOB_NAME,
      schedule: CRON_SCHEDULE,
      notice,
    };
  }

  await executeManagementSql({
    sql: SQL_QUERIES.cronSchedulePurge,
    label: 'schedule purge-ai-retention cron job',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const jobRows = await executeManagementSql({
    sql: SQL_QUERIES.cronVerifyJob,
    label: 'verify cron.job purge-ai-retention',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  if (jobRows.length === 0 || jobRows[0]?.active !== true) {
    throw new Error(
      'pg_cron verification failed: purge-ai-retention job is missing or inactive in cron.job.',
    );
  }

  return {
    stage: 'cron',
    ok: true,
    dryRun: false,
    pgCronInstalled: true,
    scheduled: true,
    jobName: CRON_JOB_NAME,
    schedule: String(jobRows[0].schedule ?? CRON_SCHEDULE),
    jobId: jobRows[0].jobid ?? null,
    notice: null,
  };
}

/**
 * Executes `verify-live`: `SQL_FOR_OWNER.md §10.2` (`Y01-1`, `Y01-2`, `Y01-3`, `Y01-5`) + `verify-edge-deployment.mjs`.
 */
async function executeVerifyLiveStage(ctx) {
  if (ctx.dryRun) {
    return {
      stage: 'verify-live',
      ok: true,
      dryRun: true,
      y01Evidence: null,
    };
  }

  const y01_1 = await executeManagementSql({
    sql: SQL_QUERIES.y01_1_publicTablesRls,
    label: 'Y01-1 public schema table + RLS summary',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const unguardedPublicTables = y01_1
    .filter((r) => r.rls_enabled === false)
    .map((r) => String(r.table_name));
  if (unguardedPublicTables.length > 0) {
    throw new Error(
      `Y01-1 live verification failed: public table(s) with RLS disabled: [${unguardedPublicTables.join(', ')}].`,
    );
  }

  const y01_2 = await executeManagementSql({
    sql: SQL_QUERIES.y01_2_schemaMigrations,
    label: 'Y01-2 live schema_migrations ledger',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const y01_3 = await executeManagementSql({
    sql: SQL_QUERIES.y01_3_rpcPrivilegeMatrix,
    label: 'Y01-3 RPC privilege & search_path matrix',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
  });

  const anonSecDefViolations = y01_3
    .filter((r) => r.security_definer === true && r.anon_exec === true)
    .map((r) => String(r.rpc_signature));
  if (anonSecDefViolations.length > 0) {
    throw new Error(
      `Y01-3 live verification failed: anon has EXECUTE on SECURITY DEFINER RPC(s): [${anonSecDefViolations.join(', ')}].`,
    );
  }

  const xpDrift = await verifyZeroXpDrift({
    contextLabel: 'Y01-5 verify-live',
    projectRef: ctx.projectRef,
    apiBase: ctx.apiBase,
    accessToken: ctx.accessToken,
    fetchImpl: ctx.fetchImpl,
    allowMissingFunction: false,
  });

  const edgeParity = runEdgeDeploymentVerifier(ctx);

  const y01Evidence = {
    contract: 'Y01',
    projectRef: ctx.projectRef,
    generatedAt: new Date().toISOString(),
    y01_1_publicTablesRls: {
      tableCount: y01_1.length,
      allRlsEnabled: true,
      tables: y01_1,
    },
    y01_2_schemaMigrations: {
      entryCount: y01_2.length,
      entries: y01_2,
    },
    y01_3_rpcPrivilegeMatrix: {
      rpcCount: y01_3.length,
      rpcs: y01_3,
    },
    y01_4_twoAccountRlsIsolation:
      'Run SQL_FOR_OWNER.md §10.2 Y01-4 ROLLBACK block with two owner-controlled test UUIDs to archive tenant-isolation proof.',
    y01_5_xpDrift: {
      drift: xpDrift.drift,
      ok: true,
    },
    y01_6_edgeParity: {
      ok: edgeParity.ok,
      summary: edgeParity.output,
    },
  };

  return {
    stage: 'verify-live',
    ok: true,
    dryRun: false,
    y01Evidence,
  };
}

/**
 * Programmatic entrypoint for executing or dry-running an owner rollout mode.
 *
 * @param {{
 *   mode: string;
 *   dryRun?: boolean;
 *   confirmNoLegacyClients?: boolean;
 *   projectRef?: string;
 *   apiBase?: string;
 *   accessToken?: string;
 *   repoRoot?: string;
 *   outPath?: string | null;
 *   fetchImpl?: typeof fetch;
 *   spawnImpl?: typeof spawnSync;
 *   runBashProbes?: boolean;
 * }} options
 */
export async function executeOwnerRollout(options) {
  const mode = options?.mode ?? '';
  const dryRun = Boolean(options?.dryRun);
  const confirmNoLegacyClients = Boolean(options?.confirmNoLegacyClients);
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;
  const apiBase = options?.apiBase ?? process.env.SUPABASE_API_URL ?? DEFAULT_API_BASE;
  const rawProjectRef =
    options?.projectRef !== undefined
      ? options.projectRef
      : (process.env.SUPABASE_PROJECT_REF ?? CANONICAL_PROJECT_REF);
  const accessToken =
    options?.accessToken !== undefined
      ? options.accessToken
      : (process.env.SUPABASE_ACCESS_TOKEN ?? '');

  /** @type {string[]} */
  const notices = [];
  /** @type {Array<Record<string, unknown>>} */
  const stageResults = [];

  try {
    const projectRef = assertCanonicalProjectRef(rawProjectRef);

    if (!VALID_MODES.includes(mode)) {
      throw new Error(`Invalid rollout mode "${mode}". Expected one of: ${VALID_MODES.join(', ')}`);
    }

    if (mode === 'all' && !confirmNoLegacyClients) {
      throw new Error(
        'ROLLOUT BLOCKED (Y02 safety rule): --mode all includes Phase B migration 039_focus_point_hardening.sql, ' +
          'which revokes legacy spend_focus_points(integer, text) and rejects active legacy clients with 42501. ' +
          'Run `--mode phase-a` before the new client release, or pass `--confirm-no-legacy-clients` once legacy client traffic has drained.',
      );
    }

    verifyCatalogAgainstRepo(repoRoot);

    if (!dryRun && !accessToken.trim()) {
      throw new Error(
        'SUPABASE_ACCESS_TOKEN is not set. Live rollout modes require a personal access token (or pass --dry-run).',
      );
    }

    const plan = dryRun ? buildDryRunPlan({ mode, repoRoot, projectRef }) : null;

    const ctx = {
      mode,
      dryRun,
      repoRoot,
      projectRef,
      apiBase,
      accessToken,
      fetchImpl: options?.fetchImpl ?? globalThis.fetch,
      spawnImpl: options?.spawnImpl,
      runBashProbes: options?.runBashProbes ?? !dryRun,
      notices,
    };

    const stagesToRun =
      mode === 'all'
        ? ['preflight', 'phase-a', 'phase-b', 'edge', 'cron', 'verify-live']
        : [mode];

    for (const stage of stagesToRun) {
      if (stage === 'preflight') {
        stageResults.push(await executePreflightStage(ctx));
      } else if (stage === 'phase-a' || stage === 'phase-b') {
        stageResults.push(await executeMigrationPhaseStage(stage, ctx));
      } else if (stage === 'edge') {
        stageResults.push(await executeEdgeStage(ctx));
      } else if (stage === 'cron') {
        stageResults.push(await executeCronStage(ctx));
      } else if (stage === 'verify-live') {
        stageResults.push(await executeVerifyLiveStage(ctx));
      }
    }

    const verifyStage = stageResults.find((s) => s.stage === 'verify-live');
    const report = {
      ok: true,
      canonicalProjectRef: projectRef,
      mode,
      dryRun,
      confirmNoLegacyClients,
      plan,
      stageResults,
      y01Evidence: verifyStage && 'y01Evidence' in verifyStage ? verifyStage.y01Evidence : null,
      notices,
      error: null,
    };

    if (options?.outPath) {
      const resolvedOut = resolve(options.outPath);
      mkdirSync(dirname(resolvedOut), { recursive: true });
      const safeJson = redactSecrets(`${JSON.stringify(report, null, 2)}\n`, accessToken);
      writeFileSync(resolvedOut, safeJson, 'utf8');
    }

    return report;
  } catch (err) {
    const safeError = redactSecrets(err instanceof Error ? err.message : String(err), accessToken);
    const failedReport = {
      ok: false,
      canonicalProjectRef: CANONICAL_PROJECT_REF,
      mode,
      dryRun,
      confirmNoLegacyClients,
      plan: null,
      stageResults,
      y01Evidence: null,
      notices,
      error: safeError,
    };

    if (options?.outPath) {
      const resolvedOut = resolve(options.outPath);
      mkdirSync(dirname(resolvedOut), { recursive: true });
      const safeJson = redactSecrets(`${JSON.stringify(failedReport, null, 2)}\n`, accessToken);
      writeFileSync(resolvedOut, safeJson, 'utf8');
    }

    return failedReport;
  }
}

/**
 * Formats a concise human-readable rollout summary (with secrets redacted).
 *
 * @param {Awaited<ReturnType<typeof executeOwnerRollout>>} report
 * @returns {string}
 */
export function formatRolloutReport(report) {
  const lines = [
    `Owner Production Rollout (${report.dryRun ? 'DRY-RUN' : 'LIVE'}) — mode=${report.mode} — target=${report.canonicalProjectRef}`,
  ];

  if (report.plan) {
    if (report.plan.phaseA) {
      lines.push(
        `  Phase A plan (${report.plan.phaseA.migrationCount} migrations): ${report.plan.phaseA.migrations.map((m) => m.num).join(' -> ')} (xp_drift gates after: ${report.plan.phaseA.xpDriftGatesAfter.join(', ')})`,
      );
    }
    if (report.plan.phaseB) {
      lines.push(
        `  Phase B plan (${report.plan.phaseB.migrationCount} migrations): ${report.plan.phaseB.migrations.map((m) => m.num).join(' -> ')} (xp_drift gates after: ${report.plan.phaseB.xpDriftGatesAfter.join(', ')})`,
      );
    }
    if (report.plan.edge) {
      lines.push(
        `  Edge plan (${report.plan.edge.functionCount} functions): ${report.plan.edge.functions.map((f) => `${f.slug}${f.noVerifyJwtFlag ? ' [--no-verify-jwt]' : ''}`).join(', ')}`,
      );
    }
    if (report.plan.cron) {
      lines.push(
        `  Cron plan: ${report.plan.cron.jobName} (${report.plan.cron.schedule}) -> ${report.plan.cron.command}`,
      );
    }
  }

  for (const stage of report.stageResults) {
    lines.push(`  [${stage.ok ? 'PASS' : 'FAIL'}] stage=${stage.stage}${stage.dryRun ? ' (dry-run)' : ''}`);
  }

  for (const notice of report.notices) {
    lines.push(`  [NOTICE] ${notice}`);
  }

  if (!report.ok && report.error) {
    lines.push('');
    lines.push(`Error: ${report.error}`);
    lines.push('Result: BLOCKED (exit 1)');
  } else {
    lines.push('');
    lines.push('Result: OK (exit 0)');
  }

  return lines.join('\n');
}

/**
 * CLI runner with injectable writers, fetch, and spawn handlers for deterministic testing.
 *
 * @param {readonly string[]} [argv]
 * @param {{
 *   repoRoot?: string;
 *   accessToken?: string;
 *   projectRef?: string;
 *   apiBase?: string;
 *   fetchImpl?: typeof fetch;
 *   spawnImpl?: typeof spawnSync;
 *   runBashProbes?: boolean;
 *   writeOut?: (text: string) => void;
 *   writeErr?: (text: string) => void;
 * }} [options]
 * @returns {Promise<number>}
 */
export async function runCli(argv = process.argv.slice(2), options = {}) {
  const writeOut = options.writeOut ?? ((text) => console.log(text));
  const writeErr = options.writeErr ?? ((text) => console.error(text));
  const token =
    options.accessToken !== undefined
      ? options.accessToken
      : (process.env.SUPABASE_ACCESS_TOKEN ?? '');

  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    writeErr(redactSecrets(err instanceof Error ? err.message : String(err), token));
    return 1;
  }

  const report = await executeOwnerRollout({
    mode: parsed.mode ?? '',
    dryRun: parsed.dryRun,
    confirmNoLegacyClients: parsed.confirmNoLegacyClients,
    outPath: parsed.outPath,
    projectRef:
      parsed.projectRef !== null
        ? parsed.projectRef
        : options.projectRef,
    apiBase: parsed.apiBase ?? options.apiBase,
    accessToken: options.accessToken,
    repoRoot: options.repoRoot,
    fetchImpl: options.fetchImpl,
    spawnImpl: options.spawnImpl,
    runBashProbes: options.runBashProbes,
  });

  if (parsed.json) {
    const safeJson = redactSecrets(JSON.stringify(report, null, 2), token);
    writeOut(safeJson);
  } else if (report.ok) {
    writeOut(redactSecrets(formatRolloutReport(report), token));
  } else {
    writeErr(redactSecrets(formatRolloutReport(report), token));
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
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    },
  );
}
