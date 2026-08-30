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
 * whole fix — the debit must come before the AI client is constructed, and
 * every path out after the charge must either return output or refund. The
 * database side is verified separately, live, in the migration probes
 * recorded in 20260831_focus_point_atomicity.sql.
 */
// The service re-exports the CRUD reads, so importing it constructs the
// Supabase client. Mocked away: this file is about ordering and prices.
jest.mock('../../repositories/creditRepository', () => ({ fetchCreditTransactions: jest.fn() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { COST, newRequestId } from '../../services/focusPointService';

const EDGE = join(__dirname, '..', '..', '..', 'supabase', 'functions', 'generate-routine', 'index.ts');
const src = stripComments(readFileSync(EDGE, 'utf8'));

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

  it('the debit precedes constructing the Anthropic client', () => {
    // The ordering IS the fix. If the client is built first, the AI call can
    // happen before anyone has been charged for it.
    const debit = src.indexOf("rpc('spend_focus_points_v2'");
    const ai = src.indexOf('new Anthropic(');
    expect(debit).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(-1);
    expect(debit).toBeLessThan(ai);
  });

  it("reads the RPC's ok flag rather than only its balance", () => {
    expect(src).toContain('spend.ok !== true');
  });

  it("does not fabricate a balance from the pre-read", () => {
    // `balance - cost` was the number returned when the debit failed.
    expect(src).not.toMatch(/balance\s*-\s*cost/);
    expect(src).toContain('const balance = Number(spend.balance)');
  });

  it('handles the RPC error instead of relying on a catch that never fires', () => {
    // supabase-js RETURNS rpc errors; it does not throw them.
    expect(src).toContain('error: spendErr');
    expect(src).toMatch(/if \(spendErr\)/);
    expect(src).not.toContain('catch (_)');
  });

  it('refuses an unaffordable request before spending money at Anthropic', () => {
    const refuse = src.indexOf("code: 'INSUFFICIENT_CREDITS'");
    const ai = src.indexOf('new Anthropic(');
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(ai);
  });
});

describe('every path out after the charge settles it', () => {
  it('each empty-AI-response branch refunds first', () => {
    // Four modes, four "the model gave us nothing" exits.
    const refunds = src.match(/await refund\('ai_empty_response'\)/g) ?? [];
    expect(refunds).toHaveLength(4);
  });

  it('a thrown AI error refunds', () => {
    expect(src).toContain("await refundOnThrow?.('ai_error')");
  });

  it('the refund handle is reachable from the catch block', () => {
    // `refund` is declared inside `try`; the catch cannot see it. The hoisted
    // handle is what makes the refund in the catch actually run, so its
    // declaration must come before the try.
    const handle = src.indexOf('let refundOnThrow');
    const tryStart = src.indexOf('try {');
    expect(handle).toBeGreaterThan(-1);
    expect(handle).toBeLessThan(tryStart);
  });

  it('a refund that fails is recorded, not swallowed', () => {
    // The user has paid for a failed call. Silence would make that
    // permanently invisible.
    expect(src).toContain("console.error('REFUND FAILED'");
  });

  it('the success path returns the database balance', () => {
    expect(src).toContain('return json({ ...payload, balance, cost, replayed })');
  });

  it('a replayed charge is not refunded by the retry that observed it', () => {
    // `charged` is false for a replay, so the refund is a no-op. Otherwise a
    // retry that failed would credit back a charge belonging to the first,
    // successful attempt.
    expect(src).toContain('let charged = !replayed');
    expect(src).toContain('if (!charged) return');
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
