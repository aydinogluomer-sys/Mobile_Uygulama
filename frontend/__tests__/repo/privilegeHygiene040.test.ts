/**
 * F09 — migration 040 (privilege, search_path and sensitive-column hygiene + F07-R3
 * mode-aware stale reconciliation), 037 read-only fix (DB1-20), 040 rollback parity,
 * expected_failures.txt closure, and owner documentation gates.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const MIG_040 = 'supabase/migrations/040_privilege_hygiene.sql';
const RB_040 = 'supabase/rollbacks/040_privilege_hygiene.rollback.sql';
const MIG_037 = 'supabase/migrations/037_today_bootstrap_rpc.sql';
const TEST_08 = 'supabase/tests/08_privilege_hygiene_040.sql';

const F13_ALL_17 = [
  'ai_calls',
  'boss_contributors',
  'calendars',
  'challenges',
  'event_templates',
  'global_bosses',
  'habit_templates',
  'pet_stages',
  'quests',
  'shop_items',
  'skills',
  'user_challenges',
  'user_gamification',
  'user_inventory',
  'user_pets',
  'user_quests',
  'user_skills',
] as const;

const F13_MOVED_6 = [
  'boss_contributors',
  'user_challenges',
  'user_inventory',
  'user_pets',
  'user_quests',
  'user_skills',
] as const;

/** Extracts dollar-quoted prosrc body of `CREATE OR REPLACE FUNCTION public.<name>(`. */
function functionBody(sql: string, name: string): string {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION (?:"public"|public)\\.(?:"${name}"|${name})\\(`).exec(sql);
  if (!head) throw new Error(`function ${name} is not defined`);
  const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(head.index));
  if (!open) throw new Error(`function ${name} has no dollar-quoted body`);
  const start = head.index + open.index + open[0].length;
  const end = sql.indexOf(open[1], start);
  if (end < 0) throw new Error(`function ${name} body is not closed`);
  return sql.slice(start, end);
}

/** Splits top-level SQL argument lists while honouring quotes and parentheses. */
function splitSqlArgs(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (list[i + 1] === "'") { cur += "'"; i++; } else inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parses every unpinned SECURITY DEFINER function signature `public.name(argtypes)` from `live_schema.sql`. */
function unpinnedLiveSignatures(dump: string): string[] {
  const out: string[] = [];
  const re = /CREATE OR REPLACE FUNCTION "public"\."([A-Za-z0-9_]+)"\(([\s\S]*?)\) RETURNS [\s\S]*?\bAS \$[A-Za-z_]*\$/g;
  for (const m of dump.matchAll(re)) {
    const header = m[0];
    if (!/SECURITY DEFINER/.test(header) || /SET "search_path"/.test(header)) continue;
    const types = splitSqlArgs(m[2]).map((a) =>
      a
        .replace(/\s+DEFAULT\s+[\s\S]*$/i, '')
        .replace(/^"[^"]+"\s+/, '')
        .replace(/"/g, '')
        .trim(),
    );
    out.push(`public.${m[1]}(${types.join(', ')})`);
  }
  return out.sort();
}

/** Pure structural validator for 040_privilege_hygiene.sql (empty = valid). */
export function migration040Problems(raw: string, expected20: string[], expected10Tables: string[]): string[] {
  const problems: string[] = [];
  const code = stripComments(raw);
  const trimmed = code.trim();

  if (!/STATUS: WRITTEN, NOT APPLIED/.test(raw)) problems.push('missing-status-marker');
  if (!trimmed.startsWith('BEGIN;') || !trimmed.endsWith('COMMIT;')) problems.push('missing-transaction');
  if (/\bTO\s+(anon|public)\b/i.test(code)) problems.push('opens-to-anon-or-public');
  if (/USING\s*\(\s*true\s*\)|WITH\s+CHECK\s*\(\s*true\s*\)/i.test(code)) problems.push('tautology-policy');
  if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(code)) problems.push('disables-rls');
  if (/\bDROP\s+TABLE\b/i.test(code)) problems.push('drops-table');
  if (/SET\s+search_path\s+TO\s+public\b/i.test(code)) problems.push('unquoted-search-path');

  // Section 1: pinned 20 list
  const pinSection = /FOREACH sig IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP\s+IF to_regprocedure\(sig\) IS NOT NULL THEN\s+EXECUTE format\('ALTER FUNCTION %s SET search_path TO ''public'', ''pg_temp'''/.exec(code);
  if (!pinSection) {
    problems.push('missing-pin-loop');
  } else {
    const pinned = [...pinSection[1].matchAll(/'(public\.[^']+)'/g)].map((m) => m[1]).sort();
    if (JSON.stringify(pinned) !== JSON.stringify(expected20)) problems.push('pin-list-mismatch');
  }

  // Section 4: profiles narrow INSERT + username CHECK
  if (!code.includes('GRANT INSERT (id, email, username) ON public.profiles TO authenticated;')) {
    problems.push('missing-profiles-column-insert');
  }
  if (!code.includes('ADD CONSTRAINT profiles_username_shape CHECK')) {
    problems.push('missing-username-check');
  }

  // Section 5: 028..031 10 tables
  for (const t of expected10Tables) {
    const pair = `REVOKE ALL ON public.${t} FROM anon, PUBLIC;\nGRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO authenticated;`;
    if (!code.includes(pair)) problems.push(`missing-028-031-grant:${t}`);
  }

  // Section 6: OAuth token tables (access_token never granted)
  if (!code.includes('REVOKE ALL ON public.google_calendar_integrations FROM anon, PUBLIC, authenticated;')) {
    problems.push('missing-google-revoke');
  }
  if (!code.includes('REVOKE ALL ON public.spotify_accounts FROM anon, PUBLIC, authenticated;')) {
    problems.push('missing-spotify-revoke');
  }
  const notionGrant = /GRANT SELECT \(([^)]+)\) ON public\.notion_integrations TO authenticated;/.exec(code);
  if (!notionGrant) {
    problems.push('missing-notion-column-grant');
  } else if (/\baccess_token\b|\brefresh_token\b/.test(notionGrant[1])) {
    problems.push('notion-secret-column-exposed');
  }

  // Section 7 + F07-R3: FOR UPDATE locks and mode-aware ai_request_reconcile_stale
  for (const fn of ['add_xp', 'get_or_init_subscription', 'get_or_init_subscription_for']) {
    if (!/\bFOR\s+UPDATE\b/i.test(functionBody(raw, fn))) problems.push(`missing-for-update:${fn}`);
  }
  if (!code.includes('CREATE OR REPLACE FUNCTION public.ai_request_reconcile_stale(')) {
    problems.push('missing-reconcile-stale');
  } else {
    const body = functionBody(raw, 'ai_request_reconcile_stale');
    if (!body.includes("mode = 'routine'")
        || !body.includes('Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.')
        || !body.includes('İstek yarıda kaldı: istek süresi doldu ve ücreti iade edildi.')) {
      problems.push('reconcile-stale-not-mode-aware');
    }
    if (!code.includes('REVOKE ALL ON FUNCTION public.ai_request_reconcile_stale(uuid, integer) FROM PUBLIC, anon, authenticated;')
        || !code.includes('GRANT EXECUTE ON FUNCTION public.ai_request_reconcile_stale(uuid, integer) TO service_role;')) {
      problems.push('reconcile-stale-grants');
    }
  }

  // Section 8: 17 F13 tables write-revoked, 6 moved to archive_f13
  for (const t of F13_ALL_17) {
    if (!code.includes(`REVOKE INSERT, UPDATE, DELETE ON public.${t} FROM anon, authenticated;`)) {
      problems.push(`missing-f13-revoke:${t}`);
    }
  }
  for (const t of F13_MOVED_6) {
    if (!code.includes(`'${t}'`)) problems.push(`missing-f13-move:${t}`);
  }

  return problems;
}

/** Pure structural validator for 037_today_bootstrap_rpc.sql (DB1-20). */
export function migration037Problems(raw: string): string[] {
  const code = stripComments(raw);
  const out: string[] = [];
  if (/INSERT\s+INTO\s+public\.willpower_state/i.test(code)) out.push('writes-willpower-state');
  if (!/\bSTABLE\b/.test(code)) out.push('missing-stable');
  if (!/\bSECURITY\s+INVOKER\b/.test(code)) out.push('missing-security-invoker');
  if (/\bSECURITY\s+DEFINER\b/.test(code)) out.push('uses-security-definer');
  return out;
}

describe('F09 — 040_privilege_hygiene.sql, 037 read-only fix, rollback & docs', () => {
  const live = read('supabase/live_schema.sql');
  const expected20 = unpinnedLiveSignatures(live);
  const expected10Tables = [
    '028_habit_pauses_and_goal_versions.sql',
    '029_habit_checklists.sql',
    '030_routine_runner.sql',
    '031_moods_and_review_actions.sql',
  ].flatMap((f) => [...read(`supabase/migrations/${f}`).matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1]));

  it('discovers the exact 20 unpinned SECURITY DEFINER functions in live_schema.sql and 10 tables in 028..031', () => {
    expect(expected20).toHaveLength(20);
    expect(expected10Tables).toEqual([
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
  });

  it('040_privilege_hygiene.sql exists and satisfies every positive hygiene, locking and F07-R3 rule', () => {
    expect(existsSync(join(REPO, MIG_040))).toBe(true);
    const mig040 = read(MIG_040);
    expect(migration040Problems(mig040, expected20, expected10Tables)).toEqual([]);
  });

  it('037_today_bootstrap_rpc.sql is read-only (STABLE, SECURITY INVOKER, zero willpower_state INSERT)', () => {
    const mig037 = read(MIG_037);
    expect(migration037Problems(mig037)).toEqual([]);
  });

  it('040_privilege_hygiene.rollback.sql resets search_path on all 20 functions and restores all 8 replaced bodies byte-for-byte', () => {
    expect(existsSync(join(REPO, RB_040))).toBe(true);
    const rb040 = read(RB_040);
    const code = stripComments(rb040);

    const resetSection = /FOREACH sig IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP\s+IF to_regprocedure\(sig\) IS NOT NULL THEN\s+EXECUTE format\('ALTER FUNCTION %s RESET search_path'/.exec(code);
    expect(resetSection).not.toBeNull();
    const resetList = [...resetSection![1].matchAll(/'(public\.[^']+)'/g)].map((m) => m[1]).sort();
    expect(resetList).toEqual(expected20);

    for (const fn of [
      'get_global_leaderboard',
      'get_weekly_leaderboard',
      'get_user_rank',
      'handle_new_user',
      'add_xp',
      'get_or_init_subscription',
      'get_or_init_subscription_for',
      'ai_request_reconcile_stale',
    ]) {
      expect({ fn, bodyMatchesLive: functionBody(rb040, fn) === functionBody(live, fn) }).toEqual({
        fn,
        bodyMatchesLive: true,
      });
    }

    expect(code).toContain('REVOKE SELECT (id, user_id, workspace_id, workspace_name, workspace_icon, bot_id, habits_database_id, tasks_database_id, habits_url, tasks_url, created_at, updated_at) ON public.notion_integrations FROM authenticated;');
    expect(code).toContain('CREATE POLICY "Users manage own notion integration" ON public.notion_integrations USING ((auth.uid() = user_id));');
  });

  it('08_privilege_hygiene_040.sql exists, follows the pure-SQL F01 protocol, and expected_failures.txt is empty', () => {
    expect(existsSync(join(REPO, TEST_08))).toBe(true);
    const test08 = read(TEST_08);
    expect(stripComments(test08).trim().endsWith('ROLLBACK;')).toBe(true);
    expect(test08).toContain('T08h3_reconcile_stale_mode_aware_messages');

    const activeExpectedFailures = read('supabase/tests/expected_failures.txt')
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
    expect(activeExpectedFailures).toEqual([]);
  });

  it('updates README.md, rollbacks/README.md, MIGRATION_MAPPING.md, and SQL_FOR_OWNER.md', () => {
    const migReadme = read('supabase/migrations/README.md');
    expect(migReadme).toContain('`040_privilege_hygiene.sql` | **NOT APPLIED**');
    expect(migReadme).toMatch(/PUBLIC EXECUTE/i);
    expect(migReadme).toContain('REVOKE ALL ON public.');

    const rbReadme = read('supabase/rollbacks/README.md');
    expect(rbReadme).toContain('`040_privilege_hygiene.rollback.sql`');

    const mapping = read('docs/implementation-v3/MIGRATION_MAPPING.md');
    expect(mapping).toContain('| `040_privilege_hygiene.sql` | `20261010001300_privilege_hygiene.sql` |');

    const ownerSql = read('docs/implementation-v3/SQL_FOR_OWNER.md');
    expect(ownerSql).toContain('`040_privilege_hygiene.sql`');
    expect(ownerSql).toContain("t.tgrelid = 'auth.users'::regclass");
    expect(ownerSql).toContain('will_be_repaired');
    expect(ownerSql).toContain("select 'user_pets' as t, count(*) from public.user_pets");
    expect(ownerSql).toContain('notion-sync');
  });

  describe('synthetic negative controls catch every forbidden 040 and 037 defect', () => {
    it('catches anon/public grants, USING (true), DISABLE RLS, DROP TABLE, unquoted search_path, secret exposure, and missing F07-R3 mode message', () => {
      if (!existsSync(join(REPO, MIG_040))) {
        expect(migration040Problems('SELECT 1;', expected20, expected10Tables)).toContain('missing-status-marker');
        return;
      }
      const base = read(MIG_040);
      expect(migration040Problems(`${base}\nGRANT SELECT ON public.profiles TO anon;`, expected20, expected10Tables)).toContain('opens-to-anon-or-public');
      expect(migration040Problems(`${base}\nCREATE POLICY p ON public.profiles FOR SELECT TO authenticated USING (true);`, expected20, expected10Tables)).toContain('tautology-policy');
      expect(migration040Problems(`${base}\nALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;`, expected20, expected10Tables)).toContain('disables-rls');
      expect(migration040Problems(`${base}\nDROP TABLE public.user_pets;`, expected20, expected10Tables)).toContain('drops-table');
      expect(migration040Problems(base.replace("SET search_path TO 'public', 'pg_temp'", 'SET search_path TO public, pg_temp'), expected20, expected10Tables)).toContain('unquoted-search-path');
      expect(migration040Problems(base.replace('workspace_id,', 'access_token, workspace_id,'), expected20, expected10Tables)).toContain('notion-secret-column-exposed');
      expect(migration040Problems(base.replace('İstek yarıda kaldı: istek süresi doldu ve ücreti iade edildi.', 'Kurulum yarida kaldi'), expected20, expected10Tables)).toContain('reconcile-stale-not-mode-aware');

      const base037 = read(MIG_037);
      expect(migration037Problems(`${base037}\nINSERT INTO public.willpower_state (user_id) VALUES (v_uid);`)).toContain('writes-willpower-state');
      expect(migration037Problems(base037.replace(/\bSTABLE\b/g, ''))).toContain('missing-stable');
      expect(migration037Problems(base037.replace(/SECURITY INVOKER/g, 'SECURITY DEFINER'))).toEqual([
        'missing-security-invoker',
        'uses-security-definer',
      ]);
    });
  });
});
