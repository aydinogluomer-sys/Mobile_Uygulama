/**
 * Focus Points — the credit the AI features spend.  (plan §8, §12)
 *
 * ## Why a service
 *
 * Spending is not a write, it is a transaction with an ordering rule: the
 * balance must be checked before the AI call, and debited only after the AI
 * call succeeded. Get that order wrong in either direction and the user
 * either pays for nothing or gets AI output for free. The rule is stated
 * here so both the client preview and the server enforcement describe the
 * same thing.
 *
 * The AUTHORITY is the edge function, which holds the service role and does
 * the actual debit. Nothing here is a security control — a client that skips
 * `canAfford` simply gets a 402 from the server. What this gives is an honest
 * preview and one definition of the prices.
 */
import { ACTION_COST } from '../lib/subscription';
import { fetchCreditTransactions, type CreditTransactionRow } from '../repositories/creditRepository';

/**
 * Tek istemci kaynağı `lib/subscription.ACTION_COST`; sunucu eşitliği
 * `focusPointAtomicity.test.ts:217` ile sabittir.
 */
export const COST = ACTION_COST;
export type AiAction = keyof typeof COST;

export type Affordability =
  | { ok: true; cost: number; remaining: number }
  | { ok: false; cost: number; balance: number; shortfall: number };

/** Can this action be paid for out of `balance`? */
export function canAfford(action: AiAction, balance: number): Affordability {
  const cost = COST[action];
  if (balance >= cost) return { ok: true, cost, remaining: balance - cost };
  return { ok: false, cost, balance, shortfall: cost - balance };
}

export const listTransactions = (limit = 80) => fetchCreditTransactions({ limit });
export type { CreditTransactionRow };

/**
 * A key that identifies ONE spend attempt.
 *
 * The edge function passes it to `spend_focus_points_v2`, which is unique on
 * `(user_id, request_id)`. Two things follow: a retry of the same attempt
 * replays the first outcome instead of charging again, and a refund can name
 * exactly which charge it reverses — without that, a retried refund would
 * credit twice, which is the double-charge bug wearing the other sign.
 *
 * Generate it ONCE where the attempt starts and reuse it for every retry of
 * that attempt. A fresh tap is a new attempt and gets a new key: the user
 * asked for a second answer and pays for it. That is the intended meaning,
 * not a gap.
 *
 * Not `crypto.randomUUID()`: it is absent on Hermes in some Expo runtimes,
 * and a missing global here would throw on the path that spends money. The
 * key only has to be unique within one account's ledger.
 */
export function newRequestId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `fp-${Date.now().toString(36)}-${rand()}${rand()}`;
}
