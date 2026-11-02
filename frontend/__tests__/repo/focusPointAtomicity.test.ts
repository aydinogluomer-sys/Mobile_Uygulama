/**
 * Focus Points are charged exactly once, or not at all.
 *
 * ## What was wrong
 *
 * `supabase/functions/generate-routine` read the balance, called Anthropic,
 * and debited afterwards:
 *
 *     const { data: spendRes } = await supabase.rpc('spend_focus_points', ...);
 *     if (Array.isArray(spendRes) && spendRes[0]) newBalance = spendRes[0].balance;
 *
 * `spend_focus_points` returns `(ok boolean, balance integer)` and `ok` was
 * never read. When the debit refused — the user no longer had the points —
 * the function took `balance`, the UN-debited number, and returned it as a
 * success. The user got the answer for free.
 *
 * Reachable without any adversary: two requests at balance 5 and cost 5 both
 * pass the up-front check, both call Anthropic, the first debits to 0, the
 * second gets `ok = false`. Two answers, one charge. A pre-check separated
 * from its debit by a multi-second network call is not a gate.
 *
 * Two more in the same six lines: the RPC's `error` was not destructured, so
 * the `catch` never fired and a failed debit returned `balance - cost`, a
 * number the database never agreed to; and there was no idempotency key, so a
 * retry paid Anthropic twice and charged twice.
 *
 * ## Why these are source assertions
 *
 * The edge function runs on Deno against a live database and an LLM; it is
 * not reachable from jest. What jest CAN hold is the ORDER, which is the
 * whole fix — the debit must come before the AI client is used, and every
 * path out after the charge must either return output or refund. The
 * database side is verified separately, live, in the migration probes
 * recorded in 010_focus_point_atomicity.sql.
 *
 * ## Where these properties now live
 *
 * The sequencing moved into `_shared/aiIdempotency.ts` when a second defect
 * turned up: the charge was idempotent but the WORK was not, so a replayed
 * key called Anthropic again for free. Closing that meant a claim/spend/call
 * order that is one function rather than a straight line through the handler.
 *
 * Nothing here was dropped in the move. Each assertion simply now reads the
 * file that owns the property: the ORCHESTRATOR for ordering and settlement,
 * the EDGE for prices, keys, and how the RPC results are read. The behaviour
 * is additionally proven — not merely asserted — with counted provider
 * invocations in `__tests__/edge/aiIdempotency.test.ts`.
 */
// The service re-exports the CRUD reads, so importing it constructs the
// Supabase client. Mocked away: this file is about ordering and prices.
jest.mock('../../repositories/creditRepository', () => ({ fetchCreditTransactions: jest.fn() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { COST, newRequestId } from '../../services/focusPointService';

const FUNCTIONS = join(__dirname, '..', '..', '..', 'supabase', 'functions');
const EDGE = join(FUNCTIONS, 'generate-routine', 'index.ts');
const ORCHESTRATOR = join(FUNCTIONS, '_shared', 'aiIdempotency.ts');
const src = stripComments(readFileSync(EDGE, 'utf8'));
/** The file that now decides what runs, in what order, and how often. */
const orch = stripComments(readFileSync(ORCHESTRATOR, 'utf8'));

describe('the charge happens before the AI call', () => {
  it('the edge function is where this test thinks it is', () => {
    // Without this, a moved file would make every assertion below vacuous.
    expect(src).toContain('Deno.serve');
    expect(src.length).toBeGreaterThan(3000);
  });

  it('debits through the idempotent function, not the old one', () => {
    expect(src).toContain("rpc('spend_focus_points_v2'");
    expect(src).not.toContain("rpc('spend_focus_points'");
  });

  it('the debit precedes the provider call', () => {
    // The ordering IS the fix. It now lives in the orchestrator, where the
    // spend is awaited and only then is the provider reached.
    const debit = orch.indexOf('deps.spend(');
    const ai = orch.indexOf('deps.callProvider()');
    expect(debit).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(-1);
    expect(debit).toBeLessThan(ai);
  });

  it('the edge has exactly one way to reach Anthropic, and hands it over', () => {
    // The ordering above only means anything if the handler cannot call the
    // provider on its own. One construction site, inside one closure, passed
    // to the orchestrator as the single `callProvider`.
    expect(src.match(/new Anthropic\(/g)).toHaveLength(1);
    expect(src).toContain('const callAi = async (): Promise<ProviderResult>');
    expect(src).toContain('callProvider: callAi');
    // And the closure is never invoked by the handler itself.
    expect(src).not.toMatch(/await callAi\(\)/);
  });

  it("reads the RPC's ok flag rather than only its balance", () => {
    expect(src).toContain('row.ok !== true');
  });

  it('does not fabricate a balance from the pre-read', () => {
    // `balance - cost` was the number returned when the debit failed.
    expect(src).not.toMatch(/balance\s*-\s*cost/);
    expect(src).toContain('Number(row.balance)');
  });

  it('handles the RPC error instead of relying on a catch that never fires', () => {
    // supabase-js RETURNS rpc errors; it does not throw them. The spend
    // adapter reads `error` and reports it as its own outcome rather than
    // letting a falsy result read as "insufficient".
    expect(src).toContain("console.error('spend_focus_points_v2 failed:'");
    expect(src).toMatch(/return \{ kind: 'unavailable', error: error\.message \} as SpendResult/);
    expect(src).not.toContain('catch (_)');
  });

  it('refuses an unaffordable request before the provider is reached', () => {
    const refuse = orch.indexOf('INSUFFICIENT_CREDITS');
    const ai = orch.indexOf('deps.callProvider()');
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(ai);
  });

  it('an unaffordable request releases its claim, so the key is not burnt', () => {
    // Nothing was charged and nothing was called, so the attempt must leave
    // no trace -- otherwise topping up and retrying meets `in_progress`.
    const insufficient = orch.indexOf("spend.kind === 'insufficient'");
    const release = orch.indexOf('deps.release(', insufficient);
    const ret = orch.indexOf('status: 402', insufficient);
    expect(insufficient).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(insufficient);
    expect(release).toBeLessThan(ret);
  });
});

describe('every path out after the charge settles it', () => {
  it('each mode reports a refund reason instead of returning empty-handed', () => {
    // Four modes, four "the model gave us nothing" exits -- plus the
    // truncation guard. The branch names the reason; the orchestrator is what
    // spends it, which is why the count lives here and the refund below.
    const empty = src.match(/reason: 'ai_empty_response'/g) ?? [];
    expect(empty).toHaveLength(4);
    expect(src).toContain("reason: 'ai_truncated'");
  });

  // F07 OWNER DECISION (2026-11-02): both failure branches go through `failAndRefund`
  // (implementation.md F07, Blok A step 2), which refunds first and settles the key only when the
  // refund was written. The three assertions below pin that shape instead of the inline one.
  const settle = orch.slice(orch.indexOf('const failAndRefund = async'), orch.indexOf('let result: ProviderResult'));

  it('a refused provider result refunds and settles the key', () => {
    const refused = orch.indexOf('if (!result.ok)');
    expect(refused).toBeGreaterThan(-1);
    expect(orch.indexOf('return failAndRefund(', refused)).toBeGreaterThan(refused);
    const refund = settle.indexOf('deps.refund(');
    expect(refund).toBeGreaterThan(-1);
    expect(settle.indexOf('deps.fail(')).toBeGreaterThan(refund);
  });

  it('a thrown AI error refunds too', () => {
    // The old hoisted `refundOnThrow` handle existed because `refund` was
    // declared inside the `try` the catch could not see. The orchestrator has
    // no such split: one try/catch around the one provider call, with the
    // refund in scope, so the hazard is gone rather than worked around.
    expect(orch).toMatch(/catch \(err\)[\s\S]{0,320}failAndRefund\(\{ reason: 'ai_error'/);
    expect(src).not.toContain('refundOnThrow');
  });

  it('a refund that fails is recorded, not swallowed', () => {
    // The user has paid for a failed call. Silence would make that
    // permanently invisible.
    expect(src).toContain("console.error('REFUND FAILED'");
  });

  // F07 (EDG-01)
  it('the refund implementation answers true / false instead of swallowing the error and returning void', () => {
    const refund = src.slice(src.indexOf('refund: async ({ requestId: id, reason }) =>'), src.indexOf('expireLease: async'));
    expect(refund).toContain("admin.rpc('refund_focus_points'");
    expect(refund).toContain('return true');
    expect(refund).toContain('return false');
  });

  it('expireLease updates ai_requests only while in_progress and calls ai_request_reconcile_stale', () => {
    const expire = src.slice(src.indexOf('expireLease: async'), src.indexOf('callProvider: callAi'));
    expect(expire).toMatch(/admin\s*\.from\('ai_requests'\)/);
    expect(expire).toContain(".eq('status', 'in_progress')");
    expect(expire).toContain("'ai_request_reconcile_stale'");
  });

  it('the success path returns the database balance', () => {
    expect(orch).toContain('balance: spend.balance');
    expect(orch).toContain('replayed: false');
  });

  it('a replayed charge is not refunded by the retry that observed it', () => {
    // `charged` is false when the ledger already held the key, so the refund
    // is skipped. Otherwise a retry that failed would credit back a charge
    // belonging to the first, successful attempt.
    expect(orch).toContain("const charged = spend.kind === 'charged'");
    // F07 OWNER DECISION (2026-11-02): one refund call site, inside `if (charged)` in failAndRefund
    expect(orch.match(/deps\.refund\(/g)).toHaveLength(1);
    expect(settle).toMatch(/if \(charged\) \{\s*try \{ refunded = await deps\.refund\(/);
  });

  it('a successful answer is stored before it is returned', () => {
    // Otherwise a client that loses the response has no way back to the thing
    // it paid for.
    const complete = orch.indexOf('deps.complete(');
    const ret = orch.indexOf('replayed: false');
    expect(complete).toBeGreaterThan(-1);
    expect(complete).toBeLessThan(ret);
  });
});

describe('the idempotency key', () => {
  it('is generated server-side when the client sends none', () => {
    // Leaving it null was the tempting shortcut and was wrong: a keyless call
    // cannot be refunded, so an AI failure would leave the user charged.
    expect(src).toContain('crypto.randomUUID()');
    expect(src).toContain('const requestId: string');
  });

  it('rejects a client key that is too short or too long to be one', () => {
    expect(src).toMatch(/clientKey\.length >= 8 && clientKey\.length <= 128/);
  });

  it('newRequestId produces distinct keys inside the accepted length', () => {
    const keys = Array.from({ length: 500 }, () => newRequestId());
    expect(new Set(keys).size).toBe(500);
    for (const k of keys.slice(0, 20)) {
      expect(k.length).toBeGreaterThanOrEqual(8);
      expect(k.length).toBeLessThanOrEqual(128);
      expect(k).not.toMatch(/\s/); // the server trims and length-checks; whitespace would be a silent reject
    }
  });
});

describe('client and server quote the same prices', () => {
  it.each(Object.entries(COST))('%s costs %i on both sides', (action, cost) => {
    // The client shows a price before it calls. A client that guessed
    // differently would quote one number and charge another.
    expect(src).toMatch(new RegExp(`${action}:\\s*${cost}\\b`));
  });
});
