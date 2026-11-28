import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  COACH_ACTIONS_V2_ENABLED,
  PUBLIC_SITE_URLS,
  PUBLIC_SITE_URLS_LIVE,
} from '../../lib/featureGates';
import { stripComments, stripSqlComments } from '../helpers/sourceText';

const FRONTEND_ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(FRONTEND_ROOT, '..');

const RELEASE_CHECKLIST_PATH = join(REPO_ROOT, 'docs', 'store', 'RELEASE_CHECKLIST.md');
const AI_CONTRACT_PATH = join(
  REPO_ROOT,
  'docs',
  'implementation-v3',
  'AI_RETENTION_AND_PROVIDER_CONTRACT.md',
);
const MIGRATION_044_PATH = join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '044_ai_messages_and_retention.sql',
);
const FEATURE_GATES_PATH = join(FRONTEND_ROOT, 'lib', 'featureGates.ts');

export type SqlRetentionSpec = {
  aiCallsDeleteInterval: string | null;
  completedResponseScrubInterval: string | null;
  failedErrorScrubInterval: string | null;
  creditTransactionsDeleteInterval: string | null;
  settledRequestsDeleteInterval: string | null;
  allDayIntervals: string[];
  batchSize: string | null;
};

export type ContractRetentionSpec = {
  aiCallsRowInterval: string | null;
  payloadScrubRowInterval: string | null;
  ledgerPurgeRowInterval: string | null;
  allMatrixDayIntervals: string[];
  batchSize: string | null;
};

export function extractSql044RetentionSpec(rawSql: string): SqlRetentionSpec {
  const clean = stripSqlComments(rawSql).replace(/\s+/g, ' ');

  const aiCallsMatch =
    /DELETE\s+FROM\s+public\.ai_calls\s+WHERE\s+called_at\s*<\s*now\(\)\s*-\s*interval\s*'([^']+)'/i.exec(
      clean,
    );
  const completedScrubMatch =
    /FROM\s+public\.ai_requests\s+WHERE\s+status\s*=\s*'completed'\s+AND\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*'([^']+)'/i.exec(
      clean,
    );
  const failedScrubMatch =
    /FROM\s+public\.ai_requests\s+WHERE\s+status\s*=\s*'failed'\s+AND\s+error\s+IS\s+NOT\s+NULL\s+AND\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*'([^']+)'/i.exec(
      clean,
    );
  const creditTxDeleteMatch =
    /FROM\s+public\.credit_transactions\s+WHERE\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*'([^']+)'\s+AND\s+request_id\s+IS\s+NOT\s+NULL/i.exec(
      clean,
    );
  const requestsDeleteMatch =
    /FROM\s+public\.ai_requests\s+WHERE\s+status\s*<>\s*'in_progress'\s+AND\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*'([^']+)'/i.exec(
      clean,
    );
  const batchMatch = /\bv_batch\s+constant\s+integer\s*:=\s*(\d+)\s*;/i.exec(clean);

  const dayMatches = Array.from(clean.matchAll(/interval\s*'(\d+\s+days)'/gi), (m) =>
    m[1].replace(/\s+/g, ' ').toLowerCase(),
  );
  const allDayIntervals = Array.from(new Set(dayMatches)).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );

  return {
    aiCallsDeleteInterval: aiCallsMatch ? aiCallsMatch[1] : null,
    completedResponseScrubInterval: completedScrubMatch ? completedScrubMatch[1] : null,
    failedErrorScrubInterval: failedScrubMatch ? failedScrubMatch[1] : null,
    creditTransactionsDeleteInterval: creditTxDeleteMatch ? creditTxDeleteMatch[1] : null,
    settledRequestsDeleteInterval: requestsDeleteMatch ? requestsDeleteMatch[1] : null,
    allDayIntervals,
    batchSize: batchMatch ? batchMatch[1] : null,
  };
}

function extractRuleRowInterval(markdown: string, ruleId: string): string | null {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp(
    `^\\|\\s*\`?${escaped}\`?\\s*\\|\\s*\`(\\d+\\s+days)\`\\s*\\|\\s*\`interval\\s+'(\\d+\\s+days)'\`\\s*\\|`,
    'm',
  );
  const m = rowRe.exec(markdown);
  if (!m) return null;
  return m[1] === m[2] ? m[1] : `${m[1]} != ${m[2]}`;
}

export function extractContractRetentionSpec(markdown: string): ContractRetentionSpec {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const secStart = normalized.indexOf('## 3.');
  const secEnd = normalized.indexOf('## 4.', secStart >= 0 ? secStart : 0);
  const matrixSection =
    secStart >= 0
      ? normalized.slice(secStart, secEnd >= 0 ? secEnd : normalized.length)
      : normalized;

  const dayMatches = Array.from(matrixSection.matchAll(/\b(\d+\s+days)\b/g), (m) =>
    m[1].replace(/\s+/g, ' '),
  );
  const allMatrixDayIntervals = Array.from(new Set(dayMatches)).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );
  const batchMatch = /\bv_batch\s*=\s*(\d+)\b/.exec(matrixSection);

  return {
    aiCallsRowInterval: extractRuleRowInterval(matrixSection, '[RET-AI-CALLS]'),
    payloadScrubRowInterval: extractRuleRowInterval(matrixSection, '[RET-AI-PAYLOAD-SCRUB]'),
    ledgerPurgeRowInterval: extractRuleRowInterval(matrixSection, '[RET-AI-LEDGER-PURGE]'),
    allMatrixDayIntervals,
    batchSize: batchMatch ? batchMatch[1] : null,
  };
}

export function verifyRetentionContractParity(rawSql: string, contractMd: string): string[] {
  const sqlSpec = extractSql044RetentionSpec(rawSql);
  const docSpec = extractContractRetentionSpec(contractMd);
  const errors: string[] = [];

  if (!sqlSpec.aiCallsDeleteInterval) {
    errors.push('sql-missing-ai-calls-interval');
  } else if (docSpec.aiCallsRowInterval !== sqlSpec.aiCallsDeleteInterval) {
    errors.push(
      `ai_calls-drift: sql=${sqlSpec.aiCallsDeleteInterval} doc=${String(docSpec.aiCallsRowInterval)}`,
    );
  }

  if (
    !sqlSpec.completedResponseScrubInterval ||
    sqlSpec.completedResponseScrubInterval !== sqlSpec.failedErrorScrubInterval
  ) {
    errors.push('sql-scrub-interval-mismatch');
  } else if (docSpec.payloadScrubRowInterval !== sqlSpec.completedResponseScrubInterval) {
    errors.push(
      `payload-scrub-drift: sql=${sqlSpec.completedResponseScrubInterval} doc=${String(docSpec.payloadScrubRowInterval)}`,
    );
  }

  if (
    !sqlSpec.settledRequestsDeleteInterval ||
    sqlSpec.settledRequestsDeleteInterval !== sqlSpec.creditTransactionsDeleteInterval
  ) {
    errors.push('sql-ledger-purge-interval-mismatch');
  } else if (docSpec.ledgerPurgeRowInterval !== sqlSpec.settledRequestsDeleteInterval) {
    errors.push(
      `ledger-purge-drift: sql=${sqlSpec.settledRequestsDeleteInterval} doc=${String(docSpec.ledgerPurgeRowInterval)}`,
    );
  }

  if (sqlSpec.allDayIntervals.join(',') !== docSpec.allMatrixDayIntervals.join(',')) {
    errors.push(
      `interval-set-drift: sql=[${sqlSpec.allDayIntervals.join(',')}] doc=[${docSpec.allMatrixDayIntervals.join(',')}]`,
    );
  }

  if (!sqlSpec.batchSize || docSpec.batchSize !== sqlSpec.batchSize) {
    errors.push(`batch-size-drift: sql=${String(sqlSpec.batchSize)} doc=${String(docSpec.batchSize)}`);
  }

  return errors;
}

export function verifyReleaseChecklistGates(checklistMd: string): string[] {
  const normalized = checklistMd.replace(/\r\n?/g, '\n');
  const requiredTokens = [
    '## Public URL vs In-App Link Gate Separation (Y03 / Y13)',
    '- [ ] [GATE-URL-CONSOLE]',
    '- [ ] [GATE-URL-INAPP]',
    '- [ ] [GATE-AUTH-RECOVERY-DELETE]',
    '## Candidate Reproducibility & Canary Halt Chain (Y09)',
    'Candidate Reproducibility',
    'git_sha',
    'frontend/package-lock.json',
    'supabase/functions/deno.lock',
    'EAS Build ID',
    '.aab',
    '.ipa',
    'TestFlight',
    'xp_drift() > 0',
  ];
  return requiredTokens.filter((token) => !normalized.includes(token));
}

describe('F1 release checklist gates (Y03 / Y09 / Y13)', () => {
  it('(+) RELEASE_CHECKLIST.md keeps existing sections intact and defines URL, auth/delete, reproducibility, and canary halt gates', () => {
    expect(existsSync(RELEASE_CHECKLIST_PATH)).toBe(true);
    const checklist = readFileSync(RELEASE_CHECKLIST_PATH, 'utf8').replace(/\r\n?/g, '\n');

    expect(checklist).toContain('## Repository / configuration');
    expect(checklist).toContain('## External / accounts');
    expect(checklist).toContain('## Before Step 11C submission');
    expect(verifyReleaseChecklistGates(checklist)).toEqual([]);

    for (const url of Object.values(PUBLIC_SITE_URLS)) {
      expect(checklist).toContain(url);
    }
    expect(checklist).toContain('HTTP 200');
    expect(checklist).toContain('PUBLIC_SITE_URLS_LIVE = true');
    expect(checklist).toContain('OWNER_ROLLOUT_QUICKSTART.md');
    expect(checklist).toContain('delete-account');
  });

  it('(+) PUBLIC_SITE_URLS_LIVE and COACH_ACTIONS_V2_ENABLED are explicit boolean literals in repository code', () => {
    expect(typeof PUBLIC_SITE_URLS_LIVE).toBe('boolean');
    expect(typeof COACH_ACTIONS_V2_ENABLED).toBe('boolean');

    const gatesCode = stripComments(readFileSync(FEATURE_GATES_PATH, 'utf8'));
    expect(gatesCode).toContain(`export const PUBLIC_SITE_URLS_LIVE = ${String(PUBLIC_SITE_URLS_LIVE)};`);
    expect(gatesCode).toContain(
      `export const COACH_ACTIONS_V2_ENABLED = ${String(COACH_ACTIONS_V2_ENABLED)};`,
    );
  });
});

describe('F1 AI retention & provider contract (Y07) with SQL 044 drift guard', () => {
  it('(+) AI_RETENTION_AND_PROVIDER_CONTRACT.md documents 3-layer evidence, AI-01 billing boundary, local fallbacks, cascade vs ledger, and journal privacy', () => {
    expect(existsSync(AI_CONTRACT_PATH)).toBe(true);
    const contract = readFileSync(AI_CONTRACT_PATH, 'utf8').replace(/\r\n?/g, '\n');

    for (const required of [
      'supabase/functions/DEPLOYMENT.json',
      'supabase/config.toml',
      'tools/verify-edge-deployment.mjs',
      'COACH_ACTIONS_V2_ENABLED = false',
      'ai_requests',
      'ai_calls',
      'credit_transactions',
      ':refund',
      'taskDecomposition.ts',
      'smallStart.ts',
      '17 3 * * *',
      'ai_conversations',
      'ai_messages',
      'ai_conversation_actions',
      'ON DELETE CASCADE',
      'journalInsightContext.ts',
    ]) {
      expect(contract).toContain(required);
    }
  });

  it('(+) 7 days / 30 days / 400 days and batch 5000 in AI_RETENTION_AND_PROVIDER_CONTRACT.md match 044_ai_messages_and_retention.sql 1:1', () => {
    expect(existsSync(MIGRATION_044_PATH)).toBe(true);
    const rawSql = readFileSync(MIGRATION_044_PATH, 'utf8');
    const contract = readFileSync(AI_CONTRACT_PATH, 'utf8');

    const sqlSpec = extractSql044RetentionSpec(rawSql);
    expect(sqlSpec).toEqual({
      aiCallsDeleteInterval: '7 days',
      completedResponseScrubInterval: '30 days',
      failedErrorScrubInterval: '30 days',
      creditTransactionsDeleteInterval: '400 days',
      settledRequestsDeleteInterval: '400 days',
      allDayIntervals: ['7 days', '30 days', '400 days'],
      batchSize: '5000',
    });

    expect(verifyRetentionContractParity(rawSql, contract)).toEqual([]);
  });

  it('(-) drift guard catches SQL interval edits, contract table edits, and missing release gates on synthetic inputs', () => {
    const rawSql = readFileSync(MIGRATION_044_PATH, 'utf8');
    const contract = readFileSync(AI_CONTRACT_PATH, 'utf8');
    const checklist = readFileSync(RELEASE_CHECKLIST_PATH, 'utf8');

    const driftedSql = rawSql.replace("interval '7 days'", "interval '14 days'");
    expect(verifyRetentionContractParity(driftedSql, contract)).toEqual(
      expect.arrayContaining([
        'ai_calls-drift: sql=14 days doc=7 days',
        'interval-set-drift: sql=[14 days,30 days,400 days] doc=[7 days,30 days,400 days]',
      ]),
    );

    const driftedDoc = contract
      .replace('`30 days` | `interval \'30 days\'`', '`60 days` | `interval \'60 days\'`')
      .replace(/30 days/g, '60 days');
    expect(verifyRetentionContractParity(rawSql, driftedDoc)).toEqual(
      expect.arrayContaining(['payload-scrub-drift: sql=30 days doc=60 days']),
    );

    const drifted400 = contract
      .replace('`400 days` | `interval \'400 days\'`', '`365 days` | `interval \'365 days\'`')
      .replace(/400 days/g, '365 days');
    expect(verifyRetentionContractParity(rawSql, drifted400)).toEqual(
      expect.arrayContaining(['ledger-purge-drift: sql=400 days doc=365 days']),
    );

    const missingGateChecklist = checklist.replace('[GATE-URL-INAPP]', '[REMOVED]');
    expect(verifyReleaseChecklistGates(missingGateChecklist)).toContain('- [ ] [GATE-URL-INAPP]');
  });
});
