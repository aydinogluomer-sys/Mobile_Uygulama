/**
 * F10 — migration 041 (RLS InitPlan wrapping, duplicate permissive policy removal,
 * leading foreign-key indexes, duplicate habit_logs index drop, tasks sub-step
 * ON DELETE CASCADE), its F02 rollback parity, config.toml local CLI hardening
 * (DB1-18), 09_rls_initplan_041.sql behavioural checks, and owner/CI wiring.
 *
 * Findings covered: DB1-14, DB1-16, DB2-10, GEM-03, GEM-04, DB2-19, DB1-18.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const MIG_041 = 'supabase/migrations/041_rls_initplan_and_indexes.sql';
const RB_041 = 'supabase/rollbacks/041_rls_initplan_and_indexes.rollback.sql';
const TEST_09 = 'supabase/tests/09_rls_initplan_041.sql';

/** The 7 cancelled F13 FK columns moved to archive_f13 by 040 and deliberately left unindexed. */
const F13_UNINDEXED_EXEMPTIONS = new Set([
  'boss_contributors.user_id',
  'user_challenges.challenge_id',
  'user_challenges.habit_id',
  'user_inventory.item_id',
  'user_pets.current_stage_id',
  'user_quests.quest_id',
  'user_skills.skill_id',
]);

const EXPECTED_TWIN_DROPS = [
  'tasks/Users can manage own tasks',
  'tasks/tasks_own',
  'challenges/Challenges imply public read',
  'habit_templates/Everyone can read patterns',
  'weekly_xp/System can manage weekly xp',
  'user_challenges/Users can manage their challenges',
] as const;

const EXPECTED_PRECONDITION_SURVIVORS = [
  'tasks/Users can CRUD own tasks',
  'challenges/Anyone can read challenges',
  'habit_templates/Anyone can read templates',
] as const;

export type LivePolicy = {
  table: string;
  name: string;
  key: string;
  body: string;
  bare: boolean;
};

/** Parses every `CREATE POLICY` statement in `supabase/live_schema.sql` and flags bare auth calls. */
export function discoverLivePolicies(liveDump: string): LivePolicy[] {
  const out: LivePolicy[] = [];
  const re = /^CREATE POLICY "([^"]+)" ON "public"\."(\w+)"([\s\S]*?);$/gm;
  for (const m of liveDump.matchAll(re)) {
    const name = m[1];
    const table = m[2];
    const body = m[3];
    const withoutWrapped = body.replace(
      /\(\s*SELECT\s+"?auth"?\."?(?:uid|role)"?\(\)(?:\s+AS\s+"?(?:uid|role)"?)?\s*\)/gi,
      '',
    );
    const bare = /"?auth"?\."?(?:uid|role)"?\(\)/i.test(withoutWrapped);
    out.push({ table, name, key: `${table}/${name}`, body, bare });
  }
  return out;
}

export type UnindexedFk = {
  table: string;
  column: string;
  nullable: boolean;
};

/** Discovers unindexed leading FK columns in `live_schema.sql` (excluding the 7 F13 exemptions). */
export function discoverLiveUnindexedFks(liveDump: string): UnindexedFk[] {
  const nullability = new Map<string, boolean>();
  const tableRe = /^CREATE TABLE IF NOT EXISTS "public"\."(\w+)" \(([\s\S]*?)\n\);$/gm;
  for (const tm of liveDump.matchAll(tableRe)) {
    const tbl = tm[1];
    for (const rawLine of tm[2].split('\n')) {
      const colMatch = /^\s*"(\w+)"\s+([^,\n]+)/.exec(rawLine);
      if (!colMatch) continue;
      const col = colMatch[1];
      if (col === 'CONSTRAINT') continue;
      nullability.set(`${tbl}.${col}`, !/\bNOT NULL\b/i.test(colMatch[2]));
    }
  }

  // Leading columns covered by PRIMARY KEY or UNIQUE constraints (always unconditional)
  const indexed = new Set<string>();
  const pkUniqueRe = /ALTER TABLE ONLY "public"\."(\w+)"\s+ADD CONSTRAINT "[^"]+" (?:PRIMARY KEY|UNIQUE) \("(\w+)"/g;
  for (const m of liveDump.matchAll(pkUniqueRe)) {
    indexed.add(`${m[1]}.${m[2]}`);
  }

  // Leading columns covered by unconditional indexes or `WHERE ("col" IS NOT NULL)` partial indexes
  const idxRe = /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "public"\."(\w+)" USING "\w+" \("(\w+)"[^;\n]*?\)(\s+WHERE\s+([^\n;]+))?;$/gm;
  for (const m of liveDump.matchAll(idxRe)) {
    const tbl = m[1];
    const col = m[2];
    const where = (m[4] ?? '').trim();
    if (!where || where === `("${col}" IS NOT NULL)`) {
      indexed.add(`${tbl}.${col}`);
    }
  }

  const out: UnindexedFk[] = [];
  const fkRe = /ALTER TABLE ONLY "public"\."(\w+)"\s+ADD CONSTRAINT "[^"]+" FOREIGN KEY \("(\w+)"\)/g;
  for (const m of liveDump.matchAll(fkRe)) {
    const tbl = m[1];
    const col = m[2];
    const key = `${tbl}.${col}`;
    if (F13_UNINDEXED_EXEMPTIONS.has(key) || indexed.has(key)) continue;
    out.push({ table: tbl, column: col, nullable: nullability.get(key) ?? false });
  }
  return out.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

/** Discovers unindexed leading FK columns across migrations 028..036 (before 038/041). */
export function discoverMigrationUnindexedFks(migrationSources: string[]): UnindexedFk[] {
  const nullability = new Map<string, boolean>();
  const indexed = new Set<string>();
  const fks: { table: string; column: string }[] = [];

  for (const raw of migrationSources) {
    const code = stripComments(raw);
    const tableRe = /CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g;
    for (const tm of code.matchAll(tableRe)) {
      const tbl = tm[1];
      const body = tm[2];
      for (const line of body.split('\n')) {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed) continue;
        const pk = /^CONSTRAINT \w+ PRIMARY KEY \((\w+)/i.exec(trimmed);
        if (pk) {
          indexed.add(`${tbl}.${pk[1]}`);
          continue;
        }
        const uq = /^CONSTRAINT \w+ UNIQUE \((\w+)/i.exec(trimmed);
        if (uq) {
          indexed.add(`${tbl}.${uq[1]}`);
          continue;
        }
        if (/^CONSTRAINT\b/i.test(trimmed)) continue;
        const colMatch = /^(\w+)\s+([\s\S]+)$/.exec(trimmed);
        if (!colMatch) continue;
        const col = colMatch[1];
        const rest = colMatch[2];
        if (/\bPRIMARY KEY\b/i.test(rest) || /\bUNIQUE\b/i.test(rest)) {
          indexed.add(`${tbl}.${col}`);
        }
        nullability.set(`${tbl}.${col}`, !/\bNOT NULL\b/i.test(rest));
        if (/\bREFERENCES\b/i.test(rest)) {
          fks.push({ table: tbl, column: col });
        }
      }
    }

    const idxRe = /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON public\.(\w+)\s*\((\w+)[^)]*\)(\s+WHERE\s+([^;]+))?;/g;
    for (const im of code.matchAll(idxRe)) {
      const tbl = im[1];
      const col = im[2];
      const where = (im[4] ?? '').trim();
      if (!where || where === `${col} IS NOT NULL`) {
        indexed.add(`${tbl}.${col}`);
      }
    }
  }

  return fks
    .filter(({ table, column }) => !indexed.has(`${table}.${column}`))
    .map(({ table, column }) => ({
      table,
      column,
      nullable: nullability.get(`${table}.${column}`) ?? false,
    }))
    .sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

const hasBareAuthCall = (expr: string): boolean => {
  const withoutWrapped = expr.replace(/\(\s*SELECT\s+auth\.(?:uid|role)\(\)\s*\)/gi, '');
  return /auth\.(?:uid|role)\(\)/i.test(withoutWrapped);
};

const hasWrappedAuthCall = (expr: string): boolean => /\(\s*SELECT\s+auth\.(?:uid|role)\(\)\s*\)/.test(expr);

/** Pure structural validator for `041_rls_initplan_and_indexes.sql` (empty = clean). */
export function migration041Problems(
  raw: string,
  expectedBarePolicyKeys: string[],
  expectedStaticFks: UnindexedFk[],
  expectedGuardedFks: UnindexedFk[],
): string[] {
  const problems: string[] = [];
  const code = stripComments(raw);

  if (!/STATUS: WRITTEN, NOT APPLIED/.test(raw)) problems.push('missing-status-marker');
  if (/\bGRANT\b/i.test(code)) problems.push('uses-grant');
  if (/\bREVOKE\b/i.test(code)) problems.push('uses-revoke');
  if (/\bCREATE\s+POLICY\b/i.test(code)) problems.push('uses-create-policy');
  if (/\bCREATE\s+TABLE\b/i.test(code)) problems.push('uses-create-table');
  if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(code)) problems.push('uses-create-function');
  if (/\bSECURITY\s+DEFINER\b/i.test(code)) problems.push('uses-security-definer');
  if (/\bTO\s+(?:anon|public)\b/i.test(code)) problems.push('opens-to-anon-or-public');
  if (/USING\s*\(\s*true\s*\)|WITH\s+CHECK\s*\(\s*true\s*\)/i.test(code)) problems.push('tautology-policy');
  if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(code)) problems.push('disables-rls');
  if (/\bCONCURRENTLY\b/i.test(code)) problems.push('uses-concurrently');

  // 0. Preconditions before first DROP POLICY
  const firstDropAt = code.search(/\bDROP\s+POLICY\b/i);
  const preBlock = firstDropAt > 0 ? code.slice(0, firstDropAt) : '';
  for (const survivor of EXPECTED_PRECONDITION_SURVIVORS) {
    const [tbl, pol] = survivor.split('/');
    if (!preBlock.includes(`tablename = '${tbl}'`) || !preBlock.includes(`policyname = '${pol}'`)) {
      problems.push(`missing-precondition:${survivor}`);
    }
  }

  // 1. Static DROP POLICY IF EXISTS
  const dropped = new Set<string>();
  const dropRe = /DROP POLICY IF EXISTS (?:"([^"]+)"|(\w+)) ON public\.(\w+);/g;
  for (const m of code.matchAll(dropRe)) {
    const pol = m[1] ?? m[2];
    dropped.add(`${m[3]}/${pol}`);
  }

  // 2. Static ALTER POLICY
  const altered = new Set<string>();
  const alterRe = /ALTER POLICY "([^"]+)" ON public\.(\w+)\s+([\s\S]*?);/g;
  for (const m of code.matchAll(alterRe)) {
    const key = `${m[2]}/${m[1]}`;
    const body = m[3];
    altered.add(key);
    if (!hasWrappedAuthCall(body)) problems.push(`static-alter-not-wrapped:${key}`);
    if (hasBareAuthCall(body)) problems.push(`static-alter-still-bare:${key}`);
  }

  // 3. Guarded VALUES tuples (public + archive_f13 lookup)
  if (!code.includes("n.nspname IN ('public', 'archive_f13')")) {
    problems.push('missing-archive-f13-lookup');
  }
  const tupleRe = /\(\s*'(\w+)'\s*,\s*'([^']+)'\s*,\s*'(drop|alter)'\s*,\s*(NULL|\$e\$([\s\S]*?)\$e\$)\s*,\s*(NULL|\$e\$([\s\S]*?)\$e\$)\s*\)/g;
  for (const m of code.matchAll(tupleRe)) {
    const key = `${m[1]}/${m[2]}`;
    const act = m[3];
    const uExpr = m[5] ?? '';
    const cExpr = m[7] ?? '';
    if (act === 'drop') {
      dropped.add(key);
    } else {
      altered.add(key);
      const combined = `${uExpr} ${cExpr}`.trim();
      if (!combined || !hasWrappedAuthCall(combined)) problems.push(`guarded-alter-not-wrapped:${key}`);
      if (hasBareAuthCall(combined)) problems.push(`guarded-alter-still-bare:${key}`);
    }
  }

  for (const twin of EXPECTED_TWIN_DROPS) {
    if (!dropped.has(twin)) problems.push(`missing-twin-drop:${twin}`);
  }
  for (const bareKey of expectedBarePolicyKeys) {
    if (!dropped.has(bareKey) && !altered.has(bareKey)) {
      problems.push(`unhandled-bare-policy:${bareKey}`);
    }
  }

  // 4. tasks_parent_task_id_fkey ON DELETE CASCADE in single ALTER TABLE
  if (
    !/ALTER TABLE public\.tasks\s+DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey,\s+ADD CONSTRAINT tasks_parent_task_id_fkey\s+FOREIGN KEY \(parent_task_id\) REFERENCES public\.tasks\(id\) ON DELETE CASCADE;/i.test(
      code,
    )
  ) {
    problems.push('missing-tasks-parent-cascade');
  }

  // 5. 18 static FK indexes
  const staticIndexes = new Map<string, { name: string; where: string }>();
  const staticIdxRe = /CREATE INDEX IF NOT EXISTS (\w+)\s+ON public\.(\w+)\s*\((\w+)\)(?:\s+WHERE\s+([^;]+))?;/g;
  for (const m of code.matchAll(staticIdxRe)) {
    staticIndexes.set(`${m[2]}.${m[3]}`, { name: m[1], where: (m[4] ?? '').trim() });
  }
  for (const fk of expectedStaticFks) {
    const key = `${fk.table}.${fk.column}`;
    const found = staticIndexes.get(key);
    if (!found) {
      problems.push(`missing-fk-index:${key}`);
      continue;
    }
    const expectedWhere = fk.nullable ? `${fk.column} IS NOT NULL` : '';
    if (found.where !== expectedWhere) {
      problems.push(`wrong-fk-index-predicate:${key}`);
    }
  }

  // 5b. 8 guarded 028..036 FK indexes
  const guardedIndexes = new Map<string, { name: string; nullable: boolean }>();
  const guardedIdxRe = /\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*(true|false)\s*\)/g;
  for (const m of code.matchAll(guardedIdxRe)) {
    guardedIndexes.set(`${m[1]}.${m[3]}`, { name: m[2], nullable: m[4] === 'true' });
  }
  for (const fk of expectedGuardedFks) {
    const key = `${fk.table}.${fk.column}`;
    const found = guardedIndexes.get(key);
    if (!found) {
      problems.push(`missing-guarded-fk-index:${key}`);
      continue;
    }
    if (found.nullable !== fk.nullable) {
      problems.push(`wrong-guarded-fk-nullability:${key}`);
    }
  }

  // 6. Duplicate habit_logs index dropped
  if (!/DROP INDEX IF EXISTS public\.idx_habit_logs_habit_date;/i.test(code)) {
    problems.push('missing-duplicate-index-drop');
  }

  // 7. Post-condition block at the end
  const postAt = code.indexOf("RAISE EXCEPTION '041: policies still call auth.uid()/auth.role() per row: %'");
  const lastAlterAt = code.lastIndexOf('ALTER POLICY');
  if (
    postAt < 0 ||
    postAt < lastAlterAt ||
    !code.slice(code.lastIndexOf('DO $f10$')).includes("p.schemaname IN ('public', 'archive_f13')") ||
    !code.slice(code.lastIndexOf('DO $f10$')).includes('regexp_replace')
  ) {
    problems.push('missing-postcondition-block');
  }

  return problems;
}

/** Pure structural validator for `041_rls_initplan_and_indexes.rollback.sql` (empty = clean). */
export function rollback041Problems(rawRollback: string, rawMigration: string): string[] {
  const problems: string[] = [];
  const code = stripComments(rawRollback);
  const migCode = stripComments(rawMigration);
  const trimmed = code.trim();

  if (!/STATUS: WRITTEN, NOT APPLIED/.test(rawRollback)) problems.push('missing-status-marker');
  if (!trimmed.startsWith('BEGIN;') || !trimmed.endsWith('COMMIT;')) problems.push('missing-transaction');
  if (
    !/current_setting\(\s*'aderyth\.rollback_confirm'\s*,\s*true\s*\)\s*,\s*''\s*\)\s*<>\s*'041'\s*THEN\s+RAISE\s+EXCEPTION/i.test(
      code,
    ) ||
    !code.includes("SET aderyth.rollback_confirm = ''041'';") ||
    !code.includes("USING ERRCODE = 'P0001'")
  ) {
    problems.push('missing-confirm-guard');
  }
  if (/\bCASCADE\b/i.test(code)) problems.push('uses-cascade');
  if (/\bDROP\s+SCHEMA\b/i.test(code)) problems.push('drops-schema');

  // Must NEVER recreate the P0 client-writable weekly_xp policy dropped by 036
  if (/CREATE\s+POLICY[\s\S]{0,80}System can manage weekly xp/i.test(code)) {
    problems.push('recreates-weekly-xp-writer');
  }

  // Restores idx_habit_logs_habit_date
  if (
    !/CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date\s+ON public\.habit_logs USING btree \(habit_id, completed_at\);/i.test(
      code,
    )
  ) {
    problems.push('missing-restore-duplicate-index');
  }

  // Drops all 26 indexes created by 041
  const createdStatic = [...migCode.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)\s+ON public\.\w+/g)].map((m) => m[1]);
  const createdGuarded = [...migCode.matchAll(/\(\s*'\w+'\s*,\s*'(\w+)'\s*,\s*'\w+'\s*,\s*(?:true|false)\s*\)/g)].map(
    (m) => m[1],
  );
  const allCreated = [...createdStatic, ...createdGuarded];
  if (allCreated.length !== 26) problems.push(`unexpected-mig-index-count:${allCreated.length}`);
  for (const idx of allCreated) {
    if (!code.includes(`DROP INDEX IF EXISTS public.${idx};`)) {
      problems.push(`missing-drop-index:${idx}`);
    }
  }

  // Restores tasks_parent_task_id_fkey without ON DELETE CASCADE
  if (
    !/ALTER TABLE public\.tasks\s+DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey,\s+ADD CONSTRAINT tasks_parent_task_id_fkey\s+FOREIGN KEY \(parent_task_id\) REFERENCES public\.tasks\(id\);/i.test(
      code,
    )
  ) {
    problems.push('missing-restore-tasks-parent-fk');
  }

  // Second-pass idempotency: every static CREATE POLICY is preceded by DROP POLICY IF EXISTS
  for (const [pol, tbl] of [
    ['"Users can manage own tasks"', 'public.tasks'],
    ['tasks_own', 'public.tasks'],
    ['"Challenges imply public read"', 'public.challenges'],
    ['"Everyone can read patterns"', 'public.habit_templates'],
  ] as const) {
    const dropStmt = `DROP POLICY IF EXISTS ${pol} ON ${tbl};`;
    const createStmt = `CREATE POLICY ${pol} ON ${tbl}`;
    const dAt = code.indexOf(dropStmt);
    const cAt = code.indexOf(createStmt);
    if (dAt < 0 || cAt < 0 || dAt > cAt) {
      problems.push(`non-idempotent-create-policy:${pol}`);
    }
  }

  // Guarded user_challenges twin restoration
  if (!code.includes("CREATE POLICY %I ON %I.%I USING (auth.uid() = user_id)")) {
    problems.push('missing-user-challenges-twin-restore');
  }

  // All 30 static core policies restored to bare auth calls
  const rbAlters = [...code.matchAll(/ALTER POLICY "([^"]+)" ON public\.(\w+)\s+([\s\S]*?);/g)];
  if (rbAlters.length !== 30) problems.push(`static-alter-count:${rbAlters.length}`);
  for (const m of rbAlters) {
    if (hasWrappedAuthCall(m[3]) || !hasBareAuthCall(m[3])) {
      problems.push(`rollback-alter-not-bare:${m[2]}/${m[1]}`);
    }
  }

  return problems;
}

/** Pure structural validator for `supabase/config.toml` local CLI hardening (DB1-18). */
export function configToml041Problems(toml: string, canonicalRef: string): string[] {
  const problems: string[] = [];
  const pin = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(toml);
  if (pin?.[1] !== canonicalRef) problems.push('project-id-drifted');
  if (!/supabase config push.*is NOT run/i.test(toml)) problems.push('missing-config-push-comment');
  if (!/^\s*schemas\s*=\s*\["public"\]\s*$/m.test(toml)) problems.push('schemas-not-public-only');
  if (/^\s*schemas\s*=.*graphql_public/m.test(toml)) problems.push('graphql-public-still-exposed');
  if (!/^\s*minimum_password_length\s*=\s*6\b/m.test(toml)) problems.push('minimum-password-length-changed');
  if (!/OD-19/.test(toml)) problems.push('missing-password-floor-comment');

  const emailSection = toml.slice(toml.indexOf('[auth.email]'), toml.indexOf('[auth.sms]'));
  if (!/^\s*enable_confirmations\s*=\s*true\b/m.test(emailSection)) problems.push('enable-confirmations-false');
  if (!/^\s*secure_password_change\s*=\s*true\b/m.test(emailSection)) problems.push('secure-password-change-false');
  return problems;
}

describe('F10 — 041_rls_initplan_and_indexes.sql, rollback, config.toml & owner docs', () => {
  const live = read('supabase/live_schema.sql');
  const guardSh = read('supabase/predeploy_guard.sh');
  const canonicalRef = /^CANONICAL="([^"]+)"/m.exec(guardSh)?.[1] ?? '';

  const allLivePolicies = discoverLivePolicies(live);
  const bareLivePolicies = allLivePolicies.filter((p) => p.bare);
  const barePolicyKeys = bareLivePolicies.map((p) => p.key);

  const expectedStaticFks = discoverLiveUnindexedFks(live);
  const expectedGuardedFks = discoverMigrationUnindexedFks(
    [
      '028_habit_pauses_and_goal_versions.sql',
      '029_habit_checklists.sql',
      '030_routine_runner.sql',
      '031_moods_and_review_actions.sql',
      '032_coach_actions_v2.sql',
      '033_habit_log_timezone.sql',
      '034_coach_reminder_action.sql',
      '035_coach_lighten_week.sql',
      '036_live_audit_hardening.sql',
    ].map((f) => read(`supabase/migrations/${f}`)),
  );

  it('discovers 115 live policies (49 bare), 18 unindexed live FK columns, and 8 unindexed 028..036 FK columns', () => {
    expect(canonicalRef).toMatch(/^[a-z]{20}$/);
    expect(allLivePolicies).toHaveLength(115);
    expect(bareLivePolicies).toHaveLength(49);
    expect(expectedStaticFks).toHaveLength(18);
    expect(expectedGuardedFks).toHaveLength(8);
  });

  it('041_rls_initplan_and_indexes.sql exists and satisfies every DB1-14, DB1-16, DB2-10, DB2-19, GEM-03 and GEM-04 rule', () => {
    expect(existsSync(join(REPO, MIG_041))).toBe(true);
    const mig041 = read(MIG_041);
    expect(migration041Problems(mig041, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toEqual([]);
  });

  it('041_rls_initplan_and_indexes.rollback.sql exists, satisfies F02, is second-pass idempotent, and restores exact baseline shapes', () => {
    expect(existsSync(join(REPO, RB_041))).toBe(true);
    expect(existsSync(join(REPO, MIG_041))).toBe(true);
    const rb041 = read(RB_041);
    const mig041 = read(MIG_041);
    expect(rollback041Problems(rb041, mig041)).toEqual([]);
  });

  it('09_rls_initplan_041.sql exists, obeys pure-SQL F01 rules, checks public + archive_f13 + xp_drift, and run.sh raises MIN_RESULTS', () => {
    expect(existsSync(join(REPO, TEST_09))).toBe(true);
    const test09 = read(TEST_09);
    const bareTest = stripComments(test09).trim();
    expect(bareTest.startsWith('BEGIN;')).toBe(true);
    expect(bareTest.endsWith('ROLLBACK;')).toBe(true);
    expect(/^\s*\\[A-Za-z]/m.test(bareTest)).toBe(false);
    expect(test09).toContain("p.schemaname IN ('public', 'archive_f13')");
    for (const checkName of [
      'T09a1_no_bare_auth_call_in_any_policy',
      'T09b1_no_overlapping_permissive_policies',
      'T09b2_tasks_has_exactly_one_policy',
      'T09b3_weekly_xp_has_no_client_writer',
      'T09c2_user_a_cannot_insert_task_for_b',
      'T09d3_anon_cannot_read_habit_templates',
      'T09d4_anon_cannot_read_challenges',
      'T09e_tables_checked_non_vacuous',
      'T09f1_negative_control_bare_policy_shows_no_initplan',
      'T09g1_every_fk_column_has_a_leading_index',
      'T09g2_named_indexes_exist',
      'T09g3_negative_control_missing_index_is_reported',
      'T09h1_duplicate_habit_logs_index_is_gone',
      'T09i1_tasks_parent_fk_is_on_delete_cascade',
      'T09i3_deleting_the_parent_removes_its_children',
      'T09i4_splitter_payload_still_inserts',
      'T09j1_every_table_with_a_policy_still_has_rls_on',
      'T09k1_xp_drift_stays_empty',
    ]) {
      expect(test09).toContain(`'${checkName}'`);
    }

    const runSh = read('supabase/tests/run.sh');
    const minMatch = /^MIN_RESULTS=(\d+)/m.exec(runSh);
    expect(Number(minMatch?.[1] ?? 0)).toBeGreaterThanOrEqual(140);
  });

  it('supabase/config.toml hardens schemas, enable_confirmations, and secure_password_change while preserving project_id and password floor 6 (DB1-18)', () => {
    const toml = read('supabase/config.toml');
    expect(configToml041Problems(toml, canonicalRef)).toEqual([]);
  });

  it('updates migrations/README.md, rollbacks/README.md, MIGRATION_MAPPING.md, SQL_FOR_OWNER.md (§1, §2.14, §8, §9) and ci.yml', () => {
    const migReadme = read('supabase/migrations/README.md');
    expect(migReadme).toContain('`041_rls_initplan_and_indexes.sql` | **NOT APPLIED**');
    expect(migReadme).toContain('**Do not run `supabase config push` against the canonical project.**');

    const rbReadme = read('supabase/rollbacks/README.md');
    expect(rbReadme).toContain('`041_rls_initplan_and_indexes.rollback.sql`');
    expect(rbReadme).toContain('041, 040, 039');

    const mapping = read('docs/implementation-v3/MIGRATION_MAPPING.md');
    expect(mapping).toContain('| `041_rls_initplan_and_indexes.sql` | `20261010001400_rls_initplan_and_indexes.sql` |');

    const ownerSql = read('docs/implementation-v3/SQL_FOR_OWNER.md');
    const row041 = ownerSql.split('\n').find((l) => l.startsWith('| 041 |')) ?? '';
    expect(row041).toContain('`041_rls_initplan_and_indexes.sql`');
    expect(row041).toContain('§2.14');
    expect(row041).toContain('`supabase/rollbacks/041_rls_initplan_and_indexes.rollback.sql`');
    expect(ownerSql).toContain('-- 2.14 (041)');
    expect(ownerSql).toContain('`09_rls_initplan_041.sql`');
    expect(ownerSql).toContain('## 9. Auth ve API ayarları — salt-okunur kontrol listesi');
    expect(ownerSql).toContain('`enable_confirmations = true`');
    expect(ownerSql).toContain('`secure_password_change = true`');
    expect(ownerSql).toContain('`schemas = ["public"]`');

    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('Migration 041 enforces InitPlan post-condition and re-applies idempotently (F10)');
    expect(ci).toContain('supabase/migrations/041_rls_initplan_and_indexes.sql');
  });

  describe('synthetic negative controls catch all 7 F10 §5 SQL mutations (M1..M7) and rollback/config defects', () => {
    it('catches M1..M7 on 041, non-idempotent/P0 rollback defects on 041.rollback, and config.toml regressions', () => {
      expect(configToml041Problems('project_id = "wrong"\nschemas = ["public", "graphql_public"]\nminimum_password_length = 8\n[auth.email]\nenable_confirmations = false\nsecure_password_change = false\n[auth.sms]\n', canonicalRef)).toEqual(
        expect.arrayContaining([
          'project-id-drifted',
          'missing-config-push-comment',
          'schemas-not-public-only',
          'graphql-public-still-exposed',
          'minimum-password-length-changed',
          'enable-confirmations-false',
          'secure-password-change-false',
        ]),
      );

      if (!existsSync(join(REPO, MIG_041)) || !existsSync(join(REPO, RB_041))) {
        expect(migration041Problems('SELECT 1;', barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
          'missing-status-marker',
        );
        return;
      }

      const base = read(MIG_041);
      // M1: Users can view own logs ALTER POLICY deleted
      const m1 = base.replace(
        'ALTER POLICY "Users can view own logs" ON public.habit_logs\n  USING (user_id = (SELECT auth.uid()));\n',
        '',
      );
      expect(m1).not.toBe(base);
      expect(migration041Problems(m1, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
        'unhandled-bare-policy:habit_logs/Users can view own logs',
      );

      // M2: DROP POLICY IF EXISTS tasks_own deleted
      const m2 = base.replace('DROP POLICY IF EXISTS tasks_own ON public.tasks;\n', '');
      expect(m2).not.toBe(base);
      expect(migration041Problems(m2, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toEqual(
        expect.arrayContaining(['missing-twin-drop:tasks/tasks_own', 'unhandled-bare-policy:tasks/tasks_own']),
      );

      // M3: projects_user_idx deleted
      const m3 = base.replace('CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id);\n', '');
      expect(m3).not.toBe(base);
      expect(migration041Problems(m3, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
        'missing-fk-index:projects.user_id',
      );

      // M4: FK tasks_parent_task_id_fkey without ON DELETE CASCADE
      const m4 = base.replace(
        'FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;',
        'FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id);',
      );
      expect(m4).not.toBe(base);
      expect(migration041Problems(m4, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
        'missing-tasks-parent-cascade',
      );

      // M5: DROP INDEX IF EXISTS public.idx_habit_logs_habit_date deleted
      const m5 = base.replace('DROP INDEX IF EXISTS public.idx_habit_logs_habit_date;\n', '');
      expect(m5).not.toBe(base);
      expect(migration041Problems(m5, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
        'missing-duplicate-index-drop',
      );

      // M6: Challenges imply public read not dropped
      const m6 = base.replace('DROP POLICY IF EXISTS "Challenges imply public read" ON public.challenges;\n', '');
      expect(m6).not.toBe(base);
      expect(migration041Problems(m6, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toContain(
        'missing-twin-drop:challenges/Challenges imply public read',
      );

      // M7: M1 + post-condition DO block deleted
      const m7 = m1.slice(0, m1.lastIndexOf('DO $f10$'));
      expect(migration041Problems(m7, barePolicyKeys, expectedStaticFks, expectedGuardedFks)).toEqual(
        expect.arrayContaining([
          'unhandled-bare-policy:habit_logs/Users can view own logs',
          'missing-postcondition-block',
        ]),
      );

      // Rollback negative controls: recreating System can manage weekly xp or omitting DROP POLICY IF EXISTS
      const rb = read(RB_041);
      expect(
        rollback041Problems(
          rb.replace('COMMIT;', 'CREATE POLICY "System can manage weekly xp" ON public.weekly_xp USING (auth.uid() = user_id);\nCOMMIT;'),
          base,
        ),
      ).toContain('recreates-weekly-xp-writer');
      expect(rollback041Problems(rb.replace('DROP POLICY IF EXISTS tasks_own ON public.tasks;\n', ''), base)).toContain(
        'non-idempotent-create-policy:tasks_own',
      );
    });
  });
});
