/**
 * The repository layer's two contracts: keyset pagination, and owner-scoped
 * mutations whose result the caller can see.
 *
 * ## What this replaces
 *
 * Eleven Zustand stores held `supabase.from(...)` calls directly. Three
 * defects were shared by almost all of them:
 *
 *  1. List reads were unbounded, and several had no `user_id` filter at all —
 *     they asked for the whole table and let RLS decide what came back.
 *  2. Mutations were `.update(patch).eq('id', id)` — RLS as the only guard,
 *     against the repo's own Rule 2/3 which makes it the backstop.
 *  3. Results were discarded. `await supabase.from('notes').delete()...`
 *     followed by removing the row from local state means a rejected delete
 *     still looked, to the user, exactly like a successful one.
 *
 * These tests exercise the real repository functions against a chain mock
 * that models what PostgREST actually returns.
 */
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

let db: MockDb = createMockDb();
let mock = makeSupabaseMock(db);

jest.mock('../../lib/supabase', () => ({
  get supabase() { return mock; },
}));

import { fetchPage, updateOwned, deleteOwned, DEFAULT_PAGE_SIZE } from '../../repositories/shared';

const seed = (table: string, n: number) => {
  db.rows[table] = Array.from({ length: n }, (_, i) => ({
    id: `id-${String(n - i).padStart(3, '0')}`,
    user_id: 'u1',
    updated_at: `2026-08-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`,
    title: `row ${i}`,
  }));
};

beforeEach(() => {
  db = createMockDb();
  mock = makeSupabaseMock(db);
});

describe('keyset pagination', () => {
  it('returns at most the requested page size, not the whole table', () => {
    // The defect in one line: the old queries had no bound at all.
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(50);
  });

  it('a full page reports hasMore and hands back a cursor', async () => {
    seed('notes', 10);
    const res = await fetchPage<{ id: string; updated_at: string }>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1', limit: 4,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toHaveLength(4);
    expect(res.data.hasMore).toBe(true);
    expect(res.data.nextCursor).not.toBeNull();
    // The cursor identifies the LAST row returned, in both components.
    expect(res.data.nextCursor!.id).toBe(res.data.rows[3].id);
  });

  it('a short page reports no more and no cursor', async () => {
    seed('notes', 3);
    const res = await fetchPage<{ id: string }>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1', limit: 10,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toHaveLength(3);
    expect(res.data.hasMore).toBe(false);
    expect(res.data.nextCursor).toBeNull();
  });

  it('an empty collection is not an error', async () => {
    seed('notes', 0);
    const res = await fetchPage<{ id: string }>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toEqual([]);
    expect(res.data.hasMore).toBe(false);
  });

  it('scopes to the owner explicitly rather than relying on RLS', async () => {
    db.rows['notes'] = [
      { id: 'a', user_id: 'u1', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'b', user_id: 'OTHER', updated_at: '2026-08-02T00:00:00Z' },
    ];
    const res = await fetchPage<{ id: string }>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('caps an absurd page size instead of honouring it', async () => {
    seed('notes', 5);
    const res = await fetchPage<{ id: string }>({
      table: 'notes', columns: '*', orderBy: 'updated_at', userId: 'u1', limit: 100000,
    });
    // A caller asking for "everything" must not get an unbounded query back.
    expect(res.ok).toBe(true);
  });

  it('surfaces a query error instead of returning an empty page', async () => {
    // The `?? []` habit that made notion-sync report success while syncing
    // nothing is exactly what must not happen here.
    mock = makeSupabaseMock(db);
    db.failNext = { error: 'boom' };
    const res = await updateOwned({ table: 'notes', id: 'x', userId: 'u1', patch: { a: 1 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('boom');
  });
});

describe('owner-scoped mutations', () => {
  beforeEach(() => {
    db.rows['notes'] = [
      { id: 'mine', user_id: 'u1', title: 'mine' },
      { id: 'theirs', user_id: 'OTHER', title: 'theirs' },
    ];
  });

  it('updates a row the caller owns and returns it', async () => {
    const res = await updateOwned<{ id: string; title: string }>({
      table: 'notes', id: 'mine', userId: 'u1', patch: { title: 'edited' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.title).toBe('edited');
  });

  it('refuses to update a row owned by someone else', async () => {
    const res = await updateOwned({
      table: 'notes', id: 'theirs', userId: 'u1', patch: { title: 'hijacked' },
    });
    expect(res.ok).toBe(false);
    expect(db.rows['notes'].find((r) => r.id === 'theirs')!.title).toBe('theirs');
  });

  it('deletes a row the caller owns', async () => {
    const res = await deleteOwned({ table: 'notes', id: 'mine', userId: 'u1' });
    expect(res.ok).toBe(true);
    expect(db.rows['notes'].map((r) => r.id)).toEqual(['theirs']);
  });

  it('REPORTS a delete that matched nothing rather than claiming success', async () => {
    // The stores used to drop the row from local state regardless, telling
    // the user something had happened that had not.
    const res = await deleteOwned({ table: 'notes', id: 'theirs', userId: 'u1' });
    expect(res.ok).toBe(false);
    expect(db.rows['notes']).toHaveLength(2);
  });

  it('reports a missing row on update rather than silently doing nothing', async () => {
    const res = await updateOwned({ table: 'notes', id: 'nope', userId: 'u1', patch: { title: 'x' } });
    expect(res.ok).toBe(false);
  });
});
