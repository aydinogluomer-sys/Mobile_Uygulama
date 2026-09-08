/**
 * `webhooks` data access.  (plan §8; migration 009_retire_legacy_backend)
 *
 * Replaces `webhookAPI` in `utils/api.ts`. The endpoint it called had no
 * authentication and no owner column, so `GET /api/webhooks` returned every
 * user's registered URLs — including whatever secret they had put in the
 * headers — to anyone who asked.
 *
 * Only registration lives here. Delivery is in `services/webhookService.ts`,
 * on the device.
 */
import { supabase } from '../lib/supabase';
import { currentUserId, deleteOwned, updateOwned, type RepoResult } from './shared';

export type WebhookEvent = 'habit_completed' | 'task_completed';

export type WebhookRow = {
  id: string;
  user_id: string;
  url: string;
  event_types: WebhookEvent[];
  headers: Record<string, string> | null;
  enabled: boolean;
  created_at: string;
};

const COLS = 'id,user_id,url,event_types,headers,enabled,created_at';

/**
 * Every registration for the current user.
 *
 * Deliberately NOT paginated, unlike the collections in the other
 * repositories: this is a BOUNDED_DOMAIN_WINDOW. A user configures a handful
 * of endpoints, the settings screen shows all of them at once, and the
 * dispatcher needs the complete enabled set to decide what to fire — a page
 * of it would silently skip webhooks. The `.limit()` is the guard against
 * that assumption being wrong rather than a page size.
 */
export async function fetchWebhooks(): Promise<RepoResult<WebhookRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('webhooks')
    .select(COLS)
    .eq('user_id', u.userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as WebhookRow[] };
}

export async function insertWebhook(input: {
  url: string;
  eventTypes?: WebhookEvent[];
  headers?: Record<string, string> | null;
}): Promise<RepoResult<WebhookRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('webhooks')
    .insert({
      user_id: u.userId,
      url: input.url,
      event_types: input.eventTypes ?? ['habit_completed', 'task_completed'],
      headers: input.headers ?? null,
    })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as WebhookRow };
}

export async function setWebhookEnabled(id: string, enabled: boolean): Promise<RepoResult<WebhookRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<WebhookRow>({ table: 'webhooks', id, userId: u.userId, patch: { enabled }, columns: COLS });
}

export async function deleteWebhook(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'webhooks', id, userId: u.userId });
}
