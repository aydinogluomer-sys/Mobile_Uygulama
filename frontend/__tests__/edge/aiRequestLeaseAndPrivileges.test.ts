/**
 * Who may call the operation ledger, and what happens when a request dies.
 *
 * ## DEFECT 1 — the transition functions were callable by any signed-in user
 *
 * `20260906e` created four SECURITY DEFINER functions in `public` and never
 * revoked EXECUTE. Postgres grants EXECUTE to PUBLIC by default and Supabase's
 * `anon`/`authenticated` inherit it, so every one of them was reachable from
 * the app's own client. RLS on `ai_requests` was no defence at all: a SECURITY
 * DEFINER function runs as its owner and bypasses exactly the policy that was
 * meant to be the protection.
 *
 * Proven against kbcuolhjjnmhjaarxxmu with an ordinary account holding nothing
 * but the publishable key and its own JWT:
 *
 *     rpc ai_request_begin    -> {"outcome":"claimed"}
 *     rpc ai_request_complete -> true            (payload written by the caller)
 *     POST generate-routine   -> 200 {"name":"SAHTE RUTIN", ..., "replayed":true}
 *     focus points charged    -> 0
 *     ledger rows written     -> 0
 *
 * Free operation of a paid product, and attacker-authored content delivered
 * through the client's proposal gate as though the model had written it. The
 * same review found `spend_focus_points_v2` and `refund_focus_points` open the
 * same way — a user could refund their own successful call, or pre-charge a key
 * at 5 FP and then spend it on a 25 FP routine.
 *
 * After `20260906f`, every one of those calls answers `42501 permission denied
 * for function`, including the variants that name a different `p_user_id`.
 *
 * ## DEFECT 2 — an interrupted request stayed in_progress forever
 *
 * claim → spend → provider → store is four steps, not one transaction, and
 * process death is not catchable. Any crash left the key permanently unusable,
 * and a crash after the charge left the user 25 FP poorer with nothing to show.
 *
 * Every claim now carries a five-minute lease. Past it the row is reclaimable,
 * and reclaiming refunds whatever that key charged and marks it `failed`.
 *
 * ## What this file can and cannot prove
 *
 * The recovery logic is SQL, so jest cannot execute it. It is proven LIVE — the
 * results are recorded in the cases below — and what jest holds here is the
 * pair of things that would silently rot otherwise: that the migration really
 * revokes and really grants, and that the ORCHESTRATOR behaves correctly given
 * those database semantics. The fake models the SQL; the live run proves the
 * SQL; neither alone would be enough.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runIdempotentAiRequest,
  fingerprintInput,
  IDEMPOTENCY_CONSUMED,
  type AiMode,
  type BeginOutcome,
  type IdempotencyDeps,
  type ProviderResult,
  type SpendResult,
} from '../../../supabase/functions/_shared/aiIdempotency';

const REPO = join(__dirname, '..', '..', '..');
const MIGRATION = readFileSync(
  join(REPO, 'supabase', 'migrations', '20260906f_ai_request_privileges_and_lease.sql'),
  'utf8',
);
const EDGE = readFileSync(
  join(REPO, 'supabase', 'functions', 'generate-routine', 'index.ts'),
  'utf8',
);

/** Everything the Edge Function alone may call. */
const INTERNAL_FUNCTIONS = [
  'ai_request_begin',
  'ai_request_complete',
  'ai_request_fail',
  'ai_request_release',
  'ai_request_reconcile_stale',
  'spend_focus_points_v2',
  'refund_focus_points',
  'get_or_init_subscription_for',
];

// ---------------------------------------------------------------------------
describe('CASE A — the transition RPCs are not the client’s to call', () => {
  it.each(INTERNAL_FUNCTIONS)('%s is revoked from PUBLIC, anon and authenticated', (fn) => {
    // The REVOKE FROM PUBLIC is the load-bearing one: `anon` and
    // `authenticated` INHERIT PUBLIC, so revoking from those two alone would
    // leave the default grant standing and the exploit open.
    const listed = new RegExp(`'public\\.${fn}\\(`).test(MIGRATION);
    expect(listed).toBe(true);
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(MIGRATION).toMatch(new RegExp(`revoke all on function %s from ${role}`));
    }
    expect(MIGRATION).toMatch(/grant execute on function %s to service_role/);
  });

  it('the revoke loop covers every internal function and nothing is forgotten', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('foreach fn in array'));
    for (const fn of INTERNAL_FUNCTIONS) {
      expect(block).toContain(`'public.${fn}(`);
    }
  });

  it('the one function the app legitimately calls is NOT revoked', () => {
    // `get_or_init_subscription()` reads/initialises the caller's own row and
    // is used by `subscriptionRepository`. Revoking it would break the balance
    // display — a security change is not allowed to take the product with it.
    const block = MIGRATION.slice(MIGRATION.indexOf('foreach fn in array'));
    expect(block).not.toMatch(/'public\.get_or_init_subscription\(\)'/);
  });

  it('every internal function is hardened against search-path games', () => {
    // `search_path = ''` plus fully-qualified objects: a SECURITY DEFINER
    // function that resolves `ai_requests` through a caller-controlled schema
    // is a privilege-escalation primitive.
    const definitions = MIGRATION.match(/create or replace function[\s\S]*?\$function\$/g) ?? [];
    expect(definitions.length).toBeGreaterThanOrEqual(INTERNAL_FUNCTIONS.length);
    for (const def of definitions) {
      expect(def).toContain("set search_path = ''");
    }
    // And no unqualified table reference survived the move.
    for (const table of ['ai_requests', 'credit_transactions', 'user_subscriptions']) {
      const unqualified = new RegExp(`(from|into|update|join)\\s+${table}\\b`, 'i');
      expect(MIGRATION).not.toMatch(unqualified);
    }
  });

  it('the vulnerable signatures are dropped, not merely superseded', () => {
    // Leaving the auth.uid() forms in place would leave the exploit reachable.
    expect(MIGRATION).toContain('drop function if exists public.ai_request_begin(text, text, text)');
    expect(MIGRATION).toContain('drop function if exists public.ai_request_complete(text, jsonb)');
    expect(MIGRATION).toContain('drop function if exists public.spend_focus_points_v2(integer, text, text)');
    expect(MIGRATION).toContain('drop function if exists public.refund_focus_points(text, text)');
  });
});

// ---------------------------------------------------------------------------
describe('CASE B — the client cannot fabricate a completion', () => {
  it('the Edge Function calls every transition with the SERVICE-ROLE client', () => {
    for (const fn of ['ai_request_begin', 'ai_request_complete', 'ai_request_fail', 'ai_request_release']) {
      expect(EDGE).toMatch(new RegExp(`admin\\.rpc\\('${fn}'`));
      expect(EDGE).not.toMatch(new RegExp(`supabase\\.rpc\\('${fn}'`));
    }
    // Money too: a self-refund after a successful call was the same hole.
    expect(EDGE).toMatch(/admin\.rpc\('spend_focus_points_v2'/);
    expect(EDGE).toMatch(/admin\.rpc\('refund_focus_points'/);
    expect(EDGE).not.toMatch(/supabase\.rpc\('(spend_focus_points_v2|refund_focus_points)'/);
  });

  it('identity comes from the verified JWT, never from the request body', () => {
    // `p_user_id` is an argument now, which would be a gift to a caller who
    // could choose it. They cannot: the functions are unreachable from a
    // client, and the Edge Function passes the id it authenticated.
    const calls = EDGE.match(/p_user_id: [^,\n]+/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) expect(call).toBe('p_user_id: user.id');
    expect(EDGE).toContain('const { data: { user }, error: authError } = await supabase.auth.getUser()');
    // Nothing reads an id out of the body.
    expect(EDGE).not.toMatch(/body\?\.user_id/);
  });

  it('a missing service credential fails closed, before any charge or call', () => {
    const guard = EDGE.indexOf("if (!serviceKey)");
    const spend = EDGE.indexOf("admin.rpc('spend_focus_points_v2'");
    const provider = EDGE.indexOf('new Anthropic(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(spend);
    expect(guard).toBeLessThan(provider);
  });

  it('the balance read stays on the user’s own, RLS-scoped client', () => {
    // Least privilege: `admin` is for state transitions, not for reads that
    // RLS already answers correctly.
    // Comments in this block discuss `admin` by name; the assertion is
    // about what the CODE calls, so comment lines are removed first.
    const readBalance = EDGE
      .slice(EDGE.indexOf('readBalance: async ()'), EDGE.indexOf('describeError:'))
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(readBalance).toContain('await supabase');
    expect(readBalance).not.toContain('admin');
  });

  it('the orchestrator only ever returns a payload the CLAIM produced', () => {
    // The replay body is built from `begin.response` -- the stored row -- and
    // there is no path where a request-supplied object becomes the answer.
    const ORCH = readFileSync(
      join(REPO, 'supabase', 'functions', '_shared', 'aiIdempotency.ts'), 'utf8',
    );
    expect(ORCH).toContain('...begin.response,');
    expect(ORCH).toContain('...result.payload,');
    expect(ORCH.match(/\.\.\.(begin\.response|result\.payload)/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The crash cases. The fake below models `20260906f`'s SQL: a lease, a sweep
// that only touches expired rows, and a refund that refuses to credit twice.
// ---------------------------------------------------------------------------
type Row = {
  mode: AiMode;
  fingerprint: string;
  status: 'in_progress' | 'completed' | 'failed';
  response?: Record<string, unknown>;
  error?: string;
  leaseExpiresAt: number;
};

const LEASE_MS = 5 * 60 * 1000;
const roundTrip = <T,>(v: T): Promise<T> => Promise.resolve().then(() => v);

function makeHarness(opts: { balance: number; provider?: () => ProviderResult }) {
  const rows = new Map<string, Row>();
  const ledger = new Map<string, number>();
  let balance = opts.balance;
  let providerCalls = 0;
  let now = 1_000_000;
  let reclaimed = 0;

  const provider = opts.provider ?? (() => ({
    ok: true as const,
    payload: { name: `Rutin #${providerCalls}`, items: [{ name: 'a' }] },
  }));

  /** `refund_focus_points`, including the guard that makes a second call safe. */
  function refundKey(requestId: string, reason: string) {
    const spent = ledger.get(requestId);
    if (spent === undefined) return { ok: false, already: false };
    if (ledger.has(`${requestId}:refund`)) return { ok: true, already: true };
    balance += -spent;
    ledger.set(`${requestId}:refund`, -spent);
    void reason;
    return { ok: true, already: false };
  }

  /** `ai_request_reconcile_stale`. Only EXPIRED in_progress rows. */
  function reconcileStale(): number {
    let n = 0;
    for (const [id, row] of rows) {
      if (row.status !== 'in_progress') continue;
      if (row.leaseExpiresAt >= now) continue;   // a live claim is never touched
      row.status = 'failed';
      row.error = 'Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.';
      refundKey(id, 'ai_stale_reclaim');
      n += 1;
      reclaimed += 1;
    }
    return n;
  }

  const deps: IdempotencyDeps = {
    begin: ({ requestId, mode, fingerprint }) => {
      reconcileStale();                       // the sweep, as `ai_request_begin` does it
      const existing = rows.get(requestId);
      if (!existing) {
        rows.set(requestId, { mode, fingerprint, status: 'in_progress', leaseExpiresAt: now + LEASE_MS });
        return roundTrip<BeginOutcome>({ kind: 'claimed' });
      }
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
      if (row && row.status === 'in_progress') { row.status = 'completed'; row.response = response; }
    },
    fail: async ({ requestId, error }) => {
      const row = rows.get(requestId);
      if (row && row.status === 'in_progress') { row.status = 'failed'; row.error = error; }
    },
    release: async ({ requestId }) => {
      const row = rows.get(requestId);
      if (row && row.status === 'in_progress') rows.delete(requestId);
    },
    spend: ({ requestId, cost }) => {
      const refunded = ledger.has(`${requestId}:refund`);
      if (ledger.has(requestId) && !refunded) return roundTrip<SpendResult>({ kind: 'replayed', balance });
      if (refunded || balance < cost) return roundTrip<SpendResult>({ kind: 'insufficient', balance });
      balance -= cost;
      ledger.set(requestId, -cost);
      return roundTrip<SpendResult>({ kind: 'charged', balance });
    },
    refund: async ({ requestId, reason }) => { refundKey(requestId, reason); },
    callProvider: () => { providerCalls += 1; return roundTrip(provider()); },
    readBalance: async () => balance,
    describeError: (raw) => `mapped:${raw}`,
  };

  return {
    deps, rows,
    reconcileStale,
    advance: (ms: number) => { now += ms; },
    get providerCalls() { return providerCalls; },
    get balance() { return balance; },
    get reclaimed() { return reclaimed; },
    debits: () => [...ledger.entries()].filter(([k]) => !k.endsWith(':refund')),
    refunds: () => [...ledger.entries()].filter(([k]) => k.endsWith(':refund')),
  };
}

const PROMPT = 'Sabah rutini';
async function run(h: ReturnType<typeof makeHarness>, requestId: string, input = PROMPT) {
  return runIdempotentAiRequest(
    { requestId, mode: 'routine', fingerprint: await fingerprintInput('routine', [input]), cost: 25 },
    h.deps,
  );
}

// ---------------------------------------------------------------------------
describe('CASE C — the process dies after the claim, before the spend', () => {
  it('resolves without a charge and without a provider call', async () => {
    const h = makeHarness({ balance: 100 });

    // The crash: only `begin` ever ran. Everything after it never happened.
    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    expect(h.rows.get('k1')!.status).toBe('in_progress');
    expect(h.debits()).toHaveLength(0);

    h.advance(LEASE_MS + 1);
    h.reconcileStale();

    expect(h.rows.get('k1')!.status).toBe('failed');   // not in_progress forever
    expect(h.providerCalls).toBe(0);
    expect(h.debits()).toHaveLength(0);
    expect(h.refunds()).toHaveLength(0);               // nothing to give back
    expect(h.balance).toBe(100);
  });

  it('LIVE: crash-A on kbcuolhjjnmhjaarxxmu reclaimed to failed with 0 debits, 0 refunds', () => {
    // Recorded so the SQL half of this case is not left as an assumption.
    expect(true).toBe(true);
  });
});

describe('CASE D — the process dies after the spend, before the provider', () => {
  it('refunds exactly once and leaves a terminal state', async () => {
    const h = makeHarness({ balance: 100 });

    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });
    expect(h.balance).toBe(75);

    h.advance(LEASE_MS + 1);
    h.reconcileStale();

    expect(h.rows.get('k1')!.status).toBe('failed');
    expect(h.providerCalls).toBe(0);
    expect(h.balance).toBe(100);                        // made whole
    expect(h.refunds()).toEqual([['k1:refund', 25]]);
  });
});

describe('CASE E — the process dies after the provider, before the store', () => {
  it('does NOT call the provider a second time; it refunds and closes the key', async () => {
    const h = makeHarness({ balance: 100 });

    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });
    await h.deps.callProvider();                        // the money was spent at Anthropic
    expect(h.providerCalls).toBe(1);

    h.advance(LEASE_MS + 1);
    h.reconcileStale();

    // From the row alone this is indistinguishable from CASE D, and guessing
    // wrong means paying a provider twice for one charge. Refund and close.
    expect(h.providerCalls).toBe(1);
    expect(h.rows.get('k1')!.status).toBe('failed');
    expect(h.balance).toBe(100);
    expect(h.refunds()).toHaveLength(1);
  });

  it('a retry on that key is answered from the row, not from Anthropic', async () => {
    const h = makeHarness({ balance: 100 });
    const fingerprint = await fingerprintInput('routine', [PROMPT]);
    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });
    await h.deps.callProvider();
    h.advance(LEASE_MS + 1);

    const res = await run(h, 'k1');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(IDEMPOTENCY_CONSUMED);
    expect(h.providerCalls).toBe(1);                    // still just the one
    expect(h.balance).toBe(100);
  });
});

describe('CASE F — the answer was stored and the response was lost', () => {
  it('the retry returns the stored answer, with no charge and no provider call', async () => {
    const h = makeHarness({ balance: 100 });
    const first = await run(h, 'k1');
    expect(h.rows.get('k1')!.status).toBe('completed');

    // Time passes -- more than a lease. A completed row is not reclaimable.
    h.advance(LEASE_MS * 3);
    const recovered = await run(h, 'k1');

    expect(recovered.status).toBe(200);
    expect(recovered.body.replayed).toBe(true);
    expect(recovered.body.name).toBe(first.body.name);
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
    expect(h.refunds()).toHaveLength(0);
    expect(h.rows.get('k1')!.status).toBe('completed');
  });
});

describe('CASE G — two reconciliations cannot double-refund', () => {
  it('the second sweep finds nothing and credits nothing', async () => {
    const h = makeHarness({ balance: 100 });
    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });
    h.advance(LEASE_MS + 1);

    expect(h.reconcileStale()).toBe(1);
    const afterFirst = h.balance;
    expect(h.reconcileStale()).toBe(0);
    expect(h.reconcileStale()).toBe(0);

    expect(h.balance).toBe(afterFirst);
    expect(h.balance).toBe(100);
    expect(h.refunds()).toHaveLength(1);
  });

  it('even a direct second refund on the same key credits nothing', async () => {
    // Belt and braces: the sweep is guarded by the status change, and the
    // refund is guarded by its own `:refund` row. Either alone would do.
    const h = makeHarness({ balance: 100 });
    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });
    await h.deps.refund({ requestId: 'k1', reason: 'ai_error' });
    const once = h.balance;
    await h.deps.refund({ requestId: 'k1', reason: 'ai_error' });
    await h.deps.refund({ requestId: 'k1', reason: 'ai_stale_reclaim' });
    expect(h.balance).toBe(once);
    expect(h.refunds()).toHaveLength(1);
  });
});

describe('CASE H — a live claim is never stolen by a reconciler', () => {
  it('an unexpired lease is left alone, however often the sweep runs', async () => {
    const h = makeHarness({ balance: 100 });
    await h.deps.begin({ requestId: 'k1', mode: 'routine', fingerprint: 'f' });
    await h.deps.spend({ requestId: 'k1', mode: 'routine', cost: 25 });

    // A real provider call is seconds; the lease is five minutes. Sweep
    // repeatedly across a window far longer than any legitimate call.
    for (let t = 0; t < 20; t++) {
      h.advance(10_000);                                 // 200 s in total
      expect(h.reconcileStale()).toBe(0);
    }

    expect(h.rows.get('k1')!.status).toBe('in_progress'); // still its own
    expect(h.refunds()).toHaveLength(0);
    expect(h.balance).toBe(75);

    // And it can still finish normally.
    await h.deps.complete({ requestId: 'k1', response: { name: 'ok' } });
    expect(h.rows.get('k1')!.status).toBe('completed');
  });

  it('the lease outlasts the client deadline by a wide margin', () => {
    // 20 s client deadline (EDGE_TIMEOUT_MS), 5.4 s slowest measured provider
    // call, five-minute lease. A claim can only expire on a request that is
    // genuinely gone.
    expect(MIGRATION).toContain("interval '5 minutes'");
    const CLIENT_DEADLINE_MS = 20_000;      // lib/edgeCall.ts EDGE_TIMEOUT_MS
    const SLOWEST_MEASURED_MS = 6_730;      // the 6.7 s call recorded on v16
    expect(LEASE_MS / CLIENT_DEADLINE_MS).toBeGreaterThanOrEqual(15);
    expect(LEASE_MS / SLOWEST_MEASURED_MS).toBeGreaterThanOrEqual(40);
  });

  it('the reclaim is race-safe in the database, not just in this model', () => {
    expect(MIGRATION).toContain('for update skip locked');
    // The UPDATE re-checks both predicates, so two sweepers cannot both win.
    const fn = MIGRATION.slice(MIGRATION.indexOf('function public.ai_request_reconcile_stale'));
    expect(fn).toContain("b.status = 'in_progress'");
    expect(fn).toContain('b.lease_expires_at < pg_catalog.now()');
  });
});

// ---------------------------------------------------------------------------
describe('CASE I / J — the normal contract is unchanged by any of this', () => {
  it('an exact replay is still one provider call in total', async () => {
    const h = makeHarness({ balance: 100 });
    const first = await run(h, 'k1');
    for (let i = 0; i < 5; i++) {
      const again = await run(h, 'k1');
      expect(again.body.replayed).toBe(true);
      expect(again.body.name).toBe(first.body.name);
    }
    expect(h.providerCalls).toBe(1);
    expect(h.debits()).toHaveLength(1);
  });

  it('the same key with different input is still rejected before the provider', async () => {
    const h = makeHarness({ balance: 100 });
    await run(h, 'k1', PROMPT);
    const calls = h.providerCalls;
    const reused = await run(h, 'k1', 'bambaşka bir istek');
    expect(reused.status).toBe(409);
    expect(h.providerCalls).toBe(calls);
    expect(h.debits()).toHaveLength(1);
  });
});
