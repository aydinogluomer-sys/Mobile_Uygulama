import { getOrInitSubscription, mockActivateSubscription } from '../repositories/subscriptionRepository';
import { create } from 'zustand';
import type { Tier, BillingPeriod } from '../lib/subscription';

type SubRow = {
  tier: Tier;
  billing_period: BillingPeriod | null;
  status: 'active' | 'expired' | 'cancelled';
  focus_points: number;
  monthly_grant: number;
  credits_period_end: string | null;
  sub_period_end: string | null;
};

type SubscriptionStore = {
  tier: Tier;
  focusPoints: number;
  monthlyGrant: number;
  billingPeriod: BillingPeriod | null;
  status: SubRow['status'];
  creditsPeriodEnd: string | null;
  subPeriodEnd: string | null;
  loading: boolean;
  loaded: boolean;

  fetch: () => Promise<void>;
  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
  canAfford: (cost: number) => boolean;
  activateMock: (tier: Exclude<Tier, 'free'>, period: BillingPeriod) => Promise<boolean>;
};

function apply(set: any, row: SubRow) {
  set({
    tier: row.tier,
    focusPoints: row.focus_points,
    monthlyGrant: row.monthly_grant,
    billingPeriod: row.billing_period,
    status: row.status,
    creditsPeriodEnd: row.credits_period_end,
    subPeriodEnd: row.sub_period_end,
  });
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  tier: 'free',
  focusPoints: 0,
  monthlyGrant: 30,
  billingPeriod: null,
  status: 'active',
  creditsPeriodEnd: null,
  subPeriodEnd: null,
  loading: false,
  loaded: false,

  fetch: async () => {
    set({ loading: true });
    const res = await getOrInitSubscription();
    if (res.ok) apply(set, res.data as unknown as SubRow);
    set({ loading: false, loaded: true });
  },

  refresh: async () => {
    const res = await getOrInitSubscription();
    if (res.ok) apply(set, res.data as unknown as SubRow);
  },

  // AI çağrısı bakiyeyi döndürünce anlık güncelle (ekstra RPC'siz)
  setBalance: (balance) => set({ focusPoints: balance }),

  canAfford: (cost) => get().focusPoints >= cost,

  // DEV-ONLY. mock_activate_subscription grants a paid tier with no payment
  // check, so its EXECUTE grant was revoked from anon/authenticated in
  // migration 20260802181931. Calling it from a release build can only fail
  // with "permission denied", so the call is compiled out entirely rather
  // than left to fail at runtime with a misleading error.
  // Real activation must go through the RevenueCat webhook ->
  // activate_subscription (service-role only).
  activateMock: async (tier, period) => {
    if (!__DEV__) return false;
    const res = await mockActivateSubscription(tier, period);
    if (!res.ok) return false;
    apply(set, res.data as unknown as SubRow);
    return true;
  },
}));
