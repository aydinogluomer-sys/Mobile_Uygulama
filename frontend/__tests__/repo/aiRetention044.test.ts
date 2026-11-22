import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const MIG_PATH = join(REPO, 'supabase', 'migrations', '044_ai_messages_and_retention.sql');
const RB_PATH = join(REPO, 'supabase', 'rollbacks', '044_ai_messages_and_retention.rollback.sql');
const TEST_PATH = join(REPO, 'supabase', 'tests', '12_ai_retention_044.sql');
const README_PATH = join(REPO, 'supabase', 'migrations', 'README.md');

const stripSqlLineComments = (s: string) => s.replace(/--[^\n]*/g, '');

export function check044Invariants(rawSql: string): string[] {
  const sql = stripSqlLineComments(rawSql);
  const issues: string[] = [];

  if (!/STATUS:\s*WRITTEN,\s*NOT APPLIED/.test(rawSql)) issues.push('missing-status');
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.purge_ai_retention\(\)/.test(sql)) {
    issues.push('missing-zero-arg-purge-fn');
  }
  if (!/SET\s+search_path\s+TO\s+'public'/.test(sql)) issues.push('missing-pinned-search-path');
  if (!/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.purge_ai_retention\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/.test(sql)) {
    issues.push('missing-purge-revoke');
  }
  if (!/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cleanup_old_ai_calls\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/.test(sql)) {
    issues.push('missing-cleanup-revoke');
  }
  if (!/\brole\s*=\s*'user'/.test(sql)) issues.push('missing-user-role-branch');
  if (!/\br\.status\s*=\s*'completed'/.test(sql)) issues.push('missing-completed-status-check');
  if (!/\br\.mode\s*=\s*'coach'/.test(sql)) issues.push('missing-coach-mode-check');
  if (!/left\(\s*r\.response\s*->>\s*'reply'\s*,\s*8000\s*\)\s*=\s*ai_messages\.content/.test(sql)) {
    issues.push('missing-exact-reply-match');
  }

  if (/\bGRANT\b/i.test(sql)) issues.push('contains-grant');
  if (/\bTO\s+(?:anon|public)\b/i.test(sql)) issues.push('opens-to-anon-or-public');
  if (/USING\s*\(\s*true\s*\)/i.test(sql)) issues.push('contains-tautology');
  if (/DELETE\s+FROM\s+public\.ai_(?:messages|conversations)\b/i.test(sql)) {
    issues.push('deletes-user-transcript');
  }

  return issues;
}

describe('F21 (EDG-19, DB1-22, DB2-20) — Migration 044 AI message integrity & retention static guard', () => {
  it('(+) 044 migration, rollback, SQL behaviour test, and README entry exist and satisfy every security invariant', () => {
    expect(existsSync(MIG_PATH)).toBe(true);
    expect(existsSync(RB_PATH)).toBe(true);
    expect(existsSync(TEST_PATH)).toBe(true);

    const mig = readFileSync(MIG_PATH, 'utf8');
    const readme = readFileSync(README_PATH, 'utf8');

    expect(readme).toContain('| 044 | `044_ai_messages_and_retention.sql` | **NOT APPLIED**');
    expect(check044Invariants(mig)).toEqual([]);
    expect(mig).toContain('CREATE INDEX IF NOT EXISTS ai_requests_user_created_idx ON public.ai_requests (user_id, created_at DESC);');
  });

  it('(-) check044Invariants catches weakened reply comparison, GRANTs, TO anon/public, USING (true), and transcript deletion', () => {
    const mig = readFileSync(MIG_PATH, 'utf8');

    const weakenedReply = mig.replace("left(r.response ->> 'reply', 8000) = ai_messages.content", 'r.response IS NOT NULL');
    expect(check044Invariants(weakenedReply)).toContain('missing-exact-reply-match');

    const withGrant = `${mig}\nGRANT EXECUTE ON FUNCTION public.purge_ai_retention() TO authenticated;`;
    expect(check044Invariants(withGrant)).toContain('contains-grant');

    const withAnon = `${mig}\nCREATE POLICY bad ON public.ai_messages FOR SELECT TO anon USING (true);`;
    expect(check044Invariants(withAnon)).toEqual(expect.arrayContaining(['opens-to-anon-or-public', 'contains-tautology']));

    const deletesChat = `${mig}\nDELETE FROM public.ai_messages WHERE created_at < now() - interval '400 days';`;
    expect(check044Invariants(deletesChat)).toContain('deletes-user-transcript');
  });
});
