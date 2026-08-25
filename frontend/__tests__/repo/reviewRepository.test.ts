/**
 * Repository tests for `repositories/reviewRepository.ts`.  (Phase 1)
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  selectError: null as PgError | null,
  upsertError: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
  upserts: [] as Record<string, unknown>[],
};

jest.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: { getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          const q: any = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
            maybeSingle: async () => {
              if (mockDb.selectError) return { data: null, error: mockDb.selectError };
              const row = mockDb.rows.find((r) =>
                Object.entries(filters).every(([col, val]) => r[col] === val));
              return { data: row ?? null, error: null };
            },
          };
          return q;
        },
        upsert: (payload: Record<string, unknown>, _opts: { onConflict: string }) => {
          mockDb.upserts.push(payload);
          if (mockDb.upsertError) return Promise.resolve({ error: mockDb.upsertError });
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
});

import { fetchWeeklyReview, upsertWeeklyReview } from '../../repositories/reviewRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.selectError = null;
  mockDb.upsertError = null;
  mockDb.user = { id: 'u1' };
  mockDb.upserts = [];
});

describe('fetchWeeklyReview', () => {
  it('returns the row for the given week_key and current user', async () => {
    mockDb.rows = [
      { id: 'r1', user_id: 'u1', week_key: '2026-08-03', wins: 'w', challenges: 'c', next_week: 'n', created_at: 'now' },
      { id: 'r2', user_id: 'u1', week_key: '2026-07-27', wins: 'x', challenges: 'y', next_week: 'z', created_at: 'earlier' },
      { id: 'r3', user_id: 'u2', week_key: '2026-08-03', wins: 'other', challenges: '', next_week: '', created_at: 'now' },
    ];
    const res = await fetchWeeklyReview({ weekKey: '2026-08-03' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.id).toBe('r1');
  });

  it('returns null (not an error) when no review exists yet', async () => {
    const res = await fetchWeeklyReview({ weekKey: '2026-08-03' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });

  it('surfaces a Supabase error instead of swallowing it', async () => {
    mockDb.selectError = { message: 'read boom' };
    const res = await fetchWeeklyReview({ weekKey: '2026-08-03' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('read boom');
  });

  it('fails explicitly when there is no session', async () => {
    mockDb.user = null;
    const res = await fetchWeeklyReview({ weekKey: '2026-08-03' });
    expect(res.ok).toBe(false);
  });
});

describe('upsertWeeklyReview', () => {
  it('writes the row scoped to the current user with the onConflict key', async () => {
    const res = await upsertWeeklyReview({ weekKey: '2026-08-03', wins: 'a', challenges: 'b', next_week: 'c' });
    expect(res.ok).toBe(true);
    expect(mockDb.upserts).toEqual([
      { user_id: 'u1', week_key: '2026-08-03', wins: 'a', challenges: 'b', next_week: 'c' },
    ]);
  });

  it('surfaces an upsert error instead of swallowing it', async () => {
    mockDb.upsertError = { message: 'write boom' };
    const res = await upsertWeeklyReview({ weekKey: '2026-08-03', wins: null, challenges: null, next_week: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('write boom');
  });
});
