const mockCurrentUserId = jest.fn();

type QueryTrace = {
  table: string;
  columns: string;
  eqCalls: [string, unknown][];
  orderColumn: string;
  limitVal: number;
};

const mockQueryTraces: QueryTrace[] = [];
const mockState: {
  queryResponse: { data: unknown[] | null; error: { message: string } | null };
} = {
  queryResponse: { data: [], error: null },
};

jest.mock('../../repositories/shared', () => ({
  currentUserId: (...args: unknown[]) => mockCurrentUserId(...args),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const eqCalls: [string, unknown][] = [];
        return {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return {
              order: (orderColumn: string) => ({
                limit: async (limitVal: number) => {
                  mockQueryTraces.push({ table, columns, eqCalls, orderColumn, limitVal });
                  return mockState.queryResponse;
                },
              }),
            };
          },
        };
      },
    }),
  },
}));

import { fetchRoutines } from '../../repositories/routineRepository';

const USER_ID = '55555555-5555-4555-8555-555555555555';

type RoutineSample = { id: string; user_id: string; title: string };

describe('routineRepository', () => {
  beforeEach(() => {
    mockQueryTraces.length = 0;
    mockCurrentUserId.mockResolvedValue({ ok: true, userId: USER_ID });
    mockState.queryResponse = {
      data: [{ id: 'r-1', user_id: USER_ID, title: 'Sabah Rutini' }],
      error: null,
    };
  });

  it('scopes query to currentUserId, orders by id, and defaults limit to 100', async () => {
    const res = await fetchRoutines<RoutineSample>();

    expect(res).toEqual({
      ok: true,
      data: [{ id: 'r-1', user_id: USER_ID, title: 'Sabah Rutini' }],
    });
    expect(mockQueryTraces).toEqual([
      {
        table: 'routines',
        columns: '*',
        eqCalls: [['user_id', USER_ID]],
        orderColumn: 'id',
        limitVal: 100,
      },
    ]);
  });

  it('clamps limit between 1 and 500 across underflow, overflow, and in-range inputs', async () => {
    await fetchRoutines<RoutineSample>(0);
    await fetchRoutines<RoutineSample>(-50);
    await fetchRoutines<RoutineSample>(250);
    await fetchRoutines<RoutineSample>(501);
    await fetchRoutines<RoutineSample>(10_000);

    expect(mockQueryTraces.map((q) => q.limitVal)).toEqual([1, 1, 250, 500, 500]);
  });

  it('coerces null PostgREST data to an empty array and surfaces auth or query errors', async () => {
    mockState.queryResponse = { data: null, error: null };
    expect(await fetchRoutines<RoutineSample>()).toEqual({ ok: true, data: [] });

    mockState.queryResponse = { data: null, error: { message: 'connection reset' } };
    expect(await fetchRoutines<RoutineSample>()).toEqual({
      ok: false,
      error: 'connection reset',
    });

    const traceCountBeforeAuthFail = mockQueryTraces.length;
    mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
    expect(await fetchRoutines<RoutineSample>()).toEqual({
      ok: false,
      error: 'Oturum bulunamadı.',
    });
    expect(mockQueryTraces).toHaveLength(traceCountBeforeAuthFail);
  });
});
