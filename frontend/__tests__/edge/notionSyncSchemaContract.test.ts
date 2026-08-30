/**
 * `notion-sync` must query columns that exist, and must not launder a failed
 * query into an empty result.
 *
 * ## The defect this exists to prevent
 *
 * The deployed v1 selected `habit_logs.target_value` and filtered on
 * `habit_logs.date`. Neither column exists — the live columns are `value` and
 * `completed_at`, and the target lives on `habits.daily_goal`. PostgREST
 * rejected the query, so `logsRes.error` was set and `logsRes.data` was null.
 *
 * The error was never read. The next line was `(logsRes.data ?? [])`, which
 * yields `[]`, so nothing was built and the function returned:
 *
 *     { success: true, synced_habits: 0, errors: 0 }
 *
 * Habit sync had never once worked, and every user was told it had. Two
 * things made that possible and both are checked here: a column name that
 * did not exist, and a `?? []` standing in for an unchecked error. The second
 * is the more dangerous of the two, because it makes ANY future query mistake
 * silent in exactly the same way.
 *
 * ## Why source text
 *
 * The function is Deno and talks to the Notion API; the properties below are
 * structural (which columns are named, whether an error is checked before its
 * data is used), which the source answers directly.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const REPO = join(__dirname, '..', '..', '..');
const SRC = join(REPO, 'supabase', 'functions', 'notion-sync', 'index.ts');

const fn = stripComments(readFileSync(SRC, 'utf8'));

/**
 * Columns confirmed present on the canonical project (kbcuolhjjnmhjaarxxmu)
 * by `information_schema.columns` on 2026-08-30. If a query below names
 * something outside this set, either the schema moved or the query is wrong —
 * both are worth failing for.
 */
const LIVE_COLUMNS: Record<string, readonly string[]> = {
  habit_logs: [
    'id', 'habit_id', 'user_id', 'completed_at', 'is_completed', 'current_streak',
    'notes', 'mood_rating', 'created_at', 'photo_url', 'voice_note_url', 'caption',
    'value', 'is_makeup', 'state', 'xp',
  ],
  habits: [
    'id', 'user_id', 'name', 'unit', 'daily_goal', 'status', 'is_active',
    'tracking_type', 'behavior_type', 'target_direction', 'icon', 'color',
  ],
  tasks: [
    'id', 'user_id', 'title', 'status', 'priority', 'due_date', 'completed',
    'completed_at', 'project_id', 'list_type',
  ],
};

/** `.from('x')...select('a, b, c')` → the column list for table x. */
function selectedColumns(table: string): string[] {
  const re = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,200}?\\.select\\('([^']+)'\\)`);
  const m = fn.match(re);
  if (!m) throw new Error(`no .select() found for table '${table}'`);
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** Every `.eq('col', …)` applied to a given table's query chain. */
function filterColumns(table: string): string[] {
  const re = new RegExp(`from\\('${table}'\\)([\\s\\S]{0,400}?)(?:,\\n\\s*supabase|\\]\\))`);
  const chain = fn.match(re)?.[1] ?? '';
  return [...chain.matchAll(/\.eq\('([^']+)'/g)].map((m) => m[1]);
}

describe('notion-sync — every queried column exists', () => {
  it.each(['habit_logs', 'habits', 'tasks'])('%s: selected columns are all real', (table) => {
    const cols = selectedColumns(table);
    expect(cols.length).toBeGreaterThan(0);
    const unknown = cols.filter((c) => !LIVE_COLUMNS[table].includes(c));
    expect(unknown).toEqual([]);
  });

  it.each(['habit_logs', 'habits', 'tasks'])('%s: filtered columns are all real', (table) => {
    const unknown = filterColumns(table).filter((c) => !LIVE_COLUMNS[table].includes(c));
    expect(unknown).toEqual([]);
  });

  it('habit_logs is dated by completed_at — `date` is not a column and was the bug', () => {
    expect(filterColumns('habit_logs')).toContain('completed_at');
    expect(fn).not.toMatch(/from\('habit_logs'\)[\s\S]{0,300}?\.eq\('date'/);
  });

  it('habit_logs does not select target_value — the target lives on habits.daily_goal', () => {
    expect(selectedColumns('habit_logs')).not.toContain('target_value');
    expect(selectedColumns('habits')).toContain('daily_goal');
  });

  it('habit_logs is scoped to the user explicitly, not by RLS alone', () => {
    expect(filterColumns('habit_logs')).toContain('user_id');
  });
});

describe('notion-sync — a failed read cannot masquerade as an empty one', () => {
  it('every query result has its error inspected', () => {
    for (const res of ['logsRes', 'habitsRes', 'tasksRes']) {
      expect(fn).toContain(`${res}.error`);
    }
  });

  it('the error check happens BEFORE any .data is consumed', () => {
    const firstErrorCheck = Math.min(
      ...['logsRes.error', 'habitsRes.error', 'tasksRes.error'].map((s) => fn.indexOf(s)),
    );
    const firstDataUse = Math.min(
      ...['logsRes.data', 'habitsRes.data', 'tasksRes.data']
        .map((s) => fn.indexOf(s))
        .filter((i) => i >= 0),
    );
    expect(firstErrorCheck).toBeGreaterThan(-1);
    expect(firstDataUse).toBeGreaterThan(firstErrorCheck);
  });

  it('a read error returns a failure response rather than continuing', () => {
    expect(fn).toMatch(/if \(readError\)[\s\S]{0,200}success: false/);
  });

  it('success is computed, never the literal the old version always returned', () => {
    expect(fn).not.toMatch(/success:\s*true/);
    expect(fn).toMatch(/success:\s*allOk/);
  });
});
