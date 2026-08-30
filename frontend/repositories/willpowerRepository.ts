/**
 * `willpower_state` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/willpowerStore.ts`. The state is keyed
 * on `(user_id, state_date)` — one row per user per day — so every function
 * here takes the date explicitly rather than reading a clock, keeping the
 * repository free of time dependence the way the rest of this layer is.
 *
 * `spend`/`refund` previously issued `.update(...).eq('user_id').eq('state_date')`
 * and discarded the result, so a rejected write left the UI showing willpower
 * the server had not recorded as spent.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, type RepoResult } from './shared';

export type WillpowerStateRow = {
  user_id: string;
  state_date: string;
  daily_budget: number;
  used: number;
  focus_capacity: number;
  active_count: number;
};

const DEFAULTS = { daily_budget: 15, used: 0, focus_capacity: 3, active_count: 0 };

/** Today's row, creating it with the standard budget if the day is new. */
export async function fetchOrCreateWillpowerState(
  date: string,
): Promise<RepoResult<WillpowerStateRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const existing = await supabase
    .from('willpower_state')
    .select('*')
    .eq('user_id', u.userId)
    .eq('state_date', date)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data) return { ok: true, data: existing.data as unknown as WillpowerStateRow };

  const created = await supabase
    .from('willpower_state')
    .upsert({ user_id: u.userId, state_date: date, ...DEFAULTS })
    .select('*')
    .single();
  if (created.error) return { ok: false, error: created.error.message };
  return { ok: true, data: created.data as unknown as WillpowerStateRow };
}

export async function updateWillpowerState(
  date: string,
  patch: Partial<Pick<WillpowerStateRow, 'used' | 'active_count' | 'daily_budget' | 'focus_capacity'>>,
): Promise<RepoResult<WillpowerStateRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('willpower_state')
    .update(patch)
    .eq('user_id', u.userId)
    .eq('state_date', date)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'İrade durumu bulunamadı.' };
  return { ok: true, data: data as unknown as WillpowerStateRow };
}
