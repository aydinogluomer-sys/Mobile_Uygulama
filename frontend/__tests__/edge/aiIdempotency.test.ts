/**
 * An idempotency key must bound the WORK, not just the charge.
 *
 * ## The defect
 *
 * `spend_focus_points_v2` made the charge idempotent — a repeated `request_id`
 * returns `replayed = true` and writes no second ledger row. `generate-routine`
 * read that flag, set `charged = false` so it would not refund a charge it had
 * not made, and then carried on into `new Anthropic(...)` regardless:
 *
 *     first call    -> 25 FP debited, one Anthropic call
 *     same key      ->  0 FP debited, ANOTHER Anthropic call
 *     same key x10  ->  0 FP debited, TEN Anthropic calls
 *
 * Provider spend is billed to the project, not the user, so one charged key
 * could be replayed indefinitely for free compute. And nothing bound a key to
 * its input, so the same key re-sent with a different prompt produced a second
 * distinct answer for a single payment.
 *
 * This was observed live, not theorised: on 2026-09-06 the request
 * `fp-mtpohn73-8wv5a6wm5glf6c1c` was replayed against production and returned
 * HTTP 200 with a freshly generated 4-habit routine in 3568 ms, while the
 * ledger stayed at exactly one −25 row.
 *
 * ## Why these tests can exist at all
 *
 * The property is "how many times was the provider called", and no assertion
 * about source text can answer that. So the orchestration lives in
 * `_shared/aiIdempotency.ts` behind injected dependencies, and every test here
 * COUNTS `callProvider` invocations against a fake database that mirrors the
 * SQL in `023_ai_request_idempotency.sql` — including the atomicity that
 * makes the concurrency case meaningful.
 *
 *   A  first request        -> one debit, one provider call
 *   B  exact replay         -> original answer, no debit, no provider call
 *   C  ten replays          -> still one debit, one provider call in total
 *   D  same key, new prompt -> rejected before the provider
 *   E  same key, new mode   -> rejected before the provider
 *   F  two concurrent       -> at most one provider call, at most one debit
 *   G  response lost in transit -> the stored answer, no provider call
 *   H  provider failure     -> refunded, exactly as before
 *   I  no credit            -> no provider call, and the key stays usable
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fingerprintInput,
  runIdempotentAiRequest,
  IDEMPOTENCY_MISMATCH,
  REQUEST_IN_PROGRESS,
  INSUFFICIENT_CREDITS,
  type AiMode,
  type BeginOutcome,
  type IdempotencyDeps,
  type ProviderResult,
  type SpendResult,
} from '../../../supabase/functions/_shared/aiIdempotency';

const COST: Record<AiMode, number> = { coach: 5, routine: 25, summarize: 3, insights: 5 };

type Row = {
  mode: AiMode;
  fingerprint: string;
  status: 'in_progress' | 'completed' | 'failed';
  response?: Record<string, unknown>;
  error?: string;
};

/** Yields the event loop the way a real round trip does, without racing. */
const roundTrip = <T,>(v: T): Promise<T> => Promise.resolve().then(() => v);

/**
 * A fake of `ai_requests` + the two credit RPCs, mirroring the SQL.
 *
 * The claim mutates the map SYNCHRONOUSLY and only then yields, which is what
 * `insert ... on conflict do nothing` gives us in Postgres: the second caller
 * blocks until the first commits and can never also be told `claimed`. Without
 * that, CASE F would pass for the wrong reason.
 */
function makeHarness(opts: {
  balance: number;
  provider?: () => ProviderResult;
  /** Held open so a second caller arrives while the first is mid-flight. */
  hold?: Promise<void>;
}) {
  const rows = new Map<string, Row>();
  const ledger = new Map<string, number>();
  let balance = opts.balance;
  let providerCalls = 0;
  const released: string[] = [];

  const provider = opts.provider ?? (() => ({
    ok: true as const,
    payload: { name: `Rutin #${providerCalls}`, description: 'd', items: [{ name: 'a' }] },
  }));

  const deps: IdempotencyDeps = {
    begin: ({ requestId, mode, fingerprint }) => {
      const existing = rows.get(requestId);
      if (!existing) {
        rows.set(requestId, { mode, fingerprint, status: 'in_progress' });
        return roundTrip<BeginOutcome>({ kind: 'claimed' });
      }
      // Fingerprint first, exactly as the SQL orders it: a key pointed at
      // different input is misuse whatever state it is in.
      if (existing.mode !== mode || existing.fingerprint !== fingerprint) {
        return roundTrip<BeginOutcome>({ kind: 'mismatch' });
      }
      if (existing.status === 'completed') {
        return roundTrip<BeginOutcome>({ kind: 'replay', response: existing.response! });
      }
      if (existing.status === 'failed') {
        return roundTrip<BeginOutcome>({ kind: 'consumed', error: existing.error ?? null });
      }
      return roundTrip<BeginOutcome>({ kind: 'in_progress' });
    },

    complete: async ({ requestId, response }) => {
      const row = rows.get(requestId);
      if (row && row.status === 'in_progress') {
        row.status = 'completed';
        row.response = response;
      }
    },

    fail: async ({ requestId, error }) => {
      const row = rows.get(requestId);
      if (row && row.status === 'in_progress') {
        row.status = 'failed';
        row.error = error;
      }
    },

    release: async ({ requestId }) => {
      const row = rows.get(requestId);
      if (row && row.status === 'in_progress') {
        rows.delete(requestId);
        released.push(requestId);
      }
    },

    // `spend_focus_points_v2`, transcribed.
    spend: ({ requestId, cost }) => {
      const refunded = ledger.has(`${requestId}:refund`);
      if (ledger.has(requestId) && !refunded) {
        return roundTrip<SpendResult>({ kind: 'replayed', balance });
      }
      if (refunded || balance < cost) {
        return roundTrip<SpendResult>({ kind: 'insufficient', balance });
      }
      balance -= cost;
      ledger.set(requestId, -cost);
      return roundTrip<SpendResult>({ kind: 'charged', balance });
    },

    // `refund_focus_points`, transcribed, including the already-refunded guard.
    refund: async ({ requestId }) => {
      const spent = ledger.get(requestId);
      if (spent === undefined) return;
      if (ledger.has(`${requestId}:refund`)) return;
      balance += -spent;
      ledger.set(`${requestId}:refund`, -spent);
    },

    callProvider: async () => {
      providerCalls += 1;
      if (opts.hold) await opts.hold;
      return provider();
    },

    readBalance: async () => balance,
    describeError: (raw) => `mapped:${raw}`,
  };

  return {
    deps,
    rows,
    released,
    get providerCalls() { return providerCalls; },
    get balance() { return balance; },
    debits: () => [...ledger.entries()].filter(([k]) => !k.endsWith(':refund')),
    refunds: () => [...ledger.entries()].filter(([k]) => k.endsWith(':refund')),
  };
}

const ROUTINE_PROMPT = 'Sabah rutini: erken kalkmak istiyorum';

async function run(
  h: ReturnType<typeof makeHarness>,
  o: { requestId: string; mode?: AiMode; input?: string },
) {
  const mode = o.mode ?? 'routine';
  return runIdempotentAiRequest(
    {
      requestId: o.requestId,
      mode,
      fingerprint: await fingerprintInput(mode, [o.input ?? ROUTINE_PROMPT]),
      cost: COST[mode],
    },
    h.deps,
  );
}

// ---------------------------------------------------------------------------
describe('CASE A — the first request does the work exactly once', () => {
  it('one debit of 25 FP and one provider call', async () => {
    const h = makeHarness({ balance: 30 });
    const res = await run(h, { requestId: 'k1' });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);
    expect(res.body.cost).toBe(25);
    expect(res.body.balance).toBe(5);
    expect(res.body.name).toBe('Rutin #1');

    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toEqual([['k1', -25]]);
    expect(h.refunds()).toEqual([]);
    expect(h.balance).toBe(5);
    expect(h.rows.get('k1')!.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
describe('CASE B — an exact replay calls nothing', () => {
  it('returns the ORIGINAL answer, with no debit and no provider call', async () => {
    const h = makeHarness({ balance: 30 });
    const first = await run(h, { requestId: 'k1' });
    const replay = await run(h, { requestId: 'k1' });

    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    // The same answer, not a second one. `Rutin #N` increments per provider
    // call, so a fresh generation would be visible here.
    expect(replay.body.name).toBe(first.body.name);
    expect(replay.body.items).toEqual(first.body.items);

    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toEqual([['k1', -25]]);
    expect(h.balance).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe('CASE C — ten replays are still one operation', () => {
  it('one debit and one provider call in total', async () => {
    const h = makeHarness({ balance: 30 });
    const first = await run(h, { requestId: 'k1' });
    for (let i = 0; i < 10; i++) {
      const again = await run(h, { requestId: 'k1' });
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.name).toBe(first.body.name);
    }

    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
    expect(h.balance).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe('CASE D — the same key with a different prompt is refused', () => {
  it('rejected before the provider, and nothing is charged', async () => {
    const h = makeHarness({ balance: 100 });
    await run(h, { requestId: 'k1', input: ROUTINE_PROMPT });
    const callsAfterFirst = h.providerCalls;

    const reused = await run(h, { requestId: 'k1', input: 'Tamamen farklı bir istek' });

    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe(IDEMPOTENCY_MISMATCH);
    expect(h.providerCalls).toBe(callsAfterFirst);
    expect(h.debits()).toHaveLength(1);
    // Never quietly answered with the first prompt's routine, either.
    expect(reused.body.name).toBeUndefined();
  });

  it('is refused even before the first attempt has finished', async () => {
    // The row is still `in_progress`; a mismatched retry must not be told
    // "try again shortly", which would invite the caller to keep trying.
    const h = makeHarness({ balance: 100 });
    h.deps.begin({ requestId: 'k2', mode: 'routine', fingerprint: 'original' });
    const reused = await run(h, { requestId: 'k2', input: 'başka' });
    expect(reused.body.code).toBe(IDEMPOTENCY_MISMATCH);
    expect(h.providerCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('CASE E — the same key with a different mode is refused', () => {
  it('rejected before the provider, and the cheaper mode cannot ride the charge', async () => {
    const h = makeHarness({ balance: 100 });
    await run(h, { requestId: 'k1', mode: 'routine' });
    const callsAfterFirst = h.providerCalls;

    // coach costs 5, routine 25 -- so this is also an attempt to get a coach
    // answer out of a routine payment.
    const reused = await run(h, { requestId: 'k1', mode: 'coach', input: ROUTINE_PROMPT });

    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe(IDEMPOTENCY_MISMATCH);
    expect(h.providerCalls).toBe(callsAfterFirst);
    expect(h.debits()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('CASE F — two concurrent identical requests', () => {
  it('at most one provider call and at most one debit', async () => {
    const h = makeHarness({ balance: 100 });
    const [a, b] = await Promise.all([
      run(h, { requestId: 'k1' }),
      run(h, { requestId: 'k1' }),
    ]);

    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
    expect(h.balance).toBe(75);

    // Which of the two safe outcomes the loser gets depends on how far the
    // winner got first, and that is genuinely a race -- so it is not asserted.
    // What IS asserted is that neither outcome can be a second generation:
    // every 200 here carries the SAME answer, and any non-200 is the explicit
    // in-flight code rather than an error the caller would retry blindly.
    for (const r of [a, b]) {
      if (r.status === 200) {
        expect(r.body.name).toBe('Rutin #1');
      } else {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe(REQUEST_IN_PROGRESS);
      }
    }
  });

  it('a caller arriving mid-flight is told so, and does not start a second call', async () => {
    // The race above, made deterministic: the provider is held open, so the
    // second request provably arrives while the first is still inside it.
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const h = makeHarness({ balance: 100, hold });

    // The fingerprint is computed up front: `crypto.subtle` is a real async
    // hop, and leaving it inside the timed section would mean waiting on the
    // hash rather than on the claim.
    const fingerprint = await fingerprintInput('routine', [ROUTINE_PROMPT]);
    const call = () => runIdempotentAiRequest(
      { requestId: 'k1', mode: 'routine', fingerprint, cost: 25 }, h.deps,
    );

    const first = call();
    // Let the first reach the provider and stop there.
    for (let i = 0; i < 50 && h.providerCalls === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(h.providerCalls).toBe(1);

    const second = await call();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe(REQUEST_IN_PROGRESS);
    // The decisive assertion: the in-flight caller did NOT call the provider.
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);

    release();
    const done = await first;
    expect(done.status).toBe(200);
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
  });

  it('the loser can collect the answer once the winner stores it', async () => {
    const h = makeHarness({ balance: 100 });
    await Promise.all([run(h, { requestId: 'k1' }), run(h, { requestId: 'k1' })]);
    const later = await run(h, { requestId: 'k1' });

    expect(later.status).toBe(200);
    expect(later.body.replayed).toBe(true);
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('CASE G — the answer was stored but the client never saw it', () => {
  it('a retry recovers the persisted output without calling the provider', async () => {
    const h = makeHarness({ balance: 30 });

    // The first call completes and stores; imagine the socket dies here and
    // the client sees a network error rather than this body.
    const lost = await run(h, { requestId: 'k1' });
    expect(h.rows.get('k1')!.status).toBe('completed');

    const recovered = await run(h, { requestId: 'k1' });

    expect(recovered.status).toBe(200);
    expect(recovered.body.name).toBe(lost.body.name);
    expect(recovered.body.items).toEqual(lost.body.items);
    expect(recovered.body.replayed).toBe(true);
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
    // The user paid once and got the thing they paid for.
    expect(h.balance).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe('CASE H — a genuine failure still refunds', () => {
  it('a refused provider result refunds and marks the key spent', async () => {
    const h = makeHarness({
      balance: 30,
      provider: () => ({ ok: false, reason: 'ai_truncated', message: 'AI yanıtı yarım kaldı, tekrar deneyin.' }),
    });
    const res = await run(h, { requestId: 'k1' });

    expect(res.status).toBe(500);
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toEqual([['k1', -25]]);
    expect(h.refunds()).toEqual([['k1:refund', 25]]);
    expect(h.balance).toBe(30);
    expect(h.rows.get('k1')!.status).toBe('failed');
  });

  it('a thrown provider error refunds too, and the message is mapped', async () => {
    const h = makeHarness({
      balance: 30,
      provider: () => { throw new Error('overloaded_error'); },
    });
    const res = await run(h, { requestId: 'k1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('mapped:overloaded_error');
    expect(h.balance).toBe(30);
    expect(h.refunds()).toHaveLength(1);
  });

  it('a charge this call did not make is never refunded', async () => {
    // The ledger already holds the key but `ai_requests` does not -- a key
    // from before the table existed. Refunding here would hand back money
    // this call never took.
    const h = makeHarness({
      balance: 30,
      provider: () => ({ ok: false, reason: 'ai_empty_response', message: 'boş' }),
    });
    await h.deps.spend({ requestId: 'old', mode: 'routine', cost: 25 });
    const balanceBefore = h.balance;

    await run(h, { requestId: 'old' });

    expect(h.balance).toBe(balanceBefore);
    expect(h.refunds()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('CASE I — no credit means no provider call', () => {
  it('402 before the provider, with no ledger movement', async () => {
    const h = makeHarness({ balance: 5 });
    const res = await run(h, { requestId: 'k1' });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe(INSUFFICIENT_CREDITS);
    expect(res.body.balance).toBe(5);
    expect(res.body.cost).toBe(25);
    expect(h.providerCalls).toBe(0);
    expect(h.debits()).toHaveLength(0);
    expect(h.balance).toBe(5);
  });

  it('the key is released, so it works again once there is credit', async () => {
    // A claim that never became a transaction must leave no trace. If it
    // stayed, topping up and retrying would hit `in_progress` forever.
    const h = makeHarness({ balance: 5 });
    await run(h, { requestId: 'k1' });

    expect(h.released).toEqual(['k1']);
    expect(h.rows.has('k1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the claim is taken before anything can be spent or called', () => {
  it('an unavailable claim fails closed', async () => {
    const h = makeHarness({ balance: 100 });
    const deps = { ...h.deps, begin: async () => ({ kind: 'unavailable' as const, error: 'db down' }) };
    const res = await runIdempotentAiRequest(
      { requestId: 'k1', mode: 'routine', fingerprint: 'f', cost: 25 },
      deps,
    );
    // No claim means nothing prevents a second call, so there must not be a
    // first one.
    expect(res.status).toBe(503);
    expect(h.providerCalls).toBe(0);
    expect(h.debits()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('the fingerprint identifies the input', () => {
  it('is stable for the same input and mode', async () => {
    expect(await fingerprintInput('routine', ['a'])).toBe(await fingerprintInput('routine', ['a']));
  });

  it('changes with the input', async () => {
    expect(await fingerprintInput('routine', ['a'])).not.toBe(await fingerprintInput('routine', ['b']));
  });

  it('changes with the mode, so a cheap mode cannot inherit a dear one', async () => {
    expect(await fingerprintInput('routine', ['a'])).not.toBe(await fingerprintInput('coach', ['a']));
  });

  it('cannot be confused by where one field ends and the next begins', async () => {
    // Without the length prefix, ['ab','c'] and ['a','bc'] would join to the
    // same string and two different requests would share an identity.
    expect(await fingerprintInput('insights', ['ab', 'c']))
      .not.toBe(await fingerprintInput('insights', ['a', 'bc']));
  });
});

// ---------------------------------------------------------------------------
describe('the short-circuit is structurally ahead of the provider', () => {
  const SRC = readFileSync(
    join(__dirname, '..', '..', '..', 'supabase', 'functions', '_shared', 'aiIdempotency.ts'),
    'utf8',
  );

  it('the replay branch returns before callProvider is ever reached', () => {
    const replay = SRC.indexOf("begin.kind === 'replay'");
    const call = SRC.indexOf('deps.callProvider()');
    expect(replay).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(replay).toBeLessThan(call);
  });

  it('there is exactly one provider call site to reason about', () => {
    expect(SRC.match(/deps\.callProvider\(\)/g)).toHaveLength(1);
  });

  it('the claim precedes the spend, which precedes the call', () => {
    expect(SRC.indexOf('deps.begin(')).toBeLessThan(SRC.indexOf('deps.spend('));
    expect(SRC.indexOf('deps.spend(')).toBeLessThan(SRC.indexOf('deps.callProvider()'));
  });
});
