import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.27.0';
import {
  fingerprintInput,
  runIdempotentAiRequest,
  type AiMode,
  type BeginOutcome,
  type ProviderResult,
  type SpendResult,
} from '../_shared/aiIdempotency.ts';

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

    // Bu anahtarin KIMLIGI. Sadece cagiranin kendi girdisi, sunucunun
    // turettigi baglam degil: `coach` baglami (aliskanlik sayisi, irade)
    // iki deneme arasinda kendiliginden degisir, ve onu kimlige katmak ayni
    // sorunun mesru bir tekrarini "anahtar kotuye kullanimi" diye reddederdi.
    // Katmamak guvenli, cunku ayni anahtar zaten SAKLANAN yaniti dondurur.
    const identity: string[] =
      mode === 'coach' ? [userMsg]
      : mode === 'summarize' ? [transcript]
      : mode === 'insights' ? [periodLabel, entriesText]
      : [prompt];

    // Anthropic'e giden TEK yol. `runIdempotentAiRequest` bunu ya bir kez
    // cagirir ya da hic cagirmaz; tekrar eden bir anahtar icin asla.
    const callAi = async (): Promise<ProviderResult> => {
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
          return { ok: false, reason: 'ai_empty_response', message: 'Yanıt alınamadı, tekrar deneyin.' };
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
          return { ok: false, reason: 'ai_empty_response', message: 'Özet oluşturulamadı, tekrar deneyin.' };
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
          return { ok: false, reason: 'ai_empty_response', message: 'İçgörü oluşturulamadı, tekrar deneyin.' };
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
          return { ok: false, reason: 'ai_truncated', message: 'AI yanıtı yarım kaldı, tekrar deneyin.' };
        }

        const text = message.content[0].type === 'text' ? message.content[0].text : '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          return { ok: false, reason: 'ai_empty_response', message: 'AI yanıt formatı geçersiz, tekrar deneyin.' };
        }
        payload = JSON.parse(match[0]);
      }

      return { ok: true, payload };
    };

    // Butun sira burada: iddia -> ucret -> saglayici -> saklama. Her adim
    // dayanikli, ve tekrar eden bir anahtar ilk adimda cevaplanir.
    const outcome = await runIdempotentAiRequest(
      {
        requestId,
        mode: mode as AiMode,
        fingerprint: await fingerprintInput(mode as AiMode, identity),
        cost,
      },
      {
        begin: async ({ requestId: id, mode: m, fingerprint }) => {
          const { data, error } = await supabase.rpc('ai_request_begin', {
            p_request_id: id, p_mode: m, p_fingerprint: fingerprint,
          });
          if (error) {
            // Iddia edilemediyse cagriyi ENGELLE. Iddiasiz bir cagriyi ikinci
            // bir cagridan alikoyacak hicbir sey yok.
            console.error('ai_request_begin failed:', error.message);
            return { kind: 'unavailable', error: error.message } as BeginOutcome;
          }
          const row = Array.isArray(data) ? data[0] : data;
          switch (row?.outcome) {
            case 'claimed': return { kind: 'claimed' };
            case 'replay': return { kind: 'replay', response: (row.response ?? {}) as Record<string, unknown> };
            case 'in_progress': return { kind: 'in_progress' };
            case 'mismatch': return { kind: 'mismatch' };
            case 'consumed': return { kind: 'consumed', error: row.error ?? null };
            default: return { kind: 'unavailable', error: `unknown outcome: ${String(row?.outcome)}` };
          }
        },

        complete: async ({ requestId: id, response }) => {
          const { error } = await supabase.rpc('ai_request_complete', {
            p_request_id: id, p_response: response,
          });
          // Yanit dondurulecek ama saklanamadi: kullanici cevabini alir,
          // kaybederse geri getiremez. Sessiz gecmiyoruz.
          if (error) console.error('ai_request_complete failed:', { requestId: id, error: error.message });
        },

        fail: async ({ requestId: id, error: reason }) => {
          const { error } = await supabase.rpc('ai_request_fail', {
            p_request_id: id, p_error: reason,
          });
          if (error) console.error('ai_request_fail failed:', { requestId: id, error: error.message });
        },

        release: async ({ requestId: id }) => {
          const { error } = await supabase.rpc('ai_request_release', { p_request_id: id });
          if (error) console.error('ai_request_release failed:', { requestId: id, error: error.message });
        },

        spend: async ({ requestId: id, mode: m, cost: amount }) => {
          const { data, error } = await supabase.rpc('spend_focus_points_v2', {
            p_amount: amount,
            p_reason: `ai_${m}`,
            p_request_id: id,
          });
          if (error) {
            // Bir zamanlar yutulan hata. Ucretlendiremiyorsak isi yapmiyoruz.
            console.error('spend_focus_points_v2 failed:', error.message);
            return { kind: 'unavailable', error: error.message } as SpendResult;
          }
          const row = Array.isArray(data) ? data[0] : data;
          if (!row || row.ok !== true) {
            return { kind: 'insufficient', balance: Number(row?.balance ?? 0) };
          }
          return row.replayed === true
            ? { kind: 'replayed', balance: Number(row.balance) }
            : { kind: 'charged', balance: Number(row.balance) };
        },

        refund: async ({ requestId: id, reason }) => {
          const { error } = await supabase.rpc('refund_focus_points', {
            p_request_id: id,
            p_reason: reason,
          });
          // Iade basarisiz olursa kullanici basarisiz bir cagri icin ucret
          // odemis olur. Sessizce gecmiyoruz: mutabakat icin iz birakiliyor.
          if (error) console.error('REFUND FAILED', { requestId: id, cost, reason, error: error.message });
        },

        callProvider: callAi,

        readBalance: async () => {
          // Tekrar yolunda bakiye OKUNUR, harcama RPC'si cagrilmaz: ucret
          // alamayacak bir yolda ucret alabilen bir sey cagirmak yanlis olur.
          const { data, error } = await supabase
            .from('user_subscriptions')
            .select('focus_points')
            .eq('user_id', user.id)
            .maybeSingle();
          if (error || !data) return null;
          return Number((data as { focus_points: number }).focus_points);
        },

        describeError: describeProviderError,
      },
    );
    return json(outcome.body, outcome.status);

  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('generate-routine error:', raw);
    // Iade artik burada YAPILMAZ. Ucreti alan da, saglayiciyi cagiran da
    // `runIdempotentAiRequest`; firlatma halinde iadeyi ve `failed` isaretini
    // o yapar. Buraya ancak ucret alinmadan once olan bir hata duser.
    return json({ error: describeProviderError(raw) }, 500);
  }
});

/**
 * Ham saglayici hatasini kullanicinin okuyacagi bir cumleye cevirir.
 *
 * Hem `runIdempotentAiRequest` (firlatma yolunda) hem de disaridaki `catch`
 * ayni esleme kullansin diye tek yerde.
 */
function describeProviderError(raw: string): string {
  if (/credit balance|billing|insufficient_quota|insufficient/i.test(raw)) {
    return 'AI servisi geçici olarak kullanılamıyor (API kredisi yetersiz). Lütfen daha sonra tekrar deneyin.';
  }
  if (/rate.?limit|overloaded|429/i.test(raw)) {
    return 'AI servisi şu an yoğun, biraz sonra tekrar dene.';
  }
  return 'AI servisi şu an yanıt veremedi, lütfen sonra tekrar deneyin.';
}

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
