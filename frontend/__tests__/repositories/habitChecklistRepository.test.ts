import type { ChecklistCheck, ChecklistItem } from '../../lib/habitChecklist';
import type * as SharedMod from '../../repositories/shared';

const ITEM_COLS = 'id,habit_id,title,required,position,created_at,archived_at';
const CHECK_COLS = 'item_id,habit_id,day';

const mockCurrentUserId = jest.fn();
const mockUpdateOwned = jest.fn();

type SelectCall = {
  table: string;
  columns: string;
  eqCalls: [string, unknown][];
  gteCalls: [string, unknown][];
  orderCalls: [string, { ascending: boolean }][];
  range: [number, number];
};

const mockSelectCalls: SelectCall[] = [];
const mockInsertItemCalls: { table: string; payload: Record<string, unknown>; columns: string }[] =
  [];
const mockUpsertCheckCalls: {
  table: string;
  payload: Record<string, unknown>;
  opts: { onConflict: string; ignoreDuplicates: boolean };
}[] = [];
const mockDeleteCheckCalls: { table: string; eqCalls: [string, unknown][] }[] = [];

const mockState: {
  selectResponse: {
    rows: unknown[];
    error: { message: string; code?: string } | null;
    status?: number;
  };
  insertItemResponse: {
    data: ChecklistItem | null;
    error: { message: string; name?: string } | null;
    status?: number;
  };
  upsertCheckResponse: {
    error: { message: string; name?: string } | null;
    status?: number;
  };
  deleteCheckResponse: {
    error: { message: string; name?: string } | null;
    status?: number;
  };
} = {
  selectResponse: { rows: [], error: null, status: 200 },
  insertItemResponse: { data: null, error: null, status: 201 },
  upsertCheckResponse: { error: null, status: 201 },
  deleteCheckResponse: { error: null, status: 204 },
};

jest.mock('../../repositories/shared', () => {
  const actual = jest.requireActual<typeof SharedMod>('../../repositories/shared');
  return {
    currentUserId: (...args: unknown[]) => mockCurrentUserId(...args),
    updateOwned: (...args: unknown[]) => mockUpdateOwned(...args),
    isTransportFailure: actual.isTransportFailure,
  };
});

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
            mockSelectCalls.push({
              table,
              columns,
              eqCalls,
              gteCalls,
              orderCalls,
              range: [from, to],
            });
            if (mockState.selectResponse.error) {
              return {
                data: null,
                error: mockState.selectResponse.error,
                status: mockState.selectResponse.status,
              };
            }
            return {
              data: from === 0 ? mockState.selectResponse.rows : [],
              error: null,
              status: mockState.selectResponse.status ?? 200,
            };
          },
        };
        return builder;
      },
      insert: (payload: Record<string, unknown>) => ({
        select: (columns: string) => ({
          single: async () => {
            mockInsertItemCalls.push({ table, payload, columns });
            return mockState.insertItemResponse;
          },
        }),
      }),
      upsert: async (
        payload: Record<string, unknown>,
        opts: { onConflict: string; ignoreDuplicates: boolean },
      ) => {
        mockUpsertCheckCalls.push({ table, payload, opts });
        return mockState.upsertCheckResponse;
      },
      delete: () => {
        const eqCalls: [string, unknown][] = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            if (eqCalls.length === 3) {
              mockDeleteCheckCalls.push({ table, eqCalls });
              return Promise.resolve(mockState.deleteCheckResponse);
            }
            return chain;
          },
        };
        return chain;
      },
    }),
  },
}));

import {
  deleteCheck,
  fetchChecklistChecks,
  fetchChecklistItems,
  insertCheck,
  insertChecklistItem,
  patchChecklistItem,
} from '../../repositories/habitChecklistRepository';

const USER_ID = '44444444-4444-4444-8444-444444444444';

const SAMPLE_ITEM: ChecklistItem = {
  id: 'item-1',
  habit_id: 'habit-1',
  title: 'Isınma hareketleri',
  required: true,
  position: 0,
  created_at: '2026-10-01T08:00:00.000Z',
  archived_at: null,
};

const SAMPLE_CHECK: ChecklistCheck = {
  item_id: 'item-1',
  habit_id: 'habit-1',
  day: '2026-11-24',
};

describe('habitChecklistRepository', () => {
  beforeEach(() => {
    mockSelectCalls.length = 0;
    mockInsertItemCalls.length = 0;
    mockUpsertCheckCalls.length = 0;
    mockDeleteCheckCalls.length = 0;
    mockCurrentUserId.mockResolvedValue({ ok: true, userId: USER_ID });
    mockState.selectResponse = { rows: [], error: null, status: 200 };
    mockState.insertItemResponse = { data: SAMPLE_ITEM, error: null, status: 201 };
    mockState.upsertCheckResponse = { error: null, status: 201 };
    mockState.deleteCheckResponse = { error: null, status: 204 };
  });

  describe('fetchChecklistItems', () => {
    it('fails open with { available: false, rows: [] } on missing table codes PGRST205 and 42P01', async () => {
      for (const code of ['PGRST205', '42P01'] as const) {
        mockState.selectResponse = {
          rows: [],
          error: { message: 'relation does not exist', code },
          status: 404,
        };
        const res = await fetchChecklistItems();
        expect(res).toEqual({ ok: true, data: { available: false, rows: [] } });
      }
    });

    it('propagates real server/transport errors and auth failures instead of swallowing them', async () => {
      mockState.selectResponse = {
        rows: [],
        error: { message: 'permission denied for table habit_checklist_items', code: '42501' },
        status: 403,
      };
      expect(await fetchChecklistItems()).toEqual({
        ok: false,
        error: 'permission denied for table habit_checklist_items',
        code: '42501',
        status: 403,
        offline: false,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await fetchChecklistItems()).toEqual({ ok: false, error: 'Oturum bulunamadı.' });
    });

    it('returns { available: true, rows } scoped to owner when table exists', async () => {
      mockState.selectResponse = { rows: [SAMPLE_ITEM], error: null, status: 200 };

      const res = await fetchChecklistItems();

      expect(res).toEqual({ ok: true, data: { available: true, rows: [SAMPLE_ITEM] } });
      expect(mockSelectCalls[0]).toMatchObject({
        table: 'habit_checklist_items',
        columns: ITEM_COLS,
        eqCalls: [['user_id', USER_ID]],
        orderCalls: [
          ['position', { ascending: true }],
          ['id', { ascending: true }],
        ],
      });
    });
  });

  describe('fetchChecklistChecks', () => {
    it('returns { available: false, rows: [] } on PGRST205 and 42P01, and propagates real errors', async () => {
      for (const code of ['PGRST205', '42P01'] as const) {
        mockState.selectResponse = {
          rows: [],
          error: { message: 'schema cache miss', code },
          status: 404,
        };
        expect(await fetchChecklistChecks('2026-11-01')).toEqual({
          ok: true,
          data: { available: false, rows: [] },
        });
      }

      mockState.selectResponse = {
        rows: [],
        error: { message: 'TypeError: Network request failed', code: '' },
        status: 0,
      };
      expect(await fetchChecklistChecks('2026-11-01')).toEqual({
        ok: false,
        error: 'TypeError: Network request failed',
        code: '',
        status: 0,
        offline: true,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum açık değil.' });
      expect(await fetchChecklistChecks('2026-11-01')).toEqual({
        ok: false,
        error: 'Oturum açık değil.',
      });
    });

    it('returns { available: true, rows } filtered by owner and day >= sinceDay', async () => {
      mockState.selectResponse = { rows: [SAMPLE_CHECK], error: null, status: 200 };

      const res = await fetchChecklistChecks('2026-11-10');

      expect(res).toEqual({ ok: true, data: { available: true, rows: [SAMPLE_CHECK] } });
      expect(mockSelectCalls[0]).toMatchObject({
        table: 'habit_checklist_checks',
        columns: CHECK_COLS,
        eqCalls: [['user_id', USER_ID]],
        gteCalls: [['day', '2026-11-10']],
        orderCalls: [
          ['day', { ascending: true }],
          ['id', { ascending: true }],
        ],
      });
    });
  });

  describe('insertChecklistItem & patchChecklistItem', () => {
    it('inserts item scoped to currentUserId and propagates offline transport flag on error', async () => {
      const input = { habit_id: 'habit-1', title: 'Isınma hareketleri', required: true, position: 0 };
      const okRes = await insertChecklistItem(input);

      expect(okRes).toEqual({ ok: true, data: SAMPLE_ITEM });
      expect(mockInsertItemCalls).toEqual([
        {
          table: 'habit_checklist_items',
          columns: ITEM_COLS,
          payload: { ...input, user_id: USER_ID },
        },
      ]);

      mockState.insertItemResponse = {
        data: null,
        error: { message: 'Network request failed' },
        status: 0,
      };
      expect(await insertChecklistItem(input)).toEqual({
        ok: false,
        error: 'Network request failed',
        offline: true,
      });

      mockState.insertItemResponse = {
        data: null,
        error: { message: 'check violation' },
        status: 400,
      };
      expect(await insertChecklistItem(input)).toEqual({
        ok: false,
        error: 'check violation',
        offline: false,
      });
    });

    it('delegates patchChecklistItem to updateOwned with owner userId and ITEM_COLS', async () => {
      const patched: ChecklistItem = { ...SAMPLE_ITEM, required: false, position: 2 };
      mockUpdateOwned.mockResolvedValueOnce({ ok: true, data: patched });

      const res = await patchChecklistItem('item-1', { required: false, position: 2 });

      expect(res).toEqual({ ok: true, data: patched });
      expect(mockUpdateOwned).toHaveBeenCalledWith({
        table: 'habit_checklist_items',
        id: 'item-1',
        userId: USER_ID,
        patch: { required: false, position: 2 },
        columns: ITEM_COLS,
      });
    });
  });

  describe('insertCheck & deleteCheck', () => {
    it('upserts check idempotently on (item_id,day) with ignoreDuplicates and propagates offline flag', async () => {
      expect(await insertCheck(SAMPLE_CHECK)).toEqual({ ok: true, data: true });
      expect(mockUpsertCheckCalls).toEqual([
        {
          table: 'habit_checklist_checks',
          payload: { ...SAMPLE_CHECK, user_id: USER_ID },
          opts: { onConflict: 'item_id,day', ignoreDuplicates: true },
        },
      ]);

      mockState.upsertCheckResponse = { error: { message: 'Failed to fetch' }, status: 0 };
      expect(await insertCheck(SAMPLE_CHECK)).toEqual({
        ok: false,
        error: 'Failed to fetch',
        offline: true,
      });

      mockState.upsertCheckResponse = { error: { message: 'foreign key violation' }, status: 409 };
      expect(await insertCheck(SAMPLE_CHECK)).toEqual({
        ok: false,
        error: 'foreign key violation',
        offline: false,
      });
    });

    it('deletes check scoped by user_id, item_id, and day, propagating offline transport flag', async () => {
      expect(await deleteCheck(SAMPLE_CHECK)).toEqual({ ok: true, data: true });
      expect(mockDeleteCheckCalls).toEqual([
        {
          table: 'habit_checklist_checks',
          eqCalls: [
            ['user_id', USER_ID],
            ['item_id', 'item-1'],
            ['day', '2026-11-24'],
          ],
        },
      ]);

      mockState.deleteCheckResponse = { error: { message: 'Network request failed' }, status: 0 };
      expect(await deleteCheck(SAMPLE_CHECK)).toEqual({
        ok: false,
        error: 'Network request failed',
        offline: true,
      });

      mockState.deleteCheckResponse = { error: { message: 'RLS denied' }, status: 403 };
      expect(await deleteCheck(SAMPLE_CHECK)).toEqual({
        ok: false,
        error: 'RLS denied',
        offline: false,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await deleteCheck(SAMPLE_CHECK)).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
    });
  });
});
