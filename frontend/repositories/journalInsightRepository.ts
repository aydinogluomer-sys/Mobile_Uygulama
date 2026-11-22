/**
 * `journal_insights` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/insightsStore.ts`. These rows hold
 * AI-generated prose about the user's journal, so the explicit `user_id`
 * filter matters for the same reason it does on `journal_entries`.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, type RepoResult } from './shared';

export const JOURNAL_INSIGHT_COLUMNS =
  'id,user_id,period,period_key,content,entry_count,created_at,updated_at';

export async function fetchJournalInsight<T>(
  period: string,
  key: string,
): Promise<RepoResult<T | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('journal_insights')
    .select(JOURNAL_INSIGHT_COLUMNS)
    .eq('user_id', u.userId)
    .eq('period', period)
    .eq('period_key', key)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? null) as T | null };
}

export async function upsertJournalInsight<T>(input: {
  period: string;
  key: string;
  content: string;
  entryCount: number;
}): Promise<RepoResult<T>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('journal_insights')
    .upsert(
      {
        user_id: u.userId,
        period: input.period,
        period_key: input.key,
        content: input.content,
        entry_count: input.entryCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,period,period_key' },
    )
    .select(JOURNAL_INSIGHT_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as T };
}
