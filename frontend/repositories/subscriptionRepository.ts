/**
 * Subscription and Focus-Point balance access.  (plan §5 Rule 4)
 *
 * Replaces the three bare `supabase.rpc(...)` calls in
 * `store/subscriptionStore.ts`. That store was classified UI_ONLY — "no
 * persistence at all, UI preference or transient state" — in the layer
 * boundary gate, which was simply untrue: it read and wrote the user's tier
 * and credit balance. The classification survived because the gate matched
 * `supabase.from(` and these are RPCs.
 *
 * Everything here goes through a SECURITY DEFINER function rather than a
 * table, deliberately: `user_subscriptions` and `credit_transactions` are the
 * money-adjacent tables, and the client is not trusted to compute a balance.
 */
import { supabase } from '../lib/supabase';
import type { RepoResult } from './shared';

export type SubscriptionRow = {
  tier: string;
  status: string;
  billing_period: string | null;
  focus_points: number;
  credits_period_end: string | null;
  current_period_end: string | null;
};

/**
 * The caller's subscription, creating the free-tier row on first read.
 *
 * The error is returned rather than dropped. The store previously wrote
 *
 *     const { data, error } = await supabase.rpc('get_or_init_subscription');
 *     if (!error && data) apply(set, data as SubRow);
 *
 * so a failure left the defaults in place — tier 'free', focusPoints 0 — and
 * the Focus Points screen could not tell "you are on free" from "we could
 * not find out".
 */
export async function getOrInitSubscription(): Promise<RepoResult<SubscriptionRow>> {
  const { data, error } = await supabase.rpc('get_or_init_subscription');
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Abonelik bilgisi alınamadı.' };
  return { ok: true, data: data as SubscriptionRow };
}

/**
 * DEV-ONLY tier grant.
 *
 * `mock_activate_subscription` grants a paid tier with no payment check, and
 * its EXECUTE grant was revoked from anon/authenticated in migration
 * 003_emergency_gate_0_revoke_mock_activate_subscription. In a release build
 * this can only ever fail with "permission
 * denied", so the caller compiles it out; the guard is repeated here so the
 * function cannot be reached from a new call site that forgets.
 *
 * Real activation goes through the RevenueCat webhook to
 * `activate_subscription`, which is service-role only.
 */
export async function mockActivateSubscription(
  tier: string,
  period: string,
): Promise<RepoResult<SubscriptionRow>> {
  if (!__DEV__) return { ok: false, error: 'Yalnızca geliştirme derlemesinde kullanılabilir.' };
  const { data, error } = await supabase.rpc('mock_activate_subscription', {
    p_tier: tier,
    p_period: period,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Abonelik güncellenemedi.' };
  return { ok: true, data: data as SubscriptionRow };
}
