/**
 * `life_area_logs` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/lifeAreasStore.ts`. The read was
 * already user-scoped and limited; the upsert was not routed through any
 * boundary and attached `user_id` from the caller.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, wrongAccountFor, type RepoResult } from './shared';

export type LifeAreaLogRow = { date: string; area: string; value: number };

export const LIFE_AREA_LOG_COLUMNS = 'date,area,value';

/** The most recent day's rows, newest first. `limit` bounds the lookback. */
export async function fetchRecentLifeAreaLogs(limit = 8): Promise<RepoResult<LifeAreaLogRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('life_area_logs')
    .select(LIFE_AREA_LOG_COLUMNS)
    .eq('user_id', u.userId)
    .order('date', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: (data ?? []) as unknown as LifeAreaLogRow[] };
}

export async function upsertLifeAreaLogs(
  date: string,
  values: Record<string, number>,
  expectedUserId?: string,
): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccountFor(expectedUserId, u.userId);
  if (wrong) return wrong;
  const rows = Object.entries(values).map(([area, value]) => ({
    user_id: u.userId, date, area, value,
  }));
  if (rows.length === 0) return { ok: true, data: true };
  const { error, status } = await supabase
    .from('life_area_logs')
    .upsert(rows, { onConflict: 'user_id,date,area' });
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: true };
}
