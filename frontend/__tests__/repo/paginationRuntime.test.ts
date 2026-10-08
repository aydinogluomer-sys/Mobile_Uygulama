/**
 * Keyset pagination, exercised against a fake that behaves like the database.
 *
 * Structural presence is not the property that matters. "There is a cursor in
 * the code" says nothing about whether page 2 starts where page 1 stopped,
 * whether a row can appear twice, or whether one can be skipped entirely at a
 * page boundary — which is exactly where keyset paging goes wrong.
 *
 * The fake implements the three things the real query does and nothing else:
 * an owner filter, `ORDER BY (key DESC, id DESC)`, and the compound cursor
 * predicate `key < k OR (key = k AND id < i)`.
 */

type Row = { id: string; user_id: string; updated_at: string; title: string };

/**
 * A `from()` that understands ordering, the compound cursor and `limit`.
 * The shared mock deliberately ignores ordering — that is fine for the
 * boundary tests, and useless here, where ordering IS the subject.
 */
function pagingMock(rows: Row[]) {
  return {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
    from: () => {
      const state = {
        userId: '',
        cursor: null as null | { key: string; id: string },
        limit: 1000,
        // The fake honours the requested DIRECTION. An earlier version sorted
        // descending unconditionally, which meant flipping the repository to
        // ascending changed nothing here — the test would have passed a
        // pagination scheme that walks the collection the wrong way.
        ascending: false,
        secondaryAscending: false,
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => { if (col === 'user_id') state.userId = val; return q; },
        is: () => q, neq: () => q, in: () => q, gte: () => q, ilike: () => q,
        or: (expr: string) => {
          // `updated_at.lt.<k>,and(updated_at.eq.<k>,id.lt.<i>)`
          const k = /updated_at\.lt\.([^,]+)/.exec(expr)?.[1];
          const i = /id\.lt\.([^)]+)/.exec(expr)?.[1];
          if (k && i) state.cursor = { key: k, id: i };
          return q;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          if (col === 'id') state.secondaryAscending = opts?.ascending ?? true;
          else state.ascending = opts?.ascending ?? true;
          return q;
        },
        limit: (n: number) => { state.limit = n; return q; },
        then: (onOk: (v: unknown) => unknown) => {
          let out = rows.filter((r) => r.user_id === state.userId);
          const dir = state.ascending ? 1 : -1;
          const dir2 = state.secondaryAscending ? 1 : -1;
          out.sort((a, b) =>
            a.updated_at === b.updated_at
              ? dir2 * a.id.localeCompare(b.id)
              : dir * a.updated_at.localeCompare(b.updated_at));
          if (state.cursor) {
            const { key, id } = state.cursor;
            // The cursor predicate is "strictly before" in the DESCENDING
            // order the repository builds. Under an ascending order it
            // excludes the rows that should come next, which is the bug
            // mutation C introduces.
            out = out.filter((r) => r.updated_at < key || (r.updated_at === key && r.id < id));
          }
          return Promise.resolve({ data: out.slice(0, state.limit), error: null }).then(onOk);
        },
      };
      return q;
    },
  };
}

let rows: Row[] = [];
let mock = pagingMock(rows);

jest.mock('../../lib/supabase', () => ({
  get supabase() { return mock; },
}));

import { fetchPage, type Cursor } from '../../repositories/shared';

const makeRows = (n: number, sameTimestamp = false): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(3, '0')}`,
    user_id: 'u1',
    // Descending timestamps so row 0 is newest — unless the tie case wants
    // them identical.
    updated_at: sameTimestamp
      ? '2026-08-30T00:00:00Z'
      : `2026-08-${String(28 - (i % 28)).padStart(2, '0')}T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`,
    title: `row ${i}`,
  }));

const page = (cursor: Cursor | null, limit = 30) =>
  fetchPage<Row>({ table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1', cursor, limit });

async function drain(limit = 30) {
  const seen: Row[] = [];
  const flags: boolean[] = [];
  let cursor: Cursor | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const res = await page(cursor, limit);
    if (!res.ok) throw new Error(res.error);
    seen.push(...res.data.rows);
    flags.push(res.data.hasMore);
    if (!res.data.hasMore) break;
    cursor = res.data.nextCursor;
  }
  return { seen, flags };
}

beforeEach(() => {
  rows = makeRows(65);
  mock = pagingMock(rows);
});

describe('65 rows at a page size of 30', () => {
  it('walks 30 / 30 / 5 and stops', async () => {
    const { seen, flags } = await drain(30);
    expect(flags).toEqual([true, true, false]);
    expect(seen).toHaveLength(65);
  });

  it('returns every row exactly once — no duplicates, nothing missing', async () => {
    const { seen } = await drain(30);
    const ids = seen.map((r) => r.id);
    expect(new Set(ids).size).toBe(65);
    expect([...ids].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('each page is itself duplicate-free and correctly sized', async () => {
    let cursor: Cursor | null = null;
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await page(cursor, 30);
      if (!res.ok) throw new Error(res.error);
      sizes.push(res.data.rows.length);
      expect(new Set(res.data.rows.map((r) => r.id)).size).toBe(res.data.rows.length);
      cursor = res.data.nextCursor;
    }
    expect(sizes).toEqual([30, 30, 5]);
  });
});

describe('a row inserted above page 1 does not corrupt page 2', () => {
  it('neither duplicates nor skips at the boundary', async () => {
    const first = await page(null, 30);
    if (!first.ok) throw new Error(first.error);
    const firstIds = first.data.rows.map((r) => r.id);

    // Someone adds a note while the user is looking at page 1. Under OFFSET
    // paging this shifts everything by one and the last row of page 1
    // reappears first on page 2.
    rows.unshift({
      id: 'id-NEW', user_id: 'u1',
      updated_at: '2026-08-31T00:00:00Z', title: 'inserted mid-scroll',
    });

    const second = await page(first.data.nextCursor, 30);
    if (!second.ok) throw new Error(second.error);
    const secondIds = second.data.rows.map((r) => r.id);

    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    // The new row sorts above page 1, so it is correctly absent from page 2
    // rather than pushing an old row into it.
    expect(secondIds).not.toContain('id-NEW');
  });

  it('a row deleted from page 1 does not skip a row on page 2', async () => {
    const first = await page(null, 30);
    if (!first.ok) throw new Error(first.error);
    const removed = first.data.rows[0].id;
    rows = rows.filter((r) => r.id !== removed);
    mock = pagingMock(rows);

    const second = await page(first.data.nextCursor, 30);
    if (!second.ok) throw new Error(second.error);
    // The cursor points at the LAST row of page 1, which still exists, so
    // page 2 is unaffected by a deletion above it.
    expect(second.data.rows).toHaveLength(30);
    expect(new Set(second.data.rows.map((r) => r.id)).size).toBe(30);
  });
});

describe('identical timestamps — the id tie-breaker earns its place', () => {
  beforeEach(() => {
    // Every row updated in the same bulk edit.
    rows = makeRows(65, true);
    mock = pagingMock(rows);
  });

  it('still returns all 65 exactly once', async () => {
    const { seen, flags } = await drain(30);
    expect(flags).toEqual([true, true, false]);
    expect(new Set(seen.map((r) => r.id)).size).toBe(65);
  });

  it('the cursor carries the id, not just the ordering column', async () => {
    const first = await page(null, 30);
    if (!first.ok) throw new Error(first.error);
    // With a key-only cursor every row shares the same key, so page 2 would
    // either repeat page 1 entirely or return nothing.
    expect(first.data.nextCursor?.id).toBe(first.data.rows[29].id);
    expect(first.data.nextCursor?.key).toBe('2026-08-30T00:00:00Z');
  });
});

describe('edge sizes', () => {
  it('exactly one full page reports no more', async () => {
    rows = makeRows(30);
    mock = pagingMock(rows);
    const res = await page(null, 30);
    if (!res.ok) throw new Error(res.error);
    // The +1 probe is what distinguishes "exactly a page" from "a page and
    // then some" without a second count query.
    expect(res.data.rows).toHaveLength(30);
    expect(res.data.hasMore).toBe(false);
    expect(res.data.nextCursor).toBeNull();
  });

  it('one row over a page reports more', async () => {
    rows = makeRows(31);
    mock = pagingMock(rows);
    const res = await page(null, 30);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.rows).toHaveLength(30);
    expect(res.data.hasMore).toBe(true);
  });

  it('another user sees none of these rows', async () => {
    const res = await fetchPage<Row>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'someone-else', cursor: null,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.rows).toEqual([]);
  });
});

// R10.06 — "Büyük liste pagination ... testlerini kontrollü ortamda doğrula."
// A long-lived account: 10.000 rows where most share a timestamp with many
// others (bulk imports, restores), walked at the app's page size.
describe('R10.06 — a large list: 10.000 rows, heavy timestamp ties', () => {
  const N = 10_000;
  const big = (): Row[] => Array.from({ length: N }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    user_id: 'u1',
    // 40 distinct instants for 10.000 rows: 250 rows tie on each one.
    updated_at: `2026-09-${String(1 + (i % 20)).padStart(2, '0')}T${i % 2 ? '08' : '20'}:00:00Z`,
    title: `row ${i}`,
  }));

  it('every row exactly once, in key order, every page full until the last', async () => {
    rows = big();
    mock = pagingMock(rows);
    const seen: Row[] = [];
    const sizes: number[] = [];
    let cursor: Cursor | null = null;
    for (let guard = 0; guard < 1000; guard++) {
      const res = await page(cursor, 30);
      if (!res.ok) throw new Error(res.error);
      seen.push(...res.data.rows);
      sizes.push(res.data.rows.length);
      if (!res.data.hasMore) break;
      cursor = res.data.nextCursor;
    }
    expect(seen).toHaveLength(N);
    expect(new Set(seen.map((r) => r.id)).size).toBe(N);
    expect(sizes).toHaveLength(Math.ceil(N / 30));
    expect(sizes.slice(0, -1).every((s) => s === 30)).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1], b = seen[i];
      const ordered = a.updated_at > b.updated_at || (a.updated_at === b.updated_at && a.id > b.id);
      if (!ordered) throw new Error(`order broken at ${i}: ${a.id} -> ${b.id}`);
    }
  });
});
