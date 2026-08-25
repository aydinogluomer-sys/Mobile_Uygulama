/**
 * Rule 4 enforcement: "UI does not query the database directly."
 * (Phase 1 repository layer, plan §5 Rule 4)
 *
 * This test asserts a property of the SOURCE TEXT, not of runtime behaviour,
 * and says so rather than pretending otherwise -- the same instrument
 * `noUtcDayKeys.test.ts` and `logHabitErrorsSurfaced.test.ts` use, and for the
 * same reason: the defect this guards against is mechanical (a raw
 * `supabase.from(`/`supabase.rpc(` call sitting inside a screen or
 * component), not something that needs a rendered component to observe.
 *
 * BACKGROUND (docs/ARCHITECTURE_V2.md §3). The first Rule 4 audit used a
 * single-line grep (`supabase\.from\(`) and reported ONE violation. That was
 * wrong: this codebase's dominant call style splits `supabase` and `.from(`/
 * `.rpc(` across lines --
 *
 *   const { data } = await supabase
 *     .from('habit_logs')
 *     .select(...)
 *
 * -- which a single-line pattern never matches. A corrected, multi-line-aware
 * scan found the real number: 16 violations across 9 files (10 in `app/**`
 * across 5 files, 6 in `components/**` across 4 files). This test is that
 * corrected scan, kept as a permanent regression fence so the miscount cannot
 * quietly happen again -- see the scanner-sanity block below, which proves
 * the pattern actually catches the multi-line shape before trusting it to
 * find zero violations.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['app', 'components'];

/**
 * `\s*` already matches newlines in JS regex (no `/s` flag needed), so this
 * one pattern catches both the single-line form (`supabase.from(`) and the
 * multi-line form the original audit missed (`supabase\n  .from(`).
 *
 * The captured verb is restricted to `from`/`rpc` ON PURPOSE, which is what
 * excludes the two call shapes Rule 4 does NOT govern:
 *   - `supabase.auth.*`        -- session/user lookup, not a data query.
 *   - `supabase.functions.invoke(...)` -- calling a deployed edge function,
 *     not a direct table/RPC query against Postgres.
 * Neither `auth` nor `functions` matches the `(from|rpc)` alternation, so
 * both are structurally excluded rather than filtered out after the fact --
 * there is no separate allowlist to keep in sync.
 */
const DIRECT_DB_CALL = /supabase\s*\.\s*(from|rpc)\s*\(/;
const DIRECT_DB_CALL_G = /supabase\s*\.\s*(from|rpc)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function rel(absPath: string): string {
  return absPath.slice(ROOT.length + 1).replace(/\\/g, '/');
}

/** 1-based line number of a character offset, for a readable hit list. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function violations(): string[] {
  const hits: string[] = [];
  for (const dir of SCANNED) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(DIRECT_DB_CALL_G)) {
        hits.push(`${rel(file)}:${lineOf(text, m.index ?? 0)}`);
      }
    }
  }
  return hits;
}

describe('Rule 4 -- UI does not query the database directly', () => {
  it('finds no supabase.from(/supabase.rpc( anywhere in app/** or components/**', () => {
    expect(violations()).toEqual([]);
  });

  it('scans a non-trivial number of files', () => {
    // Guard against the check silently passing because it matches nothing.
    const count = SCANNED.reduce((n, d) => n + walk(join(ROOT, d)).length, 0);
    expect(count).toBeGreaterThan(40);
  });
});

describe('scanner sanity -- the multi-line-aware pattern actually detects a multi-line violation', () => {
  it('matches the single-line form', () => {
    expect(DIRECT_DB_CALL.test("supabase.from('habit_logs')")).toBe(true);
  });

  it('matches this codebase\'s dominant multi-line form -- the shape the original single-line grep missed', () => {
    const snippet = [
      "const { data } = await supabase",
      "  .from('habit_logs')",
      "  .select('*');",
    ].join('\n');
    expect(DIRECT_DB_CALL.test(snippet)).toBe(true);
  });

  it('matches supabase.rpc( on its own line too', () => {
    const snippet = ["await supabase", "  .rpc('get_weekly_leaderboard')"].join('\n');
    expect(DIRECT_DB_CALL.test(snippet)).toBe(true);
  });

  it('does NOT flag supabase.auth.* -- session/user lookups are not Rule 4 violations', () => {
    expect(DIRECT_DB_CALL.test('const { data: { user } } = await supabase.auth.getUser();')).toBe(false);
    const multiline = ['await supabase', '  .auth', '  .getUser();'].join('\n');
    expect(DIRECT_DB_CALL.test(multiline)).toBe(false);
  });

  it('does NOT flag supabase.functions.invoke(...) -- an edge-function call is not a direct DB query', () => {
    expect(DIRECT_DB_CALL.test("await supabase.functions.invoke('spotify-auth', { body })")).toBe(false);
  });

  it('does not fire merely because the word "supabase" appears on the line', () => {
    expect(DIRECT_DB_CALL.test('const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL; from(x);')).toBe(false);
  });
});
