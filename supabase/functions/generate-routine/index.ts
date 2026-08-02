import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.27.0';

const MAX_TOKENS = 400;   // Çıktı token limiti (maliyet kontrolü)

// Aksiyon başına Focus Point maliyeti
const COST = { coach: 5, routine: 25 } as const;

const SYSTEM_PROMPT = `Sen bir alışkanlık koçusun. Kullanıcının hedefine uygun rutin oluşturuyorsun.

Yalnızca şu JSON'u döndür, başka hiçbir şey yazma:
{"name":"Rutin adı","description":"1 cümle","items":[{"name":"Alışkanlık","icon":"fitness-outline","tracking_type":"boolean","unit":null,"daily_goal":null,"frequency_config":{"kind":"daily","part_of_day":["morning"]},"willpower_cost":3}]}

Kurallar: Maks 4 alışkanlık. tracking_type: boolean veya numeric. willpower_cost 1-5. ADHD dostu, yargılamayan dil.`;

const COACH_SYSTEM_PROMPT = `Sen "Atlas AI Coach"sun — alışkanlık, görev ve hedef koçluğu yapan, samimi ve destekleyici bir asistansın.

Tarz: ADHD dostu, yargılamayan, motive edici ama gerçekçi. Türkçe konuş. Kısa ve net ol (en fazla 4-5 cümle ya da 3-4 madde). Somut, uygulanabilir öneri ver; gerektiğinde kullanıcının mevcut alışkanlıklarına atıfta bulun. Tıbbi/psikiyatrik tanı koyma.

Sadece düz metin yanıt ver — JSON, markdown başlığı veya kod bloğu KULLANMA.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Yetkisiz' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Kimlik doğrulama hatası' }, 401);

    const body = await req.json();
    const mode = body?.mode === 'coach' ? 'coach' : 'routine';
    const cost = mode === 'coach' ? COST.coach : COST.routine;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'Sunucu yapılandırma hatası' }, 500);

    // Girdi doğrulama
    let userMsg = '';
    let prompt = '';
    if (mode === 'coach') {
      userMsg = (body?.message ?? '').toString().trim().slice(0, 500);
      if (userMsg.length < 3) return json({ error: 'Geçersiz mesaj' }, 400);
    } else {
      prompt = (body?.prompt ?? '').toString().trim().slice(0, 150);
      if (prompt.length < 3) return json({ error: 'Geçersiz prompt' }, 400);
    }

    // ── Kredi ön kontrolü (Focus Point) ──
    const { data: sub, error: subErr } = await supabase.rpc('get_or_init_subscription');
    if (subErr) throw subErr;
    const balance = (sub?.focus_points ?? 0) as number;
    if (balance < cost) {
      return json({
        error: `Yetersiz Focus Point. Bu işlem ${cost} FP gerektiriyor, bakiyen ${balance}.`,
        code: 'INSUFFICIENT_CREDITS',
        balance,
        cost,
      }, 402);
    }

    const client = new Anthropic({ apiKey });

    // ── AI çağrısı ──
    let payload: Record<string, unknown>;
    if (mode === 'coach') {
      const ctx = body?.context ?? {};
      const activeHabits = Array.isArray(ctx.activeHabits) ? ctx.activeHabits.slice(0, 20).join(', ') : '';
      const contextLine = [
        activeHabits ? `Aktif alışkanlıklar: ${activeHabits}.` : 'Aktif alışkanlık yok.',
        typeof ctx.habitCount === 'number' ? `Toplam alışkanlık: ${ctx.habitCount}.` : '',
        typeof ctx.pendingTaskCount === 'number' ? `Bekleyen görev: ${ctx.pendingTaskCount}.` : '',
        ctx.willpower ? `İrade: ${ctx.willpower.used}/${ctx.willpower.daily_budget} kullanıldı, ${ctx.willpower.active_count}/${ctx.willpower.focus_capacity} aktif slot.` : '',
      ].filter(Boolean).join(' ');

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: MAX_TOKENS,
        system: COACH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Bağlam: ${contextLine}\n\nKullanıcı: ${userMsg}` }],
      });
      const reply = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      if (!reply) return json({ error: 'Yanıt alınamadı, tekrar deneyin.' }, 500);
      payload = { reply };
    } else {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = message.content[0].type === 'text' ? message.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return json({ error: 'AI yanıt formatı geçersiz, tekrar deneyin.' }, 500);
      payload = JSON.parse(match[0]);
    }

    // ── Başarı sonrası kredi düş ──
    let newBalance = balance - cost;
    try {
      const { data: spendRes } = await supabase.rpc('spend_focus_points', { p_amount: cost, p_reason: `ai_${mode}` });
      if (Array.isArray(spendRes) && spendRes[0]) newBalance = spendRes[0].balance;
    } catch (_) { /* harcama kaydı başarısız olsa da yanıtı döndür */ }

    return json({ ...payload, balance: newBalance, cost });

  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('generate-routine error:', raw);
    let msg = 'AI servisi şu an yanıt veremedi, lütfen sonra tekrar deneyin.';
    if (/credit balance|billing|insufficient_quota|insufficient/i.test(raw)) {
      msg = 'AI servisi geçici olarak kullanılamıyor (API kredisi yetersiz). Lütfen daha sonra tekrar deneyin.';
    } else if (/rate.?limit|overloaded|429/i.test(raw)) {
      msg = 'AI servisi şu an yoğun, biraz sonra tekrar dene.';
    }
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
