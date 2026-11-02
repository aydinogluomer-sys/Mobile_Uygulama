import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import {
  fingerprintInput,
  runIdempotentAiRequest,
  type AiMode,
  type BeginOutcome,
  type ProviderResult,
  type SpendResult,
} from '../_shared/aiIdempotency.ts';
import {
  assertCanonicalCoachHabitSchema,
  resolveAnthropicMessage,
  type StreamDeltaSink,
} from '../_shared/coachContractSchema.ts';

const MAX_TOKENS = 400;          // Varsayılan çıktı token limiti (maliyet kontrolü)
// Koç yanıtı artık düz metnin ARDINDAN isteğe bağlı bir eylem bloğu
// taşıyabiliyor. 400 token yalnızca düz metin içindi; blok eklendiğinde JSON
// ortasında kesilir ve `[[ACTIONS]]` açık kalırdı. Bu, kesilmiş bir öneriyi
// ayrıştırmaya çalışmaktan değil, hiç üretmemekten daha kötüdür: metin de
// yarıda kalır. Sınır yine de bağlı -- koç 5 FP ve tek çağrı olarak kalıyor.
const COACH_MAX_TOKENS = 900;
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

YANIT BİÇİMİ — ZORUNLU:
Her yanıtını SADECE \`coach_response\` aracını çağırarak ver. Serbest metin yazma; kullanıcının okuyacağı metin aracın \`reply\` alanına girer. \`actions\` alanı HER ZAMAN bir dizidir.

NE ZAMAN EYLEM ÜRETİLİR:

1) Sıradan sohbet (motivasyon, tavsiye, soru, bilgi) → \`actions: []\`.
   Örnek: "Motivasyonum çok düşük." → yalnızca reply, boş actions.

2) Kullanıcı AÇIKÇA plan istiyorsa → TAM OLARAK BİR \`propose_habit_plan\`.
   Örnek: "Bana 3 maddelik kısa bir haftalık plan öner."

3) Kullanıcı AÇIKÇA yeni bir alışkanlık eklemek istiyorsa → TAM OLARAK BİR \`propose_habit\`.
   Örnek: "Her gün 20 dakika kitap okuma alışkanlığı eklemek istiyorum."

4) Kullanıcı bir alışkanlığı YAPTIĞINI/YAPMADIĞINI söylüyorsa → TAM OLARAK BİR \`log_habit\`.
   Örnek: "Bugünkü yürüyüşümü yaptım." → completion.kind = "state", state = "done".
   Örnek: "Bugün 10 dakika kitap okudum." → completion.kind = "value", value = 10, unit = "dakika".

5) Kullanıcı bir alışkanlığın GÜNLERİNİ/SIKLIĞINI değiştirmek istiyorsa → TAM OLARAK BİR \`edit_habit_schedule\`.
   Örnek: "Yürüyüşü haftada 3'e indir." → frequency_config: { "kind": "weekly", "count": 3 }

6) Kullanıcı bir alışkanlığa BELİRLİ GÜNLER İÇİN ARA vermek istiyorsa → TAM OLARAK BİR \`pause_habit\`.
   Örnek: "Gelecek hafta spora ara vereceğim." → from / until tarihleri. Geçmiş bir günden başlatma.

7) Kullanıcı bir görevi BAŞKA BİR GÜNE almak istiyorsa → TAM OLARAK BİR \`move_task\`.

8) Kullanıcı bir işe BAŞLAYAMADIĞINI söylüyorsa → TAM OLARAK BİR \`suggest_small_step\` (somut, 2-15 dakikalık ilk adım).

9) Kullanıcı BUGÜN yorgun/bitkin olduğunu ve daha az yapmak istediğini söylüyorsa → TAM OLARAK BİR \`lighten_today\`
   (bugün kenara konabilecek alışkanlıkların adları; kullanıcı listeyi düzenler; hedefler değişmez).

10) Kullanıcı bir alışkanlığın HATIRLATMA SAATİNİ değiştirmek istiyorsa → TAM OLARAK BİR \`edit_reminder_time\`.
   Örnek: "Kitap hatırlatmasını akşam 9'a al." → times: ["21:00"]. Saatler "SS:DD"; günler isteğe bağlı (0=Pzt … 6=Paz).

11) Kullanıcı BU HAFTA yorgun olduğunu / haftayı hafifletmek istediğini söylüyorsa → TAM OLARAK BİR \`lighten_week\`
   (argümansız; hangi alışkanlıkların ara vereceğini uygulama kullanıcının kendi yükünden hesaplar ve kullanıcı düzenler).

Açık ve eyleme dönük bir istek SESSİZCE sadece metne dönüşmemeli: 2-11 durumlarından birindeysen eylemi ÜRET.
Aynı anda birden fazla eylem üretme.

ALIŞKANLIK ALANLARININ ANLAMI — KARIŞTIRMA:
- \`daily_goal\`: günlük ÖLÇÜLEBİLİR hedef (20 dakika, 8 bardak, 10 sayfa).
- \`unit\`: bu sayının birimi ("dakika", "sayfa", "bardak", "tekrar").
- \`estimated_minutes\`: alışkanlığın günlük TAHMİNİ SÜRE MALİYETİ (irade/kapasite hesabı için).
- \`frequency_config\`: hangi günler yapılacağı.

"Her gün 20 dakika kitap oku" için DOĞRU olan:
  tracking_type: "numeric", unit: "dakika", daily_goal: 20, target_direction: "at_least",
  frequency_config: { "kind": "daily" }, estimated_minutes: 20
Sadece \`estimated_minutes: 20\` yazmak YANLIŞTIR — hedef kaybolur.

BİLMEDİĞİNİ UYDURMA:
Kullanıcı ölçülebilir bir hedef SÖYLEMEDİYSE \`unit\` ve \`daily_goal\` alanlarını HİÇ YAZMA (ikisi birlikte gelir ya da hiç gelmez). Uygulama eksiği kullanıcıya sorar. Sıklık belirtilmediyse \`frequency_config\` yazma.

HAFTANIN GÜNLERİ — Pzt=0, Sal=1, Çar=2, Per=3, Cum=4, Cmt=5, Paz=6.
JavaScript'in Pazar=0 düzeni DEĞİL. "Pazartesi, Çarşamba, Cuma" → { "kind": "weekly", "days": [0, 2, 4] }.

ASLA user_id, habit_id, xp, cost, balance, tablo adı veya SQL yazma.
Alışkanlığın tamamlanma durumunu, XP'sini veya yüzdesini SEN hesaplama; sadece kullanıcının söylediğini aktar.
Eylemler yalnızca ÖNERİDİR. Kullanıcı onaylamadan hiçbir şey kaydedilmez; "kaydettim/ekledim" gibi olmuş-bitmiş bir dil KULLANMA, "ekleyebilirim/işaretleyebilirim" de.`;

/**
 * The habit shape the coach may propose.
 *
 * Verified against `_shared/coachContractSchema.ts` (`assertCanonicalCoachHabitSchema`)
 * and `frontend/lib/routineProposal.ts` (`coachSchemaSingleSource.test.ts`).
 */
const COACH_HABIT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 80, description: 'Kısa alışkanlık adı, örn "Kitap Oku".' },
    tracking_type: { type: 'string', enum: ['binary', 'numeric'], description: 'Ölçülebilir hedefi varsa numeric, yoksa binary.' },
    difficulty: { type: 'integer', enum: [1, 3, 5], description: '1 Kolay, 3 Orta, 5 Zor.' },
    estimated_minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Günlük TAHMİNİ SÜRE maliyeti (dakika). Hedef değildir.' },
    unit: { type: 'string', maxLength: 24, description: 'daily_goal birimi: "dakika", "sayfa", "bardak". daily_goal ile birlikte gelir.' },
    daily_goal: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: 'Günlük ölçülebilir hedef. unit ile birlikte gelir. Kullanıcı söylemediyse YAZMA.' },
    target_direction: { type: 'string', enum: ['at_least', 'at_most'], description: 'En az mı en çok mu. Varsayılan at_least.' },
    frequency_config: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        days: {
          type: 'array',
          items: { type: 'integer', minimum: 0, maximum: 6 },
          description: 'Yalnızca kind=weekly ile. Pzt=0 … Paz=6.',
        },
        count: { type: 'integer', minimum: 1, maximum: 31, description: 'Haftada/ayda kaç kez. kind=daily ile kullanılmaz.' },
        part_of_day: { type: 'array', items: { type: 'string', enum: ['morning', 'afternoon', 'evening'] } },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  required: ['name', 'tracking_type', 'difficulty', 'estimated_minutes'],
  additionalProperties: false,
} as const;

assertCanonicalCoachHabitSchema(COACH_HABIT_SCHEMA);

/**
 * The ONE thing a coach turn may return.
 *
 * ## Why this replaced the `[[ACTIONS]]` block
 *
 * The old transport was prose with an OPTIONAL delimited JSON block appended.
 * Two things were wrong with it and both showed up on a real device. It was
 * optional, so "her gün 20 dakika kitap okuma alışkanlığı eklemek istiyorum"
 * could legally come back as encouraging prose with nothing to tap. And it was
 * a delimiter, so a truncated or slightly-off block degraded silently into no
 * action at all rather than into an error anyone could see.
 *
 * A forced tool call fixes exactly that: the model cannot answer any other
 * way, `actions` is a required array, and the shape is checked by the provider
 * before the response is ever sent. It is still the SAME single request --
 * `tools` rides along with the one `messages.create` call below, so a coach
 * message still costs 5 FP and still makes one provider round trip.
 *
 * None of this makes the output trusted. `frontend/lib/coachActions.ts`
 * revalidates every field from scratch, exactly as it did before.
 */
const COACH_TOOL = {
  name: 'coach_response',
  description: 'Kullanıcıya gösterilecek metni ve (varsa) tek bir yapılandırılmış eylem önerisini döndürür.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Kullanıcının okuyacağı düz metin yanıt. Her zaman doldurulur.' },
      actions: {
        type: 'array',
        maxItems: 1,
        description: 'Sıradan sohbette boş dizi. Açık bir istek varsa tam olarak bir eylem.',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['propose_habit'] },
                habit: COACH_HABIT_SCHEMA,
              },
              required: ['type', 'habit'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['propose_habit_plan'] },
                title: { type: 'string', maxLength: 100 },
                goal: { type: 'string', maxLength: 400 },
                habits: { type: 'array', minItems: 1, maxItems: 10, items: COACH_HABIT_SCHEMA },
              },
              required: ['type', 'title', 'goal', 'habits'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['log_habit'] },
                habit_query: { type: 'string', maxLength: 80, description: 'Kullanıcının kastettiği alışkanlığın adı. ID ASLA yazma.' },
                date: { type: 'string', description: '"today", "yesterday" veya "YYYY-MM-DD".' },
                completion: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['state', 'value'] },
                    state: { type: 'string', enum: ['done', 'partial', 'miss', 'skip'], description: 'kind=state ile.' },
                    value: { type: 'number', minimum: 0, maximum: 100000, description: 'kind=value ile. Kullanıcının söylediği sayı.' },
                    unit: { type: 'string', maxLength: 24, description: 'kind=value ile, kullanıcı birim söylediyse.' },
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
              required: ['type', 'habit_query', 'date', 'completion'],
              additionalProperties: false,
            },
            // R09.02 — the second set. The app accepts these only while
            // COACH_ACTIONS_V2_ENABLED is on (after migration 032 is applied).
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['edit_habit_schedule'] },
                habit_query: { type: 'string', maxLength: 80 },
                frequency_config: COACH_HABIT_SCHEMA.properties.frequency_config,
              },
              required: ['type', 'habit_query', 'frequency_config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['pause_habit'] },
                habit_query: { type: 'string', maxLength: 80 },
                from: { type: 'string', description: '"today" veya "YYYY-MM-DD". Geçmiş olamaz.' },
                until: { type: 'string', description: '"YYYY-MM-DD"; boş bırakılırsa kullanıcı açana kadar.' },
              },
              required: ['type', 'habit_query', 'from'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['move_task'] },
                task_query: { type: 'string', maxLength: 80, description: 'Görevin başlığı. ID ASLA yazma.' },
                date: { type: 'string', description: '"today", "yesterday" veya "YYYY-MM-DD".' },
              },
              required: ['type', 'task_query', 'date'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['suggest_small_step'] },
                task_query: { type: 'string', maxLength: 80 },
                step: { type: 'string', maxLength: 120 },
                minutes: { type: 'integer', minimum: 1, maximum: 60 },
              },
              required: ['type', 'task_query', 'step', 'minutes'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['lighten_today'] },
                habit_queries: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 80 } },
              },
              required: ['type', 'habit_queries'],
              additionalProperties: false,
            },
            // R09.02 — reminder time edit (migration 034 adds it to the CHECK).
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['edit_reminder_time'] },
                habit_query: { type: 'string', maxLength: 80 },
                times: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', description: '"SS:DD"' } },
                days: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
              },
              required: ['type', 'habit_query', 'times'],
              additionalProperties: false,
            },
            // R09.04 — lighten the rest of the week (migration 035 adds it to the CHECK).
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['lighten_week'] },
              },
              required: ['type'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['reply', 'actions'],
    additionalProperties: false,
  },
} as const;

const SUMMARY_SYSTEM_PROMPT = `Sen bir günlük yazma asistanısın. Kullanıcının "Aderyth AI Coach" ile yaptığı sohbeti, kullanıcının kendi günlüğüne ekleyebileceği, birinci tekil şahıs ("ben") ağzından kısa bir özet/yansıma haline getiriyorsun.

Tarz: Sıcak, içe dönük, Türkçe. En fazla 5-6 cümle ya da 4 madde. Sohbette konuşulan ana konuları, fark ettiğim şeyleri, aldığım kararları ve eyleme dönük çıkarımları vurgula. Selamlaşmaları ve dolgu cümlelerini atla. Yeni bilgi uydurma — yalnızca sohbette geçenleri özetle.

Sadece düz metin döndür — markdown başlığı, JSON veya kod bloğu KULLANMA.`;

const INSIGHTS_SYSTEM_PROMPT = `Sen bir günlük analiz asistanısın. Kullanıcının belirli bir dönemdeki (haftalık/aylık/yıllık) günlük kayıtlarını okuyup ona içgörü dolu, sıcak bir geri bildirim veriyorsun.

Tarz: Destekleyici, yargılamayan, Türkçe, ikinci tekil ("sen") ağzından. Şunlara odaklan: tekrar eden temalar ve duygular, ruh hali eğilimi, ilerleme/büyüme işaretleri, dikkat çeken zorluklar ve nazik + uygulanabilir bir-iki öneri. Özellikle kötü/negatif alışkanlıklarla mücadele ve duygusal dalgalanma örüntülerini fark et. Genelleme yapma; yalnızca kayıtlarda geçenlere dayan. Veri azsa bunu nazikçe belirt.

En fazla 6-8 cümle ya da birkaç kısa madde. Sadece düz metin döndür — markdown başlığı, JSON veya kod bloğu KULLANMA.`;

/**
 * LEGACY FALLBACK ONLY -- no longer the action transport.
 *
 * `COACH_TOOL` above is how a coach turn answers now: a forced tool call whose
 * `actions` array is required. This function survives for the one case that
 * bypasses it -- a response that somehow arrives as a plain text block instead
 * of a tool_use block -- so that such an answer still reaches the user as
 * prose rather than as an error. It is a safety net under the new transport,
 * not an alternative to it, and an action arriving this way is treated exactly
 * as untrusted as one arriving through the tool.
 *
 * The block is delimited rather than inferred, because "find the JSON in this
 * text" is exactly the kind of guessing that ends with half a sentence being
 * parsed as a habit name. If the markers are absent, malformed, truncated
 * mid-JSON, or contain anything other than an array, the prose is returned
 * intact and `actions` is empty.
 *
 * This never throws. A bad suggestion must not cost the user the reply they
 * were charged for.
 */
function splitCoachActions(raw: string): { reply: string; actions: unknown[] } {
  const start = raw.indexOf('[[ACTIONS]]');
  if (start === -1) return { reply: raw.trim(), actions: [] };

  const reply = raw.slice(0, start).trim();
  const end = raw.indexOf('[[/ACTIONS]]', start);
  if (end === -1) return { reply, actions: [] };

  const body = raw.slice(start + '[[ACTIONS]]'.length, end).trim();
  try {
    const parsed = JSON.parse(body);
    const actions = Array.isArray(parsed) ? parsed : (parsed as { actions?: unknown }).actions;
    return { reply, actions: Array.isArray(actions) ? actions : [] };
  } catch {
    return { reply, actions: [] };
  }
}

/**
 * Reads a coach turn out of the response content blocks.
 *
 * The tool block is the contract; the text block is the fallback. Both paths
 * end in the same place -- a string the user reads and an array the client
 * revalidates -- and neither can throw, because a coach turn that already cost
 * 5 FP must still deliver its prose even when the structured half is unusable.
 */
function readCoachResponse(content: unknown[]): { reply: string; actions: unknown[] } {
  for (const block of content as { type?: string; text?: string; name?: string; input?: unknown }[]) {
    if (block?.type !== 'tool_use' || block.name !== COACH_TOOL.name) continue;
    const input = block.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { reply: '', actions: [] };
    const { reply, actions } = input as { reply?: unknown; actions?: unknown };
    return {
      reply: typeof reply === 'string' ? reply.trim() : '',
      actions: Array.isArray(actions) ? actions : [],
    };
  }

  for (const block of content as { type?: string; text?: string }[]) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return splitCoachActions(block.text.trim());
    }
  }
  return { reply: '', actions: [] };
}

/**
 * How much of a thread the model is shown.
 */
const COACH_HISTORY_MESSAGES = 16;
const COACH_HISTORY_CHARS = 6000;

type CoachTurn = { role: 'user' | 'assistant'; content: string };

async function loadCoachHistory(
  // `SupabaseClient`, not `ReturnType<typeof createClient>`: with supabase-js 2.118 types the latter
  // resolves to the default generics (`<unknown, ..., never>`) and the real client no longer fits
  // (deno check TS2345). Type-only; nothing changes at run time.
  client: SupabaseClient,
  conversationId: string,
  userId: string,
  excludeRequestId: string,
): Promise<CoachTurn[] | null> {
  const { data: conv } = await client
    .from('ai_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!conv) return null;

  const { data, error } = await client
    .from('ai_messages')
    .select('role,content,created_at,request_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(COACH_HISTORY_MESSAGES + 4);
  if (error || !data) return [];

  const prior = (data as { role: string; content: string; request_id: string | null }[])
    .filter((m) => m.request_id !== excludeRequestId)
    .slice(0, COACH_HISTORY_MESSAGES);

  const kept: CoachTurn[] = [];
  let budget = COACH_HISTORY_CHARS;
  for (const m of prior) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const cost = m.content.length;
    if (cost > budget) break;
    budget -= cost;
    kept.push({ role: m.role, content: m.content });
  }
  return kept.reverse();
}

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'son bir hafta',
  monthly: 'son bir ay',
  yearly: 'son bir yıl',
};

const ANTHROPIC_TOOL_DEF = COACH_TOOL as unknown as Anthropic.Tool;
const COACH_TOOLS: Anthropic.Tool[] = [ANTHROPIC_TOOL_DEF];

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
    const wantStream =
      body?.stream === true &&
      (mode === 'coach' || mode === 'summarize' || mode === 'insights');

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'Sunucu yapılandırma hatası' }, 500);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY missing; refusing to serve');
      return json({ error: 'Sunucu yapılandırma hatası' }, 500);
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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

    const clientKey = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
    const requestId: string =
      clientKey.length >= 8 && clientKey.length <= 128 ? clientKey : crypto.randomUUID();

    const identity: string[] =
      mode === 'coach' ? [userMsg]
      : mode === 'summarize' ? [transcript]
      : mode === 'insights' ? [periodLabel, entriesText]
      : [prompt];

    const fingerprint = await fingerprintInput(mode as AiMode, identity);
    let streamSink: StreamDeltaSink | undefined;

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

        const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
        const history = conversationId
          ? await loadCoachHistory(supabase, conversationId, user.id, requestId)
          : [];
        if (conversationId && history === null) {
          return { ok: false, reason: 'conversation_not_found', message: 'Sohbet bulunamadı.' };
        }

        // Keep `COACH_TOOLS` typed for Deno while preserving `[COACH_TOOL]` literal contract:
        void COACH_TOOLS;
        const rawCoach = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: COACH_MAX_TOKENS,
          system: COACH_SYSTEM_PROMPT,
          tools: [COACH_TOOL] as unknown as Anthropic.Tool[],
          tool_choice: { type: 'tool', name: COACH_TOOL.name },
          stream: Boolean(streamSink) as unknown as false,
          messages: [
            ...(history ?? []),
            { role: 'user', content: `Bağlam: ${contextLine}\n\nKullanıcı: ${userMsg}` },
          ],
        });
        const message = await resolveAnthropicMessage(rawCoach, streamSink);

        if (message.stop_reason === 'max_tokens') {
          return { ok: false, reason: 'ai_truncated', message: 'AI yanıtı yarım kaldı, tekrar deneyin.' };
        }

        const { reply, actions } = readCoachResponse(message.content);
        if (!reply) {
          return { ok: false, reason: 'ai_empty_response', message: 'Yanıt alınamadı, tekrar deneyin.' };
        }
        payload = { reply, actions };
      } else if (mode === 'summarize') {
        const rawSum = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: MAX_TOKENS,
          system: SUMMARY_SYSTEM_PROMPT,
          stream: Boolean(streamSink) as unknown as false,
          messages: [{ role: 'user', content: `Aşağıdaki AI koçluk sohbetini günlüğe eklenebilecek bir özet/yansıma haline getir:\n\n${transcript}` }],
        });
        const message = await resolveAnthropicMessage(rawSum, streamSink);
        const summary = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
        if (!summary) {
          return { ok: false, reason: 'ai_empty_response', message: 'Özet oluşturulamadı, tekrar deneyin.' };
        }
        payload = { summary };
      } else if (mode === 'insights') {
        const rawIns = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: INSIGHTS_MAX_TOKENS,
          system: INSIGHTS_SYSTEM_PROMPT,
          stream: Boolean(streamSink) as unknown as false,
          messages: [{ role: 'user', content: `Dönem: ${periodLabel}. Aşağıdaki günlük kayıtlarını analiz edip içgörü ver:\n\n${entriesText}` }],
        });
        const message = await resolveAnthropicMessage(rawIns, streamSink);
        const insight = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
        if (!insight) {
          return { ok: false, reason: 'ai_empty_response', message: 'İçgörü oluşturulamadı, tekrar deneyin.' };
        }
        payload = { insight };
      } else {
        const rawRoutine = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: ROUTINE_MAX_TOKENS,
          system: SYSTEM_PROMPT,
          stream: Boolean(streamSink) as unknown as false,
          messages: [{ role: 'user', content: prompt }],
        });
        const message = await resolveAnthropicMessage(rawRoutine, streamSink);

        // Kesilmiş bir yanıtı AYIKLAMAYA ÇALIŞMA.
        if (message.stop_reason === 'max_tokens') {
          return { ok: false, reason: 'ai_truncated', message: 'AI yanıtı yarım kaldı, tekrar deneyin.' };
        }

        const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          return { ok: false, reason: 'ai_empty_response', message: 'AI yanıt formatı geçersiz, tekrar deneyin.' };
        }
        payload = JSON.parse(match[0]);
      }

      return { ok: true, payload };
    };

    const executeTurn = (onDelta?: StreamDeltaSink) => {
      streamSink = onDelta;
      return runIdempotentAiRequest(
        {
          requestId,
          mode: mode as AiMode,
          fingerprint,
          cost,
        },
        {
          begin: async ({ requestId: id, mode: m, fingerprint: fp }) => {
            const { data, error } = await admin.rpc('ai_request_begin', {
              p_user_id: user.id, p_request_id: id, p_mode: m, p_fingerprint: fp,
            });
            if (error) {
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
            const { error } = await admin.rpc('ai_request_complete', {
              p_user_id: user.id, p_request_id: id, p_response: response,
            });
            if (error) console.error('ai_request_complete failed:', { requestId: id, error: error.message });
          },

          fail: async ({ requestId: id, error: reason }) => {
            const { error } = await admin.rpc('ai_request_fail', {
              p_user_id: user.id, p_request_id: id, p_error: reason,
            });
            if (error) console.error('ai_request_fail failed:', { requestId: id, error: error.message });
          },

          release: async ({ requestId: id }) => {
            const { error } = await admin.rpc('ai_request_release', {
              p_user_id: user.id, p_request_id: id,
            });
            if (error) console.error('ai_request_release failed:', { requestId: id, error: error.message });
          },

          spend: async ({ requestId: id, mode: m, cost: amount }) => {
            const { data, error } = await admin.rpc('spend_focus_points_v2', {
              p_user_id: user.id,
              p_amount: amount,
              p_reason: `ai_${m}`,
              p_request_id: id,
            });
            if (error) {
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
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                const { error } = await admin.rpc('refund_focus_points', {
                  p_user_id: user.id,
                  p_request_id: id,
                  p_reason: reason,
                });
                if (!error) return true;
                console.error('REFUND FAILED', { requestId: id, cost, reason, attempt, error: error.message });
              } catch (e) {
                console.error('REFUND THREW', { requestId: id, cost, reason, attempt, error: e instanceof Error ? e.message : String(e) });
              }
              if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
            }
            return false;
          },

          expireLease: async ({ requestId: id }) => {
            const { error } = await admin
              .from('ai_requests')
              .update({ lease_expires_at: new Date(0).toISOString() })
              .eq('user_id', user.id)
              .eq('request_id', id)
              .eq('status', 'in_progress');
            if (error) console.error('REFUND_PENDING lease expire failed:', { requestId: id, error: error.message });
            const rec = await admin.rpc('ai_request_reconcile_stale', { p_user_id: user.id, p_limit: 5 });
            if (rec.error) console.error('REFUND_PENDING reconcile failed:', { requestId: id, error: rec.error.message });
          },

          callProvider: callAi,

          readBalance: async () => {
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
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (event: string, data: Record<string, unknown>) => {
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              /* client disconnected mid-stream */
            }
          };

          try {
            const outcome = await executeTurn((delta) => emit('delta', delta));
            if (outcome.status === 200) {
              emit('done', outcome.body);
            } else {
              emit('error', { status: outcome.status, ...outcome.body });
            }
          } catch (streamErr) {
            const raw = streamErr instanceof Error ? streamErr.message : String(streamErr);
            console.error('generate-routine stream error:', raw);
            emit('error', { status: 500, error: describeProviderError(raw) });
          } finally {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
      });

      return new Response(sseStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders(),
        },
      });
    }

    const outcome = await executeTurn();
    return json(outcome.body, outcome.status);

  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('generate-routine error:', raw);
    return json({ error: describeProviderError(raw) }, 500);
  }
});

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
