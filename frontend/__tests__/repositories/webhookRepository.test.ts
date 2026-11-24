const EXPECTED_COLS = 'id,user_id,url,event_types,headers,enabled,created_at';

const mockCurrentUserId = jest.fn();
const mockUpdateOwned = jest.fn();
const mockDeleteOwned = jest.fn();

type SelectTrace = {
  table: string;
  columns: string;
  eqCalls: [string, unknown][];
  orderCalls: [string, { ascending: boolean }][];
  limitVal: number;
};

const mockSelectTraces: SelectTrace[] = [];
const mockInsertCalls: { table: string; payload: Record<string, unknown>; columns: string }[] = [];

const mockState: {
  selectResponse: { data: unknown[] | null; error: { message: string } | null };
  insertResponse: { data: unknown; error: { message: string } | null };
} = {
  selectResponse: { data: [], error: null },
  insertResponse: { data: null, error: null },
};

jest.mock('../../repositories/shared', () => ({
  currentUserId: (...args: unknown[]) => mockCurrentUserId(...args),
  updateOwned: (...args: unknown[]) => mockUpdateOwned(...args),
  deleteOwned: (...args: unknown[]) => mockDeleteOwned(...args),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const eqCalls: [string, unknown][] = [];
        const orderCalls: [string, { ascending: boolean }][] = [];
        return {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return {
              order: (orderCol: string, opts: { ascending: boolean }) => {
                orderCalls.push([orderCol, opts]);
                return {
                  limit: async (limitVal: number) => {
                    mockSelectTraces.push({ table, columns, eqCalls, orderCalls, limitVal });
                    return mockState.selectResponse;
                  },
                };
              },
            };
          },
        };
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

import {
  deleteWebhook,
  fetchWebhooks,
  insertWebhook,
  setWebhookEnabled,
  type WebhookRow,
} from '../../repositories/webhookRepository';

const USER_ID = '77777777-7777-4777-8777-777777777777';

function makeWebhook(overrides: Partial<WebhookRow> = {}): WebhookRow {
  return {
    id: 'wh-1',
    user_id: USER_ID,
    url: 'https://hooks.example.com/aderyth',
    event_types: ['habit_completed', 'task_completed'],
    headers: null,
    enabled: true,
    created_at: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('webhookRepository', () => {
  beforeEach(() => {
    mockSelectTraces.length = 0;
    mockInsertCalls.length = 0;
    mockCurrentUserId.mockResolvedValue({ ok: true, userId: USER_ID });
    mockState.selectResponse = { data: [makeWebhook()], error: null };
    mockState.insertResponse = { data: makeWebhook(), error: null };
  });

  describe('fetchWebhooks', () => {
    it('queries webhooks scoped to owner, ordered newest-first, bounded to .limit(50)', async () => {
      const res = await fetchWebhooks();

      expect(res).toEqual({ ok: true, data: [makeWebhook()] });
      expect(mockSelectTraces).toEqual([
        {
          table: 'webhooks',
          columns: EXPECTED_COLS,
          eqCalls: [['user_id', USER_ID]],
          orderCalls: [['created_at', { ascending: false }]],
          limitVal: 50,
        },
      ]);
    });

    it('handles null data, DB errors, and unauthenticated sessions', async () => {
      mockState.selectResponse = { data: null, error: null };
      expect(await fetchWebhooks()).toEqual({ ok: true, data: [] });

      mockState.selectResponse = { data: null, error: { message: 'timeout' } };
      expect(await fetchWebhooks()).toEqual({ ok: false, error: 'timeout' });

      const prevLen = mockSelectTraces.length;
      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await fetchWebhooks()).toEqual({ ok: false, error: 'Oturum bulunamadı.' });
      expect(mockSelectTraces).toHaveLength(prevLen);
    });
  });

  describe('insertWebhook', () => {
    it('defaults event_types to [habit_completed, task_completed] and headers to null', async () => {
      const res = await insertWebhook({ url: 'https://hooks.example.com/aderyth' });

      expect(res).toEqual({ ok: true, data: makeWebhook() });
      expect(mockInsertCalls).toEqual([
        {
          table: 'webhooks',
          columns: EXPECTED_COLS,
          payload: {
            user_id: USER_ID,
            url: 'https://hooks.example.com/aderyth',
            event_types: ['habit_completed', 'task_completed'],
            headers: null,
          },
        },
      ]);
    });

    it('passes explicit eventTypes and headers and surfaces auth or DB failures', async () => {
      const custom = makeWebhook({
        event_types: ['habit_completed'],
        headers: { 'X-Webhook-Secret': 'tok_live' },
      });
      mockState.insertResponse = { data: custom, error: null };

      const res = await insertWebhook({
        url: 'https://hooks.example.com/aderyth',
        eventTypes: ['habit_completed'],
        headers: { 'X-Webhook-Secret': 'tok_live' },
      });

      expect(res).toEqual({ ok: true, data: custom });
      expect(mockInsertCalls[0].payload).toEqual({
        user_id: USER_ID,
        url: 'https://hooks.example.com/aderyth',
        event_types: ['habit_completed'],
        headers: { 'X-Webhook-Secret': 'tok_live' },
      });

      mockState.insertResponse = { data: null, error: { message: 'invalid url constraint' } };
      expect(await insertWebhook({ url: 'http://bad' })).toEqual({
        ok: false,
        error: 'invalid url constraint',
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum açık değil.' });
      expect(await insertWebhook({ url: 'https://hooks.example.com/x' })).toEqual({
        ok: false,
        error: 'Oturum açık değil.',
      });
    });
  });

  describe('setWebhookEnabled & deleteWebhook', () => {
    it('delegates setWebhookEnabled to updateOwned and deleteWebhook to deleteOwned with owner userId', async () => {
      const disabled = makeWebhook({ enabled: false });
      mockUpdateOwned.mockResolvedValueOnce({ ok: true, data: disabled });

      expect(await setWebhookEnabled('wh-1', false)).toEqual({ ok: true, data: disabled });
      expect(mockUpdateOwned).toHaveBeenCalledWith({
        table: 'webhooks',
        id: 'wh-1',
        userId: USER_ID,
        patch: { enabled: false },
        columns: EXPECTED_COLS,
      });

      mockDeleteOwned.mockResolvedValueOnce({ ok: true, data: true });
      expect(await deleteWebhook('wh-1')).toEqual({ ok: true, data: true });
      expect(mockDeleteOwned).toHaveBeenCalledWith({
        table: 'webhooks',
        id: 'wh-1',
        userId: USER_ID,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await setWebhookEnabled('wh-1', true)).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await deleteWebhook('wh-1')).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
    });
  });
});
