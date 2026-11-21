/**
 * F03 — migration 038 (XP and streak integrity), its rollback, its documents, its CI wiring and the
 * client half of its contract, held statically.
 *
 * ## Why this file exists
 *
 * The behaviour of 038 is proven on a real Postgres 17 by `supabase/tests/06_xp_integrity_038.sql`
 * (CI `db-migrations-verify`). jest cannot run SQL; what it CAN hold is the text those proofs stand
 * on, so a later edit cannot quietly undo them:
 *
 *   - the five trigger functions are closed to clients, the definers pin `search_path`, the guard
 *     trigger fires BEFORE `trg_habit_log_set_xp` (Postgres orders same-event triggers by name);
 *   - the server window (`c_days_back`, `c_days_ahead`) keeps one day of timezone tolerance around
 *     the client window (lib/date.ts);
 *   - the streak gap table is the same in both trigger functions (and in the one-time backfill),
 *     so F38 cannot change one and forget the other;
 *   - `add_xp(` is called from one place only, and `profiles` is written for `purged_xp` only, so
 *     `total_xp = sum(habit_logs.xp) + purged_xp` (xp_drift()) has one writer;
 *   - the multiplier no longer reads the client-writable `habits.streak_current`, and an update that
 *     changes neither state nor value is never scored again;
 *   - the rollback restores the live `fn_habit_log_set_xp` and 036's `fn_habit_log_award` byte for
 *     byte, cuts the ledger to what the logs carry (so 036's rollback does not move that XP twice),
 *     and refuses a second run;
 *   - the documents, the CI steps, the known-red list and the client copy agree with the SQL.
 *
 * Every rule is a pure function over text. Each is fed the real files (no problem expected) and an
 * in-memory mutant that carries exactly the defect it exists to catch.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { LOGGABLE_DAYS_AHEAD, LOGGABLE_DAYS_BACK } from '../../lib/date';
import {
  HABIT_LOG_DAY_OUT_OF_RANGE,
  HABIT_LOG_KEY_IMMUTABLE,
  LOGGABLE_DAY_MESSAGE,
  LOG_KEY_IMMUTABLE_MESSAGE,
  describeHabitLogError,
  isHabitLogDayOutOfRange,
} from '../../lib/pgErrors';

const REPO = join(__dirname, '..', '..', '..');
const FRONTEND = join(REPO, 'frontend');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n?/g, '\n');

const MIGRATION = 'supabase/migrations/038_xp_streak_integrity.sql';
const ROLLBACK = 'supabase/rollbacks/038_xp_streak_integrity.rollback.sql';
const SQL_TEST = 'supabase/tests/06_xp_integrity_038.sql';

const mig = read(MIGRATION);
const rb = read(ROLLBACK);
const live = read('supabase/live_schema.sql');
const mig036 = read('supabase/migrations/036_live_audit_hardening.sql');
const ci = read('.github/workflows/ci.yml');

const FUNCTIONS = ['fn_habit_log_guard', 'fn_habit_log_set_xp', 'fn_habit_log_award', 'fn_habit_log_purge_on_delete', 'fn_habits_protect_streak'] as const;
const DEFINERS = ['fn_habit_log_set_xp', 'fn_habit_log_award', 'fn_habit_log_purge_on_delete'] as const;
const INVOKERS = ['fn_habit_log_guard', 'fn_habits_protect_streak'] as const;

// ---------------------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------------------
/** Drops `--` comments the way migrationRlsGuard does (038 has no `--` inside a string). */
const code = (sql: string): string => sql.replace(/--[^\n]*/g, '');
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** `CREATE OR REPLACE FUNCTION public.<name>() ... $function$;` (empty when absent). */
const fnBlock = (sql: string, name: string): string =>
  new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$function\\$;`).exec(sql)?.[0] ?? '';
/** The text between `AS $function$` and the closing `$function$;`: what Postgres stores as prosrc. */
const fnBody = (sql: string, name: string): string => {
  const block = fnBlock(sql, name);
  const open = block.indexOf('AS $function$');
  return open < 0 ? '' : block.slice(open + 'AS $function$'.length, block.lastIndexOf('$function$;'));
};
/** prosrc of a function in the live dump (`AS $$ ... $$;`). */
const liveBody = (name: string): string => {
  const start = live.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"()`);
  if (start < 0) return '';
  const open = live.indexOf('AS $$', start) + 'AS $$'.length;
  return live.slice(open, live.indexOf('$$;', open));
};
const gapCase = (body: string): string => collapse(/v_gap := case[\s\S]*?\bend;/i.exec(body)?.[0] ?? '');
const constantOf = (sql: string, name: string): number | null => {
  const m = new RegExp(`${name} constant integer := (\\d+);`).exec(sql);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------------------
type Window = { back: number; ahead: number };

/** Every rule 038 must keep (empty = fine). */
export function migration038Problems(sql: string, client: Window): string[] {
  const p: string[] = [];
  const c = code(sql);
  if (!/STATUS: WRITTEN, NOT APPLIED/.test(sql)) p.push('status-marker');

  // 0. the 036 precondition is the first statement
  const first = c.trim();
  if (!first.startsWith('DO $pre$') || !/to_regclass\('public\.habit_xp_awards'\) IS NULL THEN\s+RAISE EXCEPTION/.test(first.slice(0, first.indexOf('END $pre$;')))) {
    p.push('precondition');
  }

  // nothing that opens access, nothing that needs a policy
  if (/\bGRANT\b/i.test(c)) p.push('grant');
  if (/\bCREATE\s+POLICY\b/i.test(c)) p.push('create-policy');
  if (/\bCREATE\s+TABLE\b/i.test(c)) p.push('create-table');
  if (/\bTO\s+(anon|public)\b/i.test(c)) p.push('to-anon-or-public');

  // EXECUTE closed on all five; the definers pin search_path; the invokers are invokers
  for (const fn of FUNCTIONS) {
    if (!c.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`)) p.push(`revoke:${fn}`);
    if (!fnBlock(c, fn)) p.push(`missing:${fn}`);
  }
  for (const fn of DEFINERS) {
    const b = fnBlock(c, fn);
    if (!/SECURITY DEFINER/.test(b) || !b.includes("SET search_path TO 'public', 'pg_temp'")) p.push(`definer-pin:${fn}`);
  }
  for (const fn of INVOKERS) {
    const b = fnBlock(c, fn);
    if (/SECURITY DEFINER/.test(b) || !b.includes("SET search_path TO 'public', 'pg_temp'")) p.push(`invoker:${fn}`);
  }
  if ((c.match(/SECURITY DEFINER/g) ?? []).length !== DEFINERS.length) p.push('definer-count');

  // the guard trigger runs first among the BEFORE triggers of habit_logs (same event: name order)
  const guardTrigger = /CREATE TRIGGER (\w+)\s+BEFORE INSERT OR UPDATE ON public\.habit_logs\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_habit_log_guard\(\);/.exec(c)?.[1];
  if (!guardTrigger || !(guardTrigger < 'trg_habit_log_set_xp')) p.push('trigger-order');
  if (!c.includes('DROP TRIGGER IF EXISTS on_habit_completed_damage_boss ON public.habit_logs;')) p.push('boss-trigger');
  if (!/CREATE TRIGGER trg_habit_log_purge_on_delete\s+AFTER DELETE ON public\.habit_logs/.test(c)) p.push('purge-trigger');
  if (!/CREATE TRIGGER trg_habits_protect_streak\s+BEFORE INSERT OR UPDATE ON public\.habits/.test(c)) p.push('protect-trigger');

  // the server window is the client window plus one day of timezone tolerance on each side
  if (constantOf(c, 'c_days_back') !== client.back + 1 || constantOf(c, 'c_days_ahead') !== client.ahead + 1) p.push('window');
  const guard = fnBody(c, 'fn_habit_log_guard');
  for (const token of [HABIT_LOG_DAY_OUT_OF_RANGE, HABIT_LOG_KEY_IMMUTABLE]) {
    if (!new RegExp(`raise exception '${token}'\\s+using errcode = '22023'`).test(guard)) p.push(`guard-token:${token}`);
  }

  // one streak gap table, in both trigger functions and in the one-time backfill
  const setXp = fnBody(c, 'fn_habit_log_set_xp');
  const award = fnBody(c, 'fn_habit_log_award');
  if (!gapCase(setXp) || gapCase(setXp) !== gapCase(award)) p.push('gap-case');
  for (const [kind, days] of [['weekly', 13], ['monthly', 62], ['yearly', 731]] as const) {
    if (!gapCase(setXp).includes(`when '${kind}' then ${days}`)) p.push(`gap-threshold:${kind}`);
    if (!new RegExp(`WHEN '${kind}' THEN ${days}`).test(c.slice(c.indexOf('DO $backfill$')))) p.push(`backfill-threshold:${kind}`);
  }

  // one XP path: add_xp only in the award trigger, profiles written for purged_xp only
  const addXp = (c.match(/\badd_xp\(/g) ?? []).length;
  if (addXp !== 1 || (award.match(/\badd_xp\(/g) ?? []).length !== 1) p.push('single-xp-path');
  for (const m of c.matchAll(/update public\.profiles\s+set\s+([\s\S]*?)\s+where/gi)) {
    if (!/^purged_xp\s*=/.test(m[1].trim()) || /total_xp/.test(m[1])) p.push('profiles-write');
  }
  if (/\btotal_xp\s*:?=/.test(c)) p.push('total-xp-assignment');

  // the multiplier reads the ledger run, never the client-writable streak column
  if (/streak_current/.test(setXp)) p.push('set-xp-reads-streak');
  // only a new log or a change of state or value is scored
  if (!/if TG_OP = 'UPDATE'\s+and NEW\.state is not distinct from OLD\.state\s+and NEW\.value is not distinct from OLD\.value then\s+NEW\.xp := v_old;\s+return NEW;/.test(setXp)) {
    p.push('no-rescore');
  }
  if (constantOf(c, 'c_daily_cap') === null || !setXp.includes('v_award := least(v_award, v_room);')) p.push('daily-cap');
  // a cascade from a habit delete is not counted twice (fn_habits_record_purged_xp already moved it)
  if (!fnBody(c, 'fn_habit_log_purge_on_delete').includes('exists (select 1 from public.habits h where h.id = OLD.habit_id)')) p.push('purge-skip');
  return p;
}

/** Every rule the 038 rollback must keep (empty = fine). */
export function rollback038Problems(text: string): string[] {
  const p: string[] = [];
  const c = code(text);
  if (!/STATUS: WRITTEN, NOT APPLIED/.test(text)) p.push('status-marker');
  if (!c.includes("to_regprocedure('public.fn_habit_log_guard()') IS NULL") || !c.includes('038 is not applied')) p.push('not-applied-refusal');
  // the bodies come back byte for byte (md5(prosrc) is in the CI catalog fingerprint)
  if (!liveBody('fn_habit_log_set_xp') || fnBody(text, 'fn_habit_log_set_xp') !== liveBody('fn_habit_log_set_xp')) p.push('set-xp-body');
  if (!fnBody(mig036, 'fn_habit_log_award') || fnBody(text, 'fn_habit_log_award') !== fnBody(mig036, 'fn_habit_log_award')) p.push('award-body');
  for (const fn of ['fn_habit_log_set_xp', 'fn_habit_log_award']) {
    if (!/SECURITY DEFINER\s+SET search_path TO 'public'\s+AS \$function\$/.test(fnBlock(c, fn))) p.push(`attributes:${fn}`);
  }
  const bossLive = live.split('\n').find((l) => l.startsWith('CREATE OR REPLACE TRIGGER "on_habit_completed_damage_boss"')) ?? '<none>';
  if (!c.includes(bossLive)) p.push('boss-trigger');
  for (const fn of ['fn_habit_log_guard', 'fn_habit_log_purge_on_delete', 'fn_habits_protect_streak']) {
    if (!c.includes(`DROP FUNCTION IF EXISTS public.${fn}();`)) p.push(`drop:${fn}`);
  }
  for (const t of ['trg_habits_protect_streak ON public.habits', 'trg_habit_log_purge_on_delete ON public.habit_logs', 'trg_habit_log_00_guard ON public.habit_logs']) {
    const at = c.indexOf(`DROP TRIGGER IF EXISTS ${t};`);
    if (at < 0 || at > c.indexOf('DROP FUNCTION IF EXISTS')) p.push(`drop-trigger-first:${t.split(' ')[0]}`);
  }
  // the ledger: orphans out, then cut to what the logs carry, then the foreign key back
  const orphans = c.indexOf('DELETE FROM public.habit_xp_awards a\n WHERE NOT EXISTS (SELECT 1 FROM public.habits h WHERE h.id = a.habit_id);');
  const cut = c.indexOf('UPDATE public.habit_xp_awards a');
  const fk = c.indexOf('ADD CONSTRAINT habit_xp_awards_habit_id_fkey\n  FOREIGN KEY (habit_id) REFERENCES public.habits(id) ON DELETE CASCADE;');
  if (orphans < 0 || fk < 0 || orphans > fk) p.push('orphans-before-fk');
  if (cut < 0 || cut > fk || !/WHERE a\.xp_awarded > coalesce\(\(SELECT l\.xp FROM public\.habit_logs l/.test(c.slice(cut))) p.push('ledger-cut');
  if (!c.includes('DROP INDEX IF EXISTS public.habit_xp_awards_user_day_fp_idx;') || !c.includes('ALTER TABLE public.habit_xp_awards DROP COLUMN IF EXISTS habit_fp;')) p.push('fingerprint-column');
  if (!c.includes('ALTER TABLE public.weekly_xp DROP CONSTRAINT IF EXISTS weekly_xp_xp_earned_sane;')) p.push('weekly-constraint');
  // the books: counted first, checked last, inside the transaction
  const before = c.indexOf('SELECT count(*)::int AS drift_before FROM public.xp_drift();');
  const assert = c.indexOf('DO $assert$');
  if (before < 0 || assert < 0 || before > cut || assert < fk || !/IF v_after > v_before THEN\s+RAISE EXCEPTION/.test(c.slice(assert))) p.push('drift-assert');
  if (c.indexOf('COMMIT;') < assert) p.push('commit-last');
  // nothing in the rollback writes the books themselves
  if (/UPDATE public\.profiles/i.test(c)) p.push('touches-profiles');
  return p;
}

// ---------------------------------------------------------------------------------------
describe('038: the migration keeps its contract', () => {
  const client = { back: LOGGABLE_DAYS_BACK, ahead: LOGGABLE_DAYS_AHEAD };

  it('the real file has no problem', () => {
    expect(migration038Problems(mig, client)).toEqual([]);
  });

  it('the parsers are not silently empty', () => {
    for (const fn of FUNCTIONS) expect({ fn, body: fnBody(mig, fn).length > 100 }).toEqual({ fn, body: true });
    expect(gapCase(fnBody(mig, 'fn_habit_log_set_xp'))).toContain("when 'weekly' then 13");
    expect(constantOf(mig, 'c_days_back')).toBe(15);
    expect(constantOf(mig, 'c_days_ahead')).toBe(1);
    expect(constantOf(mig, 'c_daily_cap')).toBe(2000);
  });

  it('the guard trigger sorts before the live set_xp trigger, which really exists under that name', () => {
    expect('trg_habit_log_00_guard' < 'trg_habit_log_set_xp').toBe(true);
    expect(live).toContain('CREATE OR REPLACE TRIGGER "trg_habit_log_set_xp" BEFORE INSERT OR UPDATE ON "public"."habit_logs"');
  });

  // the plan's mutants (implementation.md F03 section 5) and a few more, each must be caught
  const mutants: [string, (s: string) => string, string][] = [
    ['guard trigger renamed to sort after set_xp', (s) => s.split('trg_habit_log_00_guard').join('trg_habit_log_zz_guard'), 'trigger-order'],
    ['server window narrowed to 3 days', (s) => s.replace('c_days_back constant integer := 15;', 'c_days_back constant integer := 3;'), 'window'],
    ['server window without the timezone day ahead', (s) => s.replace('c_days_ahead constant integer := 1;', 'c_days_ahead constant integer := 0;'), 'window'],
    ['weekly gap removed from set_xp only', (s) => s.replace("             when 'weekly' then 13\n", ''), 'gap-case'],
    ['monthly gap changed in the backfill only', (s) => s.replace("WHEN 'monthly' THEN 62", "WHEN 'monthly' THEN 31"), 'backfill-threshold:monthly'],
    ['award REVOKE deleted', (s) => s.replace('REVOKE EXECUTE ON FUNCTION public.fn_habit_log_award() FROM PUBLIC, anon, authenticated;\n', ''), 'revoke:fn_habit_log_award'],
    ['set_xp reads the client-writable streak', (s) => s.replace('  v_run := 0;\n  v_prev_day := NEW.completed_at;', '  v_run := coalesce((select streak_current from public.habits where id = NEW.habit_id), 0);\n  v_prev_day := NEW.completed_at;'), 'set-xp-reads-streak'],
    ['a GRANT outside a comment', (s) => `${s}\nGRANT SELECT ON public.habit_xp_awards TO authenticated;\n`, 'grant'],
    ['a second add_xp path', (s) => s.replace('  return OLD;\nend;', '  perform public.add_xp(OLD.user_id, 1);\n  return OLD;\nend;'), 'single-xp-path'],
    ['the purge writes total_xp', (s) => s.replace('set purged_xp = coalesce(purged_xp, 0) + OLD.xp', 'set total_xp = total_xp - OLD.xp'), 'profiles-write'],
    ['the no-rescore rule removed', (s) => s.replace('     and NEW.value is not distinct from OLD.value then\n    NEW.xp := v_old;', '     and false then\n    NEW.xp := v_old;'), 'no-rescore'],
    ['the cap no longer applied', (s) => s.replace('  v_award := least(v_award, v_room);\n', ''), 'daily-cap'],
    ['the cascade counted twice', (s) => s.replace('     and exists (select 1 from public.habits h where h.id = OLD.habit_id) then', '     then'), 'purge-skip'],
    ['the guard becomes a definer', (s) => s.replace("CREATE OR REPLACE FUNCTION public.fn_habit_log_guard()\n RETURNS trigger\n LANGUAGE plpgsql\n", "CREATE OR REPLACE FUNCTION public.fn_habit_log_guard()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n"), 'invoker:fn_habit_log_guard'],
    ['a definer without the pinned search_path', (s) => s.replace(" SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\nbegin\n  -- When", " SECURITY DEFINER\nAS $function$\nbegin\n  -- When"), 'definer-pin:fn_habit_log_purge_on_delete'],
    ['the 036 precondition deleted', (s) => s.replace(/DO \$pre\$[\s\S]*?END \$pre\$;\n/, ''), 'precondition'],
    ['the boss trigger kept', (s) => s.replace('DROP TRIGGER IF EXISTS on_habit_completed_damage_boss ON public.habit_logs;', ''), 'boss-trigger'],
    ['another refusal token', (s) => s.replace("raise exception 'habit_log_day_out_of_range'", "raise exception 'day_out_of_range'"), `guard-token:${HABIT_LOG_DAY_OUT_OF_RANGE}`],
  ];
  it.each(mutants)('mutant "%s" is caught', (_label, mutate, problem) => {
    const mutated = mutate(mig);
    expect(mutated).not.toBe(mig); // the mutant really changed the text
    expect(migration038Problems(mutated, client)).toContain(problem);
  });

  it('a client window wider than the server tolerance is caught', () => {
    expect(migration038Problems(mig, { back: LOGGABLE_DAYS_BACK + 1, ahead: LOGGABLE_DAYS_AHEAD })).toContain('window');
  });
});

// ---------------------------------------------------------------------------------------
describe('038 rollback: the live and 036 bodies come back, the ledger is cut, a second run refuses', () => {
  it('the real file has no problem', () => {
    expect(rollback038Problems(rb)).toEqual([]);
  });

  it('the bodies it compares against are real (the comparison is not empty against empty)', () => {
    expect(liveBody('fn_habit_log_set_xp')).toContain('v_prospective := v_streak + (case when v_entering_done then 1 else 0 end);');
    expect(fnBody(mig036, 'fn_habit_log_award')).toContain('v_prev := greatest(coalesce(v_paid, 0),');
    expect(rb).toContain('v_prev := greatest(coalesce(v_paid, 0)');
    expect(rb).toContain('v_prospective := v_streak +');
  });

  const mutants: [string, (s: string) => string, string][] = [
    ['set_xp body differs by one operator', (s) => s.replace('when v_prospective >= 30 then 1.5', 'when v_prospective > 30 then 1.5'), 'set-xp-body'],
    ['award body is 038\'s, not 036\'s', (s) => s.replace('  v_delta := coalesce(NEW.xp, 0) - v_prev;', '  v_delta := coalesce(NEW.xp, 0);'), 'award-body'],
    ['the ledger is not cut', (s) => s.replace(/UPDATE public\.habit_xp_awards a[\s\S]*?l\.completed_at = a\.day\), 0\);\n/, ''), 'ledger-cut'],
    ['orphans kept (the foreign key would fail)', (s) => s.replace('DELETE FROM public.habit_xp_awards a\n WHERE NOT EXISTS (SELECT 1 FROM public.habits h WHERE h.id = a.habit_id);', ''), 'orphans-before-fk'],
    ['a second run is not refused', (s) => s.replace("IF to_regprocedure('public.fn_habit_log_guard()') IS NULL THEN", 'IF false THEN'), 'not-applied-refusal'],
    ['the drift check never fires', (s) => s.replace('IF v_after > v_before THEN', 'IF false THEN'), 'drift-assert'],
    ['the weekly constraint stays', (s) => s.replace('ALTER TABLE public.weekly_xp DROP CONSTRAINT IF EXISTS weekly_xp_xp_earned_sane;', ''), 'weekly-constraint'],
    ['the boss trigger is not restored', (s) => s.replace(/^CREATE OR REPLACE TRIGGER "on_habit_completed_damage_boss".*$/m, ''), 'boss-trigger'],
    ['a function dropped before its trigger', (s) => s.replace('DROP TRIGGER IF EXISTS trg_habit_log_00_guard ON public.habit_logs;\n', '').replace('DROP FUNCTION IF EXISTS public.fn_habits_protect_streak();', 'DROP FUNCTION IF EXISTS public.fn_habits_protect_streak();\nDROP TRIGGER IF EXISTS trg_habit_log_00_guard ON public.habit_logs;'), 'drop-trigger-first:trg_habit_log_00_guard'],
    ['the rollback rewrites the books', (s) => s.replace('-- (7) weekly_xp', 'UPDATE public.profiles SET purged_xp = 0;\n-- (7) weekly_xp'), 'touches-profiles'],
  ];
  it.each(mutants)('mutant "%s" is caught', (_label, mutate, problem) => {
    const mutated = mutate(rb);
    expect(mutated).not.toBe(rb);
    expect(rollback038Problems(mutated)).toContain(problem);
  });
});

// ---------------------------------------------------------------------------------------
describe('038: the documents list it, with its rollback', () => {
  it('migrations/README lists it NOT APPLIED and names the rollback', () => {
    const readme = read('supabase/migrations/README.md');
    expect(readme).toContain('`038_xp_streak_integrity.sql` | **NOT APPLIED**');
    expect(readme).toContain('038_xp_streak_integrity.rollback.sql');
  });

  it('MIGRATION_MAPPING proposes a later timestamp than 037', () => {
    const doc = read('docs/implementation-v3/MIGRATION_MAPPING.md');
    const ts = (file: string): string => new RegExp(`\\| \`${file}\` \\| \`(\\d{14})_`).exec(doc)?.[1] ?? '';
    expect(ts('038_xp_streak_integrity.sql')).toBe('20261010001100');
    expect(ts('038_xp_streak_integrity.sql') > ts('037_today_bootstrap_rpc.sql')).toBe(true);
    expect(doc).toContain('### 028..038 için önerilen yeni adlar');
  });

  it('SQL_FOR_OWNER has the row, the pre-check, the read-only queries and the order 036 -> 037 -> 038', () => {
    const doc = read('docs/implementation-v3/SQL_FOR_OWNER.md');
    const row = doc.split('\n').find((l) => l.startsWith('| 038 |')) ?? '';
    expect(row).toContain('`038_xp_streak_integrity.sql`');
    expect(row).toContain('`supabase/rollbacks/038_xp_streak_integrity.rollback.sql`');
    expect(row).toContain('§2.11');
    expect(row).toContain('036 → 037 → 038');
    expect(doc.split('\n').find((l) => l.startsWith('| 036 |'))).toContain('**038 ile birlikte**');
    expect(doc).toContain('-- 0.4 038 öncesi');
    const q = doc.slice(doc.indexOf('-- 2.11 (038)'));
    expect(q).toContain('select * from public.xp_drift();');
    expect(q).toContain("'trg_habit_log_00_guard','trg_habit_log_purge_on_delete','trg_habits_protect_streak','on_habit_completed_damage_boss'");
    expect(q).toContain('a.habit_fp is null');
    expect(q).toContain("has_function_privilege('authenticated', p.oid, 'execute')");
  });

  it('rollbacks/README names the script and says why it refuses a second run', () => {
    const readme = read('supabase/rollbacks/README.md');
    expect(readme).toContain('`038_xp_streak_integrity.rollback.sql`');
    expect(readme).toContain('`038 is not applied`');
  });
});

// ---------------------------------------------------------------------------------------
describe('038: the SQL behaviour test and the known-red list', () => {
  const test06 = read(SQL_TEST);

  it('06 carries T1-T14 of the plan and ends in ROLLBACK', () => {
    const numbers = new Set([...test06.matchAll(/'T06_T(\d\d)[a-z]?_/g)].map((m) => Number(m[1])));
    for (let n = 1; n <= 14; n++) expect({ n, present: numbers.has(n) }).toEqual({ n, present: true });
    expect(code(test06).trim().endsWith('ROLLBACK;')).toBe(true);
    expect(code(test06)).not.toMatch(/\bCOMMIT\s*;/i); // `ON COMMIT DROP` of a temp table is not a commit
  });

  it('06 exercises every scenario of constitution rule A.7 as authenticated', () => {
    expect(test06).toContain('SET LOCAL ROLE authenticated;');
    for (const day of ['current_date - 10', 'current_date - 2', 'ARRAY[-16, 2]', 'ARRAY[-15, 1]']) expect(test06).toContain(day);
    expect(test06).toContain("'partial'");
    expect(test06).toContain("'miss'");
    expect(test06).toMatch(/DELETE FROM public\.habit_logs[\s\S]*?INSERT INTO public\.habit_logs/);
    expect(test06).toMatch(/DELETE FROM public\.habits[\s\S]*?'  test   HABIT '/);
    expect((test06.match(/public\.xp_drift\(\)/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('expected_failures.txt has no line justified by 036 or 038 (they close their holes)', () => {
    const lines = read('supabase/tests/expected_failures.txt').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    // F09 (040_privilege_hygiene.sql) closed and removed all 20 remaining T02b_search_path.* lines.
    expect(lines.filter((l) => /\b03[68]\b/.test(l))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
describe('038 in ci.yml: refused before 036, rolled back first, and its books proven on real rows', () => {
  const job = ci.slice(ci.indexOf('\n  db-migrations-verify:'));
  const step = (name: string): string => {
    const start = job.indexOf(`- name: ${name}`);
    if (start < 0) return '';
    const rest = job.slice(start + 1);
    const end = rest.search(/\n {6}(?:- name:|#)/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const at = (name: string): number => job.indexOf(`- name: ${name}`);

  it('038 is refused on a database without 036, and the catalog does not move', () => {
    const run = step('038 refuses to run before 036 (precondition, negative control)');
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('-f supabase/migrations/038_xp_streak_integrity.sql');
    expect(run).toContain('grep -q "038 requires 036"');
    expect(run).toContain('diff -u "$RUNNER_TEMP/fp_before_038_refusal.txt" "$RUNNER_TEMP/fp_after_038_refusal.txt"');
    expect(mig).toContain("'038 requires 036 (public.habit_xp_awards is missing)'");
    expect(at('038 refuses to run before 036')).toBeLessThan(at('Apply forward migrations 028+'));
  });

  it('the negative control proves 036 refuses while the REAL 038 is applied', () => {
    const run = step('Rollback scripts must refuse without their own confirmation (negative controls)');
    expect(run).toContain("to_regprocedure('public.fn_habit_log_guard()') IS NOT NULL");
    expect(run).not.toContain('CREATE FUNCTION public.fn_habit_log_guard()');
    expect(run).toContain('038 is still applied');
  });

  it('the second pass expects 038 to refuse once it is gone', () => {
    const run = step('Second rollback pass changes nothing (036 refuses once it is gone)');
    expect(run).toContain('elif [ "${num}" = "038" ]; then');
    expect(run).toContain('grep -q "038 is not applied" "$err"');
  });

  it('DB2-07 rolls 038 back first and applies it again at the end', () => {
    const run = step('Rollback 036 keeps the XP books straight when the ledger holds more than habit_logs (DB2-07)');
    const back = run.indexOf("-c \"SET aderyth.rollback_confirm = '038'\" -f supabase/rollbacks/038_xp_streak_integrity.rollback.sql");
    const again = run.lastIndexOf('-f supabase/migrations/038_xp_streak_integrity.sql');
    expect(back).toBeGreaterThan(-1);
    expect(back).toBeLessThan(run.indexOf('INSERT INTO auth.users'));
    expect(again).toBeGreaterThan(run.lastIndexOf('-f supabase/migrations/036_live_audit_hardening.sql'));
  });

  it('038 then 036 on rows written under 038: a real excess, then no second transfer', () => {
    const name = 'Rollback 038 then 036 on rows written under 038 keeps the XP books straight (no second transfer)';
    const run = step(name);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('test "${excess}" -gt 0'); // the fixture is not vacuous
    expect(run).toContain('NOT EXISTS (SELECT 1 FROM public.habits h WHERE h.id = a.habit_id)'); // an orphan exists
    expect(run).toContain("'F03 Yürüyüş '"); // recreated under the same name
    const rb038 = run.indexOf("SET aderyth.rollback_confirm = '038'");
    const rb036 = run.indexOf("SET aderyth.rollback_confirm = '036'");
    expect(rb038).toBeGreaterThan(-1);
    expect(rb036).toBeGreaterThan(rb038);
    expect(run.slice(rb038, rb036)).toContain('test "$(psql -X -At -v ON_ERROR_STOP=1 -c "${excess_sql}")" = "0"');
    expect(run.slice(rb036)).toContain('= "${purged}"');
    expect(run.slice(rb036)).toContain('-f supabase/migrations/038_xp_streak_integrity.sql');
    // between DB2-07 and the coach step, so the steps below find every migration applied
    expect(at(name)).toBeGreaterThan(at('Rollback 036 keeps the XP books straight'));
    expect(at(name)).toBeLessThan(at('Coach CHECK rollbacks keep rows of a newer type'));
  });
});

// ---------------------------------------------------------------------------------------
describe('038: the client half of the contract', () => {
  it('maps the two refusals to calm Turkish copy and passes anything else through unchanged', () => {
    expect(describeHabitLogError('new row violates: habit_log_day_out_of_range')).toBe(LOGGABLE_DAY_MESSAGE);
    expect(describeHabitLogError(HABIT_LOG_KEY_IMMUTABLE)).toBe(LOG_KEY_IMMUTABLE_MESSAGE);
    expect(describeHabitLogError('permission denied for table weekly_xp')).toBe('permission denied for table weekly_xp');
    expect(describeHabitLogError(null)).toBe('');
    expect(describeHabitLogError(undefined)).toBe('');
  });

  it('recognises the window refusal by its token, not by the code alone', () => {
    expect(isHabitLogDayOutOfRange({ code: '22023', message: 'habit_log_day_out_of_range' })).toBe(true);
    expect(isHabitLogDayOutOfRange('habit_log_day_out_of_range')).toBe(true);
    expect(isHabitLogDayOutOfRange({ code: '22023', message: 'invalid input value for enum' })).toBe(false);
    expect(isHabitLogDayOutOfRange({ code: '22023', message: null })).toBe(false);
    expect(isHabitLogDayOutOfRange(null)).toBe(false);
  });

  it('the copy blames no one and says what can be done', () => {
    for (const msg of [LOGGABLE_DAY_MESSAGE, LOG_KEY_IMMUTABLE_MESSAGE]) {
      expect({ msg, blaming: /hata|yanlış|başarısız|uyarı|!/i.test(msg) }).toEqual({ msg, blaming: false });
      expect(msg).toMatch(/ebilirsin\.$/);
    }
    expect(LOGGABLE_DAY_MESSAGE).toContain(`son ${LOGGABLE_DAYS_BACK} gün`);
  });

  /** frontend source files (no tests, no dependencies, no build output) */
  const sourceFiles = (): string[] => {
    const out: string[] = [];
    const skip = new Set(['node_modules', '__tests__', '.expo', 'dist', 'web-build', 'coverage', 'android', 'ios']);
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name) || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
      }
    };
    walk(FRONTEND);
    return out;
  };

  it('DB1-V01: no client code reads weekly_xp as a table; the board comes from the RPC', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const readers = files.filter((f) => /\.from\(\s*['"`]weekly_xp['"`]\s*\)/.test(readFileSync(f, 'utf8'))).map((f) => relative(FRONTEND, f));
    expect(readers).toEqual([]);
    const repo = read('frontend/repositories/profileRepository.ts');
    const fetch = repo.slice(repo.indexOf('export async function fetchLeaderboard'), repo.indexOf('export async function fetchMyRank'));
    expect(fetch).toContain("'get_weekly_leaderboard'");
    expect(fetch).toContain('supabase.rpc(fn,');
    expect(repo).toMatch(/DB1-V01[\s\S]*?`weekly_xp` is never read as a table[\s\S]*?export async function fetchLeaderboard/);
  });

  it('the table-read detector does catch one (synthetic)', () => {
    expect(/\.from\(\s*['"`]weekly_xp['"`]\s*\)/.test("supabase.from('weekly_xp').select('*')")).toBe(true);
    expect(/\.from\(\s*['"`]weekly_xp['"`]\s*\)/.test("supabase.rpc('get_weekly_leaderboard')")).toBe(false);
  });

  it('the store refuses an out-of-window day before the optimistic row and the queue', () => {
    const store = read('frontend/store/logStore.ts');
    const start = store.indexOf('logHabit: ({');
    const body = store.slice(start, store.indexOf('getLogForHabit: (', start));
    expect(body.length).toBeGreaterThan(500);
    const check = body.indexOf('if (!isLoggableDay(dateStr)) return Promise.resolve({ ok: false, error: LOGGABLE_DAY_MESSAGE });');
    expect(check).toBeGreaterThan(-1);
    for (const later of ['buildOptimisticLog(', 'enqueueOp(', 'saveSyncQueue(', 'serialise(']) {
      expect({ later, after: body.indexOf(later) > check }).toEqual({ later, after: true });
    }
  });

  it('the service translates every failure through one wrapper', () => {
    const svc = read('frontend/services/habitLogService.ts');
    expect(svc).toMatch(/export async function persistCompletion\(params: PersistParams\): Promise<PersistResult> \{\s+const res = await persistCompletionRaw\(params\);\s+if \(res\.ok\) return res;\s+return \{ \.\.\.res, error: describeHabitLogError\(res\.error\) \};\s+\}/);
    expect(svc).toMatch(/\nasync function persistCompletionRaw\(/); // not exported
    expect((svc.match(/export async function persistCompletion\b/g) ?? []).length).toBe(1);
  });

  it('the coach validates the day before it builds a card (INT-24)', () => {
    const src = read('frontend/lib/coachActions.ts');
    const at = src.indexOf("if (!date) return 'invalid date';");
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf("if (!isLoggableDay(date)) return 'date out of range';")).toBeGreaterThan(at);
  });
});
