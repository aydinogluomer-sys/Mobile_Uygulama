import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseAllowlist, isAllowedRedirect } from '../_shared/redirectAllowlist.ts';
import { mintState, verifyState } from '../_shared/oauthState.ts';

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

/**
 * HMAC key for the signed OAuth `state` (task 1D-005, decision D-02).
 *
 * Unset means every mint fails and every verify rejects. That is the intended
 * posture: a deployment without this secret must refuse to start an OAuth flow
 * rather than issue a token anyone can forge. It is a REQUIRED deploy step.
 *
 * Deliberately NOT the service-role key -- separate purposes, separate keys.
 */
const STATE_SECRET = Deno.env.get('OAUTH_STATE_SECRET') ?? '';

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

/**
 * Creates the Aderyth page and the two databases inside the user's workspace,
 * and returns their ids.
 *
 * ## Why this had to come back
 *
 * The hardened rewrite of this function dropped it and wrote
 * `habits_database_id: null` / `tasks_database_id: null` instead. That makes
 * the function undeployable in two separate ways, neither of them obvious
 * from reading it:
 *
 *  1. `notion-sync` reads those ids to know where to write. With nulls, a
 *     freshly connected workspace can never sync anything.
 *  2. The write is an `upsert` on `user_id`, so an ALREADY-CONNECTED user who
 *     re-links would have their working database ids overwritten with null —
 *     the deploy would break accounts that were fine.
 *
 * So "canonicalise the tree" could not mean "ship what was in the tree": the
 * canonical copy had the security fixes and the deployed copy had the
 * behaviour, and only the union of the two is correct.
 */
async function createAtlasDatabases(token: string, workspaceName: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  const pageRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'workspace', workspace: true },
      icon: { type: 'emoji', emoji: '🗂️' },
      properties: { title: { title: [{ text: { content: 'Aderyth' } }] } },
      children: [{
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ text: { content: `Aderyth — ${workspaceName} workspace'i ile senkronlandı.` } }],
          icon: { type: 'emoji', emoji: '⚡' },
          color: 'purple_background',
        },
      }],
    }),
  });
  const page = await pageRes.json();
  if (!pageRes.ok) throw new Error(`Sayfa oluşturulamadı: ${JSON.stringify(page)}`);
  const parentPageId = page.id;

  const habitsRes = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      icon: { type: 'emoji', emoji: '✅' },
      title: [{ type: 'text', text: { content: 'Alışkanlık Takibi' } }],
      properties: {
        'Tarih': { title: {} },
        'Alışkanlık': { rich_text: {} },
        'Durum': {
          select: {
            options: [
              { name: 'Tamamlandı', color: 'green' },
              { name: 'Kısmi', color: 'yellow' },
              { name: 'Kaçırıldı', color: 'red' },
              { name: 'Atlandı', color: 'gray' },
            ],
          },
        },
        'XP': { number: { format: 'number' } },
        'Değer': { number: { format: 'number' } },
        'Hedef': { number: { format: 'number' } },
        'Birim': { rich_text: {} },
      },
    }),
  });
  const habitsDb = await habitsRes.json();
  if (!habitsRes.ok) throw new Error(`Alışkanlık veritabanı oluşturulamadı: ${JSON.stringify(habitsDb)}`);

  const tasksRes = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      icon: { type: 'emoji', emoji: '📋' },
      title: [{ type: 'text', text: { content: 'Görevler' } }],
      properties: {
        'Görev': { title: {} },
        'Durum': {
          select: {
            options: [
              { name: 'Bekliyor', color: 'gray' },
              { name: 'Devam Ediyor', color: 'blue' },
              { name: 'Tamamlandı', color: 'green' },
              { name: 'İptal', color: 'red' },
            ],
          },
        },
        'Öncelik': {
          select: {
            options: [
              { name: 'Yüksek', color: 'red' },
              { name: 'Orta', color: 'yellow' },
              { name: 'Düşük', color: 'green' },
            ],
          },
        },
        'Bitiş Tarihi': { date: {} },
        'Tamamlandı': { checkbox: {} },
      },
    }),
  });
  const tasksDb = await tasksRes.json();
  if (!tasksRes.ok) throw new Error(`Görev veritabanı oluşturulamadı: ${JSON.stringify(tasksDb)}`);

  return {
    parentPageId,
    habitsDbId: habitsDb.id as string,
    habitsUrl: habitsDb.url as string,
    tasksDbId: tasksDb.id as string,
    tasksUrl: tasksDb.url as string,
  };
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
    // Bind the state to the session owner when there is one. The login flow has
    // NO user by definition (finding N-03), so it mints without a uid and the
    // callback verifies without one. verifyState requires the two sides to
    // AGREE in both directions, so the login path cannot be used to strip the
    // binding off the link path.
    const stateUser = await getUser(req);
    let state: string;
    try {
      state = await mintState(STATE_SECRET, { uid: stateUser?.id });
    } catch {
      return json({ error: 'OAuth state yapılandırması eksik (OAUTH_STATE_SECRET).' }, 500);
    }
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
    // Verify BEFORE the token exchange. An unverified state that reaches the
    // provider has already burned an authorization code, which is the side
    // effect the check exists to prevent.
    const stateCheck = await verifyState(STATE_SECRET, body.state ?? '', { uid: user?.id });
    if (!stateCheck.ok) {
      return json({ error: `OAuth state doğrulanamadı (${stateCheck.reason}).` }, 400);
    }

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

    const workspaceName = tokenData.workspace_name ?? me?.workspace_name ?? 'Notion';

    let dbs: Awaited<ReturnType<typeof createAtlasDatabases>> | null = null;
    if (user) {
      try {
        dbs = await createAtlasDatabases(accessToken, workspaceName);
      } catch (e) {
        // Report it. Storing the token with null database ids and answering
        // `success: true` is how this integration silently produced accounts
        // that could never sync -- the same shape of failure notion-sync had.
        return json({ error: `Notion veritabanları oluşturulamadı: ${e instanceof Error ? e.message : String(e)}` }, 502);
      }

      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { error: upsertError } = await admin.from('notion_integrations').upsert({
        user_id: user.id,
        access_token: accessToken,
        workspace_id: tokenData.workspace_id ?? null,
        workspace_name: workspaceName,
        workspace_icon: tokenData.workspace_icon ?? me?.workspace_icon ?? null,
        bot_id: tokenData.bot_id ?? null,
        habits_database_id: dbs.habitsDbId,
        tasks_database_id: dbs.tasksDbId,
        habits_url: dbs.habitsUrl,
        tasks_url: dbs.tasksUrl,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (upsertError) return json({ error: `Bağlantı kaydedilemedi: ${upsertError.message}` }, 500);
    }

    return json({
      success: true,
      workspace_name: workspaceName,
      workspace_icon: tokenData.workspace_icon ?? me?.workspace_icon ?? null,
      workspace_id: tokenData.workspace_id ?? null,
      bot_id: tokenData.bot_id ?? null,
      habits_url: dbs?.habitsUrl ?? null,
      tasks_url: dbs?.tasksUrl ?? null,
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