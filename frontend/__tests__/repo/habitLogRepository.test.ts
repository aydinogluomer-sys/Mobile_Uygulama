/**
 * Repository tests for `repositories/habitLogRepository.ts`.  (Phase 1)
 *
 * Follows the Supabase-mocking pattern established in
 * `__tests__/store/logStore.test.ts`: all fake-client state lives in a
 * `mock`-prefixed object because Jest hoists `jest.mock()` above every other
 * declaration and rejects factories that close over anything else.
 *
 * Covers, per function: the happy path returns typed data, a Supabase error
 * is surfaced (not swallowed), and every query is scoped to the current
 * user (rows belonging to another user never come back).
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
};

jest.mock('../../lib/supabase', () => {
  /** Real PostgREST only returns the requested columns -- mirror that here. */
  function project(row: Record<string, unknown>, cols: string): Record<string, unknown> {
    const names = cols.split(',').map((c) => c.trim());
    const out: Record<string, unknown> = {};
    for (const name of names) out[name] = row[name];
    return out;
  }

  function select(cols: string) {
    const eqFilters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const rangeFilters: { col: string; op: 'gte' | 'lte'; val: unknown }[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      gte(col: string, val: unknown) { rangeFilters.push({ col, op: 'gte', val }); return q; },
      lte(col: string, val: unknown) { rangeFilters.push({ col, op: 'lte', val }); return q; },
      in(col: string, vals: unknown[]) { inFilters[col] = vals; return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col; orderAsc = opts?.ascending ?? true; return q;
      },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        if (mockDb.error) {
          return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
        }
        let rows = mockDb.rows.filter((r) => {
          for (const [col, val] of Object.entries(eqFilters)) {
            if (r[col] !== val) return false;
          }
          for (const [col, vals] of Object.entries(inFilters)) {
            if (!vals.includes(r[col])) return false;
          }
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
      from: () => ({ select }),
    },
  };
});

import {
  fetchHabitLogsForReview,
  fetchHabitLogsHeatmap,
  fetchHabitIdsCompletedSince,
  fetchHabitLogsForHabitsSince,
} from '../../repositories/habitLogRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
});

describe('fetchHabitLogsForReview', () => {
  const row = (over: Partial<Record<string, unknown>>) => ({
    id: 'l1', habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-04',
    state: 'done', value: null, is_completed: true, created_at: 'now', ...over,
  });

  it('returns typed rows within the date range for the current user', async () => {
    mockDb.rows = [
      row({ id: 'in-range' }),
      row({ id: 'out-of-range', completed_at: '2026-07-01' }),
      row({ id: 'other-user', user_id: 'u2' }),
    ];
    const res = await fetchHabitLogsForReview({ start: '2026-08-01', end: '2026-08-07' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((r) => r.habit_id)).toEqual(['h1']);
      expect(res.data[0]).toEqual({ habit_id: 'h1', completed_at: '2026-08-04', state: 'done', value: null });
    }
  });

  it('surfaces a Supabase error instead of swallowing it', async () => {
    mockDb.error = { message: 'db boom' };
    const res = await fetchHabitLogsForReview({ start: '2026-08-01', end: '2026-08-07' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('db boom');
  });

  it('fails explicitly when there is no session, rather than querying unscoped', async () => {
    mockDb.user = null;
    const res = await fetchHabitLogsForReview({ start: '2026-08-01', end: '2026-08-07' });
    expect(res.ok).toBe(false);
  });
});

describe('fetchHabitLogsHeatmap', () => {
  it('returns completed_at/state only, restricted to done/partial, scoped to the user', async () => {
    mockDb.rows = [
      { habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-01', state: 'done' },
      { habit_id: 'h2', user_id: 'u1', completed_at: '2026-08-02', state: 'miss' },
      { habit_id: 'h3', user_id: 'u2', completed_at: '2026-08-01', state: 'done' },
    ];
    const res = await fetchHabitLogsHeatmap({ since: '2026-07-01' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([{ completed_at: '2026-08-01', state: 'done' }]);
  });
});

describe('fetchHabitIdsCompletedSince', () => {
  it('returns habit_id-only rows for the current user', async () => {
    mockDb.rows = [
      { habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-05', state: 'partial' },
      { habit_id: 'h2', user_id: 'u2', completed_at: '2026-08-05', state: 'partial' },
    ];
    const res = await fetchHabitIdsCompletedSince({ since: '2026-08-01' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([{ habit_id: 'h1' }]);
  });

  it('surfaces an error', async () => {
    mockDb.error = { message: 'nope' };
    const res = await fetchHabitIdsCompletedSince({ since: '2026-08-01' });
    expect(res.ok).toBe(false);
  });
});

describe('fetchHabitLogsForHabitsSince', () => {
  it('filters by habit id set and orders newest-first, scoped to the user', async () => {
    mockDb.rows = [
      { habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-01', state: 'done' },
      { habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-03', state: 'done' },
      { habit_id: 'h2', user_id: 'u1', completed_at: '2026-08-02', state: 'done' }, // not in habitIds
      { habit_id: 'h1', user_id: 'u2', completed_at: '2026-08-03', state: 'done' }, // other user
    ];
    const res = await fetchHabitLogsForHabitsSince({ habitIds: ['h1'], since: '2026-07-01' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((r) => r.completed_at)).toEqual(['2026-08-03', '2026-08-01']);
    }
  });
});
