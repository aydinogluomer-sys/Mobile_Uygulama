import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.27.0';

const MAX_TOKENS = 400;          // Varsayılan çıktı token limiti (maliyet kontrolü)
const INSIGHTS_MAX_TOKENS = 500; // İçgörü biraz daha uzun olabilir

// Rutin modunun kendi bütçesi. Diğerleri düz metin döndürür; bu mod tek
// parçada geçerli JSON döndürmek zorunda, ve o JSON yapısı gereği uzun:
// 4 alışkanlık × 7 alan + sarmalayıcı. Model çıktıyı girintili yazıyor, ve
// 400 token bunun ortasında bitiyordu -- ölçülen dört denemenin DÖRDÜ de
// aynı yerde, "line 40 column 6"da koptu. Kesilen metin `JSON.parse` için
// geçersiz olduğundan her rutin üretimi 500 ile bitiyordu. Ayrıntı için
// aşağıdaki `stop_reason` kontrolüne bak.
const ROUTINE_MAX_TOKENS = 1500;

// Aksiyon başına Focus Point maliyeti
const COST = { coach: 5, routine: 25, summarize: 3, insights: 5 } as const;
type Mode = keyof typeof COST;

const SYSTEM_PROMPT = `Sen bir alışkanlık koçusun. Kullanıcının hedefine uygun rutin oluşturuyorsun.

Yalnızca şu JSON'u döndür, başka hiçbir şey yazma:
{"name":"Rutin adı","description":"1 cümle","items":[{"name":"Alışkanlık","icon":"fitness-outline","tracking_type":"boolean","unit":null,"daily_goal":null,"frequency_config":{"kind":"daily","part_of_day":["morning"]},"willpower_cost":3}]}

Kurallar: Maks 4 alışkanlık. tracking_type: boolean veya numeric. willpower_cost 1-5. ADHD dostu, yargılamayan dil.`;

const COACH_SYSTEM_PROMPT = `Sen "Aderyth AI Coach"sun — alışkanlık, görev ve hedef koçluğu yapan, samimi ve destekleyici bir asistansın.

Tarz: ADHD dostu, yargılamayan, motive edici ama gerçekçi. Türkçe konuş. Kısa ve net ol (en fazla 4-5 cümle ya da 3-4 madde). Somut, uygulanabilir öneri ver; gerektiğinde kullanıcının mevcut alışkanlıklarına atıfta bulun. Tıbbi/psikiyatrik tanı koyma.

Sadece düz metin yanıt ver — JSON, markdown başlığı veya kod bloğu KULLANMA.`;

const SUMMARY_SYSTEM_PROMPT = `Sen bir günlük yazma asistanısın. Kullanıcının "Aderyth AI Coach" ile yaptığı sohbeti, kullanıcının kendi günlüğüne ekleyebileceği, birinci tekil şahıs ("ben") ağzından kısa bir özet/yansıma haline getiriyorsun.

Tarz: Sıcak, içe dönük, Türkçe. En fazla 5-6 cümle ya da 4 madde. Sohbette konuşulan ana konuları, fark ettiğim şeyleri, aldığım kararları ve eyleme dönük çıkarımları vurgula. Selamlaşmaları ve dolgu cümlelerini atla. Yeni bilgi uydurma — yalnızca sohbette geçenleri özetle.

Sadece düz metin döndür — markdown başlığı, JSON veya kod bloğu KULLANMA.`;

const INSIGHTS_SYSTEM_PROMPT = `Sen bir günlük analiz asistanısın. Kullanıcının belirli bir dönemdeki (haftalık/aylık/yıllık) günlük kayıtlarını okuyup ona içgörü dolu, sıcak bir geri bildirim veriyorsun.

Tarz: Destekleyici, yargılamayan, Türkçe, ikinci tekil ("sen") ağzından. Şunlara odaklan: tekrar eden temalar ve duygular, ruh hali eğilimi, ilerleme/büyüme işaretleri, dikkat çeken zorluklar ve nazik + uygulanabilir bir-iki öneri. Özellikle kötü/negatif alışkanlıklarla mücadele ve duygusal dalgalanma örüntülerini fark et. Genelleme yapma; yalnızca kayıtlarda geçenlere dayan. Veri azsa bunu nazikçe belirt.

En fazla 6-8 cümle ya da birkaç kısa madde. Sadece düz metin döndür — markdown başlığı, JSON veya kod bloğu KULLANMA.`;

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'son bir hafta',
  monthly: 'son bir ay',
  yearly: 'son bir yıl',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Yetkisiz' }, 401);

  // `catch` blogu `try` icinde tanimlanan `refund`'a erisemez; kanca burada.
  let refundOnThrow: ((reason: string) => Promise<void>) | null = null;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Kimlik doğrulama hatası' }, 401);

    const body = await req.json();
    const mode: Mode =
      body?.mode === 'coach' ? 'coach'
      : body?.mode === 'summarize' ? 'summarize'
      : body?.mode === 'insights' ? 'insights'
      : 'routine';
    const cost = COST[mode];

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'Sunucu yapılandırma hatası' }, 500);

    // Girdi doğrulama
    let userMsg = '';
    let prompt = '';
    let transcript = '';
    let entriesText = '';
    let periodLabel = '';
    if (mode === 'coach') {
      userMsg = (body?.message ?? '').toString().trim().slice(0, 500);
      if (userMsg.length < 3) return json({ error: 'Geçersiz mesaj' }, 400);
    } else if (mode === 'summarize') {
      transcript = (body?.transcript ?? '').toString().trim().slice(0, 6000);
      if (transcript.length < 10) return json({ error: 'Özetlenecek yeterli sohbet yok.' }, 400);
    } else if (mode === 'insights') {
      entriesText = (body?.entries ?? '').toString().trim().slice(0, 8000);
      if (entriesText.length < 10) return json({ error: 'Bu dönemde içgörü üretecek yeterli günlük kaydı yok.' }, 400);
      periodLabel = PERIOD_LABEL[body?.period] ?? 'bu dönem';
    } else {
      prompt = (body?.prompt ?? '').toString().trim().slice(0, 150);
      if (prompt.length < 3) return json({ error: 'Geçersiz prompt' }, 400);
    }

    // ── Kredi: ONCE dus, sonra AI cagir ──────────────────────────────────
    //
    // Eskiden sira "bakiyeyi oku -> AI cagir -> dus" idi ve dusme sonucunun
    // `ok` alani hic okunmuyordu. Bu iki ayri sizinti demekti:
    //
    //  1. `ok = false` (arada bakiye tukendi) durumunda edge, DUSULMEMIS
    //     bakiyeyi basariymis gibi dondururdu -> kullanici cikti aldi, ucret
    //     alinmadi. Bakiye 5, maliyet 5 iken iki es zamanli istek on kontrolu
    //     birlikte gecer, ikisi de Anthropic'i cagirir, biri bedavaya gelir.
    //  2. RPC hatasi `error` olarak DONER, firlatilmaz; `catch` bu yuzden hic
    //     calismadi ve `balance - cost` uydurma bir bakiye olarak dondu.
    //
    // Artik atomik dusme kapinin kendisi. Yetersizse Anthropic hic cagrilmaz.
    // Istemci bir anahtar gondermezse burada uretilir. Bos birakmak cazipti
    // ama yanlisti: anahtarsiz bir cagriyi IADE edemezdik, yani AI adimi
    // patladiginda kullanici basarisiz bir istek icin odemis kalirdi. Sunucu
    // tarafi anahtar iadeyi calisir kilar; kaybedilen tek sey istekler ARASI
    // tekrar korumasi, o da anahtari gondermeyen istemcinin sorunu.
    const clientKey = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
    const requestId: string =
      clientKey.length >= 8 && clientKey.length <= 128 ? clientKey : crypto.randomUUID();

    const { data: spendRows, error: spendErr } = await supabase.rpc('spend_focus_points_v2', {
      p_amount: cost,
      p_reason: `ai_${mode}`,
      p_request_id: requestId,
    });
    if (spendErr) {
      // Bir zamanlar yutulan hata. Ucretlendiremiyorsak isi yapmiyoruz.
      console.error('spend_focus_points_v2 failed:', spendErr.message);
      return json({ error: 'Kredi islemi yapilamadi, lutfen tekrar deneyin.' }, 503);
    }
    const spend = Array.isArray(spendRows) ? spendRows[0] : spendRows;
    if (!spend || spend.ok !== true) {
      const balance = Number(spend?.balance ?? 0);
      return json({
        error: `Yetersiz Focus Point. Bu işlem ${cost} FP gerektiriyor, bakiyen ${balance}.`,
        code: 'INSUFFICIENT_CREDITS',
        balance,
        cost,
      }, 402);
    }
    const balance = Number(spend.balance);
    const replayed = spend.replayed === true;

    // Bu noktadan sonra kullanicidan ucret ALINDI. Her cikis yolu ya cikti
    // dondurmeli ya da iade etmeli; `charged` bunu izliyor.
    let charged = !replayed;
    const refund = async (reason: string) => {
      if (!charged) return;
      charged = false;
      const { error } = await supabase.rpc('refund_focus_points', {
        p_request_id: requestId,
        p_reason: reason,
      });
      // Iade basarisiz olursa kullanici basarisiz bir cagri icin ucret odemis
      // olur. Sessizce gecmiyoruz: mutabakat icin iz birakiliyor.
      if (error) console.error('REFUND FAILED', { requestId, cost, reason, error: error.message });
    };
    refundOnThrow = refund;

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
      if (!reply) {
        await refund('ai_empty_response');
        return json({ error: 'Yanıt alınamadı, tekrar deneyin.' }, 500);
      }
      payload = { reply };
    } else if (mode === 'summarize') {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: MAX_TOKENS,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Aşağıdaki AI koçluk sohbetini günlüğe eklenebilecek bir özet/yansıma haline getir:\n\n${transcript}` }],
      });
      const summary = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      if (!summary) {
        await refund('ai_empty_response');
        return json({ error: 'Özet oluşturulamadı, tekrar deneyin.' }, 500);
      }
      payload = { summary };
    } else if (mode === 'insights') {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: INSIGHTS_MAX_TOKENS,
        system: INSIGHTS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Dönem: ${periodLabel}. Aşağıdaki günlük kayıtlarını analiz edip içgörü ver:\n\n${entriesText}` }],
      });
      const insight = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      if (!insight) {
        await refund('ai_empty_response');
        return json({ error: 'İçgörü oluşturulamadı, tekrar deneyin.' }, 500);
      }
      payload = { insight };
    } else {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: ROUTINE_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      // Kesilmiş bir yanıtı AYIKLAMAYA ÇALIŞMA.
      //
      // `stop_reason === 'max_tokens'` modelin cümlesinin ortasında
      // durdurulduğunu söyler. Aşağıdaki `/\{[\s\S]*\}/` açgözlü olduğu için
      // böyle bir metinde de EŞLEŞİR: ilk `{`den kalan son `}`e kadar alır,
      // yani yarım kalmış `items` dizisinin içindeki bir alt nesnenin
      // kapanışına. Ortaya makul görünen ama geçersiz bir JSON parçası çıkar,
      // `JSON.parse` fırlatır, ve kullanıcı sağlayıcı hatası sanılan
      // "AI servisi şu an yanıt veremedi" mesajını görür. Sağlayıcı çalışıyor;
      // yanıt sığmıyor. Bunu burada, kendi adıyla yakalıyoruz.
      if (message.stop_reason === 'max_tokens') {
        await refund('ai_truncated');
        return json({ error: 'AI yanıtı yarım kaldı, tekrar deneyin.' }, 500);
      }

      const text = message.content[0].type === 'text' ? message.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        await refund('ai_empty_response');
        return json({ error: 'AI yanıt formatı geçersiz, tekrar deneyin.' }, 500);
      }
      payload = JSON.parse(match[0]);
    }

    // Ucret zaten alindi; `balance` veritabanindan gelen GERCEK deger.
    return json({ ...payload, balance, cost, replayed });

  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('generate-routine error:', raw);
    // Ucret alindiysa iade et: AI adimi basarisiz oldu, kullanici odemis
    // olmamali. `refundOnThrow` outer scope'ta, cunku `refund` try blogunun
    // icinde tanimli.
    await refundOnThrow?.('ai_error');
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
