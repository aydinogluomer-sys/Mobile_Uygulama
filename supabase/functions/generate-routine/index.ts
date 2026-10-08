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
 * Mirrors `frontend/lib/routineProposal.ts`'s `ProposalHabit` field for field,
 * because that validator is what actually decides whether the model's answer
 * becomes a row. Declaring it here is not a second copy of the RULE -- the rule
 * stays there and rejects anything that slips through -- it is how the model is
 * told the shape in the first place, so the common case is a valid answer
 * rather than a rejected one.
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
  // No closing marker means the model was cut off mid-block. Keep the prose,
  // drop the fragment.
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

  // No tool block. Forced tool_choice makes this all but impossible, so the
  // fallback exists to keep a surprising response readable rather than to be
  // relied upon.
  for (const block of content as { type?: string; text?: string }[]) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return splitCoachActions(block.text.trim());
    }
  }
  return { reply: '', actions: [] };
}

/**
 * How much of a thread the model is shown.
 *
 * The full transcript is kept forever and the user can scroll all of it; this
 * is the bounded slice that goes to Anthropic. Two limits, because either one
 * alone is escapable: 16 messages stops a long chat growing without end, and
 * 6000 characters stops sixteen essays doing the same. The newest turns are
 * kept and the oldest are dropped, which is the half that "bunu haftada üçe
 * çıkaralım" actually depends on.
 *
 * There is deliberately NO rolling summary yet. A summary is another model
 * call, and this feature is not allowed to add a second charge to a 5 FP
 * message; doing it for free on the server would still be a real provider cost
 * appearing out of nowhere. So the cap is honest and stated rather than
 * pretending the context is unlimited.
 */
const COACH_HISTORY_MESSAGES = 16;
const COACH_HISTORY_CHARS = 6000;

type CoachTurn = { role: 'user' | 'assistant'; content: string };

/**
 * The prior turns of ONE conversation, or null if the caller does not own it.
 *
 * Read through the CALLER'S client, not the service-role one. The explicit
 * `user_id` filter would already be correct, but reading as the user means RLS
 * is a second, independent barrier: a mistake in this function still cannot
 * return another person's messages.
 */
async function loadCoachHistory(
  client: ReturnType<typeof createClient>,
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

  // The client persists the current user message before calling, so it is
  // already in this result. It is excluded here and re-added by the caller
  // together with the app's deterministic context.
  const prior = (data as { role: string; content: string; request_id: string | null }[])
    .filter((m) => m.request_id !== excludeRequestId)
    .slice(0, COACH_HISTORY_MESSAGES);

  // Walk newest-first accumulating a character budget, then restore
  // chronological order -- dropping from the OLD end, never the recent one.
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

    // ── Ayri, GUVENILIR istemci ────────────────────────────────────────
    //
    // Islem ve muhasebe RPC'leri artik yalnizca `service_role`a acik. Once
    // oyle degildi ve sonuc gercek bir aciktı: siradan bir kullanici, sadece
    // publishable anahtar ve kendi JWT'si ile `ai_request_begin` +
    // `ai_request_complete` cagirip KENDI yazdigi JSON'u tamamlanmis yanit
    // diye kaydedebiliyor, sonra `generate-routine`den onu 200 ile, ucretsiz
    // ve saglayiciya hic gitmeden geri alabiliyordu.
    //
    // Anahtar sunucuda, kimlik kullanicida: asagidaki her cagriya JWT'den
    // DOGRULANMIS `user.id` gecirilir. Istemci bu fonksiyonlari hic
    // cagiramadigi icin baskasinin kimligini secmesi de mumkun degil.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      // Kapali basarisizlik: guvenilir yol yoksa ucret de almayiz, cagri da
      // yapmayiz.
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

        // THIS conversation's prior turns, and only this one's. The id is
        // verified against the caller before a single message is read, so a
        // forged conversation_id yields no history rather than someone else's.
        const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
        const history = conversationId
          ? await loadCoachHistory(supabase, conversationId, user.id, requestId)
          : [];
        if (conversationId && history === null) {
          return { ok: false, reason: 'conversation_not_found', message: 'Sohbet bulunamadı.' };
        }

        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: COACH_MAX_TOKENS,
          system: COACH_SYSTEM_PROMPT,
          // ONE request. `tools` rides along with the same call that produces
          // the prose -- there is no second "extract the intent" inference, so
          // the coach still costs one 5 FP charge and one provider round trip.
          tools: [COACH_TOOL],
          // FORCED. `auto` would leave "eklemek istiyorum" free to come back as
          // prose with nothing to tap, which is the defect this replaces.
          tool_choice: { type: 'tool', name: COACH_TOOL.name },
          messages: [
            // Conversation history first, then the current turn carrying the
            // app's deterministic domain context. The two are different things
            // and are deliberately not blended: history is what was said, the
            // context line is what is true in Aderyth right now.
            ...(history ?? []),
            { role: 'user', content: `Bağlam: ${contextLine}\n\nKullanıcı: ${userMsg}` },
          ],
        });

        // A tool call cut off mid-argument is not a partial suggestion, it is
        // an unparseable one. Named here rather than left to surface as a
        // generic provider error, exactly as routine mode already does.
        if (message.stop_reason === 'max_tokens') {
          return { ok: false, reason: 'ai_truncated', message: 'AI yanıtı yarım kaldı, tekrar deneyin.' };
        }

        const { reply, actions } = readCoachResponse(message.content);
        if (!reply) {
          return { ok: false, reason: 'ai_empty_response', message: 'Yanıt alınamadı, tekrar deneyin.' };
        }
        // `actions` is ALWAYS an array, and anything unreadable yields an empty
        // one rather than an error: the user paid 5 FP for the reply, and a
        // malformed suggestion must not take that away from them. The client
        // validates this again from scratch -- nothing here is trusted
        // downstream.
        payload = { reply, actions };
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
          const { data, error } = await admin.rpc('ai_request_begin', {
            p_user_id: user.id, p_request_id: id, p_mode: m, p_fingerprint: fingerprint,
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
          const { error } = await admin.rpc('ai_request_complete', {
            p_user_id: user.id, p_request_id: id, p_response: response,
          });
          // Yanit dondurulecek ama saklanamadi: kullanici cevabini alir,
          // kaybederse geri getiremez. Sessiz gecmiyoruz.
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
          const { error } = await admin.rpc('refund_focus_points', {
            p_user_id: user.id,
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
          //
          // Ve bu okuma kasitli olarak KULLANICININ istemcisiyle yapilir:
          // RLS zaten kendi satirina sinirliyor, yani en az yetki. `admin`
          // sadece yazma gecislerinde kullanilir.
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
