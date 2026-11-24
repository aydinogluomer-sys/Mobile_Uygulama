import { createSubscriptionWebhookHandler, type SubscriptionWebhookDeps } from './handler.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Assertion failed (${msg}): expected ${e}, got ${a}`);
  }
}

function makeWebhook(opts: { secret?: string; rpcError?: string } = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: SubscriptionWebhookDeps = {
    env: (name) => (name === 'REVENUECAT_WEBHOOK_SECRET' ? opts.secret : undefined),
    makeAdminClient: () => ({
      rpc: (name, args) => {
        rpcCalls.push({ name, args });
        return Promise.resolve({ error: opts.rpcError ? { message: opts.rpcError } : null });
      },
    }),
  };
  return { handler: createSubscriptionWebhookHandler(deps), rpcCalls };
}

Deno.test('subscription-webhook activates, expires, and ignores non-lifecycle events under valid Bearer secret', async () => {
  const { handler, rpcCalls } = makeWebhook({ secret: 'rc-wh-secret-777' });

  const activateRes = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-abc',
        product_id: 'pro_monthly',
        transaction_id: 'tx-900',
      },
    }),
  }));
  assertEquals(activateRes.status, 200, 'activate 200');
  assertEquals(await activateRes.json(), { ok: true, action: 'activated', tier: 'pro', period: 'monthly' }, 'activate body');
  assertEquals(rpcCalls[0], {
    name: 'activate_subscription',
    args: {
      p_user_id: 'user-abc',
      p_tier: 'pro',
      p_period: 'monthly',
      p_provider: 'revenuecat',
      p_provider_ref: 'tx-900',
    },
  }, 'activate RPC args');

  const expireRes = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { type: 'EXPIRATION', app_user_id: 'user-abc' } }),
  }));
  assertEquals(expireRes.status, 200, 'expire 200');
  assertEquals(rpcCalls[1], { name: 'expire_subscription', args: { p_user_id: 'user-abc' } }, 'expire RPC');

  const cancelRes = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { type: 'CANCELLATION', app_user_id: 'user-abc' } }),
  }));
  assertEquals(cancelRes.status, 200, 'cancellation 200');
  assertEquals(await cancelRes.json(), { ok: true, ignored: 'CANCELLATION' }, 'ignored CANCELLATION');
  assertEquals(rpcCalls.length, 2, 'CANCELLATION calls zero additional RPCs');
});

Deno.test('subscription-webhook rejects 405, 401, 400 bad_json, 413 too_large, and sanitizes 500 RPC failures', async () => {
  const { handler, rpcCalls } = makeWebhook({ secret: 'rc-wh-secret-777' });

  const getRes = await handler(new Request('https://example.test/wh', { method: 'GET' }));
  assertEquals(getRes.status, 405, 'GET -> 405');

  const wrongSecret = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong' },
    body: '{}',
  }));
  assertEquals(wrongSecret.status, 401, 'wrong Bearer -> 401');

  const noHeader = await handler(new Request('https://example.test/wh', { method: 'POST', body: '{}' }));
  assertEquals(noHeader.status, 401, 'missing Authorization -> 401');

  const unconfigured = await makeWebhook({ secret: undefined }).handler(
    new Request('https://example.test/wh', {
      method: 'POST',
      headers: { Authorization: 'Bearer undefined' },
      body: '{}',
    }),
  );
  assertEquals(unconfigured.status, 401, 'unset secret -> 401');
  assertEquals(rpcCalls.length, 0, 'zero RPCs on auth failures');

  const badJson = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777' },
    body: '{not-json',
  }));
  assertEquals(badJson.status, 400, 'malformed JSON -> 400');
  assertEquals(await badJson.json(), { error: 'bad_json' }, 'bad_json error body');

  const tooLarge = await handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777' },
    body: '{"pad":"' + 'x'.repeat(270_000) + '"}',
  }));
  assertEquals(tooLarge.status, 413, 'oversize body -> 413');
  assertEquals(await tooLarge.json(), { error: 'too_large' }, 'too_large error body');

  const failing = makeWebhook({ secret: 'rc-wh-secret-777', rpcError: 'FATAL db detail rc-wh-secret-777' });
  const rpcErrRes = await failing.handler(new Request('https://example.test/wh', {
    method: 'POST',
    headers: { Authorization: 'Bearer rc-wh-secret-777' },
    body: JSON.stringify({ event: { type: 'EXPIRATION', app_user_id: 'u1' } }),
  }));
  assertEquals(rpcErrRes.status, 500, 'RPC failure -> 500');
  const txt = await rpcErrRes.text();
  assertEquals(JSON.parse(txt), { error: 'internal' }, 'generic internal body');
  assert(!txt.includes('rc-wh-secret-777') && !txt.includes('FATAL'), 'never leaks secret or raw DB error');
});
