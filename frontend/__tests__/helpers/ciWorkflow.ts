import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

export type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string | boolean;
  'continue-on-error'?: boolean | string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

export type WorkflowJob = {
  'runs-on'?: unknown;
  'timeout-minutes'?: number;
  needs?: string | string[];
  'continue-on-error'?: boolean | string;
  if?: string | boolean;
  steps?: WorkflowStep[];
  services?: Record<string, { image?: string }>;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown[]> };
  defaults?: { run?: { 'working-directory'?: string } };
  env?: Record<string, string>;
};

export type Workflow = {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string>;
  concurrency?: unknown;
  jobs: Record<string, WorkflowJob>;
};

const REPO_ROOT = join(__dirname, '..', '..', '..');

export function parseWorkflow(source: string): Workflow {
  const parsed = parse(source) as Partial<Workflow> | null;
  if (!parsed || typeof parsed !== 'object') {
    return { jobs: {} };
  }
  return {
    ...parsed,
    jobs: parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {},
  };
}

export function loadWorkflow(repoRelativePath: string): Workflow {
  const raw = readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8');
  return parseWorkflow(raw);
}

function isDisabledIf(cond: string | boolean | undefined): boolean {
  if (cond === false) return true;
  if (typeof cond === 'string') {
    const trimmed = cond.trim();
    if (/^(?:\$\{\{\s*)?false(?:\s*\}\})?$/i.test(trimmed)) return true;
  }
  return false;
}

function hasContinueOnError(val: boolean | string | undefined): boolean {
  if (val === true) return true;
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    return trimmed !== '' && trimmed !== 'false';
  }
  return false;
}

export function isActiveStep(step: WorkflowStep, job: WorkflowJob): boolean {
  if (isDisabledIf(job.if) || hasContinueOnError(job['continue-on-error'])) {
    return false;
  }
  if (isDisabledIf(step.if) || hasContinueOnError(step['continue-on-error'])) {
    return false;
  }
  return true;
}

export function runText(job: WorkflowJob): string {
  return (job.steps ?? [])
    .filter((step) => isActiveStep(step, job) && typeof step.run === 'string')
    .map((step) => (step.run ?? '').replace(/\\\r?\n\s*/g, ' '))
    .join('\n');
}

export function edgeFunctionEntrypoints(listing: readonly string[]): string[] {
  const found = new Set<string>();
  for (const raw of listing) {
    const norm = raw.trim().replace(/\\/g, '/');
    const m = /^supabase\/functions\/([^/]+)\/index\.ts$/.exec(norm);
    if (!m) continue;
    const fnDir = m[1];
    if (fnDir.startsWith('_')) continue;
    found.add(`supabase/functions/${fnDir}/index.ts`);
  }
  return [...found].sort();
}
