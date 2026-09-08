/**
 * Delete the CALLER'S account, and nothing else.
 *
 * ## Why this is a server function at all
 *
 * Removing a row from `auth.users` requires the service role, and the service
 * role must never exist in a client. So the client's only power here is to
 * prove who it is; the identity this function acts on is derived from the
 * verified JWT and from nowhere else. There is deliberately no `user_id` in
 * the request body -- not validated, not optional, not present. A parameter
 * that does not exist cannot be forged.
 *
 * ## What "delete" means
 *
 * One statement: `auth.admin.deleteUser(user.id)`. Every one of the 47 tables
 * in `public` that references `auth.users` is declared `ON DELETE CASCADE`
 * (see `027_account_deletion_cascade.sql` -- eight of them were not, and
 * this function would have failed outright on a foreign-key violation for any
 * user who had ever created a habit). The database performs the deletion as a
 * single transaction, so there is no half-deleted account to reason about.
 *
 * Tables that hang off a user-owned parent rather than off `auth.users`
 * directly -- `habit_reminders`, `reminders`, `routine_items`,
 * `profile_badges` -- cascade through that parent. The remaining tables
 * (`challenges`, `habit_templates`, `pet_stages`, `quests`, `shop_items`,
 * `skills`, `global_bosses`) are catalogs and hold no personal data.
 *
 * ## Fail closed
 *
 * Every failure path returns an error and deletes nothing. The one thing this
 * must never do is tell the client the account is gone when it is not, because
 * the client then clears the session and the user has no way back in to try
 * again. `ok: true` is returned only after the delete call itself succeeded.
 *
 * ## Retry-safe
 *
 * A second call with the same (now-deleted) user cannot authenticate at all,
 * so it stops at the 401 above -- there is no path on which this runs twice
 * against the same account. A retry that arrives while the first is still in
 * flight is serialised by the database, and the loser sees "user not found",
 * which is reported as success because the account IS gone.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'Yöntem desteklenmiyor' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Yetkisiz' }, 401);

  try {
    // The caller's own client. Its ONLY job is to turn a bearer token into a
    // verified identity; it is never used to delete anything.
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Kimlik doğrulama hatası' }, 401);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      // Fail closed: without the trusted path there is no deletion to report,
      // and saying "deleted" here would be a lie the user acts on.
      console.error('SUPABASE_SERVICE_ROLE_KEY missing; refusing to serve');
      return json({ error: 'Sunucu yapılandırma hatası' }, 500);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // `user.id` comes from the verified token above. This is the only value
    // that reaches the delete call, and the request body is never read.
    const { error } = await admin.auth.admin.deleteUser(user.id);

    if (error) {
      // Already gone is the outcome the caller asked for. Anything else is a
      // real failure and must not be dressed up as success.
      const message = String(error.message ?? '');
      if (/not.?found/i.test(message)) return json({ ok: true, alreadyDeleted: true });
      console.error('deleteUser failed:', message);
      return json({ error: 'Hesap silinemedi, lütfen tekrar deneyin.' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('delete-account error:', raw);
    return json({ error: 'Hesap silinemedi, lütfen tekrar deneyin.' }, 500);
  }
});
