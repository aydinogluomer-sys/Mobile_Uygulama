import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseAllowlist, isAllowedRedirect } from '../_shared/redirectAllowlist.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_CLIENT_ID = Deno.env.get('NOTION_CLIENT_ID') ?? '';
const NOTION_CLIENT_SECRET = Deno.env.get('NOTION_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const NOTION_VERSION = '2022-06-28';

/**
 * Comma-separated allowlist, e.g.
 *   "atlas://notion-callback,https://atlas.app/notion-callback,exp://*"
 *
 * Unset means the list is empty, and an empty list permits NOTHING. That is
 * deliberate: an unconfigured deployment must refuse to mint authorize URLs
 * rather than accept whatever redirect the caller supplies. Setting this is a
 * required deploy step, alongside the provider client id/secret.
 */
const REDIRECT_ALLOWLIST = parseAllowlist(Deno.env.get('OAUTH_REDIRECT_ALLOWLIST'));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function basicAuth() {
  return `Basic ${btoa(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`)}`;
}

async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const action = url.searchParams.get('action') ?? body.action;

  if (action === 'url') {
    if (!NOTION_CLIENT_ID) return json({ error: 'Notion yapılandırması eksik.' }, 500);
    const redirectUri = url.searchParams.get('redirect_uri') ?? body.redirect_uri ?? '';
    if (!isAllowedRedirect(redirectUri, REDIRECT_ALLOWLIST)) {
      return json({ error: 'redirect_uri izin verilen listede değil.' }, 400);
    }
    const state = crypto.randomUUID();
    const oauthUrl =
      'https://api.notion.com/v1/oauth/authorize' +
      `?client_id=${encodeURIComponent(NOTION_CLIENT_ID)}` +
      '&response_type=code' +
      '&owner=user' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;
    return json({ url: oauthUrl, state });
  }

  if (action === 'callback') {
    const user = await getUser(req);

    const { code, redirect_uri } = body;
    if (!isAllowedRedirect(redirect_uri ?? '', REDIRECT_ALLOWLIST)) {
      return json({ error: 'redirect_uri izin verilen listede değil.' }, 400);
    }
    if (!code) return json({ error: 'code gerekli' }, 400);

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return json({ error: `Token alınamadı: ${JSON.stringify(tokenData)}` }, 400);

    const accessToken = tokenData.access_token as string | undefined;
    if (!accessToken) return json({ error: 'Access token alınamadı' }, 400);

    const meRes = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    const me = await meRes.json().catch(() => ({}));

    if (user) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await admin.from('notion_integrations').upsert({
        user_id: user.id,
        access_token: accessToken,
        workspace_id: tokenData.workspace_id ?? null,
        workspace_name: tokenData.workspace_name ?? me?.workspace_name ?? 'Notion',
        workspace_icon: tokenData.workspace_icon ?? me?.workspace_icon ?? null,
        bot_id: tokenData.bot_id ?? null,
        habits_database_id: null,
        tasks_database_id: null,
        habits_url: null,
        tasks_url: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    return json({
      success: true,
      workspace_name: tokenData.workspace_name ?? me?.workspace_name ?? 'Notion',
      workspace_icon: tokenData.workspace_icon ?? me?.workspace_icon ?? null,
      workspace_id: tokenData.workspace_id ?? null,
      bot_id: tokenData.bot_id ?? null,
    });
  }

  if (action === 'status') {
    const user = await getUser(req);
    if (!user) return json({ connected: false });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data } = await admin
      .from('notion_integrations')
      .select('workspace_name,workspace_icon,habits_url,tasks_url,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    return json({ connected: !!data, ...(data ?? {}) });
  }

  if (action === 'disconnect') {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await admin.from('notion_integrations').delete().eq('user_id', user.id);
    return json({ success: true });
  }

  return json({ error: 'Geçersiz action' }, 400);
});