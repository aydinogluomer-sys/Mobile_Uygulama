# Gözlemlenebilirlik, Gizlilik Arındırma ve Olay Müdahale Rehberi (`Y04` & `E13`)

> **Tek Doğruluk Kaynağı (`Y04` / `E13`):** Bu operasyon rehberi doğrudan
> `frontend/lib/sentryClient.ts`, `frontend/lib/crashReporting.ts`,
> `frontend/lib/analytics.ts`, `frontend/lib/syncOutcomes.ts`,
> `frontend/services/unifiedOutbox.ts`, `frontend/lib/outbox.ts`,
> `supabase/migrations/044_ai_messages_and_retention.sql`,
> `docs/implementation-v3/AI_RETENTION_AND_PROVIDER_CONTRACT.md` ve
> `docs/store/RELEASE_CHECKLIST.md` kaynaklarından türetilmiştir.
> Sözleşme bütünlüğü CI'da `frontend/__tests__/repo/f5ObservabilityAndAnalytics.test.ts`,
> `frontend/__tests__/repo/analyticsNoFreeText.test.ts` ve
> `frontend/__tests__/repo/freeMvpReleaseShape.test.ts` tarafından denetlenir.

- **Kanonik Supabase Projesi:** `kbcuolhjjnmhjaarxxmu`
- **Bağlayıcı Kanıt Kuralı:** Hermetik CI testlerinin `GEÇTİ` olması canlı ortamda Sentry veya `pg_cron` çalıştığı anlamına gelmez. Operatör (`OWNER`) dış kimlik bilgilerini tanımlayıp canlı doğrulamayı tamamlayana dek canlı gözlemlenebilirlik kapıları dürüstçe **`BLOKE`** olarak izlenir (`PLAYBOOK_EXECUTION_LEDGER.md`).

---

## 1. Sentry Release / Source-Map / DSN ve 4-Katmanlı Gizlilik Sözleşmesi (`sentryClient.ts` & `crashReporting.ts`)

### 1.1 Ortam Değişkenleri, Sır Yönetimi ve Native `release` / `dist` Türetimi

Depo içinde hiçbir gizli anahtar, sabitlenmiş DSN veya kimlik belirteci bulunmaz:

| Değişken / Ayar | Kapsam | Zorunlu Kural ve Davranış | Depo / Canlı Durumu |
|---|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | İstemci derleme zamanı (bundle içine gömülür) | Yalnızca yazma amaçlı (write-only) ingest adresidir. Boş olduğunda `SENTRY_DSN_CONFIGURED === false` olur ve `initCrashReporting()` `false` döner; uygulama geliştirme modunda konsola yazar, üretimde sessiz kalır, açılışı (`_layout.tsx`) asla kırmaz. | Depoda boş (`""`) · Canlı proje **`BLOKE` (`OWNER`)** |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | İstemci derleme zamanı (opsiyonel) | Tanımlanmazsa `__DEV__ ? 'development' : 'production'` değerini alır. Ayrıca `enabled: !__DEV__` kuralı ile geliştirici modunda ağa hiçbir hata paketi gönderilmez. | Varsayılan kural aktif (`GEÇTİ`) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Yalnız EAS Build ortamı (`sentry-cli`) | Yalnızca derleme sırasında source-map yüklemesi için okunur; çalışma zamanı paketine girmez. | **`BLOKE` (`OWNER`)** |
| `SENTRY_AUTH_TOKEN` | **Yalnızca EAS Secret** | **Asla** `EXPO_PUBLIC_` öneki almaz; **asla** `app.json`, `eas.json` veya kaynak koda yazılmaz (`sntrys_` / `sntryu_` önekleri CI'da taranır ve reddedilir). | Git'te yok (`GEÇTİ`) · EAS Secret **`BLOKE` (`OWNER`)** |
| `release` ve `dist` | Native SDK + `@sentry/react-native` eklentisi | `sentryClient.ts` içinde **bilerek elle tanımlanmaz**. `eas.json` altında `appVersionSource: "remote"` kullanıldığından `app.json` manifest sürümü ile EAS tarafından atanan `versionCode` / `buildNumber` ayrışabilir; native eklenti ve SDK `release`/`dist` kimliklerini doğrudan native ikili paketten (`com.aderyth.app`, sürüm ve derleme numarası) türeterek Hermes/JS source-map eşleşmesini garanti eder. | Otomatik native türetim (`GEÇTİ`) |

### 1.2 4-Katmanlı Gizlilik Bariyeri (Defense-in-Depth PII Scrubbing)

Aderyth günlük (journal) girdileri, AI Koç yazışmaları, alışkanlık ve görev başlıkları barındırır. Tek bir katmandaki olası hata kullanıcı metnini dışarı sızdırmasın diye dört bağımsız bariyer art arda çalışır:

1. **Katman 1 — Tek Yakalama Hunisi (`buildCrashReport`, `scrubMessage`, `scrubStack`):**
   - Uygulama içi tüm yakalanan hatalar (`ErrorBoundary`, `installGlobalErrorHandlers`, `reportError`) `buildCrashReport` üzerinden geçer.
   - `scrubMessage` sırasıyla en özgül kalıptan genele doğru temizlik yapar:
     - `TOKEN_RE`: `ey...` (JWT), `sk-...` (API anahtarı) ve `Bearer <token>` dizgilerini `[redacted]` yapar.
     - `EMAIL_RE`: E-posta adreslerini `[redacted]` yapar.
     - `QUERY_VALUE_RE`: PostgREST sorgu parametrelerindeki kullanıcı değerlerini (`?title=eq.GizliNot` -> `?title=[redacted]`) maskeler.
     - `QUOTED_RE`: Tek, çift ve ters tırnak içindeki tüm çalışma zamanı alıntılarını (ör. `JSON.parse` hatasına gömülen günlük cümlesi) `[redacted]` yapar ve mesajı `MAX_MESSAGE_CHARS = 300` karakterde keser.
   - `scrubStack` en üst `MAX_STACK_FRAMES = 12` çerçeveyi tutar, ilk satırdaki hata mesajını da `scrubMessage` ile temizler ve geliştirici/cihaz dosya yollarındaki kullanıcı adlarını (`C:\Users\<ad>\...`, `/Users/<ad>/...`, `/home/<ad>/...`) soyarak yalnızca `dosya.ts:satır:sütun` bilgisini korur.
   - `context` etiketi `^[A-Za-z][\w./-]{0,63}$` şablonuna uymuyorsa `undefined` yapılır; serbest metin bu alandan sızamaz.
   - `sentrySink`, `ErrorUtils` üzerinden çift kayıt oluşmasını önlemek için `source === 'unhandled'` olaylarını SDK'nın yerleşik yakalayıcısına bırakır; yalnız `render`, `manual` ve `unhandled_promise` raporlarını iletir.
2. **Katman 2 — `beforeSend` Konteyner İmhası ve İkinci Maskeleme:**
   - Native katmandan veya SDK'nın kendi yakalayıcısından gelenler dahil her olay gönderilmeden hemen önce `beforeSend` kancasına girer.
   - `delete event.request` (`Authorization: Bearer <jwt>` başlığı, POST gövdesi ve ham URL'ler), `delete event.user` (hesap veya rastgele kurulum kimliği), `delete event.extra`, `delete event.server_name` ve `event.breadcrumbs = []` uygulanır.
   - `event.message` ve `event.exception?.values[].value` metinleri ikinci kez `scrubMessage` içinden geçirilir.
3. **Katman 3 — `beforeBreadcrumb: () => null`:**
   - Konsol çıktıları, ekran geçişleri ve PostgREST filtre değerleri taşıyan HTTP istek izleri (breadcrumbs) en sessiz PII sızıntı kanalıdır. `beforeBreadcrumb: () => null` ile hiçbir breadcrumb belleğe alınmaz ve ağa çıkmaz.
4. **Katman 4 — Performans İzleme, Oturum ve Ekran Kaydı Sıfırlaması:**
   - `sendDefaultPii: false`, `tracesSampleRate: 0`, `enableAutoPerformanceTracing: false`, `enableCaptureFailedRequests: false`, `enableAutoSessionTracking: false`, `replaysSessionSampleRate: 0` ve `replaysOnErrorSampleRate: 0` açıkça `0` / `false` olarak sabitlenmiştir; `mobileReplayIntegration` projeye dahil edilmemiştir.

---

## 2. İzlenen 5 Kritik Sinyal, Alarm Eşikleri ve Müdahale Protokolü

### 2.1 Kritik Sinyaller ve Alarm Eşikleri

| # | Kritik Sinyal | Birincil Kaynak / Kod Yolu | Uyarı / Alarm Eşiği | İlk Müdahale Özeti |
|---|---|---|---|---|
| **1** | **RPC / PostgREST Hata Oranı (`42501`, `42703`, `5xx`)** | `frontend/lib/syncOutcomes.ts` (`classifyRepoFailure`), Supabase API / Postgres logları | `42501` (RLS yetki reddi): **`> 0`** beklenmedik artış (P0/P1) · `42703` / `PGRST204` (`missing_schema`, `045` dar şema geçişi hariç): **`> 0`** (P1) · `5xx` / `429`: 5 dk pencerede **`> %2`** (P1) | `42501` artışında `039` istemci sürüm uyumunu ve RLS politikalarını kontrol et; `42703` artışında `028..045` canlı migration sırasını (`SQL_FOR_OWNER.md`) doğrula; `5xx` artışında outbox üstel geri çekilmesinin (`retryableDelayMs`) devrede olduğunu teyit et. |
| **2** | **AI Edge Hata / Zaman Aşımı / `refund_credit` Mutabakat Farkı** | `supabase/functions/generate-routine/handler.ts`, `public.ai_requests`, `public.credit_transactions` (`refund_focus_points`) | `refund_credit` (`refund_focus_points`, `request_id \|\| ':refund'`) mutabakat farkı (5 dk kira + `ai_request_reconcile_stale` sonrası iadesiz `failed` istek): **`0` tolerans** (P0) · Edge `5xx` / timeout: 10 dk pencerede **`> %5`** (P1) | Mutabakat farkı `> 0` ise **anında Canary Halt**; `SELECT public.ai_request_reconcile_stale();` çıktısını ve `credit_transactions` defterini incele. Sağlayıcı kesintisinde istemcinin `taskDecomposition.ts` ve `smallStart.ts` yerel fallback yolunda kaldığını doğrula. |
| **3** | **Birleşik Outbox Yaş (`oldestPendingAgeMs`) ve `conflict` / `permanent` Dağılımı** | `frontend/services/unifiedOutbox.ts`, `frontend/lib/outboxEngine.ts`, `frontend/lib/outbox.ts` (`habit`, `task`, `core`, `effect` kanalları) | Çevrimiçi oturumda `oldestPendingAgeMs` (`now - min(cmd.createdAt)`): Uyarı **`> 15 dk`** (`900_000 ms`), Kritik (P1) **`> 6 saat`** (`21_600_000 ms`), üst sınır `RETRYABLE_GIVE_UP_MS = 72 saat` · `permanent` (`dead`) veya `conflict` yığılması: **`> %1`** aktif istemci (P1) | `listOutboxIssues()` üzerindeki `status` (`conflict` vs `dead`) ve `classifyRepoFailure` kategorisini (`auth`, `missing_schema`, `validation`) ayır; şema eksikliğiyse istemciyi zorlamadan sunucu migration'ını tamamla. |
| **4** | **`044` `pg_cron` (`ai_retention_purge` / `purge-ai-retention`) Son Başarılı Çalışma Kontrolü** | `supabase/migrations/044_ai_messages_and_retention.sql` (`public.purge_ai_retention()`, `17 3 * * *` zamanlaması), `cron.job_run_details` | Son başarılı çalışma yaşı: **`> 24s`** (`24 saat` eşik aşımı) veya son çalışmada `status = 'failed'` (P1 gizlilik/saklama alarmı) | `cron.job` ve `cron.job_run_details` tablolarını sorgula; zamanlayıcı durmuşsa `SELECT public.purge_ai_retention();` fonksiyonunu `postgres` / `service_role` ile manuel çalıştır (`v_batch = 5000` parti sınırıyla arka arkaya boşalana dek) ve `17 3 * * *` kaydını onar. |
| **5** | **Hesap İzolasyonu / Yanlış Tahsilat / XP Kayması P0 Olayları** | RLS politikaları, `guardAccountResponse`, `accountScope`, `public.xp_drift()`, Sentry crash-free rate | **Tekil olayda bile `0` tolerans (`> 0` = P0):** Çapraz hesap veri görünürlüğü, çift Focus Point tahsilatı, `xp_drift() > 0` veya canary sürümünde çökmesiz oturum oranının eşik altına düşmesi | Aşağıdaki **2.2 Anında Canary Durdurma (Halt) Prosedürü** derhal işletilir; hiçbir kademeli dağıtım genişletilmez. |

### 2.2 P0 Olaylarında Anında Canary Durdurma (Halt) Prosedürü ve Sorumlu Rol Tablosu

`docs/store/RELEASE_CHECKLIST.md` (`Y09`) ile bağlayıcı ortak protokol:

1. **Dağıtımı Durdur (T+0 – T+15 dk):** Google Play Console üzerinde aşamalı dağıtımı (`Staged Rollout`) anında **Halt** durumuna al; App Store Connect TestFlight harici dağıtımını durdur ve hiçbir iç test yapısını üretime terfi ettirme.
2. **Yetenek Bayraklarını Kapat / Geri Al:** `frontend/lib/featureGates.ts` içindeki `COACH_ACTIONS_V2_ENABLED = false` ve `PUBLIC_SITE_URLS_LIVE = false` kapılarını kapalı tut; açık bir bayrak PR'ı tetikleyiciyse derhal revert et.
3. **Veritabanı ve Kredi Mutabakatını Dondur / Onar:**
   - Sorun `028..045` arası bir migration'dan kaynaklanıyorsa `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md` ve `SQL_FOR_OWNER.md §12` uyarınca `SET aderyth.rollback_confirm = 'NNN';` kilidiyle yalnız ilgili `supabase/rollbacks/` betiğini ters sırada uygula veya ileri düzeltme migration'ı hazırla.
   - `SELECT count(*) FROM public.xp_drift();` sonucunun `0` olduğunu ve `ai_requests` / `credit_transactions` üzerinde açık iade kalmadığını doğrula.
4. **Yeni Aday (RC) Zinciri Olmadan Yeniden Açma Yasağı:** Yama yalnızca yeni bir `git_sha -> frontend/package-lock.json & supabase/functions/deno.lock SHA-256 -> yeşil GitHub Actions CI URI -> EAS Build ID -> imzalı .aab/.ipa SHA-256` zinciriyle yeni sürüm adayı olarak çıkarılır.

| Rol | Sorumluluk Alanı | Yetki ve Eylem |
|---|---|---|
| **`OWNER / Release Lead`** | Mağaza konsolları, EAS sırları, canlı Supabase (`kbcuolhjjnmhjaarxxmu`) | Tek başına **Canary Halt**, mağaza geri çekme ve canlı SQL rollback/ileri düzeltme onay otoritesidir. |
| **`REL` (Release & Observability)** | `sentryClient.ts`, `crashReporting.ts`, `analytics.ts`, `RELEASE_CHECKLIST.md` | PII sızıntı denetimi, Sentry sürüm/source-map doğrulaması, aday tekrar üretilebilirlik zinciri kontrolü. |
| **`DATA` (Database & Ledger)** | `supabase/migrations/028..045`, `supabase/rollbacks/`, `xp_drift()` | `42501`/`42703` teşhisi, `044` `purge_ai_retention()` ve `xp_drift() = 0` mutabakat sorguları. |
| **`SYNC` (Outbox & Isolation)** | `unifiedOutbox.ts`, `outboxEngine.ts`, `syncOutcomes.ts`, `accountScope.ts` | `oldestPendingAgeMs`, `conflict`/`permanent` kök neden analizi ve A->B hesap sınırı doğrulaması. |
| **`AI` (Edge & Billing)** | `generate-routine`, `aiIdempotency.ts`, `AI_RETENTION_AND_PROVIDER_CONTRACT.md` | `refund_focus_points` (`request_id \|\| ':refund'`) mutabakatı, sağlayıcı kesintisi ve yerel fallback doğrulaması. |

---

## 3. Kontrollü Hata Tatbikatı (Incident Drill) ve Canlı Kanıt Durumu

### 3.1 Hermetik CI Tatbikatı vs Canlı Ortam Durumu

| Denetim Kalemi | Kapsam ve Yöntem | Kanıt Yeri | Durum |
|---|---|---|---|
| **Kontrollü PII / Sır Sızıntı Tatbikatı (Hermetik)** | Tek bir bileşik hata yüküne tırnak içi Türkçe günlük cümlesi, PostgREST `?title=eq.GizliNot` sorgusu, `test@example.com` e-postası, `Bearer <jwt>` belirteci, kullanıcı adı içeren dosya yolu ve serbest metin `context` enjekte edilerek `scrubMessage` + `buildCrashReport` + `sentryClient` konteyner silimi doğrulanır. | `frontend/__tests__/repo/f5ObservabilityAndAnalytics.test.ts`, `frontend/__tests__/lib/crashReporting.test.ts` | **`GEÇTİ`** (serbest metin, günlük girdisi, görev başlığı, e-posta ve `Bearer <jwt>` sızıntısı = **`0`**; tanısal hata sınıfı/kodu korundu) |
| **Sentry Statik Gizlilik Kapısı** | `beforeBreadcrumb: () => null`, `delete event.request/user/extra/server_name`, `tracesSampleRate: 0`, `replaysSessionSampleRate: 0` ve kaynak kodda `sntrys_`/`sntryu_` bulunmaması. | `frontend/__tests__/repo/freeMvpReleaseShape.test.ts`, `frontend/__tests__/repo/f5ObservabilityAndAnalytics.test.ts` | **`GEÇTİ`** |
| **Canlı Sentry Projesi, DSN ve Source-Map Yüklemesi** | Sentry organizasyon/proje açılışı, `EXPO_PUBLIC_SENTRY_DSN` ve EAS `SENTRY_AUTH_TOKEN` tanımlanıp gerçek bir üretim derlemesinden arındırılmış test hatasının Sentry panelinde doğrulanması. | `docs/store/RELEASE_CHECKLIST.md` (`External / accounts`) | **`BLOKE`** (Operatör `EXPO_PUBLIC_SENTRY_DSN` ve EAS sırlarını tanımlayana dek dürüstçe `BLOKE`) |
| **Canlı `044` `pg_cron` (`ai_retention_purge`) Kanıtı** | Kanonik projede (`kbcuolhjjnmhjaarxxmu`) `044_ai_messages_and_retention.sql` uygulanması, `cron.schedule('purge-ai-retention', '17 3 * * *', ...)` kurulumu ve `24s` içinde başarılı çalışma kaydı. | `docs/implementation-v3/AI_RETENTION_AND_PROVIDER_CONTRACT.md §3`, `SQL_FOR_OWNER.md §5` | **`BLOKE`** (Operatör canlı migration ve `pg_cron` adımı bekleniyor) |

### 3.2 Operatör Devreye Alma Sonrası Canlı Doğrulama Adımları (`BLOKE -> GEÇTİ` Geçiş Kapısı)

1. Sentry üzerinde `aderyth` projesi açılır; EAS ortam değişkenlerine `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` ve **EAS Secret** olarak `SENTRY_AUTH_TOKEN` eklenir.
2. İç test (`validation` / `Internal Testing`) derlemesinde kontrollü bir test hatası tetiklenir; Sentry panelinde gelen olayda `request`, `user`, `extra`, `breadcrumbs` alanlarının boş olduğu ve hata mesajındaki tırnak içi/sorgu içi verinin `[redacted]` olarak göründüğü ekran görüntüsü/olay kimliği ile kayıt altına alınır.
3. Kanonik Supabase SQL Editöründe `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'purge-ai-retention';` ve son `24s` çalışma sonucu doğrulanır.

---

## 4. `E13` Opt-In Ürün Analitiği: Pay / Payda, Kapalı Sözlük ve Veri Ömrü

### 4.1 Gizlilik, Açık Rıza (Opt-In) ve Veri Ömrü Kuralları (`frontend/lib/analytics.ts`)

- **Varsayılan Kapalı (`isAnalyticsOptedIn() === false`):** Kullanıcı açıkça onay vermeden (`setAnalyticsOptIn(true)`) `emitProductEvent(name, props)` hiçbir olayı sink'e iletmez (`null` döner) ve varsayılan sink `noopSink` olarak sessizdir.
- **Veri Saklama Süresi (`ANALYTICS_RETENTION_DAYS = 90`):** Opt-in kapsamında toplanan arındırılmış ürün olaylarının maksimum saklama ömrü **90 gündür** (`ANALYTICS_RETENTION_DAYS = 90`). 90 günü aşan ham olay satırları silinir.
- **Sıfır Serbest Metin (`buildEvent` + `isPermittedString` + `ANALYTICS_ENUMS`):** Bir olay yalnızca UUID, ISO tarih/zaman damgası, sonlu sayı (`number`), `boolean`, `null` veya kendi anahtarı altında ilan edilmiş kapalı küçük harf enum (`^[a-z][a-z0-9_-]{0,31}$`) taşıyabilir. Görev başlığı, alışkanlık adı, günlük yazısı veya duygu metni geçirilirse sessizce düşürülür ve anahtar adı sızıntı denetimi için `dropped` dizisine yazılır.
- **Eklenen Minimal `E13` Olayları ve Kapalı Enum Anahtarları:**
  - Olaylar (`ANALYTICS_EVENTS`): `first_action_started`, `day_replan_applied`, `day_replan_undone`, `focus_stopped_early`, `light_day_confirmed`.
  - Kapalı Sözlükler (`ANALYTICS_ENUMS`):
    - `replan_outcome`: `committed`, `pending`, `partial`, `conflict`, `aborted`
    - `undo_outcome`: `undone`, `pending`, `partial`, `conflict`, `noop`
    - `stop_reason`: `early_exit`, `switched_task`, `completed`, `paused`
    - `suggestion_kind`: `resume_focus`, `resume_routine`, `start_small`, `recovery`, `habit`, `task`
    - `environment`: `development`, `staging`, `production`, `test`

### 4.2 İki Ana Ürün Metriği: Pay, Payda ve Veri Ömrü Tablosu

| Ürün Metriği | Pay (Numerator) | Payda (Denominator) | İlgili Kapalı Olaylar ve Özellikler | Özet İstatistik | Veri Ömrü ve Rıza Kuralı |
|---|---|---|---|---|---|
| **1. İlk Etkin Eyleme Kadar Süre (`Time-to-First-Effective-Action`)** | Paydadaki yerel gün oturumları içinde ilk `first_action_started` (veya ilk `focus_started` / `habit_completed`) olayının kaydedildiği oturumlardaki açılış -> ilk eylem geçen süre (`elapsed_seconds`, sonlu sayı) | `isAnalyticsOptedIn() === true` olan ve ilgili `local_day` (ISO `yyyy-MM-dd`) içinde uygulama açılışı veya `onboarding_started` kaydı bulunan tekil kullanıcı-gün oturumları | `first_action_started` (`suggestion_kind`, `elapsed_seconds`, `local_day`), `onboarding_started`, `focus_started`, `habit_completed` | **Medyan (P50)** ve **P90** saniye (`suggestion_kind` kırılımlı) | Yalnızca açık opt-in (`isAnalyticsOptedIn() === true`) · Ham olay ömrü **`ANALYTICS_RETENTION_DAYS = 90`** gün |
| **2. Aksama Sonrası Aynı Gün Dönüş Oranı (`Same-Day Return Rate After Disruption`)** | Paydadaki kullanıcı-günleri içinden, günün ilk aksama/yeniden planlama olayından **sonra** aynı `local_day` kapanmadan en az bir etkin devam/tamamlama olayı (`first_action_started`, `habit_completed`, `habit_partial`, `focus_completed` veya `recovery_completed`) üreten tekil kullanıcı-günleri (yalnız `day_replan_undone` ile geri alınıp eylem üretilmeyen günler hariç) | `isAnalyticsOptedIn() === true` olan ve ilgili `local_day` içinde en az bir aksama veya yük hafifletme sinyali (`habit_missed`, `focus_stopped_early` [`stop_reason = 'early_exit'`], `day_replan_applied` [`replan_outcome`], `light_day_confirmed` veya `recovery_created`) üreten tekil kullanıcı-günleri | `focus_stopped_early` (`stop_reason`), `day_replan_applied` (`replan_outcome`), `day_replan_undone` (`undo_outcome`), `light_day_confirmed`, `habit_missed`, `recovery_created` -> `first_action_started`, `habit_completed`, `habit_partial`, `focus_completed`, `recovery_completed` | Oran (**`Pay / Payda`**, `%` olarak, günlük ve 7 günlük hareketli pencere) | Yalnızca açık opt-in (`isAnalyticsOptedIn() === true`) · Ham olay ömrü **`ANALYTICS_RETENTION_DAYS = 90`** gün |
