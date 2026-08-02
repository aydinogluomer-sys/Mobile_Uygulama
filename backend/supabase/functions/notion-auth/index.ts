import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_CLIENT_ID = Deno.env.get('NOTION_CLIENT_ID')!;
const NOTION_CLIENT_SECRET = Deno.env.get('NOTION_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Notion'da Atlas veritabanlarını oluştur
async function createAtlasDatabases(token: string, workspaceName: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // Önce bir Atlas ana sayfası oluştur
  const pageRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'workspace', workspace: true },
      icon: { type: 'emoji', emoji: '🗂️' },
      properties: {
        title: { title: [{ text: { content: 'Atlas POS' } }] },
      },
      children: [{
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ text: { content: `Atlas POS v2 — ${workspaceName} workspace'i ile senkronlandı.` } }],
          icon: { type: 'emoji', emoji: '⚡' },
          color: 'purple_background',
        },
      }],
    }),
  });
  const page = await pageRes.json();
  if (!pageRes.ok) throw new Error(`Sayfa oluşturulamadı: ${JSON.stringify(page)}`);
  const parentPageId = page.id;

  // Alışkanlık veritabanı
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
  if (!habitsRes.ok) throw new Error(`Alışkanlık DB oluşturulamadı: ${JSON.stringify(habitsDb)}`);

  // Görev veritabanı
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
  if (!tasksRes.ok) throw new Error(`Görev DB oluşturulamadı: ${JSON.stringify(tasksDb)}`);

  return {
    parentPageId,
    habitsDbId: habitsDb.id,
    habitsUrl: habitsDb.url,
    tasksDbId: tasksDb.id,
    tasksUrl: tasksDb.url,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? (await req.json().catch(() => ({}))).action;

  // ── 1. OAuth URL üret ────────────────────────────────────────────────────
  if (action === 'url') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = crypto.randomUUID();
    const oauthUrl =
      `https://api.notion.com/v1/oauth/authorize` +
      `?client_id=${NOTION_CLIENT_ID}` +
      `&response_type=code` +
      `&owner=user` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;
    return new Response(JSON.stringify({ url: oauthUrl, state }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Code exchange + DB kurulum ────────────────────────────────────────
  if (action === 'callback') {
    const authHeader = req.headers.get('Authorization');
    let user: { id: string } | null = null;
    if (authHeader) {
      const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: authUser } } = await userSupabase.auth.getUser();
      user = authUser ?? null;
    }

    const body = await req.json();
    const { code, redirect_uri, state } = body;
    if (!code) return new Response(JSON.stringify({ error: 'code gerekli' }), { status: 400, headers: CORS });
    // state parametresi isteğe bağlı - gerekirse ve varsa doğrula
    if (state) {
      // State validation can be added here if session storage is available
    }

    // Notion'dan token al
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return new Response(JSON.stringify({ 
        error: `Token alınamadı: ${tokenData.error || JSON.stringify(tokenData)}` 
      }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const { access_token, workspace_id, workspace_name, workspace_icon, bot_id } = tokenData;

    // Veritabanlarını oluştur
    let dbs;
    try {
      dbs = await createAtlasDatabases(access_token, workspace_name ?? 'Atlas');
    } catch (err) {
      return new Response(JSON.stringify({ 
        error: err instanceof Error ? err.message : 'Veritabanları oluşturulamadı' 
      }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (user) {
      // Supabase'e kaydet (service key ile RLS bypass)
      const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { error: upsertError } = await adminSupabase.from('notion_integrations').upsert({
        user_id: user.id,
        access_token,
        workspace_id,
        workspace_name,
        workspace_icon,
        bot_id,
        habits_database_id: dbs.habitsDbId,
        tasks_database_id: dbs.tasksDbId,
        habits_url: dbs.habitsUrl,
        tasks_url: dbs.tasksUrl,
        parent_page_id: dbs.parentPageId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      
      if (upsertError) {
        return new Response(JSON.stringify({ 
          error: `Supabase kaydı başarısız: ${upsertError.message}` 
        }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      workspace_name,
      workspace_icon,
      workspace_id,
      habits_url: dbs.habitsUrl,
      tasks_url: dbs.tasksUrl,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── 3. Mevcut bağlantıyı getir ──────────────────────────────────────────
  if (action === 'status') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ connected: false, error: 'Unauthorized' }), { 
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ connected: false, error: 'Unauthorized' }), { 
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    const { data, error } = await userSupabase
      .from('notion_integrations')
      .select('workspace_name, workspace_icon, habits_url, tasks_url, workspace_id, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (error) {
      return new Response(JSON.stringify({ 
        connected: false, 
        error: error.message 
      }), { 
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    return new Response(JSON.stringify({ 
      connected: !!data, 
      workspace_name: data?.workspace_name,
      workspace_icon: data?.workspace_icon,
      workspace_id: data?.workspace_id,
      habits_url: data?.habits_url,
      tasks_url: data?.tasks_url,
      updated_at: data?.updated_at,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Bağlantıyı kes ───────────────────────────────────────────────────
  if (action === 'disconnect') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    const userSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    // Notion erişim tokenini revoke et (isteğe bağlı, hatalar yoksayılır)
    const { data: notion } = await userSupabase
      .from('notion_integrations')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (notion?.access_token) {
      // Notion'da revoke etmeyi dene, başarısız olsa da devam et
      fetch('https://api.notion.com/v1/oauth/token/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: notion.access_token }),
      }).catch(() => {}); // silently ignore revoke errors
    }
    
    // Supabase'den sil
    const { error: deleteError } = await userSupabase
      .from('notion_integrations')
      .delete()
      .eq('user_id', user.id);
    
    if (deleteError) {
      return new Response(JSON.stringify({ 
        error: deleteError.message 
      }), { 
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' } 
      });
    }
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...CORS, 'Content-Type': 'application/json' } 
    });
  }

  return new Response(JSON.stringify({ error: 'Geçersiz action' }), { status: 400, headers: CORS });
});
