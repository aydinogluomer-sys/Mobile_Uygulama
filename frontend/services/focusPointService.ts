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
import { fetchCreditTransactions, type CreditTransactionRow } from '../repositories/creditRepository';

/**
 * Cost per AI action, mirroring `supabase/functions/generate-routine`'s own
 * `COST` table. Duplicated deliberately and pinned by a test: the client has
 * to show a price before it calls, and a client that guessed differently from
 * the server would quote one number and charge another.
 */
export const COST = { coach: 5, routine: 25, summarize: 3, insights: 5 } as const;
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

/**
 * Turns the server's answer into something the UI can act on.
 *
 * `INSUFFICIENT_CREDITS` is a normal outcome, not an error: the user is told
 * what the action costs and what they have. Everything else is a failure and
 * is reported as one — the previous code path treated any non-2xx the same
 * way, so "you cannot afford this" and "the AI service is down" produced the
 * same message.
 */
export type SpendOutcome =
  | { kind: 'ok'; balance: number; cost: number }
  | { kind: 'insufficient'; balance: number; cost: number }
  | { kind: 'failed'; error: string };

export function interpretSpend(body: unknown, httpStatus: number): SpendOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.code === 'INSUFFICIENT_CREDITS' || httpStatus === 402) {
    return {
      kind: 'insufficient',
      balance: Number(b.balance ?? 0),
      cost: Number(b.cost ?? 0),
    };
  }
  if (httpStatus < 200 || httpStatus >= 300 || typeof b.error === 'string') {
    return { kind: 'failed', error: String(b.error ?? `HTTP ${httpStatus}`) };
  }
  return { kind: 'ok', balance: Number(b.balance ?? 0), cost: Number(b.cost ?? 0) };
}

export const listTransactions = (limit = 80) => fetchCreditTransactions({ limit });
export type { CreditTransactionRow };
