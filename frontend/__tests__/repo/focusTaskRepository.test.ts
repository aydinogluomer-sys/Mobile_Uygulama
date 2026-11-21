/**
 * Repository tests for `repositories/focusTaskRepository.ts`.  (Phase 1)
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
};

jest.mock('../../lib/supabase', () => {
  function select() {
    const eqFilters: Record<string, unknown> = {};
    const orders: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let sliceRange: [number, number] | null = null;

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending ?? true });
        return q;
      },
      // The export reads are capped now -- "read everything" without a bound
      // is one large account away from a memory failure.
      limit(n: number) { limitN = n; return q; },
      range(from: number, to: number) { sliceRange = [from, to]; return q; },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        if (mockDb.error) return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
        let rows = mockDb.rows.filter((r) => {
          for (const [col, val] of Object.entries(eqFilters)) if (r[col] !== val) return false;
          return true;
        });
        if (orders.length > 0) {
          rows = [...rows].sort((a, b) => {
            for (const o of orders) {
              const av = String(a[o.col] ?? '');
              const bv = String(b[o.col] ?? '');
              if (av !== bv) return o.asc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
            }
            return 0;
          });
        }
        if (sliceRange) rows = rows.slice(sliceRange[0], sliceRange[1] + 1);
        else if (limitN != null) rows = rows.slice(0, limitN);
        return Promise.resolve({ data: rows, error: null }).then(onOk, onErr);
      },
    };
    return q;
  }

  return {
    supabase: {
      auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
      from: () => ({ select }),
    },
  };
});

import { fetchAllFocusTasks } from '../../repositories/focusTaskRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
});

describe('fetchAllFocusTasks', () => {
  it('returns tasks for the current user, oldest first', async () => {
    mockDb.rows = [
      { id: 't2', user_id: 'u1', title: 'B', created_at: '2026-08-02' },
      { id: 't1', user_id: 'u1', title: 'A', created_at: '2026-08-01' },
      { id: 't3', user_id: 'u2', title: 'C', created_at: '2026-08-01' },
    ];
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('surfaces an error instead of swallowing it', async () => {
    mockDb.error = { message: 'boom' };
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('boom');
  });

  it('fails explicitly when unauthenticated', async () => {
    mockDb.user = null;
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(false);
  });
});
