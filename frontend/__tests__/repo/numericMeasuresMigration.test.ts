/**
 * F14 static contract for migration 042 (`numeric(12,2)` measurable columns,
 * private `habit_xp_value(uuid, text, numeric)`, atomic `spend_willpower` RPC)
 * and its lossy-guarded rollback.
 * (DOM-03, REP-09, STO-15)
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');

const MIG_REL = 'supabase/migrations/042_numeric_measures_and_willpower.sql';
const RB_REL = 'supabase/rollbacks/042_numeric_measures_and_willpower.rollback.sql';

export function checkMigration042Contract(rawSql: string): string[] {
  const problems: string[] = [];
  if (!/STATUS:\s*WRITTEN,\s*NOT APPLIED/.test(rawSql.split('\n').slice(0, 8).join('\n'))) {
    problems.push('missing_status_header');
  }
  const code = stripSqlComments(rawSql);
  if (!/ALTER\s+TABLE\s+public\.habit_logs\s+ALTER\s+COLUMN\s+"value"\s+TYPE\s+numeric\(12,\s*2\)/i.test(code)) {
    problems.push('missing_habit_logs_value_numeric');
  }
  if (!/ALTER\s+TABLE\s+public\.habits\s+ALTER\s+COLUMN\s+daily_goal\s+TYPE\s+numeric\(12,\s*2\)/i.test(code)) {
    problems.push('missing_habits_daily_goal_numeric');
  }
  if (!/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.habit_xp_value\(uuid,\s*text,\s*integer\)\s*;/i.test(code)) {
    problems.push('missing_drop_integer_scorer');
  }
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.habit_xp_value\(p_habit_id\s+uuid,\s*p_state\s+text,\s*p_value\s+numeric\)/i.test(code)) {
    problems.push('missing_numeric_scorer');
  }
  // Ceiling equality invariant: p_value <= h.daily_goal must earn full base XP (not strict <)
  if (!/if\s+p_value\s*<=\s*h\.daily_goal\s+then\s+return\s+v_base_xp\s*;/i.test(code)) {
    problems.push('broken_ceiling_goal_equality');
  }
  if (!/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.habit_xp_value\(uuid,\s*text,\s*numeric\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i.test(code)) {
    problems.push('missing_scorer_revoke');
  }
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.spend_willpower\(/i.test(code)) {
    problems.push('missing_spend_willpower');
  }
  // Tenant filter & atomic budget predicate invariants on willpower_state UPDATE
  if (!/WHERE\s+w\.user_id\s*=\s*v_uid/i.test(code)) {
    problems.push('missing_spend_user_filter');
  }
  if (!/AND\s*\(\s*v_amount\s*<=\s*0\s+OR\s+p_clamp\s+OR\s+w\.used\s*\+\s*v_amount\s*<=\s*w\.daily_budget\s*\)/i.test(code)) {
    problems.push('missing_spend_budget_predicate');
  }
  if (/\bSECURITY\s+DEFINER\b/i.test(code)) {
    problems.push('forbidden_security_definer');
  }
  if (/\bTO\s+(?:anon|public)\b/i.test(code)) {
    problems.push('forbidden_anon_or_public_grant');
  }
  const grantRe = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.spend_willpower\(date,\s*numeric,\s*integer,\s*boolean\)\s+TO\s+authenticated\s*;/i;
  const revokeRe = /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.spend_willpower\(date,\s*numeric,\s*integer,\s*boolean\)\s+FROM\s+PUBLIC,\s*anon\s*;/i;
  const grantMatch = grantRe.exec(code);
  const revokeMatch = revokeRe.exec(code);
  if (!grantMatch || !revokeMatch || revokeMatch.index >= grantMatch.index) {
    problems.push('missing_or_unordered_spend_acl');
  }
  return problems;
}

describe('F14 migration 042 — numeric(12,2) columns, scorer swap, and spend_willpower RPC', () => {
  it('042 migration file exists and satisfies every schema, security, and predicate invariant', () => {
    expect(existsSync(join(REPO, MIG_REL))).toBe(true);
    const sql = read(MIG_REL);
    expect(checkMigration042Contract(sql)).toEqual([]);
  });

  it('042 rollback exists, uses aderyth.rollback_confirm = 042, and restores live habit_xp_value byte-for-byte', () => {
    expect(existsSync(join(REPO, RB_REL))).toBe(true);
    const rb = read(RB_REL);
    const live = read('supabase/live_schema.sql');
    expect(rb).toContain("current_setting('aderyth.rollback_confirm', true)");
    expect(rb).toContain("<> '042'");
    expect(rb).toContain('END $guard$;');
    expect(rb).toMatch(/ALTER\s+TABLE\s+public\.habit_logs\s+ALTER\s+COLUMN\s+"value"\s+TYPE\s+integer\s+USING\s+round\("value"\)::integer;/);
    expect(rb).toMatch(/ALTER\s+TABLE\s+public\.habits\s+ALTER\s+COLUMN\s+daily_goal\s+TYPE\s+integer\s+USING\s+round\(daily_goal\)::integer;/);
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.habit_xp_value(uuid, text, numeric);');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.spend_willpower(date, numeric, integer, boolean);');

    const extractBody = (src: string): string => {
      const head = /CREATE OR REPLACE FUNCTION (?:"public"|public)\.(?:"habit_xp_value"|habit_xp_value)\(/.exec(src);
      if (!head) throw new Error('habit_xp_value missing');
      const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(head.index))!;
      const start = head.index + open.index + open[0].length;
      const end = src.indexOf(open[1], start);
      return src.slice(start, end);
    };
    expect(extractBody(rb)).toBe(extractBody(live));
  });

  it('README, MIGRATION_MAPPING, and SQL_FOR_OWNER document 042 and its apply-before-client order', () => {
    const migReadme = read('supabase/migrations/README.md');
    const rbReadme = read('supabase/rollbacks/README.md');
    const mapping = read('docs/implementation-v3/MIGRATION_MAPPING.md');
    const owner = read('docs/implementation-v3/SQL_FOR_OWNER.md');

    expect(migReadme).toContain('`042_numeric_measures_and_willpower.sql` | **NOT APPLIED**');
    expect(rbReadme).toContain('`042_numeric_measures_and_willpower.rollback.sql`');
    expect(mapping).toMatch(/`042_numeric_measures_and_willpower\.sql`\s*\|\s*`20261010001500_numeric_measures_and_willpower\.sql`/);
    const ts041 = Number(/`041_[^`]+`\s*\|\s*`(\d{14})_/.exec(mapping)?.[1] ?? 0);
    const ts042 = Number(/`042_[^`]+`\s*\|\s*`(\d{14})_/.exec(mapping)?.[1] ?? 0);
    expect(ts042).toBeGreaterThan(ts041);
    expect(owner).toContain('`042_numeric_measures_and_willpower.sql`');
    expect(owner).toContain('`supabase/rollbacks/042_numeric_measures_and_willpower.rollback.sql`');
  });

  it('negative control: checkMigration042Contract catches removed budget check, user filter, ceiling <=, or SECURITY DEFINER', () => {
    expect(existsSync(join(REPO, MIG_REL))).toBe(true);
    const valid = read(MIG_REL);
    expect(
      checkMigration042Contract(
        valid.replace('AND (v_amount <= 0 OR p_clamp OR w.used + v_amount <= w.daily_budget)', ''),
      ),
    ).toContain('missing_spend_budget_predicate');
    expect(checkMigration042Contract(valid.replace('WHERE w.user_id = v_uid', 'WHERE true'))).toContain(
      'missing_spend_user_filter',
    );
    expect(
      checkMigration042Contract(valid.replace('if p_value <= h.daily_goal then', 'if p_value < h.daily_goal then')),
    ).toContain('broken_ceiling_goal_equality');
    expect(checkMigration042Contract(valid.replace('SECURITY INVOKER', 'SECURITY DEFINER'))).toContain(
      'forbidden_security_definer',
    );
  });
});
