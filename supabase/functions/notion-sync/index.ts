/**
 * notion-sync — pushes a day's habit logs and open tasks into the user's
 * Notion databases.
 *
 * ## What was wrong with the version this replaces (deployed v1)
 *
 * It read habit logs like this:
 *
 *     supabase.from('habit_logs')
 *       .select('habit_id, state, xp, value, target_value')
 *       .eq('date', syncDate)
 *
 * Neither `target_value` nor `date` exists on `habit_logs`. The live columns
 * are `value` and `completed_at`; the per-habit target lives on
 * `habits.daily_goal`. PostgREST rejected the query, so `logsRes.error` was
 * set and `logsRes.data` was null — and the error was never checked. The next
 * line was `(logsRes.data ?? [])`, which turned a hard failure into an empty
 * array, so zero Notion pages were built and the function answered:
 *
 *     { success: true, synced_habits: 0, errors: 0 }
 *
 * Habit sync had never worked, and every user who tried it was told it had.
 * The `?? []` is the whole mechanism: it converts "the query failed" into
 * "there was nothing to sync", which are indistinguishable downstream.
 *
 * ## Rules this version follows
 *
 * 1. Every query's `error` is checked before its `data` is used. There is no
 *    `?? []` on a result whose error has not been inspected.
 * 2. `success` means everything asked for actually happened. A partial run
 *    reports per-entity counts AND the reason, so "tasks synced, habits
 *    failed" cannot present as success.
 * 3. Habit logs are filtered by `user_id` explicitly. RLS already scopes
 *    them, but tasks and habits both filter explicitly and a query that
 *    depends on an invisible mechanism is one policy change from leaking.
 */
import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

async function notionInsert(
  token: string,
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<string> {
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
    const err = await res.json().catch(() => ({}));
    throw new Error(`Notion insert hatası: ${JSON.stringify(err)}`);
  }
  return (await res.json()).id as string;
}

type HabitRow = { id: string; name: string; unit: string | null; daily_goal: number | null };
type LogRow = { habit_id: string; state: string; xp: number | null; value: number | null };
type TaskRow = {
  title: string; status: string; priority: string; due_date: string | null; completed: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: notion, error: notionError } = await supabase
    .from('notion_integrations')
    .select('access_token, habits_database_id, tasks_database_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (notionError) return json({ error: `Notion bağlantısı okunamadı: ${notionError.message}` }, 500);
  if (!notion) return json({ error: 'Notion bağlı değil.' }, 400);

  const { access_token, habits_database_id, tasks_database_id } = notion;
  const { date } = await req.json().catch(() => ({}));
  const syncDate: string = date ?? new Date().toISOString().split('T')[0];

  // `completed_at` is the live date column on habit_logs; `daily_goal` on
  // habits is the target. Neither `habit_logs.date` nor
  // `habit_logs.target_value` exists — asking for them is what broke v1.
  const [logsRes, habitsRes, tasksRes] = await Promise.all([
    supabase
      .from('habit_logs')
      .select('habit_id, state, xp, value')
      .eq('user_id', user.id)
      .eq('completed_at', syncDate),
    supabase
      .from('habits')
      .select('id, name, unit, daily_goal')
      .eq('user_id', user.id)
      .eq('status', 'active'),
    supabase
      .from('tasks')
      .select('title, status, priority, due_date, completed')
      .eq('user_id', user.id)
      .or(`due_date.eq.${syncDate},due_date.lt.${syncDate}`)
      .eq('completed', false),
  ]);

  // Fail loudly. A read error must never be laundered into "nothing to sync".
  const readError =
    logsRes.error ? `habit_logs: ${logsRes.error.message}`
    : habitsRes.error ? `habits: ${habitsRes.error.message}`
    : tasksRes.error ? `tasks: ${tasksRes.error.message}`
    : null;
  if (readError) {
    return json({ success: false, date: syncDate, error: `Veri okunamadı — ${readError}` }, 500);
  }

  const habits = (habitsRes.data ?? []) as HabitRow[];
  const logs = (logsRes.data ?? []) as LogRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];

  const habitMap: Record<string, HabitRow> = Object.fromEntries(habits.map((h) => [h.id, h]));

  const stateLabel: Record<string, string> = {
    done: 'Tamamlandı', partial: 'Kısmi', miss: 'Kaçırıldı', skip: 'Atlandı',
  };
  const priorityLabel: Record<string, string> = {
    high: 'Yüksek', medium: 'Orta', low: 'Düşük', none: 'Düşük',
  };
  const statusLabel: Record<string, string> = {
    pending: 'Bekliyor', in_progress: 'Devam Ediyor', completed: 'Tamamlandı', cancelled: 'İptal',
  };

  const habitResults = await Promise.allSettled(
    logs.map((l) => {
      const h = habitMap[l.habit_id];
      return notionInsert(access_token, habits_database_id, {
        'Tarih': { title: [{ text: { content: syncDate } }] },
        'Alışkanlık': { rich_text: [{ text: { content: h?.name ?? l.habit_id } }] },
        'Durum': { select: { name: stateLabel[l.state] ?? l.state } },
        'XP': { number: l.xp ?? 0 },
        'Değer': { number: l.value ?? 0 },
        'Hedef': { number: h?.daily_goal ?? 0 },
        'Birim': { rich_text: [{ text: { content: h?.unit ?? '' } }] },
      });
    }),
  );

  const taskResults = await Promise.allSettled(
    tasks.map((t) =>
      notionInsert(access_token, tasks_database_id, {
        'Görev': { title: [{ text: { content: t.title } }] },
        'Durum': { select: { name: statusLabel[t.status] ?? 'Bekliyor' } },
        'Öncelik': { select: { name: priorityLabel[t.priority] ?? 'Düşük' } },
        'Bitiş Tarihi': t.due_date ? { date: { start: t.due_date } } : null,
        'Tamamlandı': { checkbox: t.completed },
      }),
    ),
  );

  const tally = (rs: PromiseSettledResult<string>[]) => {
    const ok = rs.filter((r) => r.status === 'fulfilled').length;
    const failed = rs.length - ok;
    const firstError = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    return {
      attempted: rs.length,
      synced: ok,
      failed,
      error: firstError ? String(firstError.reason?.message ?? firstError.reason) : null,
    };
  };

  const habitTally = tally(habitResults);
  const taskTally = tally(taskResults);
  const allOk = habitTally.failed === 0 && taskTally.failed === 0;

  return json({
    // `success` is now an honest summary, not a constant. A run where habits
    // failed and tasks succeeded reports false and says which.
    success: allOk,
    date: syncDate,
    habits: habitTally,
    tasks: taskTally,
    // Kept for the existing client contract (store/notionStore.ts).
    synced_habits: habitTally.synced,
    synced_tasks: taskTally.synced,
    notion_pages_created: habitTally.synced + taskTally.synced,
    errors: habitTally.failed + taskTally.failed,
  });
});
