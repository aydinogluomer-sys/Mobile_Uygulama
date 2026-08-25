/**
 * Repository tests for `repositories/creditRepository.ts`.  (Phase 1)
 *
 * The migrated call site (`app/screens/credit-history.tsx`) had no explicit
 * `.eq('user_id', ...)` before this migration -- it relied on RLS alone.
 * The user-scoping test below is the one that would have failed against the
 * pre-migration query shape, proving the repository actually adds the
 * explicit scope plan Rule 2/Rule 3 ask for.
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
};

jest.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: { getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          let orderCol: string | null = null;
          let orderAsc = true;
          let limitN: number | null = null;
          const q: any = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
            order(col: string, opts?: { ascending?: boolean }) {
              orderCol = col; orderAsc = opts?.ascending ?? true; return q;
            },
            limit(n: number) { limitN = n; return q; },
            then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
              if (mockDb.error) return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
              let rows = mockDb.rows.filter((r) =>
                Object.entries(filters).every(([col, val]) => r[col] === val));
              if (orderCol) {
                const col = orderCol;
                rows = [...rows].sort((a, b) => {
                  const av = a[col] as string; const bv = b[col] as string;
                  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                  return orderAsc ? cmp : -cmp;
                });
              }
              if (limitN != null) rows = rows.slice(0, limitN);
              return Promise.resolve({ data: rows, error: null }).then(onOk, onErr);
            },
          };
          return q;
        },
      }),
    },
  };
});

import { fetchCreditTransactions } from '../../repositories/creditRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
});

describe('fetchCreditTransactions', () => {
  it('returns the current user\'s transactions, newest first, respecting the limit', async () => {
    mockDb.rows = [
      { id: 'a', user_id: 'u1', delta: 10, reason: 'monthly_renewal', balance_after: 10, created_at: '2026-08-01' },
      { id: 'b', user_id: 'u1', delta: -5, reason: 'ai_coach', balance_after: 5, created_at: '2026-08-03' },
    ];
    const res = await fetchCreditTransactions({ limit: 80 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('never returns another user\'s rows -- the scope this migration was required to add', async () => {
    mockDb.rows = [
      { id: 'mine', user_id: 'u1', delta: 10, reason: null, balance_after: 10, created_at: '2026-08-01' },
      { id: 'not-mine', user_id: 'u2', delta: 999, reason: null, balance_after: 999, created_at: '2026-08-02' },
    ];
    const res = await fetchCreditTransactions({ limit: 80 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['mine']);
  });

  it('surfaces an error instead of swallowing it', async () => {
    mockDb.error = { message: 'boom' };
    const res = await fetchCreditTransactions({ limit: 80 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('boom');
  });

  it('fails explicitly when there is no session', async () => {
    mockDb.user = null;
    const res = await fetchCreditTransactions({ limit: 80 });
    expect(res.ok).toBe(false);
  });
});
