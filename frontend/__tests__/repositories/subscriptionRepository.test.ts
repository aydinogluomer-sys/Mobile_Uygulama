const mockRpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
const mockState: {
  rpcResponse: { data: unknown; error: { message: string } | null };
} = {
  rpcResponse: { data: null, error: null },
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      mockRpcCalls.push({ fn, args });
      return mockState.rpcResponse;
    },
  },
}));

import {
  getOrInitSubscription,
  mockActivateSubscription,
  type SubscriptionRow,
} from '../../repositories/subscriptionRepository';

const devGlobal = global as unknown as { __DEV__: boolean };
const REAL_DEV = devGlobal.__DEV__;

const SAMPLE_SUB_ROW: SubscriptionRow = {
  user_id: '66666666-6666-4666-8666-666666666666',
  tier: 'plus',
  billing_period: 'monthly',
  status: 'active',
  focus_points: 100,
  monthly_grant: 100,
  credits_period_end: '2026-12-24T00:00:00.000Z',
  sub_period_end: '2026-12-24T00:00:00.000Z',
  provider: 'revenuecat',
  provider_ref: 'rc_sub_1',
  created_at: '2026-11-24T00:00:00.000Z',
  updated_at: '2026-11-24T00:00:00.000Z',
};

describe('subscriptionRepository', () => {
  beforeEach(() => {
    mockRpcCalls.length = 0;
    mockState.rpcResponse = { data: SAMPLE_SUB_ROW, error: null };
  });

  afterEach(() => {
    devGlobal.__DEV__ = REAL_DEV;
  });

  describe('getOrInitSubscription', () => {
    it('calls get_or_init_subscription RPC and returns the narrowed SubscriptionRow', async () => {
      const res = await getOrInitSubscription();

      expect(res).toEqual({ ok: true, data: SAMPLE_SUB_ROW });
      expect(mockRpcCalls).toEqual([{ fn: 'get_or_init_subscription', args: undefined }]);
    });

    it('returns an explicit failure on RPC error or null data', async () => {
      mockState.rpcResponse = { data: null, error: { message: 'JWT expired' } };
      expect(await getOrInitSubscription()).toEqual({ ok: false, error: 'JWT expired' });

      mockState.rpcResponse = { data: null, error: null };
      expect(await getOrInitSubscription()).toEqual({
        ok: false,
        error: 'Abonelik bilgisi alınamadı.',
      });
    });
  });

  describe('mockActivateSubscription', () => {
    it('refuses immediately without calling RPC when __DEV__ is false', async () => {
      devGlobal.__DEV__ = false;

      const res = await mockActivateSubscription('pro', 'yearly');

      expect(res).toEqual({
        ok: false,
        error: 'Yalnızca geliştirme derlemesinde kullanılabilir.',
      });
      expect(mockRpcCalls).toEqual([]);
    });

    it('calls mock_activate_subscription RPC when __DEV__ is true and handles error or null data', async () => {
      devGlobal.__DEV__ = true;
      const proRow: SubscriptionRow = {
        ...SAMPLE_SUB_ROW,
        tier: 'pro',
        billing_period: 'yearly',
        focus_points: 1000,
        monthly_grant: 1000,
      };
      mockState.rpcResponse = { data: proRow, error: null };

      const okRes = await mockActivateSubscription('pro', 'yearly');
      expect(okRes).toEqual({ ok: true, data: proRow });
      expect(mockRpcCalls).toEqual([
        {
          fn: 'mock_activate_subscription',
          args: { p_tier: 'pro', p_period: 'yearly' },
        },
      ]);

      mockState.rpcResponse = { data: null, error: { message: 'permission denied for function' } };
      expect(await mockActivateSubscription('plus', 'monthly')).toEqual({
        ok: false,
        error: 'permission denied for function',
      });

      mockState.rpcResponse = { data: null, error: null };
      expect(await mockActivateSubscription('plus', 'monthly')).toEqual({
        ok: false,
        error: 'Abonelik güncellenemedi.',
      });
    });
  });
});
