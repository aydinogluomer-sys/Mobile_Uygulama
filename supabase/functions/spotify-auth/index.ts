import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID') ?? '';
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const basicAuth = () => `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Authorization header'dan kullanıcıyı doğrula
async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user;
}

// Geçerli (gerekirse yenilenmiş) access token + ürün bilgisini döndür
async function getValidToken(admin: any, userId: string): Promise<{ access_token: string; product: string | null } | null> {
  const { data } = await admin.from('spotify_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  let access = data.access_token as string;
  // Süresi 60 sn içinde dolacaksa yenile
  if (new Date(data.expires_at).getTime() - Date.now() < 60_000) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }),
    });
    const t = await r.json();
    if (!r.ok) return null;
    access = t.access_token;
    await admin.from('spotify_accounts').update({
      access_token: access,
      refresh_token: t.refresh_token ?? data.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
  }
  return { access_token: access, product: data.product ?? null };
}

// Spotify oynatma uç noktasına çağrı; 204'leri normalize et, anlamlı hata döndür
async function spotifyControl(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return { ok: true };
  if (res.status === 404) return { ok: false, error: 'no_active_device' };
  if (res.status === 403) return { ok: false, error: 'premium_required' };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: txt || `spotify_${res.status}` };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const action = url.searchParams.get('action') ?? body.action;

  // ── OAuth URL ──────────────────────────────────────────────────────────
  if (action === 'url') {
    if (!SPOTIFY_CLIENT_ID) return json({ error: 'Spotify yapılandırması eksik (yönetici kurulumu gerekli).' }, 500);
    const redirectUri = url.searchParams.get('redirect_uri') ?? body.redirect_uri ?? '';
    const state = crypto.randomUUID();
    const oauthUrl =
      'https://accounts.spotify.com/authorize' +
      `?client_id=${encodeURIComponent(SPOTIFY_CLIENT_ID)}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}` +
      '&show_dialog=true';
    return json({ url: oauthUrl, state });
  }

  // ── Kod → Token + profil ───────────────────────────────────────────────
  if (action === 'callback') {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const { code, redirect_uri } = body;
    if (!code) return json({ error: 'code gerekli' }, 400);

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return json({ error: `Token alınamadı: ${JSON.stringify(tokenData)}` }, 400);

    // Profil
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await admin.from('spotify_accounts').upsert({
      user_id: user.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
      scope: tokenData.scope ?? SCOPES,
      spotify_user_id: me?.id ?? null,
      display_name: me?.display_name ?? me?.id ?? 'Spotify',
      product: me?.product ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return json({
      success: true,
      display_name: me?.display_name ?? me?.id ?? 'Spotify',
      product: me?.product ?? null,
    });
  }

  // ── Durum ──────────────────────────────────────────────────────────────
  if (action === 'status') {
    const user = await getUser(req);
    if (!user) return json({ connected: false });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data } = await admin.from('spotify_accounts')
      .select('display_name,product,updated_at').eq('user_id', user.id).maybeSingle();
    return json({ connected: !!data, ...(data ?? {}) });
  }

  // ── Bağlantıyı kes ─────────────────────────────────────────────────────
  if (action === 'disconnect') {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await admin.from('spotify_accounts').delete().eq('user_id', user.id);
    return json({ success: true });
  }

  // ── Bundan sonrası geçerli token gerektirir ────────────────────────────
  const user = await getUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const tok = await getValidToken(admin, user.id);
  if (!tok) return json({ error: 'not_connected' }, 400);

  if (action === 'now-playing') {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (res.status === 204) return json({ is_playing: false, track: null });
    if (!res.ok) return json({ is_playing: false, track: null });
    const d = await res.json();
    const item = d?.item;
    return json({
      is_playing: !!d?.is_playing,
      progress_ms: d?.progress_ms ?? 0,
      track: item ? {
        name: item.name,
        artists: (item.artists ?? []).map((a: any) => a.name).join(', '),
        album_art: item.album?.images?.[0]?.url ?? null,
        duration_ms: item.duration_ms ?? 0,
        uri: item.uri,
      } : null,
    });
  }

  if (action === 'play') return json(await spotifyControl(tok.access_token, 'PUT', '/me/player/play'));
  if (action === 'pause') return json(await spotifyControl(tok.access_token, 'PUT', '/me/player/pause'));
  if (action === 'next') return json(await spotifyControl(tok.access_token, 'POST', '/me/player/next'));
  if (action === 'previous') return json(await spotifyControl(tok.access_token, 'POST', '/me/player/previous'));

  if (action === 'play-context') {
    const context_uri = body.context_uri;
    if (!context_uri) return json({ ok: false, error: 'context_uri gerekli' }, 400);
    return json(await spotifyControl(tok.access_token, 'PUT', '/me/player/play', { context_uri }));
  }

  return json({ error: 'Geçersiz action' }, 400);
});
