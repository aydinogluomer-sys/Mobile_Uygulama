import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function notionInsert(token: string, databaseId: string, properties: Record<string, unknown>) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion insert hatası: ${JSON.stringify(err)}`);
  }
  return (await res.json()).id as string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  // Notion bağlantı bilgilerini DB'den al
  const { data: notion, error: notionError } = await supabase
    .from('notion_integrations')
    .select('access_token, habits_database_id, tasks_database_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (notionError || !notion) {
    return new Response(JSON.stringify({ error: 'Notion bağlı değil. Lütfen önce bağlantı kurun.' }), { status: 400, headers: CORS });
  }

  if (!notion.access_token || !notion.habits_database_id || !notion.tasks_database_id) {
    return new Response(JSON.stringify({ error: 'Notion bağlantısı eksik. Lütfen yeniden bağlantı kurun.' }), { status: 400, headers: CORS });
  }

  const { access_token, habits_database_id, tasks_database_id } = notion;
  const body = await req.json().catch(() => ({}));
  const { date: bodyDate } = body;
  const syncDate: string = bodyDate ?? new Date().toISOString().split('T')[0];

  // Supabase verilerini paralel çek
  const [logsRes, habitsRes, tasksRes] = await Promise.all([
    supabase.from('habit_logs').select('habit_id, state, xp, value, target_value').eq('date', syncDate),
    supabase.from('habits').select('id, name, unit').eq('status', 'active').eq('user_id', user.id),
    supabase.from('tasks').select('title, status, priority, due_date, completed')
      .eq('user_id', user.id)
      .or(`due_date.eq.${syncDate},due_date.lt.${syncDate}`)
      .eq('completed', false),
  ]);

  if (logsRes.error || habitsRes.error || tasksRes.error) {
    const err = logsRes.error || habitsRes.error || tasksRes.error;
    return new Response(JSON.stringify({ error: `Veri çekme hatası: ${err.message}` }), { status: 400, headers: CORS });
  }

  const habitMap = Object.fromEntries(
    (habitsRes.data ?? []).map((h: { id: string; name: string; unit: string | null }) => [h.id, h])
  );

  // Alışkanlık loglarını Notion'a gönder
  const stateLabel: Record<string, string> = { done: 'Tamamlandı', partial: 'Kısmi', miss: 'Kaçırıldı' };
  const habitInserts = (logsRes.data ?? []).map((l: { habit_id: string; state: string; xp: number | null; value: number | null; target_value: number | null }) =>
    notionInsert(access_token, habits_database_id, {
      'Tarih':      { title: [{ text: { content: syncDate } }] },
      'Alışkanlık': { rich_text: [{ text: { content: habitMap[l.habit_id]?.name ?? l.habit_id } }] },
      'Durum':      { select: { name: stateLabel[l.state] ?? l.state } },
      'XP':         { number: l.xp ?? 0 },
      'Değer':      { number: l.value ?? 0 },
      'Hedef':      { number: l.target_value ?? 0 },
      'Birim':      { rich_text: [{ text: { content: habitMap[l.habit_id]?.unit ?? '' } }] },
    })
  );

  const priorityLabel: Record<string, string> = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', none: 'Düşük' };
  const statusLabel: Record<string, string> = { pending: 'Bekliyor', in_progress: 'Devam Ediyor', completed: 'Tamamlandı', cancelled: 'İptal' };

  const taskInserts = (tasksRes.data ?? []).map((t: { title: string; status: string; priority: string; due_date: string | null; completed: boolean }) =>
    notionInsert(access_token, tasks_database_id, {
      'Görev':        { title: [{ text: { content: t.title } }] },
      'Durum':        { select: { name: statusLabel[t.status] ?? 'Bekliyor' } },
      'Öncelik':      { select: { name: priorityLabel[t.priority] ?? 'Düşük' } },
      'Bitiş Tarihi': t.due_date ? { date: { start: t.due_date } } : null,
      'Tamamlandı':   { checkbox: t.completed },
    })
  );

  const results = await Promise.allSettled([...habitInserts, ...taskInserts]);
  const success = results.filter(r => r.status === 'fulfilled').length;
  const failed  = results.filter(r => r.status === 'rejected').length;

  return new Response(JSON.stringify({
    success: true,
    date: syncDate,
    synced_habits: habitInserts.length,
    synced_tasks:  taskInserts.length,
    notion_pages_created: success,
    errors: failed,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
