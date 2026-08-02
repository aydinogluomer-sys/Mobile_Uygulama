// RevenueCat (veya benzeri) abonelik webhook'u.
// Güvenlik: paylaşılan sır ile doğrulama (verify_jwt=false; auth bu sır ile).
// Gerekli secret'lar: REVENUECAT_WEBHOOK_SECRET. (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY otomatik sağlanır.)
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Ürün id → tier + period eşlemesi (lib/subscription.ts ile uyumlu olmalı)
function mapProduct(pid: string): { tier: 'plus' | 'pro'; period: 'weekly' | 'monthly' | 'yearly' } | null {
  const tier = pid.startsWith('pro') ? 'pro' : pid.startsWith('plus') ? 'plus' : null;
  const period = pid.endsWith('weekly') ? 'weekly' : pid.endsWith('yearly') ? 'yearly' : pid.endsWith('monthly') ? 'monthly' : null;
  if (!tier || !period) return null;
  return { tier, period };
}

const ACTIVATE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE']);
const EXPIRE_TYPES = new Set(['EXPIRATION']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // ── Paylaşılan sır doğrulaması ──
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const auth = req.headers.get('Authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const ev = body?.event ?? {};
    const type: string = ev.type ?? '';
    const userId: string | null = ev.app_user_id ?? null;
    const productId: string = (ev.product_id ?? '').toString();

    if (!userId) return json({ ok: true, ignored: 'no app_user_id' });

    if (ACTIVATE_TYPES.has(type)) {
      const m = mapProduct(productId);
      if (!m) return json({ ok: true, ignored: `unknown product ${productId}` });
      const { error } = await sb.rpc('activate_subscription', {
        p_user_id: userId,
        p_tier: m.tier,
        p_period: m.period,
        p_provider: 'revenuecat',
        p_provider_ref: ev.transaction_id ?? ev.id ?? null,
      });
      if (error) throw error;
      return json({ ok: true, action: 'activated', tier: m.tier, period: m.period });
    }

    if (EXPIRE_TYPES.has(type)) {
      const { error } = await sb.rpc('expire_subscription', { p_user_id: userId });
      if (error) throw error;
      return json({ ok: true, action: 'expired' });
    }

    // CANCELLATION / BILLING_ISSUE vb. → süre bitene kadar aktif kalır, sadece kabul et
    return json({ ok: true, ignored: type });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    console.error('subscription-webhook error:', msg);
    return json({ error: 'internal' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
