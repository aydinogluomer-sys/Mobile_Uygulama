/**
 * F20 (SYN-06 / SYN-20) — dışa aktarımın salt-okunur, tam tablo okuyucuları.
 *
 * Bu modül hiçbir yazma işlemi yapmaz. `profiles` (birincil anahtar `id`, `user_id` yok)
 * ve `user_onboarding` (birincil anahtar `user_id`, `id` yok) `keysetAll` ile okunamayacağı
 * için ayrı, açık sütun listeli tek-satır okuyucularıyla alınır (Anayasa 0.H).
 */
import { supabase } from '../lib/supabase';
import { keysetAll, type PagedRows } from './pagedSelect';
import { currentUserId, isTransportFailure, type RepoResult } from './shared';

/** Koleksiyon başına üst satır sınırı (`exportService.MAX_ROWS` ile tek kaynak). */
export const MAX_EXPORT_ROWS = 20_000;

export const EXPORT_FULL_TABLES = ['habits', 'habit_logs', 'journal_entries', 'focus_sessions', 'webhooks'] as const;
export type ExportFullTable = (typeof EXPORT_FULL_TABLES)[number];

/** `select('*')`, `user_id` süzgeçli, `id` anahtar-kümeli; `habits` arşivlenmişleri de içerir. */
export async function fetchFullTable(
  table: ExportFullTable,
  max = MAX_EXPORT_ROWS,
): Promise<RepoResult<PagedRows<Record<string, unknown>>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return keysetAll<Record<string, unknown>>((after, limit) => {
    let q = supabase.from(table).select('*').eq('user_id', u.userId).order('id', { ascending: true }).limit(limit);
    if (after !== null) q = q.gt('id', after);
    return q;
  }, { maxRows: max });
}

/** profiles: PK `id`, `user_id` sütunu yok. `push_token`, `coins`, `skill_points`, XP alanları ve `purged_xp` DIŞARIDA. */
export const PROFILE_EXPORT_COLUMNS = 'id,email,username,ai_persona,last_ai_context,created_at';
/** user_onboarding: PK `user_id`, `id` sütunu yok. `install_*` DIŞARIDA. */
export const ONBOARDING_EXPORT_COLUMNS =
  'user_id,onboarding_version,goals,primary_barrier,pace,preferred_dayparts,reminder_intent,status,completed_at,created_at,updated_at';

/** Sıfır ya da bir satır; satır yoksa boş dizi (hata değil). */
export async function fetchOwnProfileForExport(): Promise<RepoResult<Record<string, unknown>[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('profiles')
    .select(PROFILE_EXPORT_COLUMNS)
    .eq('id', u.userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status,
      offline: isTransportFailure(status, error),
    };
  }
  return { ok: true, data: data ? [{ ...data }] : [] };
}

export async function fetchOwnOnboardingForExport(): Promise<RepoResult<Record<string, unknown>[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('user_onboarding')
    .select(ONBOARDING_EXPORT_COLUMNS)
    .eq('user_id', u.userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status,
      offline: isTransportFailure(status, error),
    };
  }
  return { ok: true, data: data ? [{ ...data }] : [] };
}
