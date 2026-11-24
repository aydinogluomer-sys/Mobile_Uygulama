import type * as PagedSelectMod from '../../repositories/pagedSelect';

const EXPECTED_COLS = 'id,user_id,subject,duration_minutes,date,created_at';

const mockCurrentUserId = jest.fn();
const mockDeleteOwned = jest.fn();
const mockSelectAllPages = jest.fn();
const mockRequireComplete = jest.fn();

type SelectTrace = {
  table: string;
  columns: string;
  eqCalls: [string, unknown][];
  gteCalls: [string, unknown][];
  orderCalls: [string, { ascending: boolean }][];
  range: [number, number];
};

const mockSelectTraces: SelectTrace[] = [];
const mockInsertCalls: { table: string; payload: Record<string, unknown>; columns: string }[] = [];

const mockState: {
  selectPagesResponse: {
    rows: unknown[];
    error: { message: string; code?: string } | null;
  };
  insertResponse: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  };
} = {
  selectPagesResponse: { rows: [], error: null },
  insertResponse: { data: null, error: null },
};

jest.mock('../../repositories/shared', () => ({
  ...jest.requireActual('../../repositories/shared'),
  currentUserId: (...args: unknown[]) => mockCurrentUserId(...args),
  deleteOwned: (...args: unknown[]) => mockDeleteOwned(...args),
}));

jest.mock('../../repositories/pagedSelect', () => ({
  selectAllPages: (...args: unknown[]) => mockSelectAllPages(...args),
  requireComplete: (...args: unknown[]) => mockRequireComplete(...args),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const eqCalls: [string, unknown][] = [];
        const gteCalls: [string, unknown][] = [];
        const orderCalls: [string, { ascending: boolean }][] = [];
        const builder = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return builder;
          },
          gte: (col: string, val: unknown) => {
            gteCalls.push([col, val]);
            return builder;
          },
          order: (col: string, opts: { ascending: boolean }) => {
            orderCalls.push([col, opts]);
            return builder;
          },
          range: async (from: number, to: number) => {
            mockSelectTraces.push({ table, columns, eqCalls, gteCalls, orderCalls, range: [from, to] });
            if (mockState.selectPagesResponse.error) {
              return { data: null, error: mockState.selectPagesResponse.error };
            }
            return {
              data: from === 0 ? mockState.selectPagesResponse.rows : [],
              error: null,
            };
          },
        };
        return builder;
      },
      insert: (payload: Record<string, unknown>) => ({
        select: (columns: string) => ({
          single: async () => {
            mockInsertCalls.push({ table, payload, columns });
            return mockState.insertResponse;
          },
        }),
      }),
    }),
  },
}));

const actualPagedSelect = jest.requireActual<typeof PagedSelectMod>('../../repositories/pagedSelect');

import {
  deleteDeepWorkSession,
  fetchDeepWorkSince,
  insertDeepWorkSession,
  type DeepWorkRow,
} from '../../repositories/deepWorkRepository';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const FIXED_NOW = new Date(2026, 10, 24, 14, 30, 0); // 2026-11-24 local

const SAMPLE_ROW: DeepWorkRow = {
  id: 'dw-1',
  user_id: USER_ID,
  subject: 'Dağıtık sistemler makalesi',
  duration_minutes: 50,
  date: '2026-11-24',
  created_at: '2026-11-24T11:30:00.000Z',
};

describe('deepWorkRepository', () => {
  beforeEach(() => {
    mockSelectTraces.length = 0;
    mockInsertCalls.length = 0;
    mockCurrentUserId.mockResolvedValue({ ok: true, userId: USER_ID });
    mockSelectAllPages.mockImplementation(actualPagedSelect.selectAllPages);
    mockRequireComplete.mockImplementation(actualPagedSelect.requireComplete);
    mockState.selectPagesResponse = { rows: [SAMPLE_ROW], error: null };
    mockState.insertResponse = { data: SAMPLE_ROW, error: null };
  });

  describe('fetchDeepWorkSince', () => {
    it('clamps window days into 1..365, scopes to owner, and runs selectAllPages + requireComplete', async () => {
      // Default 30 days from 2026-11-24 -> 2026-10-25
      const defaultRes = await fetchDeepWorkSince(undefined, FIXED_NOW);
      expect(defaultRes).toEqual({ ok: true, data: [SAMPLE_ROW] });
      expect(mockSelectAllPages).toHaveBeenCalledTimes(1);
      expect(mockRequireComplete).toHaveBeenCalledWith(
        { ok: true, data: { rows: [SAMPLE_ROW], truncated: false } },
        'Derin çalışma seansları',
      );
      expect(mockSelectTraces[0]).toMatchObject({
        table: 'deep_work_sessions',
        columns: EXPECTED_COLS,
        eqCalls: [['user_id', USER_ID]],
        gteCalls: [['date', '2026-10-25']],
        orderCalls: [
          ['date', { ascending: false }],
          ['created_at', { ascending: false }],
          ['id', { ascending: true }],
        ],
      });

      // Lower bound clamp: 0 and negative days clamp to 1 day (2026-11-23)
      mockSelectTraces.length = 0;
      await fetchDeepWorkSince(0, FIXED_NOW);
      expect(mockSelectTraces[0].gteCalls).toEqual([['date', '2026-11-23']]);

      mockSelectTraces.length = 0;
      await fetchDeepWorkSince(-14, FIXED_NOW);
      expect(mockSelectTraces[0].gteCalls).toEqual([['date', '2026-11-23']]);

      // Upper bound clamp: >365 clamps to 365 days (2025-11-24)
      mockSelectTraces.length = 0;
      await fetchDeepWorkSince(900, FIXED_NOW);
      expect(mockSelectTraces[0].gteCalls).toEqual([['date', '2025-11-24']]);
    });

    it('rejects truncated page sets via requireComplete and propagates auth or DB errors', async () => {
      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await fetchDeepWorkSince(30, FIXED_NOW)).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
      expect(mockSelectAllPages).not.toHaveBeenCalled();

      mockSelectAllPages.mockResolvedValueOnce({
        ok: true,
        data: { rows: [SAMPLE_ROW], truncated: true },
      });
      const truncated = await fetchDeepWorkSince(30, FIXED_NOW);
      expect(truncated).toEqual({
        ok: false,
        code: 'TOO_LARGE',
        error: 'Derin çalışma seansları kayıt sınırını aştığı için tam okunamadı.',
      });

      mockState.selectPagesResponse = {
        rows: [],
        error: { message: 'statement timeout', code: '57014' },
      };
      const dbErr = await fetchDeepWorkSince(7, FIXED_NOW);
      expect(dbErr).toMatchObject({ ok: false, error: 'statement timeout', code: '57014' });
    });
  });

  describe('insertDeepWorkSession', () => {
    it('rejects 0, negative, fractional, NaN, and >720 durations via parseManualMinutes before hitting auth or DB', async () => {
      for (const badMinutes of [0, -15, 25.5, Number.NaN, 721]) {
        const res = await insertDeepWorkSession({
          subject: 'Odak',
          minutes: badMinutes,
          date: '2026-11-24',
        });
        expect(res.ok).toBe(false);
      }
      expect(mockCurrentUserId).not.toHaveBeenCalled();
      expect(mockInsertCalls).toHaveLength(0);
    });

    it('inserts valid manual minutes scoped to currentUserId and normalises missing created_at', async () => {
      mockState.insertResponse = {
        data: {
          id: 'dw-2',
          user_id: USER_ID,
          subject: 'Derleyici tasarımı',
          duration_minutes: 90,
          date: '2026-11-24',
          created_at: null,
        },
        error: null,
      };

      const res = await insertDeepWorkSession({
        subject: 'Derleyici tasarımı',
        minutes: 90,
        date: '2026-11-24',
      });

      expect(res).toEqual({
        ok: true,
        data: {
          id: 'dw-2',
          user_id: USER_ID,
          subject: 'Derleyici tasarımı',
          duration_minutes: 90,
          date: '2026-11-24',
          created_at: '',
        },
      });
      expect(mockInsertCalls).toEqual([
        {
          table: 'deep_work_sessions',
          columns: EXPECTED_COLS,
          payload: {
            user_id: USER_ID,
            subject: 'Derleyici tasarımı',
            duration_minutes: 90,
            date: '2026-11-24',
          },
        },
      ]);
    });

    it('propagates auth failure and insert DB error for valid duration', async () => {
      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum açık değil.' });
      expect(
        await insertDeepWorkSession({ subject: 'Tez', minutes: 45, date: '2026-11-24' }),
      ).toEqual({ ok: false, error: 'Oturum açık değil.' });
      expect(mockInsertCalls).toHaveLength(0);

      mockState.insertResponse = { data: null, error: { message: 'insert denied' } };
      expect(
        await insertDeepWorkSession({ subject: 'Tez', minutes: 45, date: '2026-11-24' }),
      ).toEqual({ ok: false, error: 'insert denied' });
    });
  });

  describe('deleteDeepWorkSession', () => {
    it('delegates to deleteOwned with owner userId and propagates auth failures', async () => {
      mockDeleteOwned.mockResolvedValueOnce({ ok: true, data: true });
      expect(await deleteDeepWorkSession('dw-1')).toEqual({ ok: true, data: true });
      expect(mockDeleteOwned).toHaveBeenCalledWith({
        table: 'deep_work_sessions',
        id: 'dw-1',
        userId: USER_ID,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await deleteDeepWorkSession('dw-1')).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
      expect(mockDeleteOwned).toHaveBeenCalledTimes(1);
    });
  });
});
