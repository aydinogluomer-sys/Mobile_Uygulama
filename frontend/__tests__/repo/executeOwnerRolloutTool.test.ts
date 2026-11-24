/**
 * Fail-closed owner rollout CLI & store web privacy parity tests
 * (`tools/execute-owner-rollout.mjs`, `docs/store/web/privacy.html`, `docs/store/web/godaddy/privacy.fragment.html`).
 */
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { readSource, stripComments } from '../helpers/sourceText';

type EdgePlanItem = {
  slug: string;
  verifyJwt: boolean;
  noVerifyJwtFlag: boolean;
  command: string;
  npxArgs: string[];
};

type MigrationPlanItem = {
  num: string;
  file: string;
  ledgerVersion: string;
  ledgerName: string;
  checkXpDriftAfter: boolean;
};

type DryRunPlan = {
  stages: string[];
  phaseA: {
    migrationCount: number;
    migrations: MigrationPlanItem[];
    xpDriftGatesAfter: string[];
  } | null;
  phaseB: {
    migrationCount: number;
    migrations: MigrationPlanItem[];
    xpDriftGatesAfter: string[];
  } | null;
  edge: {
    functionCount: number;
    functions: EdgePlanItem[];
  } | null;
  cron: {
    jobName: string;
    schedule: string;
    command: string;
  } | null;
};

type StageResult = {
  stage: string;
  ok: boolean;
  dryRun: boolean;
  migrations?: {
    num: string;
    file: string;
    ledgerVersion: string;
    ledgerName: string;
    status: string;
    xpDriftChecked: boolean;
  }[];
  pgCronInstalled?: boolean | null;
  scheduled?: boolean;
  notice?: string | null;
};

type RolloutReport = {
  ok: boolean;
  canonicalProjectRef: string;
  mode: string;
  dryRun: boolean;
  confirmNoLegacyClients: boolean;
  plan: DryRunPlan | null;
  stageResults: StageResult[];
  y01Evidence: Record<string, unknown> | null;
  notices: string[];
  error: string | null;
};

type MockFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type MockFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type RolloutModule = {
  CANONICAL_PROJECT_REF: string;
  PHASE_A_MIGRATIONS: readonly string[];
  PHASE_B_MIGRATIONS: readonly string[];
  redactSecrets: (text: string, secretToken?: string) => string;
  assertCanonicalProjectRef: (projectRef?: string | null) => string;
  executeOwnerRollout: (options: {
    mode: string;
    dryRun?: boolean;
    confirmNoLegacyClients?: boolean;
    projectRef?: string;
    apiBase?: string;
    accessToken?: string;
    repoRoot?: string;
    outPath?: string | null;
    fetchImpl?: (url: string, init?: MockFetchInit) => Promise<MockFetchResponse>;
    spawnImpl?: (
      cmd: string,
      args: readonly string[],
    ) => { status: number; stdout: string; stderr: string };
    runBashProbes?: boolean;
  }) => Promise<RolloutReport>;
  runCli: (
    argv?: readonly string[],
    options?: {
      repoRoot?: string;
      accessToken?: string;
      projectRef?: string;
      apiBase?: string;
      fetchImpl?: (url: string, init?: MockFetchInit) => Promise<MockFetchResponse>;
      spawnImpl?: (
        cmd: string,
        args: readonly string[],
      ) => { status: number; stdout: string; stderr: string };
      runBashProbes?: boolean;
      writeOut?: (text: string) => void;
      writeErr?: (text: string) => void;
    },
  ) => Promise<number>;
};

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'tools', 'execute-owner-rollout.mjs');

function loadRolloutModule(): RolloutModule {
  const builtinModule =
    typeof process.getBuiltinModule === 'function'
      ? (process.getBuiltinModule('node:module') as typeof import('module') | undefined)
      : undefined;

  if (builtinModule && typeof builtinModule.createRequire === 'function') {
    const hostRequire = builtinModule.createRequire(SCRIPT_PATH);
    return hostRequire(SCRIPT_PATH) as RolloutModule;
  }

  const localRequire = createRequire(SCRIPT_PATH);
  return localRequire(SCRIPT_PATH) as RolloutModule;
}

const rollout = loadRolloutModule();

function jsonResponse(payload: unknown, status = 200): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

const okGuardSpawn = () => ({
  status: 0,
  stdout: 'deploy target OK: kbcuolhjjnmhjaarxxmu\n',
  stderr: '',
});

describe('Automated Owner Rollout CLI (`tools/execute-owner-rollout.mjs`)', () => {
  it('(+) rejects empty and non-canonical projectRef fail-closed without touching network', async () => {
    let fetchCalls = 0;
    const neverFetch = async () => {
      fetchCalls += 1;
      return jsonResponse([]);
    };

    expect(() => rollout.assertCanonicalProjectRef('')).toThrow(/fail-closed/);
    expect(() => rollout.assertCanonicalProjectRef('wrong-project-ref-000')).toThrow(
      /non-canonical projectRef/,
    );

    const report = await rollout.executeOwnerRollout({
      mode: 'preflight',
      dryRun: false,
      projectRef: 'wrong-project-ref-000',
      accessToken: 'sbp_synthetic_unit_test_secret_token',
      fetchImpl: neverFetch,
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });

    expect(report.ok).toBe(false);
    expect(fetchCalls).toBe(0);
    expect(report.error).toMatch(/non-canonical projectRef/);
    expect(report.error).not.toContain('sbp_synthetic_unit_test_secret_token');

    const errChunks: string[] = [];
    const exitCode = await rollout.runCli(
      ['--mode', 'preflight', '--project-ref', 'wrong-project-ref-000'],
      {
        accessToken: 'sbp_synthetic_unit_test_secret_token',
        fetchImpl: neverFetch,
        writeOut: () => undefined,
        writeErr: (t) => errChunks.push(t),
      },
    );
    expect(exitCode).toBe(1);
    expect(fetchCalls).toBe(0);
    expect(errChunks.join('\n')).not.toContain('sbp_synthetic_unit_test_secret_token');
  });

  it('(+) --dry-run requires zero token and zero network and outputs exact Phase A (13), Phase B (5), and 4 Edge plans', async () => {
    let fetchCalls = 0;
    const forbidFetch = async () => {
      fetchCalls += 1;
      throw new Error('network must not be called in --dry-run');
    };

    const tmpDir = mkdtempSync(join(tmpdir(), 'owner-rollout-dry-'));
    try {
      const outPath = join(tmpDir, 'plan.json');
      const report = await rollout.executeOwnerRollout({
        mode: 'all',
        dryRun: true,
        confirmNoLegacyClients: true,
        accessToken: '',
        repoRoot: REPO_ROOT,
        outPath,
        fetchImpl: forbidFetch,
        spawnImpl: okGuardSpawn,
        runBashProbes: false,
      });

      expect(report.ok).toBe(true);
      expect(fetchCalls).toBe(0);
      expect(report.canonicalProjectRef).toBe('kbcuolhjjnmhjaarxxmu');
      expect(report.plan).not.toBeNull();

      // Exact Phase A (13 migrations: 028..038, 042, 045)
      expect(report.plan?.phaseA?.migrationCount).toBe(13);
      expect(report.plan?.phaseA?.migrations.map((m) => m.num)).toEqual([
        '028',
        '029',
        '030',
        '031',
        '032',
        '033',
        '034',
        '035',
        '036',
        '037',
        '038',
        '042',
        '045',
      ]);
      expect(report.plan?.phaseA?.xpDriftGatesAfter).toEqual(['036', '038', '042', '045']);

      // Exact Phase B (5 migrations: 039, 040, 041, 043, 044)
      expect(report.plan?.phaseB?.migrationCount).toBe(5);
      expect(report.plan?.phaseB?.migrations.map((m) => m.num)).toEqual([
        '039',
        '040',
        '041',
        '043',
        '044',
      ]);
      expect(report.plan?.phaseB?.xpDriftGatesAfter).toEqual(['039', '040', '041', '043', '044']);

      // Exact 4 deploy:true Edge functions (subscription-webhook with --no-verify-jwt)
      expect(report.plan?.edge?.functionCount).toBe(4);
      expect(report.plan?.edge?.functions.map((f) => f.slug)).toEqual([
        'generate-routine',
        'delete-account',
        'subscription-webhook',
        'notion-sync',
      ]);
      const webhookFn = report.plan?.edge?.functions.find(
        (f) => f.slug === 'subscription-webhook',
      );
      expect(webhookFn?.noVerifyJwtFlag).toBe(true);
      expect(webhookFn?.command).toContain('--no-verify-jwt');
      for (const slug of ['generate-routine', 'delete-account', 'notion-sync']) {
        const fn = report.plan?.edge?.functions.find((f) => f.slug === slug);
        expect(fn?.noVerifyJwtFlag).toBe(false);
        expect(fn?.command).not.toContain('--no-verify-jwt');
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('(-) refuses --mode all without --confirm-no-legacy-clients so 039 cannot break active legacy clients', async () => {
    let fetchCalls = 0;
    const report = await rollout.executeOwnerRollout({
      mode: 'all',
      dryRun: true,
      confirmNoLegacyClients: false,
      repoRoot: REPO_ROOT,
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse([]);
      },
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });

    expect(report.ok).toBe(false);
    expect(fetchCalls).toBe(0);
    expect(report.error).toContain('--confirm-no-legacy-clients');
    expect(report.error).toContain('039_focus_point_hardening.sql');

    const errChunks: string[] = [];
    const code = await rollout.runCli(['--mode', 'all', '--dry-run'], {
      repoRoot: REPO_ROOT,
      runBashProbes: false,
      writeOut: () => undefined,
      writeErr: (t) => errChunks.push(t),
    });
    expect(code).toBe(1);
    expect(errChunks.join('\n')).toContain('--confirm-no-legacy-clients');
  });

  it('(+) mocked Management API runs preflight and phase-a cleanly, and (-) halts immediately when xp_drift() > 0', async () => {
    const executedQueries: string[] = [];
    const secretToken = 'sbp_mock_secret_token_do_not_leak';

    // 1. Clean preflight + full Phase A run (drift === 0 everywhere)
    const cleanFetch = async (url: string, init?: MockFetchInit): Promise<MockFetchResponse> => {
      expect(url).toBe('https://api.supabase.com/v1/projects/kbcuolhjjnmhjaarxxmu/database/query');
      expect(init?.headers?.Authorization).toBe(`Bearer ${secretToken}`);
      const parsed = JSON.parse(init?.body ?? '{}') as { query: string };
      const sql = parsed.query;
      executedQueries.push(sql);

      if (sql.includes('FROM public.xp_drift()')) {
        return jsonResponse([{ drift: 0 }]);
      }
      if (sql.includes('AS recorded,')) {
        return jsonResponse([{ recorded: false, target_present: false }]);
      }
      if (sql.includes('ORDER BY version DESC LIMIT 5')) {
        return jsonResponse([{ version: '20260908133800', name: 'account_deletion_cascade' }]);
      }
      if (sql.includes("column_name = 'tz'")) {
        return jsonResponse([{ count: 0 }]);
      }
      if (sql.includes('will_be_repaired')) {
        return jsonResponse([{ with_name: 10, will_be_repaired: 0 }]);
      }
      return jsonResponse([]);
    };

    const preflightRes = await rollout.executeOwnerRollout({
      mode: 'preflight',
      dryRun: false,
      accessToken: secretToken,
      repoRoot: REPO_ROOT,
      fetchImpl: cleanFetch,
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });
    expect(preflightRes.ok).toBe(true);
    expect(JSON.stringify(preflightRes)).not.toContain(secretToken);

    executedQueries.length = 0;
    const phaseARes = await rollout.executeOwnerRollout({
      mode: 'phase-a',
      dryRun: false,
      accessToken: secretToken,
      repoRoot: REPO_ROOT,
      fetchImpl: cleanFetch,
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });
    expect(phaseARes.ok).toBe(true);
    expect(phaseARes.stageResults[0]?.migrations?.map((m) => m.num)).toEqual(
      rollout.PHASE_A_MIGRATIONS,
    );
    expect(
      executedQueries.some((q) => q.includes("VALUES ('20261010001800', 'task_estimated_minutes')")),
    ).toBe(true);

    // 2. Drift > 0 after migration 036 MUST halt immediately before 037, 038, 042, or 045 execute
    const driftedQueries: string[] = [];
    const driftFetch = async (_url: string, init?: MockFetchInit): Promise<MockFetchResponse> => {
      const parsed = JSON.parse(init?.body ?? '{}') as { query: string };
      const sql = parsed.query;
      driftedQueries.push(sql);

      if (sql.includes('FROM public.xp_drift()')) {
        return jsonResponse([{ drift: 3 }]);
      }
      if (sql.includes('AS recorded,')) {
        return jsonResponse([{ recorded: false, target_present: false }]);
      }
      return jsonResponse([]);
    };

    const driftedReport = await rollout.executeOwnerRollout({
      mode: 'phase-a',
      dryRun: false,
      accessToken: secretToken,
      repoRoot: REPO_ROOT,
      fetchImpl: driftFetch,
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });

    expect(driftedReport.ok).toBe(false);
    expect(driftedReport.error).toContain('after migration 036');
    expect(driftedReport.error).toContain('count is 3');
    expect(driftedReport.error).not.toContain(secretToken);
    // Must have halted before 037, 038, 042, or 045 were applied
    expect(
      driftedQueries.some((q) => q.includes('CREATE OR REPLACE FUNCTION public.get_today_bootstrap')),
    ).toBe(false);
    expect(driftedQueries.some((q) => q.includes('spend_willpower'))).toBe(false);
  });

  it('(+) cron mode prints an actionable Dashboard notice when pg_cron is not yet installed', async () => {
    const cronRes = await rollout.executeOwnerRollout({
      mode: 'cron',
      dryRun: false,
      accessToken: 'sbp_cron_test_token',
      repoRoot: REPO_ROOT,
      fetchImpl: async (_url, init) => {
        const parsed = JSON.parse(init?.body ?? '{}') as { query: string };
        if (parsed.query.includes("extname = 'pg_cron'")) {
          return jsonResponse([]);
        }
        throw new Error('should not schedule cron when extension is absent');
      },
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });

    expect(cronRes.ok).toBe(true);
    expect(cronRes.stageResults[0]?.pgCronInstalled).toBe(false);
    expect(cronRes.stageResults[0]?.scheduled).toBe(false);
    expect(cronRes.notices[0]).toContain('Database -> Extensions');
  });

  it('(+) executes phase-b RLS gates, edge deploy parity, and verify-live Y01 evidence summary', async () => {
    const newRlsTables = [
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
    ];

    const phaseBFetch = async (_url: string, init?: MockFetchInit): Promise<MockFetchResponse> => {
      const sql = (JSON.parse(init?.body ?? '{}') as { query: string }).query;
      if (sql.includes('AS recorded,')) {
        return jsonResponse([{ recorded: true, target_present: true }]);
      }
      if (sql.includes('FROM public.xp_drift()')) {
        return jsonResponse([{ drift: 0 }]);
      }
      if (sql.includes('SELECT tablename, rowsecurity')) {
        return jsonResponse(newRlsTables.map((tablename) => ({ tablename, rowsecurity: true })));
      }
      if (sql.includes("NOT (roles = '{authenticated}')")) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    };

    const phaseBRes = await rollout.executeOwnerRollout({
      mode: 'phase-b',
      dryRun: false,
      accessToken: 'sbp_phase_b_test_token',
      repoRoot: REPO_ROOT,
      fetchImpl: phaseBFetch,
      spawnImpl: okGuardSpawn,
      runBashProbes: false,
    });
    expect(phaseBRes.ok).toBe(true);
    expect(phaseBRes.stageResults[0]?.migrations?.map((m) => m.num)).toEqual(
      rollout.PHASE_B_MIGRATIONS,
    );

    const spawnedCommands: string[] = [];
    const mockEdgeSpawn = (cmd: string, args: readonly string[]) => {
      spawnedCommands.push(`${cmd} ${args.join(' ')}`);
      if (args[0] === 'supabase/predeploy_guard.sh') {
        return okGuardSpawn();
      }
      return { status: 0, stdout: 'Production matches the manifest.\n', stderr: '' };
    };

    const edgeRes = await rollout.executeOwnerRollout({
      mode: 'edge',
      dryRun: false,
      accessToken: 'sbp_edge_test_token',
      repoRoot: REPO_ROOT,
      spawnImpl: mockEdgeSpawn,
      runBashProbes: false,
    });
    expect(edgeRes.ok).toBe(true);
    expect(
      spawnedCommands.some((c) =>
        c.includes('supabase functions deploy subscription-webhook --no-verify-jwt --project-ref kbcuolhjjnmhjaarxxmu'),
      ),
    ).toBe(true);

    const verifyRes = await rollout.executeOwnerRollout({
      mode: 'verify-live',
      dryRun: false,
      accessToken: 'sbp_verify_test_token',
      repoRoot: REPO_ROOT,
      fetchImpl: async (_url, init) => {
        const sql = (JSON.parse(init?.body ?? '{}') as { query: string }).query;
        if (sql.includes('FROM public.xp_drift()')) {
          return jsonResponse([{ drift: 0 }]);
        }
        if (sql.includes('AS table_name,')) {
          return jsonResponse([{ table_name: 'habits', rls_enabled: true, policy_count: 4 }]);
        }
        if (sql.includes('AS statement_count')) {
          return jsonResponse([{ version: '20261010001800', name: 'task_estimated_minutes', statement_count: 1 }]);
        }
        if (sql.includes('AS rpc_signature,')) {
          return jsonResponse([
            {
              rpc_signature: 'get_today_bootstrap(date)',
              security_definer: false,
              volatility: 's',
              config: 'search_path=public',
              anon_exec: false,
              auth_exec: true,
              service_exec: true,
            },
          ]);
        }
        return jsonResponse([]);
      },
      spawnImpl: mockEdgeSpawn,
      runBashProbes: false,
    });
    expect(verifyRes.ok).toBe(true);
    expect(verifyRes.y01Evidence).not.toBeNull();
    expect(verifyRes.y01Evidence?.contract).toBe('Y01');
  });
});

describe('Store web privacy HTML & GoDaddy fragment synchronization', () => {
  it('(+) syncs privacy.html and privacy.fragment.html with privacy.tsx disclosures and keeps zero placeholders', () => {
    const inAppPrivacy = stripComments(readSource('app', 'screens', 'privacy.tsx'));
    const canonicalHtml = readSource('..', 'docs', 'store', 'web', 'privacy.html');
    const godaddyFragment = readSource(
      '..',
      'docs',
      'store',
      'web',
      'godaddy',
      'privacy.fragment.html',
    );

    expect(inAppPrivacy).toContain('Europe/Istanbul');

    for (const html of [canonicalHtml, godaddyFragment]) {
      expect(html).not.toMatch(/\{\{[^}]+\}\}/);
      expect(html).toContain('24 ');
      expect(html).toContain('2026');
      expect(html).toContain('Europe/Istanbul');
      expect(html).toContain('8000');
      expect(html).toContain('Anthropic');
      expect(html).toContain('Keychain / Keystore');
      expect(html).toContain('localStorage');
      expect(html).toContain('JSON, CSV');
      expect(html).toContain('Excel');
      expect(html).toContain('Obsidian (Markdown)');
      expect(html).toContain('60 ');
      expect(html).toContain('<a href="mailto:support@aderyth.com">support@aderyth.com</a>');
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/support"');
      expect(html).toContain('href="/delete-account"');
    }

    // Inner body markup of canonical wrap and GoDaddy #aderyth-privacy-page wrapper must match 1:1
    const wrapStart = canonicalHtml.indexOf('<div class="wrap">\n');
    const wrapEnd = canonicalHtml.lastIndexOf('\n</div>\n</body>');
    const fragStart = godaddyFragment.indexOf(
      '<div id="aderyth-privacy-page" class="aderyth-public-page">\n',
    );
    const fragEnd = godaddyFragment.lastIndexOf('\n</div>');

    expect(wrapStart).toBeGreaterThan(-1);
    expect(fragStart).toBeGreaterThan(-1);

    const canonicalInner = canonicalHtml.slice(wrapStart + '<div class="wrap">\n'.length, wrapEnd);
    const fragmentInner = godaddyFragment.slice(
      fragStart + '<div id="aderyth-privacy-page" class="aderyth-public-page">\n'.length,
      fragEnd,
    );
    expect(fragmentInner).toBe(canonicalInner);
  });
});
