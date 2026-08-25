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
    const rangeFilters: { col: string; op: 'gte' | 'lte'; val: unknown }[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      gte(col: string, val: unknown) { rangeFilters.push({ col, op: 'gte', val }); return q; },
      lte(col: string, val: unknown) { rangeFilters.push({ col, op: 'lte', val }); return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col; orderAsc = opts?.ascending ?? true; return q;
      },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        if (mockDb.error) return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
        let rows = mockDb.rows.filter((r) => {
          for (const [col, val] of Object.entries(eqFilters)) if (r[col] !== val) return false;
          for (const f of rangeFilters) {
            const v = r[f.col] as string;
            if (f.op === 'gte' && !(v >= (f.val as string))) return false;
            if (f.op === 'lte' && !(v <= (f.val as string))) return false;
          }
          return true;
        });
        if (orderCol) {
          const col = orderCol;
          rows = [...rows].sort((a, b) => {
            const av = a[col] as string; const bv = b[col] as string;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
        }
        return Promise.resolve({ data: rows.map((r) => project(r, cols)), error: null }).then(onOk, onErr);
      },
    };
    return q;
  }

  return {
    supabase: {
      auth: { getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
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
  fetchFocusSecondsForReview,
  fetchFocusSessionsSince,
  fetchAllFocusSessions,
  deleteAllFocusSessions,
} from '../../repositories/focusSessionRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
  mockDb.deleteCalls = [];
});

describe('fetchFocusSecondsForReview', () => {
  it('returns completed_seconds for the range, scoped to the current user', async () => {
    mockDb.rows = [
      { user_id: 'u1', started_at: '2026-08-04T10:00:00', completed_seconds: 1200 },
      { user_id: 'u1', started_at: '2026-07-01T10:00:00', completed_seconds: 999 }, // out of range
      { user_id: 'u2', started_at: '2026-08-04T10:00:00', completed_seconds: 500 }, // other user
    ];
    const res = await fetchFocusSecondsForReview({ start: '2026-08-01', end: '2026-08-07' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([{ completed_seconds: 1200 }]);
  });

  it('surfaces an error instead of swallowing it', async () => {
    mockDb.error = { message: 'boom' };
    const res = await fetchFocusSecondsForReview({ start: '2026-08-01', end: '2026-08-07' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('boom');
  });
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
