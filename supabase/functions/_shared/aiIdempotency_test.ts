/**
 * Deno 2 native test suite for `supabase/functions/_shared/*`.
 *
 * Executed in CI (`edge-deno-verify`) via:
 *   deno test supabase/functions/_shared/aiIdempotency_test.ts
 */
import {
  fingerprintInput,
  INSUFFICIENT_CREDITS,
  REFUND_PENDING_NOTE,
  runIdempotentAiRequest,
  type IdempotencyDeps,
} from './aiIdempotency.ts';
import {
  assertCanonicalCoachHabitSchema,
  COACH_HABIT_SCHEMA,
  extractPartialReplyFromToolJson,
  resolveAnthropicMessage,
} from './coachContractSchema.ts';
import { mintState, verifyState } from './oauthState.ts';
import { isAllowedRedirect, parseAllowlist } from './redirectAllowlist.ts';

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

Deno.test('fingerprintInput length-prefixes parts to prevent boundary collisions', async () => {
  const left = await fingerprintInput('coach', ['ab', 'c']);
  const right = await fingerprintInput('coach', ['a', 'bc']);
  assert(left !== right, 'length-prefixed parts must not collide');
  assertEquals(left.length, 64, 'SHA-256 hex digest length');
});

Deno.test('runIdempotentAiRequest charges once, calls provider once, and replays without charging', async () => {
  let spendCalls = 0;
  let providerCalls = 0;
  let storedResponse: Record<string, unknown> | null = null;

  const makeDeps = (replaying: boolean): IdempotencyDeps => ({
    begin: async () =>
      replaying && storedResponse
        ? { kind: 'replay', response: storedResponse }
        : { kind: 'claimed' },
    complete: async ({ response }) => {
      storedResponse = response;
    },
    fail: async () => {},
    release: async () => {},
    spend: async () => {
      spendCalls += 1;
      return { kind: 'charged', balance: 20 };
    },
    refund: async () => true,
    expireLease: async () => {},
    callProvider: async () => {
      providerCalls += 1;
      return { ok: true, payload: { reply: 'Harika gidiyorsun!', actions: [] } };
    },
    readBalance: async () => 20,
    describeError: (raw) => raw,
  });

  const first = await runIdempotentAiRequest(
    { requestId: 'req-1', mode: 'coach', fingerprint: 'fp-1', cost: 5 },
    makeDeps(false),
  );
  assertEquals(first.status, 200, 'first call status');
  assertEquals(first.body.replayed, false, 'first call not replayed');
  assertEquals(spendCalls, 1, 'spend called once');
  assertEquals(providerCalls, 1, 'provider called once');

  const second = await runIdempotentAiRequest(
    { requestId: 'req-1', mode: 'coach', fingerprint: 'fp-1', cost: 5 },
    makeDeps(true),
  );
  assertEquals(second.status, 200, 'replay status');
  assertEquals(second.body.replayed, true, 'replay flag true');
  assertEquals(second.body.reply, 'Harika gidiyorsun!', 'replay returns stored reply');
  assertEquals(spendCalls, 1, 'replay does not charge again');
  assertEquals(providerCalls, 1, 'replay does not invoke provider again');
});

Deno.test('runIdempotentAiRequest releases claim on insufficient credits and refunds on provider failure', async () => {
  let released = false;
  let refundedReason: string | null = null;

  const noCredit = await runIdempotentAiRequest(
    { requestId: 'req-402', mode: 'routine', fingerprint: 'fp-2', cost: 25 },
    {
      begin: async () => ({ kind: 'claimed' }),
      complete: async () => {},
      fail: async () => {},
      release: async () => {
        released = true;
      },
      spend: async () => ({ kind: 'insufficient', balance: 4 }),
      refund: async () => true,
      expireLease: async () => {},
      callProvider: async () => {
        throw new Error('must not reach provider');
      },
      readBalance: async () => 4,
      describeError: (r) => r,
    },
  );
  assertEquals(noCredit.status, 402, 'insufficient credits status');
  assertEquals(noCredit.body.code, INSUFFICIENT_CREDITS, 'insufficient credits code');
  assert(released, 'claim released when spend refused');

  const failed = await runIdempotentAiRequest(
    { requestId: 'req-500', mode: 'coach', fingerprint: 'fp-3', cost: 5 },
    {
      begin: async () => ({ kind: 'claimed' }),
      complete: async () => {},
      fail: async () => {},
      release: async () => {},
      spend: async () => ({ kind: 'charged', balance: 15 }),
      refund: async ({ reason }) => {
        refundedReason = reason;
        return true;
      },
      expireLease: async () => {},
      callProvider: async () => ({ ok: false, reason: 'ai_truncated', message: 'Yarım kaldı' }),
      readBalance: async () => 15,
      describeError: (r) => r,
    },
  );
  assertEquals(failed.status, 500, 'truncated provider status');
  assertEquals(refundedReason, 'ai_truncated', 'refunded with exact reason');
});

// F07 (EDG-01): a refund that cannot be written must not mark the claim failed.
function refundCase(refund: IdempotencyDeps['refund'], spendKind: 'charged' | 'replayed' = 'charged') {
  const calls = { fail: 0, expireLease: 0, refund: 0, provider: 0 };
  const deps: IdempotencyDeps = {
    begin: async () => ({ kind: 'claimed' }),
    complete: async () => {},
    fail: async () => { calls.fail += 1; },
    release: async () => {},
    spend: async () => ({ kind: spendKind, balance: 25 }),
    refund: async (input) => { calls.refund += 1; return refund(input); },
    expireLease: async () => { calls.expireLease += 1; },
    callProvider: async () => { calls.provider += 1; return { ok: false, reason: 'ai_truncated', message: 'Yarım kaldı' }; },
    readBalance: async () => 25,
    describeError: (r) => r,
  };
  return { deps, calls };
}

Deno.test('F07 (i): refund returns false -> fail is never called, expireLease once, 500 REFUND_PENDING', async () => {
  const { deps, calls } = refundCase(async () => false);
  const res = await runIdempotentAiRequest({ requestId: 'req-f07-1', mode: 'coach', fingerprint: 'fp', cost: 5 }, deps);
  assertEquals(calls.fail, 0, 'fail never called');
  assertEquals(calls.expireLease, 1, 'expireLease once');
  assertEquals(res.status, 500, 'status');
  assertEquals(res.body.code, 'REFUND_PENDING', 'code');
  assert(String(res.body.error).includes(REFUND_PENDING_NOTE), 'the error carries the refund note');
  assertEquals(calls.provider, 1, 'providerCalls');
});

Deno.test('F07 (ii): refund throws -> the same as (i)', async () => {
  const { deps, calls } = refundCase(async () => { throw new Error('connection reset'); });
  const res = await runIdempotentAiRequest({ requestId: 'req-f07-2', mode: 'coach', fingerprint: 'fp', cost: 5 }, deps);
  assertEquals(calls.fail, 0, 'fail never called');
  assertEquals(calls.expireLease, 1, 'expireLease once');
  assertEquals(res.status, 500, 'status');
  assertEquals(res.body.code, 'REFUND_PENDING', 'code');
  assert(String(res.body.error).includes(REFUND_PENDING_NOTE), 'the error carries the refund note');
  assertEquals(calls.provider, 1, 'providerCalls');
});

Deno.test('F07 (iii): refund returns true -> fail once, expireLease never', async () => {
  const { deps, calls } = refundCase(async () => true);
  await runIdempotentAiRequest({ requestId: 'req-f07-3', mode: 'coach', fingerprint: 'fp', cost: 5 }, deps);
  assertEquals(calls.fail, 1, 'fail once');
  assertEquals(calls.expireLease, 0, 'expireLease never');
});

Deno.test('F07 (iv): charged === false (spend replayed) -> refund never called, fail is called', async () => {
  const { deps, calls } = refundCase(async () => { throw new Error('must not be called'); }, 'replayed');
  await runIdempotentAiRequest({ requestId: 'req-f07-4', mode: 'coach', fingerprint: 'fp', cost: 5 }, deps);
  assertEquals(calls.refund, 0, 'refund never called');
  assertEquals(calls.fail, 1, 'fail called');
});

Deno.test('coachContractSchema validates canonical bounds and streams tool_use JSON deltas cleanly', async () => {
  assertCanonicalCoachHabitSchema(COACH_HABIT_SCHEMA);

  const partial = extractPartialReplyFromToolJson('{"reply":"Merhaba\\nAderyth');
  assertEquals(partial, 'Merhaba\nAderyth', 'partial reply decoded');

  const deltas: string[] = [];
  async function* fakeStream() {
    yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'coach_response' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"reply":"Selam' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' dostum!","actions":[]}' } };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  }

  const msg = await resolveAnthropicMessage(fakeStream(), (d) => {
    if (d.reply) deltas.push(d.reply);
  });
  assertEquals(msg.stop_reason, 'end_turn', 'assembled stop_reason');
  assertEquals(deltas, ['Selam', 'Selam dostum!'], 'incremental reply deltas');
  assertEquals(msg.content[0], {
    type: 'tool_use',
    name: 'coach_response',
    input: { reply: 'Selam dostum!', actions: [] },
  }, 'assembled tool_use block');
});

Deno.test('oauthState and redirectAllowlist enforce HMAC uid binding and fail-closed allowlists', async () => {
  const token = await mintState('super-secret-hmac-key', { uid: 'user-123', ttlSeconds: 300 });
  const ok = await verifyState('super-secret-hmac-key', token, { uid: 'user-123' });
  assert(ok.ok, 'matching uid verifies');

  const mismatch = await verifyState('super-secret-hmac-key', token, { uid: 'user-999' });
  assert(!mismatch.ok && mismatch.reason === 'uid_mismatch', 'mismatched uid rejected');

  const allow = parseAllowlist('*,atlas://notion-callback,https://aderyth.com/callback');
  assert(!isAllowedRedirect('https://evil.example.com/callback', allow), 'wildcard * dropped fail-closed');
  assert(isAllowedRedirect('atlas://notion-callback', allow), 'exact custom scheme allowed');
});

