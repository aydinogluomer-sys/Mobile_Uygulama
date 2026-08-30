/**
 * `deep_work_sessions` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/deepWorkStore.ts`.
 *
 * The list query is windowed by DATE rather than keyset-paginated, because
 * every consumer of it is an aggregate over a period — `todayMinutes()` and
 * `weekMinutes()`. Paging a sum makes no sense: a partial page would produce
 * a partial total that still looks like a total. The store already asked for
 * 30 days; that window is now explicit and adjustable instead of hard-coded
 * inside the store.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, deleteOwned, type RepoResult } from './shared';
import { ymd } from '../lib/date';

export type DeepWorkRow = {
  id: string;
  user_id: string;
  subject: string;
  duration_minutes: number;
  date: string;
  created_at: string;
};

const COLS = 'id,user_id,subject,duration_minutes,date,created_at';

export async function fetchDeepWorkSince(days = 30): Promise<RepoResult<DeepWorkRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, Math.min(days, 365)));
  const { data, error } = await supabase
    .from('deep_work_sessions')
    .select(COLS)
    .eq('user_id', u.userId)
    .gte('date', ymd(since))
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as DeepWorkRow[] };
}

export async function insertDeepWorkSession(input: {
  subject: string;
  minutes: number;
  date: string;
}): Promise<RepoResult<DeepWorkRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const minutes = Math.max(0, Math.round(input.minutes));
  const { data, error } = await supabase
    .from('deep_work_sessions')
    .insert({ user_id: u.userId, subject: input.subject, duration_minutes: minutes, date: input.date })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as DeepWorkRow };
}

export async function deleteDeepWorkSession(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'deep_work_sessions', id, userId: u.userId });
}
