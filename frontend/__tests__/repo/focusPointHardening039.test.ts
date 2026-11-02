/**
 * F07 — migration 039 and its call sites, statically (implementation.md F07, section 5,
 * "focusPointHardening039.test.ts"). The behaviour runs on Postgres 17 in CI
 * (supabase/tests/07_focus_point_039.sql); this file pins the shape in one place.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');
/** SQL line comments removed (the comment stripper migrationRlsGuard uses). */
const sqlCode = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const MIG = 'supabase/migrations/039_focus_point_hardening.sql';
const RB = 'supabase/rollbacks/039_focus_point_hardening.rollback.sql';

/** Every .ts / .tsx source under `dir` (no node_modules, no tests). */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('039 is written, marked and listed, and has its rollback', () => {
  it('(+) the migration exists, its header says STATUS: WRITTEN, NOT APPLIED, the README lists it NOT APPLIED', () => {
    expect(existsSync(join(REPO, MIG))).toBe(true);
    expect(read(MIG)).toContain('STATUS: WRITTEN, NOT APPLIED');
    expect(read('supabase/migrations/README.md')).toContain('`039_focus_point_hardening.sql` | **NOT APPLIED**');
  });

  it('(+) the rollback lives under supabase/rollbacks/, carries the marker and drops the index', () => {
    expect(existsSync(join(REPO, RB))).toBe(true);
    expect(read(RB)).toContain('STATUS: WRITTEN, NOT APPLIED');
    expect(read(RB)).toContain('DROP INDEX IF EXISTS public.ai_messages_user_request_uniq;');
  });
});

describe('what 039 does', () => {
  const mig = read(MIG);

  it('(+) the unique index on user rows with a request id', () => {
    expect(mig).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ai_messages_user_request_uniq');
    expect(mig).toContain("WHERE role = 'user' AND request_id IS NOT NULL");
  });

  it('(+) the REVOKE of the legacy spend function', () => {
    expect(mig).toContain('REVOKE EXECUTE ON FUNCTION public.spend_focus_points(integer, text) FROM PUBLIC, anon, authenticated;');
  });

  it('(+) the refund goes only through public.refund_focus_points(, and the heal keeps t.created_at >= a.created_at', () => {
    expect(mig).toContain('public.refund_focus_points(');
    expect(mig).toContain('t.created_at >= a.created_at');
  });

  it('(-) no GRANT, CREATE OR REPLACE FUNCTION, SECURITY DEFINER, UPDATE public.user_subscriptions, habit_logs, profiles, xp', () => {
    const code = sqlCode(mig);
    for (const word of [/\bGRANT\b/i, /CREATE OR REPLACE FUNCTION/i, /SECURITY DEFINER/i, /UPDATE public\.user_subscriptions/i, /\bhabit_logs\b/i, /\bprofiles\b/i, /\bxp\b/i]) {
      expect({ word: String(word), found: word.test(code) }).toEqual({ word: String(word), found: false });
    }
  });
});

describe('the legacy spend function has no caller', () => {
  it("(-) no source under frontend/ or supabase/functions/ calls rpc('spend_focus_points') (stripComments)", () => {
    const files = [...sources(join(REPO, 'frontend')), ...sources(join(REPO, 'supabase', 'functions'))];
    expect(files.length).toBeGreaterThan(100);
    const callers = files.filter((f) => /rpc\(\s*['"]spend_focus_points['"]/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(callers).toEqual([]);
  });

  it('(-) database.types.ts has no spend_focus_points: key', () => {
    expect(read('frontend/lib/database.types.ts')).not.toMatch(/\bspend_focus_points:/);
  });
});

describe('the four call sites wait out REQUEST_IN_PROGRESS before answered()', () => {
  const coach = stripComments(read('frontend/app/screens/ai-coach.tsx'));
  const insights = stripComments(read('frontend/app/screens/journal-insights.tsx'));
  const routine = stripComments(read('frontend/store/routineStore.ts'));
  const slice = (src: string, from: string, to: string) => {
    const a = src.indexOf(from);
    return src.slice(a, src.indexOf(to, a + from.length));
  };
  const sites: [string, string, string][] = [
    ['ai-coach send', slice(coach, 'async function send(', 'async function summarize('), 'coachAttempt.answered();'],
    ['ai-coach summarize', slice(coach, 'async function summarize(', 'async function saveSummaryToJournal('), 'summaryAttempt.answered();'],
    ['journal-insights', slice(insights, 'async function generate(', 'return ('), 'insightAttempt.answered();'],
    ['routineStore', slice(routine, 'generateRoutine: async', 'stageCoachProposal:'), 'routineAttempt.answered();'],
  ];

  it.each(sites)('(+) %s', (_name, body, answered) => {
    expect(body).toContain('retryWhileInProgress(');
    const still = body.indexOf('stillInProgress');
    expect(still).toBeGreaterThan(-1);
    expect(still).toBeLessThan(body.indexOf(answered));
  });
});
