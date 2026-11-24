/**
 * F15 (DB2-11): static verification for migration 043 (`043_profile_time_zone.sql`),
 * its rollback script, SQL behaviour tests (`11_profile_time_zone_043.sql`),
 * CI second-pass guard, owner documentation, `database.types.ts`, and `LOG_TIMEZONE_ENABLED`.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LOG_TIMEZONE_ENABLED } from '../../lib/featureGates';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');

const stripSqlComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

function extractFunctionBlock(sql: string, fnName: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION (?:public|"public")\\.(?:${fnName}|"${fnName}")\\([^)]*\\)[\\s\\S]*?\\$(?:function)?\\$;`,
    'i',
  );
  const m = re.exec(sql);
  return m ? m[0] : '';
}

function extractDollarBody(sql: string, fnName: string): string {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION (?:public|"public")\\.(?:${fnName}|"${fnName}")\\(`).exec(sql);
  if (!head) throw new Error(`function ${fnName} not found`);
  const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(head.index));
  if (!open) throw new Error(`function ${fnName} missing dollar tag`);
  const start = head.index + open.index + open[0].length;
  const end = sql.indexOf(open[1], start);
  if (end < 0) throw new Error(`function ${fnName} body unclosed`);
  return sql.slice(start, end);
}

export function check043MigrationInvariants(rawSql: string): string[] {
  const issues: string[] = [];
  if (!/STATUS:\s*WRITTEN,\s*NOT APPLIED/.test(rawSql)) {
    issues.push('missing-status-marker');
  }
  const sql = stripSqlComments(rawSql);

  if (!/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS time_zone text;/i.test(sql)) {
    issues.push('missing-profiles-time-zone-column');
  }
  if (!/ADD CONSTRAINT profiles_time_zone_check CHECK\s*\(\s*time_zone IS NULL OR char_length\(time_zone\) BETWEEN 1 AND 64\s*\);/i.test(sql)) {
    issues.push('missing-profiles-time-zone-check');
  }

  // Pure helpers: local_date_in_zone & week_start_in_zone
  const localDate = extractFunctionBlock(sql, 'local_date_in_zone');
  if (!localDate || !/\(p_at AT TIME ZONE p_zone\)::date/i.test(localDate) || !/EXCEPTION WHEN invalid_parameter_value/i.test(localDate)) {
    issues.push('broken-local-date-in-zone');
  }
  const weekStart = extractFunctionBlock(sql, 'week_start_in_zone');
  if (!weekStart || !/date_trunc\(\s*'week'\s*,\s*public\.local_date_in_zone\(\s*p_zone\s*,\s*p_at\s*\)::timestamp\s*\)::date/i.test(weekStart)) {
    issues.push('broken-week-start-in-zone');
  }

  // RPC: set_profile_time_zone
  const setTz = extractFunctionBlock(sql, 'set_profile_time_zone');
  if (!setTz) {
    issues.push('missing-set-profile-time-zone');
  } else {
    if (!/\(SELECT auth\.uid\(\)\)/.test(setTz)) issues.push('set-tz-missing-auth-uid');
    if (!/pg_catalog\.pg_timezone_names/.test(setTz)) issues.push('set-tz-missing-pg-timezone-names');
    if (!/char_length\(v_zone\) NOT BETWEEN 1 AND 64/i.test(setTz)) issues.push('set-tz-missing-length-check');
    if (!/time_zone IS DISTINCT FROM v_zone/i.test(setTz)) issues.push('set-tz-missing-distinct-guard');
  }

  // Weekly XP writer & reader
  const trackWeekly = extractFunctionBlock(sql, 'track_weekly_xp');
  if (!trackWeekly || !/public\.week_start_in_zone\(\s*v_zone\s*\)/i.test(trackWeekly)) {
    issues.push('track-weekly-xp-not-local-week');
  }
  const leaderboard = extractFunctionBlock(sql, 'get_weekly_leaderboard');
  if (
    !leaderboard ||
    !/w\.week_start\s*=\s*public\.week_start_in_zone\(\s*p\.time_zone\s*\)/i.test(leaderboard) ||
    /CURRENT_DATE/i.test(leaderboard)
  ) {
    issues.push('leaderboard-not-local-week');
  }

  // 038 guard anchored to local_date_in_zone
  const logGuard = extractFunctionBlock(sql, 'fn_habit_log_guard');
  if (
    !logGuard ||
    !/select\s+p\.time_zone\s+into\s+v_zone\s+from\s+public\.profiles\s+p\s+where\s+p\.id\s*=\s*NEW\.user_id;/i.test(logGuard) ||
    !/v_today\s*:=\s*public\.local_date_in_zone\(\s*v_zone\s*\);/i.test(logGuard)
  ) {
    issues.push('habit-log-guard-not-local-day');
  }

  // All 3 SECURITY DEFINER functions pin search_path to 'public', 'pg_temp'
  for (const fn of ['set_profile_time_zone', 'track_weekly_xp', 'get_weekly_leaderboard']) {
    const blk = extractFunctionBlock(sql, fn);
    if (!blk.includes('SECURITY DEFINER')) issues.push(`not-security-definer:${fn}`);
    if (!blk.includes("SET search_path TO 'public', 'pg_temp'")) issues.push(`unpinned-search-path:${fn}`);
  }

  if (/\bGRANT\s+UPDATE\b/i.test(sql)) issues.push('disallowed-grant-update');
  if (/\bTO\s+(anon|public)\b/i.test(sql)) issues.push('opens-to-anon-or-public');

  return issues;
}

describe('F15 migration 043 — profile time_zone, local day window & local week', () => {
  const migRel = 'supabase/migrations/043_profile_time_zone.sql';
  const rbRel = 'supabase/rollbacks/043_profile_time_zone.rollback.sql';
  const sqlTestRel = 'supabase/tests/11_profile_time_zone_043.sql';

  it('043 forward migration exists and satisfies all schema, RPC, window, week and privilege invariants', () => {
    expect(existsSync(join(REPO, migRel))).toBe(true);
    const raw = read(migRel);
    expect(check043MigrationInvariants(raw)).toEqual([]);
  });

  it('043 rollback exists, checks confirmation 043 and applied state, and restores pre-043 function bodies byte-for-byte', () => {
    expect(existsSync(join(REPO, rbRel))).toBe(true);
    const rbRaw = read(rbRel);
    const rbCode = stripSqlComments(rbRaw);

    expect(rbRaw).toMatch(/STATUS:\s*WRITTEN,\s*NOT APPLIED/);
    expect(rbCode).toContain("current_setting('aderyth.rollback_confirm', true)");
    expect(rbCode).toContain("<> '043'");
    expect(rbCode).toContain('043 is not applied');

    const m038 = read('supabase/migrations/038_xp_streak_integrity.sql');
    const m040 = read('supabase/migrations/040_privilege_hygiene.sql');
    const live = read('supabase/live_schema.sql');

    expect(extractDollarBody(rbRaw, 'fn_habit_log_guard')).toBe(extractDollarBody(m038, 'fn_habit_log_guard'));
    expect(extractDollarBody(rbRaw, 'track_weekly_xp')).toBe(extractDollarBody(live, 'track_weekly_xp'));
    expect(extractDollarBody(rbRaw, 'get_weekly_leaderboard')).toBe(extractDollarBody(m040, 'get_weekly_leaderboard'));

    expect(rbCode).toContain('DROP FUNCTION IF EXISTS public.set_profile_time_zone(text);');
    expect(rbCode).toContain('DROP FUNCTION IF EXISTS public.week_start_in_zone(text, timestamptz);');
    expect(rbCode).toContain('DROP FUNCTION IF EXISTS public.local_date_in_zone(text, timestamptz);');
    expect(rbCode).toContain('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_time_zone_check;');
    expect(rbCode).toContain('ALTER TABLE public.profiles DROP COLUMN IF EXISTS time_zone;');
  });

  it('wires 043 into ci.yml second-pass check, READMEs, MIGRATION_MAPPING, SQL_FOR_OWNER, run.sh and database.types.ts', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('elif [ "${num}" = "043" ]; then');
    expect(ci).toContain('grep -q "043 is not applied" "$err"');

    const migReadme = read('supabase/migrations/README.md');
    expect(migReadme).toContain('| 043 | `043_profile_time_zone.sql` | **NOT APPLIED**');

    const rbReadme = read('supabase/rollbacks/README.md');
    expect(rbReadme).toContain('043_profile_time_zone.rollback.sql');
    expect(rbReadme).toContain('043 is not applied');

    const mapping = read('docs/implementation-v3/MIGRATION_MAPPING.md');
    const row042 = /\|\s*`042_[^`]+`\s*\|\s*`(\d{14})_/.exec(mapping);
    const row043 = /\|\s*`043_profile_time_zone\.sql`\s*\|\s*`(\d{14})_profile_time_zone\.sql`\s*\|/.exec(mapping);
    expect(row042).not.toBeNull();
    expect(row043).not.toBeNull();
    expect(Number(row043![1])).toBeGreaterThan(Number(row042![1]));

    const sqlForOwner = read('docs/implementation-v3/SQL_FOR_OWNER.md');
    expect(sqlForOwner).toContain('| 043 | `043_profile_time_zone.sql` |');
    expect(sqlForOwner).toContain('set_profile_time_zone');

    const runSh = read('supabase/tests/run.sh');
    const minMatch = /^MIN_RESULTS=(\d+)/m.exec(runSh);
    expect(minMatch).not.toBeNull();
    expect(Number(minMatch![1])).toBeGreaterThanOrEqual(193);

    expect(existsSync(join(REPO, sqlTestRel))).toBe(true);
    const sqlTest = read(sqlTestRel);
    const t11Names = [...sqlTest.matchAll(/'(T11[a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(new Set(t11Names).size).toBe(25);

    const dbTypes = read('frontend/lib/database.types.ts');
    expect(dbTypes).toMatch(/\/\/ @source migration:043\n\s+time_zone:\s*string \| null;/);
    expect(dbTypes).toMatch(/\/\/ @source migration:043\n\s{6}set_profile_time_zone:\s*\{/);
  });

  it('keeps LOG_TIMEZONE_ENABLED === false (033 is separate owner decision D07)', () => {
    expect(LOG_TIMEZONE_ENABLED).toBe(false);
  });

  it('(-) check043MigrationInvariants catches M1-M4 defects on synthetic mutations', () => {
    const base = read(migRel);
    // M1: remove v_today := public.local_date_in_zone(v_zone);
    expect(
      check043MigrationInvariants(base.replace('v_today := public.local_date_in_zone(v_zone);', '')),
    ).toContain('habit-log-guard-not-local-day');
    // M2: replace local_date_in_zone in week_start_in_zone with p_at::date
    expect(
      check043MigrationInvariants(
        base.replace('public.local_date_in_zone(p_zone, p_at)::timestamp', 'p_at::date::timestamp'),
      ),
    ).toContain('broken-week-start-in-zone');
    // M3: replace week_start_in_zone(p.time_zone) in leaderboard with CURRENT_DATE
    expect(
      check043MigrationInvariants(
        base.replace('public.week_start_in_zone(p.time_zone)', "date_trunc('week', CURRENT_DATE)::date"),
      ),
    ).toContain('leaderboard-not-local-week');
    // M4: remove pg_timezone_names validation
    expect(
      check043MigrationInvariants(base.replace('pg_catalog.pg_timezone_names', 'pg_catalog.pg_tables')),
    ).toContain('set-tz-missing-pg-timezone-names');
  });
});
