import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? (await req.json().catch(() => ({}))).action;

  if (action === 'url') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = crypto.randomUUID();
    const oauthUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${GOOGLE_CLIENT_ID}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('openid profile email https://www.googleapis.com/auth/calendar.events')}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;

    return new Response(JSON.stringify({ url: oauthUrl, state }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'callback') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

    const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

    const body = await req.json();
    const { code, redirect_uri } = body;
    if (!code) return new Response(JSON.stringify({ error: 'code gerekli' }), { status: 400, headers: CORS });

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
    if (!tokenRes.ok) return new Response(JSON.stringify({ error: `Token alınamadı: ${JSON.stringify(tokenData)}` }), { status: 400, headers: CORS });

    const { access_token, refresh_token, expires_in, scope, token_type } = tokenData;
    if (!access_token) return new Response(JSON.stringify({ error: 'Access token alınamadı' }), { status: 400, headers: CORS });

    const calendarListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const calendarList = await calendarListRes.json();
    if (!calendarListRes.ok) return new Response(JSON.stringify({ error: `Takvim listesi alınamadı: ${JSON.stringify(calendarList)}` }), { status: 400, headers: CORS });

    const primaryCalendar = (calendarList.items ?? []).find((item: any) => item.primary) ?? calendarList.items?.[0];
    const calendarId = primaryCalendar?.id ?? 'primary';
    const calendarName = primaryCalendar?.summary ?? 'Google Takvim';

    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await adminSupabase.from('google_calendar_integrations').upsert({
      user_id: user.id,
      access_token,
      refresh_token: refresh_token ?? '',
      expires_at: expiresAt,
      scope,
      token_type,
      calendar_id: calendarId,
      calendar_name: calendarName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return new Response(JSON.stringify({ success: true, calendar_id: calendarId, calendar_name: calendarName }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'status') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ connected: false }), { headers: CORS });
    const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await userSupabase
      .from('google_calendar_integrations')
      .select('calendar_id,calendar_name,updated_at')
      .maybeSingle();

    return new Response(JSON.stringify({ connected: !!data, ...data }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'disconnect') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    await userSupabase.from('google_calendar_integrations').delete().eq('user_id', user.id);
    return new Response(JSON.stringify({ success: true }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Geçersiz action' }), { status: 400, headers: CORS });
});
