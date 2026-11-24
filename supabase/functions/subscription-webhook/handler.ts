import { readJsonBody } from '../_shared/http.ts';

export const WEBHOOK_MAX_BODY_BYTES = 262_144;

export type SubscriptionWebhookDeps = {
  env(name: string): string | undefined;
  makeAdminClient(): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
  };
};

// Ürün id → tier + period eşlemesi (lib/subscription.ts ile uyumlu olmalı)
function mapProduct(pid: string): { tier: 'plus' | 'pro'; period: 'weekly' | 'monthly' | 'yearly' } | null {
  const tier = pid.startsWith('pro') ? 'pro' : pid.startsWith('plus') ? 'plus' : null;
  const period = pid.endsWith('weekly') ? 'weekly' : pid.endsWith('yearly') ? 'yearly' : pid.endsWith('monthly') ? 'monthly' : null;
  if (!tier || !period) return null;
  return { tier, period };
}

const ACTIVATE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
]);
const EXPIRE_TYPES = new Set(['EXPIRATION']);

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

export function createSubscriptionWebhookHandler(
  deps: SubscriptionWebhookDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);

    // ── Paylaşılan sır doğrulaması ──
    const secret = deps.env('REVENUECAT_WEBHOOK_SECRET');
    const auth = req.headers.get('Authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    const parsed = await readJsonBody(req, WEBHOOK_MAX_BODY_BYTES);
    if (!parsed.ok) {
      return parsed.status === 413
        ? json({ error: 'too_large' }, 413)
        : json({ error: 'bad_json' }, 400);
    }

    try {
      const sb = deps.makeAdminClient();
      const body = (parsed.value && typeof parsed.value === 'object' ? parsed.value : {}) as Record<string, unknown>;
      const ev = (body.event && typeof body.event === 'object' ? body.event : {}) as Record<string, unknown>;
      const type = typeof ev.type === 'string' ? ev.type : '';
      const userId = typeof ev.app_user_id === 'string' && ev.app_user_id ? ev.app_user_id : null;
      const productId = (ev.product_id ?? '').toString();

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
    } catch {
      console.error('subscription-webhook error');
      return json({ error: 'internal' }, 500);
    }
  };
}
