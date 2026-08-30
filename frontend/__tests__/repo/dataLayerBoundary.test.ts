/**
 * The data-access boundary: only `repositories/` talks to the database.
 *
 *     UI ──▶ store ──▶ repository ──▶ supabase
 *
 * A companion to `rule4NoDirectDbInUi`, which already pinned the UI half.
 * This pins the store half, which was the larger violation: **17 stores held
 * 72 direct `supabase.from(...)` calls** between them, most of them unbounded
 * reads with no `user_id` filter and mutations keyed on `id` alone whose
 * results were discarded.
 *
 * (An earlier count said 34 across 11. It was taken with the pattern
 * `supabase\.from\(`, which misses the multi-line form this codebase mostly
 * uses -- `await supabase
  .from('habits')`. More than half the call sites
 * were invisible to it. The regex below is whitespace-tolerant for exactly
 * that reason.)
 *
 * ## Comments are stripped first, and that is not a detail
 *
 * Several of these stores now DOCUMENT the calls they used to make —
 * "this store used to hold `supabase.from('notes')` calls directly". A naive
 * `includes('supabase.from(')` counts those and reports violations that do
 * not exist, which is how the first measurement of this refactor came back
 * wrong. The shared stripper (`__tests__/helpers/sourceText.ts`) exists
 * because that class of false reading has bitten this repository repeatedly.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const sourcesIn = (dir: string, exts = ['.ts', '.tsx']): { path: string; code: string }[] => {
  const out: { path: string; code: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!exts.some((e) => entry.name.endsWith(e))) continue;
      out.push({ path: p.slice(ROOT.length + 1).replace(/\\/g, '/'), code: stripComments(readFileSync(p, 'utf8')) });
    }
  };
  walk(join(ROOT, dir));
  return out;
};

const DB_CALL = /supabase\s*\.\s*from\s*\(/;

describe('the stripper is doing its job (everything below depends on it)', () => {
  it('a documented call in a comment is not a call', () => {
    const fixture = "// this used to be supabase.from('notes')\nconst x = 1;";
    expect(DB_CALL.test(stripComments(fixture))).toBe(false);
  });

  it('a real call is still a call', () => {
    expect(DB_CALL.test(stripComments("await supabase.from('notes').select('*');"))).toBe(true);
  });

  it('at least one store really does mention a call in prose — so stripping matters', () => {
    const raw = readFileSync(join(ROOT, 'store', 'noteStore.ts'), 'utf8');
    expect(raw).toMatch(/supabase\.from/);           // present in the file
    expect(DB_CALL.test(stripComments(raw))).toBe(false); // but not as code
  });
});

describe('no store reaches the database directly', () => {
  const stores = sourcesIn('store');

  it('finds the stores (scanner sanity)', () => {
    expect(stores.length).toBeGreaterThan(10);
  });

  it('none of them calls supabase.from', () => {
    const offenders = stores.filter((f) => DB_CALL.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('no screen or component reaches the database directly', () => {
  it('app/ and components/ are clean', () => {
    const offenders = [...sourcesIn('app'), ...sourcesIn('components')]
      .filter((f) => DB_CALL.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('the repository layer exists and is where the queries live', () => {
  const repos = sourcesIn('repositories');

  it('covers the domains the stores gave up', () => {
    const names = repos.map((r) => r.path.split('/').pop()!);
    for (const expected of [
      'noteRepository.ts', 'projectRepository.ts', 'readingListRepository.ts',
      'goalRepository.ts', 'okrRepository.ts', 'deepWorkRepository.ts',
      'taskRepository.ts', 'habitRepository.ts', 'recoveryRepository.ts',
      'routineRepository.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('is the only place `supabase.from` appears outside lib/', () => {
    const withQueries = repos.filter((r) => DB_CALL.test(r.code));
    // If this ever hits zero the queries have moved somewhere unexpected,
    // which matters as much as them being in the wrong place.
    expect(withQueries.length).toBeGreaterThan(5);
  });
});

// The file-level bounding check that used to live here has been REMOVED and
// replaced by `queryBounding.test.ts`, which classifies each query chain
// individually. The old check asked whether a repository FILE contained a
// bound, so a file with one paginated query and one unbounded query passed.
// Demonstrated rather than assumed: adding an unbounded second query to
// noteRepository turns the per-query gate red while the file-level gate stays
// green. Keeping both would have left a check that grants false confidence.

describe('pagination reaches the user, not just the query', () => {
  const screens = [
    { path: 'app/screens/notes.tsx', store: 'store/noteStore.ts' },
    { path: 'app/screens/projects.tsx', store: 'store/projectStore.ts' },
    { path: 'app/tabs/tasks.tsx', store: 'store/taskStore.ts' },
    { path: 'app/screens/reading-list.tsx', store: 'store/readingListStore.ts' },
  ];

  it.each(screens)('$path offers a way to load the next page', ({ path }) => {
    // A paginated list with no affordance to continue is indistinguishable
    // from a list that simply ends — which is the exact failure a bare
    // `.limit()` would have introduced, dressed up as a fix.
    const code = stripComments(readFileSync(join(ROOT, path), 'utf8'));
    expect(code).toContain('LoadMoreFooter');
    expect(code).toMatch(/loadMore/);
  });

  it.each(screens)('$store exposes hasMore and loadMore', ({ store }) => {
    const code = stripComments(readFileSync(join(ROOT, store), 'utf8'));
    expect(code).toMatch(/hasMore/);
    expect(code).toMatch(/loadMore/);
  });

  it('the command palette searches the server, not the loaded page', () => {
    // It used to filter the stores' in-memory arrays, which was only correct
    // while those arrays were the whole table.
    const code = stripComments(readFileSync(join(ROOT, 'components/CommandPalette.tsx'), 'utf8'));
    // The four per-domain searches moved behind one service call, which also
    // owns the per-source limit and the "a failed source contributes nothing"
    // policy. The invariant is unchanged: the palette must not filter memory.
    expect(code).toContain('searchEverything(');
    expect(code).not.toMatch(/tasks\.filter\([^)]*toLowerCase/);
    const svc = stripComments(readFileSync(join(ROOT, 'services/searchService.ts'), 'utf8'));
    for (const fn of ['searchTasks', 'searchNotes', 'searchProjects', 'searchHabits']) {
      expect(svc).toContain(fn);
    }
  });
});

describe('the data layer does not pay for auth on every query', () => {
  const shared = stripComments(readFileSync(join(ROOT, 'repositories', 'shared.ts'), 'utf8'));

  it('currentUserId reads the LOCAL session, not the auth API', () => {
    // `getUser()` always issues GET /auth/v1/user. Measured against the live
    // project, three repository operations cost three auth round trips and
    // 373 ms of pure waste; `getSession()` reads persisted state and costs
    // nothing. Six operations now issue ZERO auth requests.
    expect(shared).toContain('supabase.auth.getSession()');
    expect(shared).not.toContain('supabase.auth.getUser()');
  });

  it('the resolved id is actually used to scope queries', () => {
    // Reading the id locally is only safe because it is defence in depth on
    // top of RLS, not a replacement for it -- and that depends on the id
    // still being applied as a filter. Asserted on the code rather than on a
    // comment, which the stripper removes anyway.
    expect(shared).toContain(".eq('user_id', params.userId)");
    const repos = sourcesIn('repositories').filter((r) => !r.path.endsWith('shared.ts'));
    const scoped = repos.filter((r) => /\.eq\('user_id',\s*u\.userId\)/.test(r.code));
    expect(scoped.length).toBeGreaterThan(8);
  });
});
