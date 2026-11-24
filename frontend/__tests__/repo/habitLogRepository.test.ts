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
  status: 200 as number,
  user: { id: 'u1' } as { id: string } | null,
  lastSelectedCols: '' as string,
  lastUpdate: null as { patch: Record<string, unknown>; eqs: [string, unknown][] } | null,
  insertCalled: 0,
  upsertCalled: 0,
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
    mockDb.lastSelectedCols = cols;
    const eqFilters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const rangeFilters: { col: string; op: 'gte' | 'lte'; val: unknown }[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let sliceRange: [number, number] | null = null;
    let limitN: number | null = null;

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      gte(col: string, val: unknown) { rangeFilters.push({ col, op: 'gte', val }); return q; },
      lte(col: string, val: unknown) { rangeFilters.push({ col, op: 'lte', val }); return q; },
      in(col: string, vals: unknown[]) { inFilters[col] = vals; return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending ?? true });
        return q;
      },
      range(from: number, to: number) { sliceRange = [from, to]; return q; },
      limit(n: number) { limitN = n; return q; },
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
        else if (limitN !== null) rows = rows.slice(0, limitN);
        return Promise.resolve({ data: rows.map((r) => project(r, cols)), error: null }).then(onOk, onErr);
      },
    };
    return q;
  }

  function update(patch: Record<string, unknown>) {
    const eqs: [string, unknown][] = [];
    let selectedCols = 'id,notes';
    const q: any = {
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return q;
      },
      select(cols: string) {
        selectedCols = cols;
        mockDb.lastSelectedCols = cols;
        return q;
      },
      async maybeSingle() {
        mockDb.lastUpdate = { patch, eqs: [...eqs] };
        if (mockDb.error) {
          return { data: null, error: mockDb.error, status: mockDb.status };
        }
        const match = mockDb.rows.find((r) => eqs.every(([c, v]) => r[c] === v));
        if (!match) return { data: null, error: null, status: 200 };
        Object.assign(match, patch);
        return { data: project(match, selectedCols), error: null, status: 200 };
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
      from: () => ({
        select,
        update,
        insert: () => {
          mockDb.insertCalled += 1;
          throw new Error('insert must not be called');
        },
        upsert: () => {
          mockDb.upsertCalled += 1;
          throw new Error('upsert must not be called');
        },
      }),
    },
  };
});

import {
  fetchHabitLogsForReview,
  fetchHabitLogsHeatmap,
  fetchHabitIdsCompletedSince,
  fetchHabitLogsForHabitsSince,
  fetchHabitLogsForHabit,
  updateLogNote,
} from '../../repositories/habitLogRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.status = 200;
  mockDb.user = { id: 'u1' };
  mockDb.lastSelectedCols = '';
  mockDb.lastUpdate = null;
  mockDb.insertCalled = 0;
  mockDb.upsertCalled = 0;
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

describe('fetchHabitLogsForHabit & updateLogNote (F31 PS-03)', () => {
  it('(+) fetchHabitLogsForHabit selects notes column and returns it per row', async () => {
    mockDb.rows = [
      {
        id: 'l1',
        habit_id: 'h1',
        user_id: 'u1',
        completed_at: '2026-08-10',
        state: 'skip',
        value: null,
        notes: 'misafir geldi',
      },
    ];
    const res = await fetchHabitLogsForHabit({
      habitId: 'h1',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    expect(mockDb.lastSelectedCols).toContain('notes');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([
        {
          habit_id: 'h1',
          completed_at: '2026-08-10',
          state: 'skip',
          value: null,
          notes: 'misafir geldi',
        },
      ]);
    }
  });

  it('(+) updateLogNote updates ONLY notes with habit_id + user_id + completed_at eq chain, and (-) never inserts/upserts', async () => {
    mockDb.rows = [
      {
        id: 'l1',
        habit_id: 'h1',
        user_id: 'u1',
        completed_at: '2026-08-10',
        state: 'skip',
        value: null,
        notes: null,
      },
    ];
    const res = await updateLogNote({
      habitId: 'h1',
      dateStr: '2026-08-10',
      note: 'erken yattım',
    });
    expect(res).toEqual({ ok: true, data: { id: 'l1', notes: 'erken yattım' } });
    expect(mockDb.lastUpdate?.patch).toEqual({ notes: 'erken yattım' });
    expect(mockDb.lastUpdate?.eqs).toEqual(
      expect.arrayContaining([
        ['habit_id', 'h1'],
        ['user_id', 'u1'],
        ['completed_at', '2026-08-10'],
      ]),
    );
    expect(mockDb.insertCalled).toBe(0);
    expect(mockDb.upsertCalled).toBe(0);
  });

  it('(-) updateLogNote returns code:"no_row" when no row exists, without inserting', async () => {
    mockDb.rows = [];
    const res = await updateLogNote({
      habitId: 'h1',
      dateStr: '2026-08-10',
      note: 'yok',
    });
    expect(res).toEqual({
      ok: false,
      error: 'Bu gün için kayıt bulunamadı.',
      code: 'no_row',
    });
    expect(mockDb.insertCalled).toBe(0);
    expect(mockDb.upsertCalled).toBe(0);
  });
});
