# AI Retention, Idempotency & Provider Contract (`Y07`)

> **Tek Doğruluk Kaynağı (`Y07` / `AI-01`):** Bu sözleşme doğrudan
> `supabase/migrations/023_ai_request_idempotency.sql`,
> `024_ai_request_privileges_and_lease.sql`,
> `026_ai_conversations.sql`,
> `039_focus_point_hardening.sql`,
> `044_ai_messages_and_retention.sql`,
> `supabase/functions/DEPLOYMENT.json`,
> `supabase/config.toml`,
> `supabase/functions/generate-routine/handler.ts` ve
> `supabase/functions/_shared/aiIdempotency.ts` kaynaklarından türetilmiştir.
> Saklama sürelerinin `044_ai_messages_and_retention.sql` ile birebir eşliği CI'da
> `frontend/__tests__/repo/f1ReleaseAndAiContract.test.ts` tarafından denetlenir.

---

## 1. Üçlü Kanıt Ayrımı (Three-Layer Evidence Separation)

AI ve Edge katmanında "repoda yazılmış kaynak", "canlıda çalışan paket" ve
"istemcinin açtığı yetenek" birbirinin yerine geçmeyen üç ayrı kanıt katmanıdır:

| Katman | Kanıt Kaynağı | Doğrulama Aracı / Yeri | Mevcut Durum |
|---|---|---|---|
| **1. Repo Manifest & Config Eşliği** | `supabase/functions/DEPLOYMENT.json` + `supabase/config.toml` (`[functions.*]` blokları, `verify_jwt` ve `import_map = "./functions/deno.json"`) | `frontend/__tests__/repo/edgeDeploymentManifest.test.ts` (kimlik bilgisi gerektirmez, her PR'da CI'da çalışır) | **DOĞRULANDI (Repo):** `generate-routine`, `delete-account`, `notion-sync` (`deploy: true`, `verify_jwt = true`); `subscription-webhook` (`deploy: true`, `verify_jwt = false`); `google-auth`, `notion-auth`, `spotify-auth` (`deploy: false`, `config.toml` dışında). |
| **2. Canlı Yayımlanan Edge Paketi** | Kanonik proje (`kbcuolhjjnmhjaarxxmu`) üzerindeki gerçek Edge dağıtımı (`version`, `verify_jwt`, son kaynak commit'ine göre bayatlık) | `SUPABASE_ACCESS_TOKEN=<token> node tools/verify-edge-deployment.mjs --project-ref kbcuolhjjnmhjaarxxmu` (`OWNER_ROLLOUT_QUICKSTART.md` Adım 4) | **`BLOKE` / Operatör Adımı (`S3` / `OD-03`):** CI üretim erişim belirteci taşımaz; canlı eşlik kanıtı yalnız sahip dağıtımı sonrasında üretilir. |
| **3. İstemci Yetenek Bayrağı** | `frontend/lib/featureGates.ts` içindeki `COACH_ACTIONS_V2_ENABLED = false` | `frontend/__tests__/repo/coachV2Wired.test.ts` + `ownerRolloutReadiness.test.ts` (`--post-rollout`) | **KAPALI (`false`):** `032` + `034` + `035` (`ai_actions_type_check` 10 eylem türü) canlıya uygulanıp `generate-routine` deploy edildikten ve `tools/verify-edge-deployment.mjs` `0` döndükten **sonra** ayrı 2 satırlık PR ile `true` yapılır (`OWNER_ROLLOUT_QUICKSTART.md` Adım 6). |

---

## 2. Kimlik, Tahsilat ve Yerel Fallback Sınırı (`AI-01`)

### 2.1 Dört Ayrı Kayıt Katmanı (Birbirine Karıştırılmaz)

Bir AI işlemi boyunca oluşan dört kayıt farklı yaşam döngülerine ve farklı tablolara aittir:

| Kavram | Tablo / Kaynak | Birincil Anahtar / Kimlik | Rol ve Sınır |
|---|---|---|---|
| **1. İstemci Mantıksal Niyeti** | `frontend/lib/aiAttempt.ts` (`createAttemptKeeper`) → `public.ai_requests` | `(user_id, request_id)` + SHA-256 `input_fingerprint` | Kullanıcının tek bir mantıksal AI isteğini temsil eder. Yanıt alınamayan denemelerde (timeout, ağ kopması, `REQUEST_IN_PROGRESS`) aynı `request_id` yeniden gönderilir; sunucu kesin yanıt verdiğinde (`answered()`) deneme kapanır. |
| **2. Edge Çağrı Telemetrisi** | `public.ai_calls` | `id` (`user_id`, `called_at`) | Kısa ömürlü operasyonel çağrı izi / hız sınırı tablosudur (`040` ile istemci `INSERT/UPDATE/DELETE` kapatılmıştır). Kredi muhasebesi veya yanıt tekrar oynatma (replay) kaynağı **değildir**. |
| **3. Sağlayıcı İsteği (Anthropic)** | `supabase/functions/generate-routine/handler.ts` (`callAi` → `client.messages.create`) | Yalnız `outcome = 'claimed'` ve başarılı `spend` sonrası tek çağrı | Yalnız `ai_request_begin` `claimed` döndüğünde, 24 saatlik kota (`DAILY_REQUEST_CAP = 60`) ve eşzamanlı kira sınırı (`MAX_IN_FLIGHT = 2`) geçildiğinde ve `spend_focus_points_v2` başarılı olduğunda çağrılır. `replay`, `in_progress`, `mismatch`, `consumed` veya `insufficient` dallarında sağlayıcıya **sıfır** çağrı gider. |
| **4. Focus Point Kredi Hareketi** | `public.credit_transactions` | Harcama: `request_id` (`delta < 0`) · İade: `request_id \|\| ':refund'` (`delta > 0`) | Yalnızca eklenir (append-only) kredi defteridir. Sağlayıcı hatası, boş/kesik yanıt (`ai_truncated`, `ai_empty_response`) veya süresi dolan kira (`lease_expires_at`, 5 dakika; `ai_request_reconcile_stale`) durumunda `refund_focus_points` tam olarak tek bir `request_id \|\| ':refund'` satırı yazar. |

### 2.2 Tek Net Focus Point Etkisi (`023`, `024`, `039`)

- **Tamamlanan İstek (`status = 'completed'`):** Aksiyon başına maliyet (`coach = 5`, `routine = 25`, `summarize = 3`, `insights = 5` FP) tam olarak **bir kez** düşülür. Aynı `(user_id, request_id)` ve aynı `input_fingerprint` ile gelen tekrar çağrılar `ai_requests.response` üzerinden yanıtlanır; yeni `credit_transactions` satırı veya ikinci Anthropic çağrısı üretmez. Farklı girdiyle aynı anahtar gönderilirse `409 IDEMPOTENCY_KEY_REUSE_MISMATCH` döner.
- **Başarısız / Zaman Aşımına Uğrayan İstek (`status = 'failed'` veya `REFUND_PENDING`):** Harcama yapılmışsa `refund_focus_points(p_user_id, p_request_id, p_reason)` `request_id || ':refund'` anahtarıyla ücreti iade eder (net FP etkisi = **0**). İade anında yazılamazsa satır `in_progress` bırakılır, `expireLease` çağrılır ve 5 dakikalık kira sonunda `ai_request_reconcile_stale` (`FOR UPDATE SKIP LOCKED`) iadeyi tamamlar. `039_focus_point_hardening.sql` geçmişte iadesi eksik kalmış `failed` satırları tek seferlik onarır ve eski anahtarsız `spend_focus_points(integer, text)` RPC'sinin istemci `EXECUTE` yetkisini kapatır.
- **Mesaj Tekilliği ve Bütünlüğü (`026`, `039`, `044`):** `ai_messages_assistant_request_uniq` (`026`) ve `ai_messages_user_request_uniq` (`039`) aynı `(conversation_id, request_id)` için en fazla bir kullanıcı ve bir asistan satırına izin verir; `044` ise `role = 'assistant'` eklemelerini tamamlanmış `ai_requests` kaydındaki `left(r.response ->> 'reply', 8000) = ai_messages.content` eşitliğine bağlar.

### 2.3 Sağlayıcı Kesintisinde Yerel Deterministik Fallback

Sağlayıcı zaman aşımı (`EDGE_TIMEOUT_MS`), 5xx/429 hatası, çevrimdışı durum veya yetersiz Focus Point (`402 INSUFFICIENT_CREDITS`, `429 DAILY_LIMIT`, `429 TOO_MANY_IN_FLIGHT`) yaşandığında çekirdek görev parçalama ve işe başlama akışları **kesintisiz ve yerel** çalışır:

- **`frontend/lib/taskDecomposition.ts`:** `buildLocalSplitProposal` ve `validateSubtaskProposal` görev başlığındaki Türkçe eylem ailesinden (`STEP_FAMILIES` veya `GENERIC_STEPS`) cihaz üzerinde deterministik alt görev önerisi üretir; ağ veya Focus Point gerektirmez.
- **`frontend/lib/smallStart.ts`:** `draftFor` ve `validateSmallStep` görevi değiştirmeden 2–25 dakikalık düşük sürtünmeli ilk adım odak oturumu başlatır; hiçbir sağlayıcı çağrısına veya krediye bağımlı değildir.

---

## 3. Operasyonel Saklama (Retention) Matrisi (`044_ai_messages_and_retention.sql`)

`public.purge_ai_retention()` (`SECURITY DEFINER`, `SET search_path TO 'public'`, parti büyüklüğü `v_batch = 5000`) yalnızca operasyonel AI tablolarını temizler:

| Kural Kimliği | Saklama Süresi | SQL İfadesi (`044_ai_messages_and_retention.sql`) | Hedef Tablo ve Koşul | İşlem ve Parti Sınırı |
|---|---|---|---|---|
| `[RET-AI-CALLS]` | `7 days` | `interval '7 days'` | `public.ai_calls` (`called_at < now() - interval '7 days'`) | Satırlar tamamen silinir (`DELETE`, `ai_calls_deleted`). |
| `[RET-AI-PAYLOAD-SCRUB]` | `30 days` | `interval '30 days'` | `public.ai_requests` (`created_at < now() - interval '30 days'`) | `status = 'completed'` ve `response <> '{}'::jsonb` satırlarda `response = '{}'::jsonb` yapılır (`answers_blanked`); `status = 'failed'` ve `error IS NOT NULL` satırlarda `error = NULL` yapılır (`errors_cleared`). Her iki adım `ORDER BY created_at LIMIT 5000 FOR UPDATE SKIP LOCKED` ile çalışır; idempotency/muhasebe satır kimliği korunur. |
| `[RET-AI-LEDGER-PURGE]` | `400 days` | `interval '400 days'` | `public.ai_requests` (`status <> 'in_progress'` ve `created_at < now() - interval '400 days'`) **ve** `public.credit_transactions` (`request_id IS NOT NULL` ve `created_at < now() - interval '400 days'`) | Her iki tablodan `ORDER BY created_at LIMIT 5000` partilerle satırlar silinir (`request_records_deleted`, `ledger_rows_deleted`). `in_progress` istekler ve AI dışı kredi hareketleri (`request_id IS NULL`, ör. `monthly_renewal`) silinmez. |

### Yetki Sınırı ve `pg_cron` Operatör Adımı (`OD-25`)

- **Yetki:** `044_ai_messages_and_retention.sql` hem `public.purge_ai_retention()` hem `public.cleanup_old_ai_calls()` üzerinde `PUBLIC, anon, authenticated` rollerinden `EXECUTE` yetkisini geri alır (`REVOKE EXECUTE`); fonksiyon yalnız `service_role` / `postgres` (`pg_cron`) tarafından çalıştırılabilir.
- **Zamanlama (`17 3 * * *`) ve Canlı Kanıt Durumu (`BLOKE`):** Migration `044` repoda `WRITTEN, NOT APPLIED` durumundadır ve zamanlayıcıyı kendiliğinden kurmaz. `044` canlıya uygulandıktan ve `pg_cron` uzantısı etkinleştirildikten sonra operatör (`OWNER`) tarafından Dashboard SQL Editöründe çalıştırılır (`OWNER_ROLLOUT_QUICKSTART.md` Adım 5):
  ```sql
  SELECT cron.schedule('purge-ai-retention', '17 3 * * *', $$SELECT public.purge_ai_retention()$$);
  ```
  Canlı `cron.job` çıktısı alınana kadar otomatik temizlik zamanlaması kanıtı **`BLOKE`** olarak izlenir (`SQL_FOR_OWNER.md §5`).

---

## 4. Sohbet Silme vs Operasyonel Kayıt ve Günlük Bağlamı Gizliliği

### 4.1 Sohbet Silme (`ai_conversations`) ile Operasyonel Kaydın (`ai_requests`) Farkı

| İşlem | Hemen Silinen Kullanıcı Verisi | Korunan Operasyonel Kayıt ve Nedeni | Tam Hesap Silmede (`delete-account`) Ne Olur? |
|---|---|---|---|
| **Kullanıcı tek bir sohbeti siler** (`deleteConversation` → `DELETE FROM public.ai_conversations`) | `026_ai_conversations.sql` içindeki `ON DELETE CASCADE` yabancı anahtarları sayesinde ilgili sohbetin tüm **`public.ai_messages`** dökümü ve **`public.ai_conversation_actions`** öneri kayıtları **anında** silinir; sonraki hiçbir `loadCoachHistory` çağrısında modele gösterilemez. | `public.ai_requests` ve `public.credit_transactions` tablolarının `ai_conversations` tablosuna FK bağı **yoktur** (`(user_id, request_id)` anahtarlıdır). 24 saatlik kota (`DAILY_REQUEST_CAP = 60`), tekrar oynatma güvenliği ve Focus Point muhasebe bütünlüğü için bu operasyonel kayıtlar kalır; içerik gövdesi (`response` / `error`) **`30 days`** sonunda boşaltılır, satırların kendisi **`400 days`** sonunda silinir. | `delete-account` Edge fonksiyonu `auth.admin.deleteUser` çağrısıyla `auth.users` satırını sildiğinde `ai_conversations`, `ai_messages`, `ai_conversation_actions`, `ai_requests`, `ai_calls` ve `credit_transactions` dahil 47 tablonun tamamı `ON DELETE CASCADE` ile **beklemesiz** silinir. |
| **`purge_ai_retention()` gece temizliği çalışır** | **Hiçbir sohbet silinmez:** `purge_ai_retention()` `public.ai_conversations` veya `public.ai_messages` tablolarına dokunmaz (`aiRetention044.test.ts` bu yasağı statik olarak korur). | Yalnız `7 days` (`ai_calls`), `30 days` (`ai_requests.response`/`error` maskeleme) ve `400 days` (`ai_requests` + AI `credit_transactions`) kuralları uygulanır. | Hesap silinmişse ilgili `user_id` altında zaten satır kalmamıştır. |

### 4.2 Günlük (`journal`) Bağlamı Gizliliği Sözleşmesi

- **Varsayılan Olarak Gönderilmeme Kuralı:** Serbest metin günlük (`journal`) ve not kayıtları `coach` veya `routine` modlarında modele **varsayılan olarak asla gönderilmez**. `supabase/functions/_shared/coachContractSchema.ts` içindeki `sanitizeCoachContext` yalnızca sınırlı yapısal özet alanlarını (`activeHabits` adları en fazla 20 adet, `habitCount`, `pendingTaskCount`, `willpower` sayaçları) kabul eder; günlük metinlerini, notları veya ham veritabanı kimliklerini reddeder/yok sayar.
- **Yalnız Açık Kullanıcı Seçimiyle Bağlama Girme (`mode = 'insights'` / `mode = 'summarize'`):**
  - Günlük kayıtları modele yalnızca kullanıcı Günlük İçgörüleri ekranında açıkça içgörü istediğinde (`mode = 'insights'`), `frontend/lib/journalInsightContext.ts` içindeki `insightPrompt(entries, excluded)` aracılığıyla gönderilir.
  - Kullanıcının hariç tuttuğu günler (`excluded` kümesi), silinmiş kayıtlar ve boş girişler istemcide ayıklanır; kalan tam kayıtlar `INSIGHT_PROMPT_LIMIT = 7000` karakter sınırıyla (en eskiden düşürülerek, kayıt ortasından kesilmeden) paketlenir ve Edge tarafında `<gunluk_kayitlari>` güvenilmeyen veri etiketi (`wrapUntrusted`) içine alınır.
  - Kayıt sayısı, tarih aralığı ve duygu ortalaması (`insightFacts`) modelden alınmaz; uygulama tarafından yerel olarak hesaplanır ve model çıktısı yalnızca yorum olarak sunulur.
  - `mode = 'summarize'` ise yalnızca kullanıcının açıkça özetlemek istediği mevcut AI Koç sohbet dökümünü (`<sohbet_dokumu>`) işler; kullanıcının onayı olmadan günlüğe hiçbir satır yazılmaz.
