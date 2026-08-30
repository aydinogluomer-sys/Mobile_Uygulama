/**
 * The data-access boundary: only `repositories/` talks to the database.
 *
 *     UI ──▶ store ──▶ repository ──▶ supabase
 *
 * A companion to `rule4NoDirectDbInUi`, which already pinned the UI half.
 * This pins the store half, which was the larger violation: eleven stores
 * held 34 direct `supabase.from(...)` calls between them, most of them
 * unbounded reads with no `user_id` filter and mutations keyed on `id` alone
 * whose results were discarded.
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

describe('list reads are bounded', () => {
  const repos = sourcesIn('repositories');

  it('every repository that selects a collection bounds it', () => {
    // A `.select()` that is neither paginated, single-row, windowed by date,
    // nor explicitly limited is the unbounded read this refactor removed.
    const unbounded: string[] = [];
    for (const r of repos) {
      if (r.path.endsWith('shared.ts')) continue;
      if (!DB_CALL.test(r.code)) continue;
      const bounded =
        /\.limit\(/.test(r.code) ||
        /fetchPage(<|\()/.test(r.code) ||
        /\.single\(\)|\.maybeSingle\(\)/.test(r.code) ||
        /\.gte\(/.test(r.code) ||
        /count:\s*'exact'/.test(r.code);
      if (!bounded) unbounded.push(r.path);
    }
    expect(unbounded).toEqual([]);
  });
});
