import { execFileSync } from 'child_process';
import { join } from 'path';
import {
  edgeFunctionEntrypoints,
  isActiveStep,
  loadWorkflow,
  parseWorkflow,
  runText,
  type Workflow,
} from '../helpers/ciWorkflow';
import { readSource } from '../helpers/sourceText';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SHA40_USES_RE = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

export function checkedEdgeEntrypoints(wf: Workflow, denoCheckCommand: string): string[] {
  const edgeJob = wf.jobs['edge-deno-verify'];
  if (!edgeJob) return [];
  const activeRun = runText(edgeJob);
  const covered = new Set<string>();

  if (activeRun.includes('deno task --config supabase/functions/deno.json check')) {
    for (const tok of denoCheckCommand.split(/\s+/)) {
      if (/^[^_][^/]*\/index\.ts$/.test(tok)) {
        covered.add(`supabase/functions/${tok}`);
      }
    }
  }
  for (const m of activeRun.matchAll(/\bsupabase\/functions\/([^/\s]+)\/index\.ts\b/g)) {
    if (!m[1].startsWith('_')) {
      covered.add(`supabase/functions/${m[1]}/index.ts`);
    }
  }
  return [...covered].sort();
}

export function missingEdgeFunctions(
  wf: Workflow,
  denoCheckCommand: string,
  repoListing: readonly string[],
): string[] {
  const expected = edgeFunctionEntrypoints(repoListing);
  const covered = new Set(checkedEdgeEntrypoints(wf, denoCheckCommand));
  return expected.filter((entry) => !covered.has(entry));
}

describe('F48 C5/C6 (TST-06, TST-10) — Parsed CI Workflow Structure & TZ Matrix Guard', () => {
  const wf = loadWorkflow('.github/workflows/ci.yml');
  const denoCfg = JSON.parse(readSource('..', 'supabase', 'functions', 'deno.json')) as {
    tasks?: { check?: string };
  };
  const denoCheckTask = denoCfg.tasks?.check ?? '';
  const gitListing = execFileSync('git', ['ls-files', 'supabase/functions'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);

  it('(+) verify job executes active steps in strict order: typecheck -> lint -> jest (--coverage + floor) -> structural -> exports', () => {
    const verify = wf.jobs.verify;
    expect(verify).toBeDefined();
    const steps = verify.steps ?? [];

    const findIdx = (pred: (run: string) => boolean): number =>
      steps.findIndex((s) => typeof s.run === 'string' && isActiveStep(s, verify) && pred(s.run));

    const typecheckIdx = findIdx((r) => r.includes('npm run typecheck:ci'));
    const lintIdx = findIdx((r) => r.includes('npm run lint:ci'));
    const jestIdx = findIdx((r) => r.includes('npx jest --ci') && r.includes('--coverage'));
    const floorIdx = findIdx((r) => r.includes('--listTests') && r.includes('-ge '));
    const structuralIdx = findIdx((r) => r.includes('node run-tests.js'));
    const exportAndroidIdx = findIdx((r) => r.includes('npx expo export --platform android'));
    const exportIosIdx = findIdx((r) => r.includes('npx expo export --platform ios'));
    const exportWebIdx = findIdx((r) => r.includes('npx expo export --platform web'));

    expect(typecheckIdx).toBeGreaterThanOrEqual(0);
    expect(lintIdx).toBeGreaterThan(typecheckIdx);
    expect(jestIdx).toBeGreaterThan(lintIdx);
    expect(floorIdx).toBeGreaterThan(jestIdx);
    expect(structuralIdx).toBeGreaterThan(jestIdx);
    expect(exportAndroidIdx).toBeGreaterThan(jestIdx);
    expect(exportIosIdx).toBeGreaterThan(jestIdx);
    expect(exportWebIdx).toBeGreaterThan(jestIdx);
  });

  it('(+) edge-deno-verify active check covers every supabase/functions/*/index.ts on disk', () => {
    const entrypoints = edgeFunctionEntrypoints(gitListing);
    expect(entrypoints.length).toBeGreaterThanOrEqual(6);
    expect(missingEdgeFunctions(wf, denoCheckTask, gitListing)).toEqual([]);
  });

  it('(+) db-migrations-verify runs against postgres:17 service container', () => {
    const dbJob = wf.jobs['db-migrations-verify'];
    expect(dbJob).toBeDefined();
    expect(dbJob.services?.postgres?.image).toBe('postgres:17');
  });

  it('(+) tz-matrix job runs DST zones [America/New_York, Pacific/Auckland, UTC] with fail-fast: false', () => {
    const tzJob = wf.jobs['tz-matrix'];
    expect(tzJob).toBeDefined();
    expect(tzJob.strategy?.['fail-fast']).toBe(false);
    expect(tzJob.strategy?.matrix?.zone).toEqual([
      'America/New_York',
      'Pacific/Auckland',
      'UTC',
    ]);
    expect(runText(tzJob)).toContain('node scripts/run-tz-matrix.js ${{ matrix.zone }}');
  });

  it('(+) enforces read-only contents permission, <= 30m timeout-minutes on every job, and 40-char SHA on every uses:', () => {
    expect(wf.permissions?.contents).toBe('read');
    const jobNames = Object.keys(wf.jobs);
    expect(jobNames.length).toBeGreaterThanOrEqual(4);

    for (const [name, job] of Object.entries(wf.jobs)) {
      expect({
        name,
        hasTimeout: typeof job['timeout-minutes'] === 'number',
        withinCeiling: (job['timeout-minutes'] ?? 999) <= 30,
      }).toEqual({
        name,
        hasTimeout: true,
        withinCeiling: true,
      });

      for (const step of job.steps ?? []) {
        if (step.uses !== undefined) {
          expect({ job: name, uses: step.uses, pinned: SHA40_USES_RE.test(step.uses) }).toEqual({
            job: name,
            uses: step.uses,
            pinned: true,
          });
        }
      }
    }
  });

  it('(-) commented-out job is absent from parsed workflow (catches substring-only false positives)', () => {
    const commented = parseWorkflow(
      [
        'name: CI',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: npm test',
        '  # edge-deno-verify:',
        '  #   runs-on: ubuntu-latest',
        '  #   steps:',
        '  #     - run: deno task --config supabase/functions/deno.json check',
      ].join('\n'),
    );
    expect(commented.jobs['edge-deno-verify']).toBeUndefined();
    expect(missingEdgeFunctions(commented, denoCheckTask, gitListing)).toEqual(
      edgeFunctionEntrypoints(gitListing),
    );
  });

  it('(-) steps or jobs with if: false or continue-on-error: true report isActiveStep = false', () => {
    const syn = parseWorkflow(
      [
        'jobs:',
        '  j1:',
        '    steps:',
        '      - name: normal',
        '        run: npm run lint:ci',
        '      - name: skipped-bool',
        '        if: false',
        '        run: npm run typecheck:ci',
        '      - name: skipped-expr',
        "        if: '${{ false }}'",
        '        run: npx jest --ci',
        '      - name: soft-fail',
        '        continue-on-error: true',
        '        run: npx expo-doctor',
        '  j2:',
        '    continue-on-error: true',
        '    steps:',
        '      - name: job-soft',
        '        run: npm test',
      ].join('\n'),
    );

    const j1Steps = syn.jobs.j1.steps ?? [];
    expect(isActiveStep(j1Steps[0], syn.jobs.j1)).toBe(true);
    expect(isActiveStep(j1Steps[1], syn.jobs.j1)).toBe(false);
    expect(isActiveStep(j1Steps[2], syn.jobs.j1)).toBe(false);
    expect(isActiveStep(j1Steps[3], syn.jobs.j1)).toBe(false);
    expect(runText(syn.jobs.j1)).toBe('npm run lint:ci');

    const j2Steps = syn.jobs.j2.steps ?? [];
    expect(isActiveStep(j2Steps[0], syn.jobs.j2)).toBe(false);
  });

  it('(-) flags an unlisted new supabase/functions/yeni/index.ts entrypoint immediately while ignoring _* shared dirs', () => {
    const withNewFn = [
      ...gitListing,
      'supabase/functions/_shared/index.ts',
      'supabase/functions/yeni/index.ts',
    ];
    expect(missingEdgeFunctions(wf, denoCheckTask, withNewFn)).toEqual([
      'supabase/functions/yeni/index.ts',
    ]);
  });
});
