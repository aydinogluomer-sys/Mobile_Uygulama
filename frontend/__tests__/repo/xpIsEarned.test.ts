/**
 * XP is earned, not declared.
 *
 * ## The defect this guards
 *
 * `get_global_leaderboard` ranks every user by `profiles.total_xp` and shows
 * `level` and `willpower_rank` beside it. `add_xp` — the function that writes
 * those three — was already locked to postgres and service_role. The TABLE
 * was not:
 *
 *     policy "Users can update own profile" USING (id = auth.uid())   -- no WITH CHECK
 *     column UPDATE grants to authenticated: total_xp, level, current_level_xp,
 *       next_level_xp, willpower_rank, coins, skill_points, makeup_credits, ...
 *
 * Verified live before the fix, as the `authenticated` role with an ordinary
 * user's claims: `update profiles set total_xp = 999999999, level = 99,
 * willpower_rank = 'Efsane'` succeeded. One PostgREST PATCH and the caller
 * tops the leaderboard every other user sees.
 *
 * Locking the function was necessary and not sufficient, because `add_xp` was
 * never the only way in. Migration 20260831_xp_integrity narrows the grant to
 * `username`, the single column the app writes.
 *
 * ## What THIS file can check
 *
 * The grant is the control and it lives in the database, proven there. What
 * jest can hold is the client's half of the contract: no code in this repo
 * writes a server-derived column. That matters because such code would not
 * fail loudly after the fix — PostgREST returns a 403 the repository would
 * surface as a save error, and someone would be tempted to "fix" it by
 * re-widening the grant.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

/** Columns only the server may write. */
const SERVER_OWNED = [
  'total_xp', 'current_level_xp', 'next_level_xp', 'level', 'willpower_rank',
  'coins', 'skill_points', 'makeup_credits', 'streak_record',
];

function sources(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  const skip = new Set(['node_modules', '.expo', 'dist', '__tests__', 'coverage', 'android', 'ios']);
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      out.push({ rel: r, code: stripComments(readFileSync(abs, 'utf8')) });
    }
  };
  walk(ROOT, '');
  return out;
}

describe('nothing in the app writes a server-derived profile column', () => {
  const files = sources();

  it('finds the source (scanner sanity)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /**
   * Only the payload of a write counts.
   *
   * A first version of this matched `total_xp\s*:` anywhere and flagged
   * `lib/supabase.ts` and `types/index.ts` — the ROW TYPES, which of course
   * name every column and write nothing. Reading `level` to render it is
   * normal and must stay allowed; what must not exist is the column as a key
   * in an insert/update/upsert body.
   */
  const writePayloads = files.flatMap((f) =>
    (f.code.match(/\.(update|upsert|insert)\(\s*\{[\s\S]{0,400}?\}/g) ?? [])
      .map((body) => ({ rel: f.rel, body })),
  );

  it('there are write payloads to inspect (scanner sanity)', () => {
    // If the matcher stopped matching, every assertion below would pass
    // vacuously -- the failure mode this repo keeps meeting.
    expect(writePayloads.length).toBeGreaterThan(5);
  });

  it.each(SERVER_OWNED)('no write payload sets %s', (col) => {
    const offenders = writePayloads
      // Whitespace is squeezed out of the payload FIRST, so the pattern needs
      // no backslash escape at all. That matters here: inside a template
      // literal a lone backslash-s is not an escape sequence and collapses to
      // a literal "s", which turned an earlier version of this into
      // `total_xps*:` — still matching the common `total_xp:` through zero
      // repetitions, so it looked correct, while silently missing
      // `total_xp :`. Removing the need for the escape removes the trap.
      .filter((w) => new RegExp(`(^|[^a-z_])${col}:`).test(w.body.replace(/\s+/g, '')))
      .map((w) => `${w.rel}: ${w.body.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });
});

describe('the one column the client owns', () => {
  const repo = stripComments(readFileSync(join(ROOT, 'repositories', 'profileRepository.ts'), 'utf8'));

  it('updateUsername writes username and nothing else', () => {
    expect(repo).toContain('.update({ username: trimmed || null })');
  });

  it('the profile insert carries only id and email', () => {
    // The row is created by a trigger for new accounts; this is the fallback
    // for older ones. Anything else here would be a client-set starting XP.
    expect(repo).toMatch(/\.insert\(\{\s*id:\s*u\.userId,\s*email:[^}]*\}\)/);
  });

  it('no update in this repository names a gamification column', () => {
    const updates = repo.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    expect(updates.length).toBeGreaterThan(0); // sanity: there is something to check
    for (const u of updates) {
      for (const col of SERVER_OWNED) expect(u).not.toContain(col);
    }
  });
});

describe('the canonical XP path is documented where it is enforced', () => {
  const mig = readFileSync(
    join(ROOT, '..', 'supabase', 'migrations', '20260831_xp_integrity.sql'),
    'utf8',
  );

  it('the migration names the reconstruction rule', () => {
    // profiles.total_xp should equal sum(habit_logs.xp): `fn_habit_log_award`
    // is the only live path in, and it adds exactly the positive delta.
    expect(mig).toContain('xp_drift');
    expect(mig).toContain('rebuild_profile_xp');
    expect(mig).toContain('sum(coalesce(hl.xp, 0))');
  });

  it('it retires the three unattached award functions by name', () => {
    for (const fn of ['process_habit_xp', 'trigger_xp_habit_completion', 'trigger_xp_task_completion']) {
      expect(mig).toContain(`drop function if exists public.${fn}()`);
    }
  });

  it('it narrows the grant rather than only adding a policy', () => {
    // A WITH CHECK constrains which ROWS may result, not which COLUMNS may be
    // set. Only the column grant stops a user editing their own total_xp.
    expect(mig).toContain('revoke update on public.profiles from authenticated');
    expect(mig).toContain('grant update (username) on public.profiles to authenticated');
  });
});
