/**
 * R08.01 — the backup reads a whole table keyset-paged by id: every row once,
 * in order, nothing skipped at page edges, and a ceiling reported as
 * truncation instead of a silent cut.
 */
const mockRows = Array.from({ length: 1234 }, (_, i) => ({ id: `id-${String(i).padStart(5, '0')}`, user_id: 'u1', n: i }));
jest.mock('../../lib/supabase', () => {
  const make = () => {
    const st: { gt: string | null; limit: number } = { gt: null, limit: 1000 };
    const q: any = {
      select: () => q, eq: () => q, order: () => q,
      limit: (n: number) => { st.limit = n; return q; },
      gt: (_c: string, v: string) => { st.gt = v; return q; },
      then: (ok: (v: unknown) => unknown) => {
        const rows = mockRows.filter((r) => st.gt === null || r.id > st.gt).slice(0, st.limit);
        return Promise.resolve({ data: rows, error: null, status: 200 }).then(ok);
      },
    };
    return q;
  };
  return { supabase: { from: () => make() } };
});
jest.mock('../../repositories/shared', () => ({
  ...jest.requireActual('../../repositories/shared'),
  currentUserId: async () => ({ ok: true, userId: 'u1' }),
}));

import { fetchOwnedTable } from '../../repositories/restoreRepository';

it('every row exactly once across page edges', async () => {
  const r = await fetchOwnedTable('okrs', 5000, 100);
  if (!r.ok) throw new Error(r.error);
  expect(r.data.truncated).toBe(false);
  expect(r.data.rows.map((x) => x.n)).toEqual(mockRows.map((x) => x.n));
});

it('the ceiling is reported, not silently cut', async () => {
  const r = await fetchOwnedTable('okrs', 1000, 300);
  if (!r.ok) throw new Error(r.error);
  expect(r.data.truncated).toBe(true);
  expect(r.data.rows).toHaveLength(1000);
});
