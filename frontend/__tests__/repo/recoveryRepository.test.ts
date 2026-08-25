/**
 * Repository tests for `repositories/recoveryRepository.ts`.  (Phase 2,
 * CODER-I, plan §12). Mock pattern matches `reviewRepository.test.ts` /
 * `focusSessionRepository.test.ts`.
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
};

jest.mock('../../lib/supabase', () => {
  function select(cols: string) {
    const eqFilters: Record<string, unknown> = {};
    const rangeFilters: { col: string; op: 'gte' | 'lte'; val: unknown }[] = [];
    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      gte(col: string, val: unknown) { rangeFilters.push({ col, op: 'gte', val }); return q; },
      lte(col: string, val: unknown) { rangeFilters.push({ col, op: 'lte', val }); return q; },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        if (mockDb.error) return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
        const rows = mockDb.rows.filter((r) => {
          for (const [col, val] of Object.entries(eqFilters)) if (r[col] !== val) return false;
          for (const f of rangeFilters) {
            const v = r[f.col] as string;
            if (f.op === 'gte' && !(v >= (f.val as string))) return false;
            if (f.op === 'lte' && !(v <= (f.val as string))) return false;
          }
          return true;
        });
        return Promise.resolve({ data: rows, error: null }).then(onOk, onErr);
      },
    };
    void cols;
    return q;
  }

  return {
    supabase: {
      auth: { getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
      from: () => ({ select }),
    },
  };
});

import { fetchRecoveryPlansForReview } from '../../repositories/recoveryRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
});

describe('fetchRecoveryPlansForReview', () => {
  it('returns plans of ANY status whose target_date falls in [start, end], scoped to the current user', () => {
    mockDb.rows = [
      { id: 'p1', user_id: 'u1', habit_id: 'h1', source_date: '2026-08-03', target_date: '2026-08-04', strategy: 'full', note: null, reminder_time: null, status: 'done', created_at: 'now' },
      { id: 'p2', user_id: 'u1', habit_id: 'h2', source_date: '2026-08-05', target_date: '2026-08-06', strategy: 'reschedule', note: null, reminder_time: null, status: 'planned', created_at: 'now' },
      { id: 'p3', user_id: 'u1', habit_id: 'h3', source_date: '2026-07-01', target_date: '2026-07-02', strategy: 'mini', note: null, reminder_time: null, status: 'skipped', created_at: 'now' }, // out of range
      { id: 'p4', user_id: 'u2', habit_id: 'h4', source_date: '2026-08-03', target_date: '2026-08-04', strategy: 'full', note: null, reminder_time: null, status: 'done', created_at: 'now' }, // other user
    ];
    return fetchRecoveryPlansForReview({ start: '2026-08-01', end: '2026-08-07' }).then((res) => {
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    });
  });

  it('includes non-"planned" statuses (done/skipped) -- this is the whole point vs. recoveryStore.fetchPlans', () => {
    mockDb.rows = [
      { id: 'p1', user_id: 'u1', habit_id: 'h1', source_date: '2026-08-03', target_date: '2026-08-04', strategy: 'full', note: null, reminder_time: null, status: 'done', created_at: 'now' },
    ];
    return fetchRecoveryPlansForReview({ start: '2026-08-01', end: '2026-08-07' }).then((res) => {
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data[0].status).toBe('done');
    });
  });

  it('surfaces an error instead of swallowing it', () => {
    mockDb.error = { message: 'boom' };
    return fetchRecoveryPlansForReview({ start: '2026-08-01', end: '2026-08-07' }).then((res) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('boom');
    });
  });

  it('fails explicitly when unauthenticated', () => {
    mockDb.user = null;
    return fetchRecoveryPlansForReview({ start: '2026-08-01', end: '2026-08-07' }).then((res) => {
      expect(res.ok).toBe(false);
    });
  });
});
