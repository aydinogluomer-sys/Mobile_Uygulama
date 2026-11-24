/**
 * Repository tests for `repositories/focusSessionRepository.ts`.  (Phase 1)
 * Mock pattern matches `habitLogRepository.test.ts` / `store/logStore.test.ts`.
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
  deleteCalls: [] as { table: string; userId: unknown }[],
};

jest.mock('../../lib/supabase', () => {
  /** Real PostgREST only returns the requested columns -- mirror that here. */
  function project(row: Record<string, unknown>, cols: string): Record<string, unknown> {
    if (cols.trim() === '*') return row;
    const names = cols.split(',').map((c) => c.trim());
    const out: Record<string, unknown> = {};
    for (const name of names) out[name] = row[name];
    return out;
  }

  function select(cols: string) {
    const eqFilters: Record<string, unknown> = {};
    const rangeFilters: { col: string; op: 'gte' | 'lte' | 'lt'; val: unknown }[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let sliceRange: [number, number] | null = null;

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      gte(col: string, val: unknown) { rangeFilters.push({ col, op: 'gte', val }); return q; },
      lte(col: string, val: unknown) { rangeFilters.push({ col, op: 'lte', val }); return q; },
      lt(col: string, val: unknown) { rangeFilters.push({ col, op: 'lt', val }); return q; },
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
          for (const f of rangeFilters) {
            const v = r[f.col] as string;
            if (f.op === 'gte' && !(v >= (f.val as string))) return false;
            if (f.op === 'lte' && !(v <= (f.val as string))) return false;
            if (f.op === 'lt' && !(v < (f.val as string))) return false;
          }
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
        const capped = sliceRange
          ? rows.slice(sliceRange[0], sliceRange[1] + 1)
          : limitN == null ? rows : rows.slice(0, limitN);
        return Promise.resolve({ data: capped.map((r) => project(r, cols)), error: null }).then(onOk, onErr);
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
      from: (table: string) => ({
        select,
        delete: () => ({
          eq: async (col: string, val: unknown) => {
            mockDb.deleteCalls.push({ table, userId: val });
            expect(col).toBe('user_id');
            if (mockDb.error) return { error: mockDb.error };
            return { error: null };
          },
        }),
      }),
    },
  };
});

import {
  fetchFocusSessionsSince,
  fetchFocusSessionsBetween,
  fetchAllFocusSessions,
  deleteAllFocusSessions,
} from '../../repositories/focusSessionRepository';
import { localDayStartIso } from '../../lib/date';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
  mockDb.deleteCalls = [];
});

describe('fetchFocusSessionsSince', () => {
  it('returns report-shaped rows newest-first', async () => {
    mockDb.rows = [
      { id: 's1', user_id: 'u1', task_id: null, task_title: null, mode: 'work', started_at: '2026-08-01T00:00:00Z', ended_at: null, planned_seconds: 1500, completed_seconds: 1500, completed: true },
      { id: 's2', user_id: 'u1', task_id: null, task_title: null, mode: 'work', started_at: '2026-08-03T00:00:00Z', ended_at: null, planned_seconds: 1500, completed_seconds: 1500, completed: true },
    ];
    const res = await fetchFocusSessionsSince({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['s2', 's1']);
  });

  it('fails explicitly when unauthenticated', async () => {
    mockDb.user = null;
    const res = await fetchFocusSessionsSince({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(res.ok).toBe(false);
  });
});

describe('fetchFocusSessionsBetween', () => {
  it('filters by half-open local-day UTC boundaries [startIso, endExclusiveIso)', async () => {
    const startIso = localDayStartIso('2026-08-03')!;
    const endExclusiveIso = localDayStartIso('2026-08-05')!;
    mockDb.rows = [
      { id: 'before', user_id: 'u1', task_id: null, task_title: null, mode: 'work', started_at: new Date(Date.parse(startIso) - 1000).toISOString(), ended_at: null, planned_seconds: 1500, completed_seconds: 1500, completed: true },
      { id: 'inside', user_id: 'u1', task_id: null, task_title: null, mode: 'work', started_at: startIso, ended_at: null, planned_seconds: 1500, completed_seconds: 1500, completed: true },
      { id: 'atEndExclusive', user_id: 'u1', task_id: null, task_title: null, mode: 'work', started_at: endExclusiveIso, ended_at: null, planned_seconds: 1500, completed_seconds: 1500, completed: true },
    ];
    const res = await fetchFocusSessionsBetween({ startYmd: '2026-08-03', endYmd: '2026-08-04' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['inside']);
  });

  it('rejects malformed or inverted date bounds', async () => {
    expect((await fetchFocusSessionsBetween({ startYmd: '2026-02-30', endYmd: '2026-03-01' })).ok).toBe(false);
    expect((await fetchFocusSessionsBetween({ startYmd: '2026-08-05', endYmd: '2026-08-04' })).ok).toBe(false);
  });
});

describe('fetchAllFocusSessions', () => {
  it('returns every column for the current user only', async () => {
    mockDb.rows = [
      { id: 's1', user_id: 'u1', started_at: '2026-08-01T00:00:00Z' },
      { id: 's2', user_id: 'u2', started_at: '2026-08-01T00:00:00Z' },
    ];
    const res = await fetchAllFocusSessions();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['s1']);
  });
});

describe('deleteAllFocusSessions', () => {
  it('deletes scoped to the current user', async () => {
    const res = await deleteAllFocusSessions();
    expect(res.ok).toBe(true);
    expect(mockDb.deleteCalls).toEqual([{ table: 'focus_sessions', userId: 'u1' }]);
  });

  it('surfaces a delete error', async () => {
    mockDb.error = { message: 'delete failed' };
    const res = await deleteAllFocusSessions();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('delete failed');
  });
});
