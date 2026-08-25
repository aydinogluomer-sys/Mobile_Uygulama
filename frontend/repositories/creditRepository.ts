/**
 * `credit_transactions` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * The inline call this replaces (`app/screens/credit-history.tsx`) had no
 * explicit `.eq('user_id', ...)` filter and relied on RLS alone. Plan Rule 2/
 * Rule 3 treat RLS as the backstop, not the only guard, so this repository
 * adds the explicit scope on top of it -- under correct RLS the returned row
 * set is unchanged (RLS already limited it to the caller's own rows), so this
 * does not alter what the screen shows.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, RepoResult } from './shared';

export type CreditTransactionRow = {
  id: string;
  delta: number;
  reason: string | null;
  balance_after: number | null;
  created_at: string;
};

/** Most recent `limit` credit transactions, newest first. */
export async function fetchCreditTransactions(params: {
  limit: number;
}): Promise<RepoResult<CreditTransactionRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('id,delta,reason,balance_after,created_at')
    .eq('user_id', u.userId)
    .order('created_at', { ascending: false })
    .limit(params.limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as CreditTransactionRow[] };
}
