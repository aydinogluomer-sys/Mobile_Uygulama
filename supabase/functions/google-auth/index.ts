/**
 * google-auth — Google Calendar account linking.
 *
 * ## Why this file is new rather than a copy
 *
 * `frontend/store/googleCalendarStore.ts` has always called `google-auth` with
 * four actions (`url`, `callback`, `status`, `disconnect`). The function
 * existed only under `backend/supabase/functions/`: never in the canonical
 * tree, never deployed, and writing to a table that did not exist. Every
 * Google Calendar action in the shipped app returned 404 while the UI showed
 * the integration as available.
 *
 * The `backend/` copy was NOT copied over as-is, because it carries two
 * defects this repository has already fixed everywhere else:
 *
 *   1. It minted a `state` with `crypto.randomUUID()`, handed it to the
 *      client, and never looked at it again. There was no CSRF protection on
 *      account linking and nothing to compare against.
 *   2. It interpolated an unvalidated `redirect_uri` into Google's authorize
 *      URL and forwarded it to the token endpoint — anyone could ask this
 *      function for a legitimately-formed Google authorize link that delivers
 *      the authorization code to a host they control.
 *
 * `_shared/oauthState.ts` and `_shared/redirectAllowlist.ts` exist precisely
 * for these, and `spotify-auth` already uses both. This follows that pattern.
 *
 * ## Configuration is reported, not assumed
 *
 * The old copy read `Deno.env.get('GOOGLE_CLIENT_ID')!`. The `!` is a
 * TypeScript assertion and does nothing at runtime, so a project without the
 * secret produced `client_id=undefined` in a real Google URL and failed at the
 * provider with an opaque message. Here a missing secret is a first-class
 * answer: `status` returns `configured: false` so the client can present the
 * integration as unavailable instead of offering a button that cannot work.
 *
 * ## Token storage
 *
 * `google_calendar_integrations` is server-only fail-closed — RLS enabled,
 * zero client policies, same as `spotify_accounts`. It holds a Google refresh
 * token, so it is read and written ONLY through the service role, and only
 * after this function has verified the caller's identity itself. `status` and
 * `disconnect` therefore use the admin client too; a user-scoped client would
 * silently see nothing.
 */
import { createClient } from '@supabase/supabase-js';
import { parseAllowlist, isAllowedRedirect } from '../_shared/redirectAllowlist.ts';
import { mintState, verifyState } from '../_shared/oauthState.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// `?? ''` rather than `!`: a missing secret must be a value this code can see
// and report, not an assertion that evaporates at runtime.
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const REDIRECT_ALLOWLIST = parseAllowlist(Deno.env.get('OAUTH_REDIRECT_ALLOWLIST'));
const STATE_SECRET = Deno.env.get('OAUTH_STATE_SECRET') ?? '';

const SCOPES = 'openid profile email https://www.googleapis.com/auth/calendar.events';

/** Everything the OAuth flow needs before it can be offered at all. */
const isConfigured = () =>
  !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET && !!STATE_SECRET && REDIRECT_ALLOWLIST.length > 0;

async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const action = url.searchParams.get('action') ?? body.action;

  // ── Durum ──────────────────────────────────────────────────────────────
  // Answers two different questions the client must not conflate: is this
  // integration usable at all (`configured`), and has THIS user linked it
  // (`connected`). Without the first, an unconfigured deployment is
  // indistinguishable from a user who simply has not connected yet, and the
  // UI offers a button that cannot work.
  if (action === 'status') {
    const user = await getUser(req);
    if (!user) return json({ configured: isConfigured(), connected: false }, 401);
    if (!isConfigured()) return json({ configured: false, connected: false });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await admin
      .from('google_calendar_integrations')
      .select('calendar_id, calendar_name, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return json({ configured: true, connected: false, error: error.message }, 500);

    return json({ configured: true, connected: !!data, ...(data ?? {}) });
  }

  // ── OAuth URL ──────────────────────────────────────────────────────────
  if (action === 'url') {
    if (!isConfigured()) {
      return json({ error: 'Google Calendar yapılandırması eksik (yönetici kurulumu gerekli).', configured: false }, 503);
    }
    const redirectUri = url.searchParams.get('redirect_uri') ?? body.redirect_uri ?? '';
    if (!isAllowedRedirect(redirectUri, REDIRECT_ALLOWLIST)) {
      return json({ error: 'redirect_uri izin verilen listede değil.' }, 400);
    }
    // Linking always has a session owner — unlike notion-auth, there is no
    // "sign in with Google" flow through this endpoint — so the state is
    // always uid-bound and the callback always verifies with the same uid.
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    let state: string;
    try {
      state = await mintState(STATE_SECRET, { uid: user.id });
    } catch {
      return json({ error: 'OAuth state yapılandırması eksik (OAUTH_STATE_SECRET).' }, 500);
    }

    const oauthUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      '&response_type=code' +
      `&scope=${encodeURIComponent(SCOPES)}` +
      '&access_type=offline' +
      '&prompt=consent' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;

    return json({ url: oauthUrl, state });
  }

  // ── Kod → Token ────────────────────────────────────────────────────────
  if (action === 'callback') {
    if (!isConfigured()) {
      return json({ error: 'Google Calendar yapılandırması eksik (yönetici kurulumu gerekli).', configured: false }, 503);
    }
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { code, redirect_uri } = body;
    if (!isAllowedRedirect(redirect_uri ?? '', REDIRECT_ALLOWLIST)) {
      return json({ error: 'redirect_uri izin verilen listede değil.' }, 400);
    }
    if (!code) return json({ error: 'code gerekli' }, 400);

    // Verified BEFORE the token exchange. A state checked afterwards has
    // already burned an authorization code at Google, which is the side
    // effect the check exists to prevent.
    const stateCheck = await verifyState(STATE_SECRET, body.state ?? '', { uid: user.id });
    if (!stateCheck.ok) {
      return json({ error: `OAuth state doğrulanamadı (${stateCheck.reason}).` }, 400);
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return json({ error: `Token alınamadı: ${JSON.stringify(tokenData)}` }, 400);

    const { access_token, refresh_token, expires_in, scope, token_type } = tokenData;
    if (!access_token) return json({ error: 'Access token alınamadı' }, 400);

    const calendarListRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    const calendarList = await calendarListRes.json();
    if (!calendarListRes.ok) {
      return json({ error: `Takvim listesi alınamadı: ${JSON.stringify(calendarList)}` }, 400);
    }

    const items: { id?: string; summary?: string; primary?: boolean }[] = calendarList.items ?? [];
    const primary = items.find((i) => i.primary) ?? items[0];
    const calendarId = primary?.id ?? 'primary';
    const calendarName = primary?.summary ?? 'Google Takvim';

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error: upsertError } = await admin.from('google_calendar_integrations').upsert({
      user_id: user.id,
      access_token,
      // Google returns no refresh_token on a re-consent without prompt=consent.
      // Keep whatever is already stored rather than overwriting it with ''.
      ...(refresh_token ? { refresh_token } : {}),
      expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
      scope: scope ?? SCOPES,
      token_type: token_type ?? 'Bearer',
      calendar_id: calendarId,
      calendar_name: calendarName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (upsertError) return json({ error: `Bağlantı kaydedilemedi: ${upsertError.message}` }, 500);

    return json({ success: true, calendar_id: calendarId, calendar_name: calendarName });
  }

  // ── Bağlantıyı kes ─────────────────────────────────────────────────────
  if (action === 'disconnect') {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error } = await admin
      .from('google_calendar_integrations')
      .delete()
      .eq('user_id', user.id);
    if (error) return json({ error: `Bağlantı kesilemedi: ${error.message}` }, 500);
    return json({ success: true });
  }

  return json({ error: 'Geçersiz action' }, 400);
});
