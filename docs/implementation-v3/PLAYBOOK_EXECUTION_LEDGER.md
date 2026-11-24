# Aderyth — Kanonik Uygulama, Sahiplik ve Yayın Kanıt Defteri (Y08)

- **Başlangıç (Audit / Faz 0) Taban SHA:** `56577e9051b64cc43fe5e49d1f5a94c2bb71256d` ([CI Run `45365712434` — 7/7 yeşil](https://github.com/aydinogluomer-sys/Mobile_Uygulama/actions/runs/45365712434))
- **Kanonik Supabase Projesi:** `kbcuolhjjnmhjaarxxmu` (bu oturumda canlı DB/Edge/mağaza yazımı yetki kapsamı dışındadır — bkz. `SQL_FOR_OWNER.md`, `OWNER_ROLLOUT_QUICKSTART.md`)
- **Bağlayıcı Kural:** Kod veya hermetik CI başarısı `staging`, `cihaz` veya `canlı` sütunlarına taşınmaz. Yetki/ortam gerektiren adımlar kanıt oluşana dek `BLOKE` veya `N/R`, kapsam dışı bırakılan ürün fikirleri `KAPSAM DIŞI` olarak işaretlenir. Açık P0 canlı kapısı varken ürün «yayına hazır» ilan edilmez.

---

## 1. Faz 0 Taban Envanteri (`56577e9051b64cc43fe5e49d1f5a94c2bb71256d`)

### 1.1. SQL ve Şema Envanteri (Depo vs Canlı Defter)

| Kategori | Depodaki Dosya Sayısı (`F0` -> `F2`) | Hermetik Postgres 17 CI Durumu | Canlı (`kbcuolhjjnmhjaarxxmu`) Defter Durumu |
|---|---|---|---|
| Baz şema dökümü (`supabase/live_schema.sql`) | `1` | `GEÇTİ` | `001..027` karşılığı baz alındı |
| Tarihsel ileri migration (`001..027`) | `27` | `live_schema.sql` içinde temsil edilir | Kanonik defterde uygulandı kabul edilir; toplu yeniden oynatılmaz |
| Bekleyen ileri migration (`028..044` taban, `045` F2'de) | `17` (`F2` ile `18`) | `GEÇTİ` (ileri → geri → katalog farkı `0` → tekrar ileri) | **BLOKE (Operatör):** Salt okunur katalog sorgusu + kademeli uygulama bekleniyor (`SQL_FOR_OWNER.md`) |
| Eşleşen rollback betikleri (`supabase/rollbacks/`) | `17` (`F2` ile `18`) | `GEÇTİ` (`aderyth.rollback_confirm` korumalı) | Kuru/canlı RPO-RTO kararı operatöre ait |
| Katalog parmak izi (`supabase/tests/catalog_fingerprint.sql`) | `1` | `GEÇTİ` | Salt okunur denetimde kullanılır |
| Davranışsal SQL testleri (`supabase/tests/*.sql`) | `11` (`F2` ile `12`) | `GEÇTİ` (`xp_drift() = 0`, A/B RLS, eşzamanlılık) | Staging/canlı doğrulama operatöre ait |
| **Toplam izlenen `.sql` dosyası** | **`74`** (`F2` ile **`77`**) | **`GEÇTİ`** | **Canlı kanıt açık (`BLOKE`)** |

### 1.2. Özellik Bayrakları ve Sorumluluk Tablosu (`frontend/lib/featureGates.ts`)

| Bayrak | Depo Değeri | Sorumlu Rol | Açılma Önkoşulu | Durum |
|---|---|---|---|---|
| `SPOTIFY_OAUTH_ENABLED` | `false` | LEAD + Operatör | Harici OAuth incelemesi; ücretsiz MVP kapsamı dışında | `KAPSAM DIŞI` (MVP) |
| `NOTION_INTEGRATION_ENABLED` | `false` | LEAD + Operatör | Harici entegrasyon kapsam dışı (`I2`) | `KAPSAM DIŞI` (MVP) |
| `GOOGLE_CALENDAR_INTEGRATION_ENABLED` | `false` | SYNC + Operatör | F6 pilot çakışma kanıtı + salt okunur OAuth onayı (`E16`) | Kapalı (`false`) |
| `PAID_SUBSCRIPTIONS_ENABLED` | `false` | LEAD + Operatör | Ücretsiz MVP kararı korunuyor | `KAPSAM DIŞI` (MVP) |
| `PUBLIC_SITE_URLS_LIVE` | `false` | REL + Operatör | Canlı HTTPS Privacy/Support/Delete URL 200 doğrulaması (`Y13`) | `BLOKE` (Operatör URL yayını) |
| `COACH_ACTIONS_V2_ENABLED` | `false` | AI + DATA + Operatör | Canlıda `032`, `034`, `035` + `generate-routine` deploy + `verify-edge-deployment.mjs` (`Y01`/`Y07`) | `BLOKE` (Canlı rollout sonrası ayrı PR) |
| `LOG_TIMEZONE_ENABLED` | `false` | DATA + SYNC + Operatör | Canlıda `033_habit_log_timezone.sql` + `xp_drift() = 0` (`E04`) | `BLOKE` (Canlı rollout sonrası ayrı PR) |
| `LIGHT_THEME_ENABLED` | `false` | UI + Operatör | Fiziksel cihaz kontrast/erişilebilirlik onayı (`U08`) ve ayrı sahip PR'ı | Kapalı (`false`) |

### 1.3. Açık Mimari ve P0 Kararları (F0 Kaydı)

| Karar Kodu | Konu | Seçilen Mühendislik Sözleşmesi | Sahip / Durum |
|---|---|---|---|
| `DEC-E19` | Görev süre tahmini şeması | `public.tasks` üzerine geriye uyumlu, nullable `estimated_minutes integer (1..1440)` ve `estimate_source text ('user'\|'ai'\|'block'\|'default')` eklenir (`045_task_estimated_minutes.sql` + rollback + `get_today_bootstrap` güncellemesi). Eski şemada `42703`/`PGRST204` gelirse repository dar kolona düşer, sahte kayıt/veri kaybı üretmez. | DATA + SYNC + PRODUCT (`F2`) |
| `DEC-OD20` | Alışkanlık kaydı geri alımında (undo) XP davranışı | Kintsugi / `xp_drift() = 0` değişmezi korunur; istemci tarafında undo günlük/seri görünümünü ve sunucu kaydını güncellerken XP defteri kuralı kullanıcıya şeffaf açıklanır, gizli/çift düşüm yapılmaz. | PRODUCT + DATA (`F2 E09`) |
| `DEC-Y02` | İki aşamalı DB ve istemci geçişi (`042` vs `039`) | Genişletme fazında `042` (ondalık ölçüm + atomik irade RPC) yeni binary'den önce/birlikte uygulanır; daraltma fazındaki `039` (eski istemci `profiles.xp` direkt yazım engeli) yalnız minimum istemci uyumu sağlandıktan sonra uygulanır. | DATA + REL + Operatör (`F1 Y02`) |
| `DEC-OD11` | Harici takvim izin modeli (`E16`) | Yalnız salt okunur meşgul aralık (`busy slot`) adaptörü; dış takvime yazma kesin yasak; `GOOGLE_CALENDAR_INTEGRATION_ENABLED = false` korunur; izin kalktığında önbellek temizlenir. | SYNC + UI (`F7 E16`) |

---

## 2. Rakip Analizindeki 15 Farkın Karar Tablosu (§11)

| Kod | Fark | Aderyth Kararı | Faz / İş | Durum |
|---|---|---|---|---|
| `P3` | Takvimde doğrudan blok düzenleme | Mevcut planın ikinci giriş biçimi; sürüklemeye erişilebilir «Saati değiştir» düğmesi eşlik eder, aynı preview/commit/undo hattını kullanır | `F7` · `U12` | `GEÇTİ` (`calendar.tsx` + `f5f7AccessibilityAndStates.test.tsx`) |
| `P4` | Birden çok aksayan blok | Hafif Gün ve Telafi'ye bağlı, onaylı 3 adımlı («Koru → Gör → Uygula») yeniden planlama ve geri alma | `F4` · `E02`, `E03`, `U05` | `GEÇTİ` (`dayPlanPreview.ts`, `dayPlanCommitService.ts`, `DayReplanSheet.tsx`) |
| `A2` | Göreve özgü AI alt adımı | Tek başlatılabilir mikro adım + yerel `taskDecomposition.ts`/`smallStart.ts` fallback | `F3` · `E01`, `E11`, `U04` | `GEÇTİ` (`actionSuggestion.ts`, `aiFirstStepAdapter.ts`, `SmallStartSheet.tsx`) |
| `A3` | AI süre tahmini | Düzeltilebilir süre/aralık ve açık kaynak etiketi (`user`/`ai`/`block`/`default`/`none`); önce `E19` kalıcılığı | `F2` `E19` → `F3` `U04` | `GEÇTİ` (`045_task_estimated_minutes.sql`, `taskDuration.ts`, `SmallStartSheet.tsx`) |
| `F4` | OS düzeyinde app blocker | MVP koşulu değil; ağır izin/platform bağımlılığı eklenmez, kısa odak başlangıç rehberi (`focusRitual.ts`) ile sınırlı opt-in deney | `F7` · `P06` | `GEÇTİ` (`focusRitual.ts` `resolveFocusStarterGuide`, OS blocker paketi yok) |
| `G3` | Karakter/koleksiyon/ödül ekonomisi | RPG ekonomisi kapsam dışı; yargılamayan geri dönüş ve birikimli çaba görünürlüğü iyileştirilir | `F7` · `U13` | RPG **`KAPSAM DIŞI`**, sakin geri dönüş `GEÇTİ` (`calmProgress.ts`, `achievements.tsx`) |
| `I1` | Harici takvim | Yalnız salt okunur meşgul blokları adaptörü (`GOOGLE_CALENDAR_INTEGRATION_ENABLED = false` altında) | `F7` · `E16` | `GEÇTİ` (Bayrak kapalı = `internal_only`; `calendarBusyAdapter.ts`) |
| `I2` | Geniş görev/sağlık/otomasyon bağlantısı | MVP dışında; yalnız versiyonlu/kuru çalışmalı veri taşıma ve ithal önizleme sözleşmesi | `F7` · `E15` | Harici sağlık OAuth **`KAPSAM DIŞI`**, kuru ithal `GEÇTİ` (`importPreviewAdapter.ts`) |
| `I3` | Çift yönlü takvim/görev senkronu | MVP dışında; dış takvime yazma yapılmaz, tek yön okuma sınırı korunur | `F7` · `E16` | Çift yön **`KAPSAM DIŞI`** (`canWriteExternalCalendar: false`) |
| `I4` | Widget/saat/kilit ekranı | Tek eylem kimliği, dar yetki, gizli varsayılan metin ve ekran içi rutin sesi uyumu | `F7` · `E17`, `U14` | `GEÇTİ` (`routineCuePolicy.ts`, `routine-runner.tsx`) |
| `S1` | Kayıtlı veya yapay eşlik | Kısa, kapatılabilir başlangıç rehberi (`focusRitual.ts`); ayrı sanal karakter yok | `F7` · `P06` | `GEÇTİ` (`focusRitual.ts`, `f5f7NativeReliability.test.ts`) |
| `S2` | Canlı body doubling | Ayrı moderasyon, gizlilik ve gerçek zamanlı operasyon gerektirir | — | **`KAPSAM DIŞI`** |
| `S3` | Yapılandırılmış öz bakım içeriği | Tam içerik kütüphanesi kapsam dışı; `routinePacks.ts` üzerinden tek adımla başlatılabilir kısa paketler | `F3` · `P03` | `GEÇTİ` (`routinePacks.ts` `pickStarterQuickStep`, `onboarding/plan.tsx`) |
| `S4` | Topluluk/bakım veren/hesap verebilirlik | Bireysel mahremiyet ve sakin geri dönüş odağı korunur | — | **`KAPSAM DIŞI`** |
| `S5` | İnsan koçluğu | Yalnız kullanıcı onaylı dijital eylem önerisi | — | **`KAPSAM DIŞI`** |

---

## 3. Mimari Rapordaki 53 İşin Eşleme ve Kanıt Matrisi (§13)

Durum etiketleri: `GEÇTİ` (doğrulandı), `BLOKE` (canlı/konsol/cihaz yetkisi bekliyor), `N/R` (henüz gerçek insan/cihaz üzerinde ölçülmedi), `KAPSAM DIŞI` (bilinçli kapsam sınırı / kapalı bayrak).

| İş ID | Faz | Öncelik | Rol | Teslim Durumu | Normal Giriş Noktası ve Test Kanıtı | Kod | CI | Staging | Cihaz | Canlı |
|---|---|---|---|---|---|---|---|---|---|---|
| `Y08` | F0 | P0 | LEAD | tamamlandı | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `R11_CORE_CLOSURE.md`, `acceptanceReport.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `P02` | F0 | P1 | PRODUCT | tamamlandı | `docs/implementation-v3/R11_USER_ROUNDS_PLAN.md`, `playbookFixtures.ts`, `playbookBaselineFixtures.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `Y01` | F1 | P0 | DATA | repo+CI tamam / canlı açık | `docs/implementation-v3/SQL_FOR_OWNER.md` (§10), `tools/verify-owner-rollout-readiness.mjs`, `ownerRolloutReadiness.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y02` | F1 | P0 | DATA | tamamlandı | `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md`, `SQL_FOR_OWNER.md` (§11 `042`/`039`/`045` eski-yeni istemci matrisi) | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y03` | F1 | P0 | REL | repo kapısı tamam / konsol açık | `docs/store/RELEASE_CHECKLIST.md`, `f1ReleaseAndAiContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `BLOKE` | `BLOKE` |
| `Y06` | F1 | P0 | DATA | tamamlandı | `supabase/rollbacks/README.md`, `SQL_FOR_OWNER.md` (§12 kayıplı rollback vs ileri düzeltme RPO/RTO matrisi) | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y07` | F1 | P0 | AI | tamamlandı | `supabase/migrations/044_ai_messages_and_retention.sql`, `AI_RETENTION_AND_PROVIDER_CONTRACT.md`, `f1ReleaseAndAiContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y09` | F1 | P0 | REL | tamamlandı | `.github/workflows/ci.yml`, `RELEASE_CHECKLIST.md` (`SHA -> lockfile -> artifact` zinciri), `f1ReleaseAndAiContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `BLOKE` | `BLOKE` |
| `Y10` | F1 | P0 | DATA | tamamlandı (CI) / staging açık | `supabase/tests/run.sh`, `supabase/tests/13_task_estimated_minutes_045.sql` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y11` | F1 | P0 | SYNC | tamamlandı | `027_account_deletion_cascade.sql`, `outboxResilienceAndSyncOutcomes.test.ts`, `f1f2IndependentAcceptance.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y13` | F1 | P0 | REL | tamamlandı | `docs/store/RELEASE_CHECKLIST.md` (`[GATE-URL-CONSOLE]` vs `[GATE-URL-INAPP]`), `f1ReleaseAndAiContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `E04` | F2 | P1 | PRODUCT | tamamlandı | `frontend/lib/dayBoundaryContract.ts`, `taskDurationAndDayContract.test.ts`, `f1f2IndependentAcceptance.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `BLOKE` |
| `E05` | F2 | P1 | SYNC | tamamlandı | `frontend/lib/outboxBench.ts`, `outboxStorage.ts`, `outboxResilienceAndSyncOutcomes.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E06` | F2 | P1 | SYNC | tamamlandı | `frontend/lib/syncOutcomes.ts`, `unifiedOutbox.ts`, `outboxResilienceAndSyncOutcomes.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E08` | F2 | P1 | DATA+SYNC | tamamlandı | `taskRepository.ts` (`getTaskSchemaCapability`), `database.types.ts`, `taskDurationPersistence.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `E09` | F2 | P1 | PRODUCT | tamamlandı | `habitSchedule.ts`, `capacityMetricsContract.ts`, `taskDurationAndDayContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E10` | F2 | P1 | PRODUCT | tamamlandı | `capacity.ts`, `capacityMetricsContract.ts`, `taskDurationAndDayContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E19` | F2 | P1 | DATA+SYNC+PRODUCT | tamamlandı | `045_task_estimated_minutes.sql`, `taskRepository.ts`, `taskDuration.ts`, `taskDurationPersistence.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `E01` | F3 | P1 | PRODUCT | tamamlandı | `frontend/lib/actionSuggestion.ts`, `actionSuggestion.test.ts`, `f3f4AcceptanceMatrix.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E11` | F3 | P1 | AI | tamamlandı | `frontend/lib/aiFirstStepAdapter.ts`, `aiFirstStepAdapter.test.ts`, `f3f4AcceptanceMatrix.test.ts` (`LEAF-02/03`) | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `U01` | F3 | P1 | UI | tamamlandı | `frontend/app/tabs/today.tsx`, `todayCognitiveLoad.test.tsx`, `firstActionAndReplanToday.test.tsx` (`<= 8` kontrol) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U02` | F3 | P1 | UI | tamamlandı | `frontend/app/onboarding/plan.tsx`, `onboardingFirstAction.test.tsx`, `f3f4AcceptanceMatrix.test.ts` (`LEAF-01`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U03` | F3 | P1 | UI | tamamlandı | `frontend/lib/todayNarrative.ts`, `locales/tr.json`, `i18nCatalogComplete.test.ts` («Bugün ne kadarı sığar?») | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U04` | F3 | P1 | UI | tamamlandı | `frontend/components/SmallStartSheet.tsx`, `smallStart.ts`, `firstActionAndReplanToday.test.tsx` (`LEAF-04/05`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `P03` | F3 | P1 | PRODUCT | tamamlandı | `frontend/lib/routinePacks.ts`, `onboarding/plan.tsx`, `onboardingFirstAction.test.tsx` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E02` | F4 | P1 | PRODUCT | tamamlandı | `frontend/lib/dayPlanPreview.ts`, `dayPlanPreview.test.ts`, `f3f4AcceptanceMatrix.test.ts` (`REC-01/02/04/05`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E03` | F4 | P1 | SYNC | tamamlandı | `frontend/services/dayPlanCommitService.ts`, `dayPlanCommitAndFocusIdempotency.test.ts`, `f3f4AcceptanceMatrix.test.ts` (`REC-03/04`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U05` | F4 | P1 | UI | tamamlandı | `frontend/components/today/DayReplanSheet.tsx`, `recovery.tsx`, `today.tsx`, `firstActionAndReplanToday.test.tsx` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U10` | F4 | P1 | UI | tamamlandı | `frontend/app/screens/weekly-review.tsx`, `weeklyReviewAndRecoveryFlow.test.tsx` (`REC-06`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `P01` | F4 | P1 | PRODUCT | tamamlandı | `frontend/lib/dayPlanPreview.ts`, `dayPlanPreview.test.ts` (`16:00` sabit randevu + korunan iş + yük farkı) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `P04` | F4 | P1 | PRODUCT | tamamlandı | `frontend/lib/recovery.ts`, `dayPlanPreview.ts`, `recovery.tsx` («telafi etme» ve kısmi ilerleme koruma) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `Y04` | F5 | P0 | REL | repo+tatbikat tamam / canlı DSN açık | `frontend/lib/sentryClient.ts`, `OBSERVABILITY_RUNBOOK.md`, `f5ObservabilityAndAnalytics.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `Y05` | F5 | P0 | QA | simülasyon tamam / fiziksel cihaz açık | `R02_OFFLINE_MATRIX.md`, `PILOT_EXECUTION_KIT.md`, `f5f6PilotAndScaleReadiness.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E07` | F5 | P1 | NATIVE | tamamlandı | `focusTimer.ts`, `routineRunner.ts`, `f5f7NativeReliability.test.ts` (kesinti, saat kayması, OS kill, hesap matrisi) | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E12` | F5 | P1 | QA | tamamlandı | `docs/QUERY_BOUNDING_MATRIX.md`, `frontend/__tests__/perf/oneYearScaleBudget.test.ts` (`4.380` log + `160` görev p95) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E13` | F5 | P1 | REL | tamamlandı | `frontend/lib/analytics.ts`, `analyticsNoFreeText.test.ts`, `f5ObservabilityAndAnalytics.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E14` | F5 | P1 | NATIVE | tamamlandı | `frontend/services/reminderService.ts`, `f5f7NativeReliability.test.ts` (`dayKey+targetId+channel` mutabakatı) | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U06` | F5 | P1 | NATIVE | tamamlandı | `frontend/app/screens/routine-runner.tsx`, `f5f7NativeReliability.test.ts` (atlanan vs yapılan + «Sonra: ...») | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U07` | F5 | P1 | NATIVE | tamamlandı | `frontend/store/focusStore.ts`, `f5f7NativeReliability.test.ts` (erken bitirmede kısmi süre + görev açık kalır) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U08` | F5 | P1 | UI | tamamlandı (CI+Web) / cihaz açık | `R06_ACCESSIBILITY.md`, `f5f7AccessibilityAndStates.test.tsx`, Playwright `reduced-motion-375` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U09` | F5 | P1 | UI | tamamlandı | `frontend/lib/screenStateContract.ts`, `f5f7AccessibilityAndStates.test.tsx` (`pending` ≠ `committed`, taslak koruma) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U11` | F5 | P1 | UI | tamamlandı | `frontend/components/MeasurableInputModal.tsx`, `f5f7AccessibilityAndStates.test.tsx` («1,5 L», «haftada 3») | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `Y12` | F6 | P0 | QA | protokol hazır / insan turu açık | `R11_USER_ROUNDS_PLAN.md`, `PILOT_EXECUTION_KIT.md`, `f5f6PilotAndScaleReadiness.test.ts` (`5–8 × 2` `N/R`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E15` | F7 | P2 | SYNC | tamamlandı | `frontend/lib/importPreviewAdapter.ts`, `R08_BACKUP_PROTECTION.md`, `f7ExperimentsAndAdapters.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E16` | F7 | P2 | SYNC | tamamlandı (kapalı bayrak) | `frontend/lib/calendarBusyAdapter.ts`, `featureGates.ts` (`GOOGLE_CALENDAR_INTEGRATION_ENABLED = false`) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `KAPSAM DIŞI` |
| `E17` | F7 | P2 | NATIVE | tamamlandı | `frontend/lib/routineCuePolicy.ts`, `notificationActions.ts`, `f5f7NativeReliability.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E18` | F7 | P2 | UI | tamamlandı | `frontend/lib/destinations.ts`, `f5f7AccessibilityAndStates.test.tsx`, `routeLiterals.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U12` | F7 | P2 | UI | tamamlandı | `frontend/app/screens/calendar.tsx`, `f5f7AccessibilityAndStates.test.tsx` («Saati değiştir» → ortak preview/undo) | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U13` | F7 | P2 | PRODUCT | tamamlandı | `frontend/lib/calmProgress.ts`, `app/screens/achievements.tsx`, `f7ExperimentsAndAdapters.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U14` | F7 | P2 | NATIVE | tamamlandı | `frontend/lib/routineCuePolicy.ts`, `routine-runner.tsx`, `f5f7NativeReliability.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U15` | F7 | P2 | PRODUCT | tamamlandı | `frontend/lib/calmProgress.ts` (`evaluateCalmReturnHint`), `f7ExperimentsAndAdapters.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `P05` | F7 | P2 | PRODUCT | tamamlandı | `frontend/lib/calmProgress.ts` (`evaluateDurationCalibration`, `n >= 5`, `>= 2` gün), `f7ExperimentsAndAdapters.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `P06` | F7 | P2 | NATIVE | tamamlandı | `frontend/lib/focusRitual.ts` (`resolveFocusStarterGuide`), `f5f7NativeReliability.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |

---

## 4. Tek Yazan Dosya Tahsisi Kaydı (§1.1)

| Faz | Owner | Dosya / Alan | Temel SHA | Okuyucular | Merge Sırası |
|---|---|---|---|---|---|
| `F0` | `LEAD` | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `docs/implementation-v3/R11_CORE_CLOSURE.md`, `docs/implementation-v3/R11_USER_ROUNDS_PLAN.md`, `frontend/__tests__/helpers/playbookFixtures.ts`, `frontend/__tests__/lib/playbookBaselineFixtures.test.ts` | `56577e90` | `ALL` | `1 (LEAD -> 72b93457)` |
| `F1+F2` | `DATA` | `supabase/migrations/045_task_estimated_minutes.sql`, `supabase/rollbacks/045_task_estimated_minutes.rollback.sql`, `supabase/tests/13_task_estimated_minutes_045.sql`, `supabase/migrations/README.md`, `supabase/rollbacks/README.md`, `docs/implementation-v3/SQL_FOR_OWNER.md`, `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md`, `tools/verify-owner-rollout-readiness.mjs`, `frontend/lib/database.types.ts`, `frontend/__tests__/repo/ownerRolloutReadiness.test.ts` | `72b93457` | `SYNC, REL, QA` | `1 (DATA -> 0b7e9ea3)` |
| `F1+F2` | `SYNC` | `frontend/lib/taskTypes.ts`, `frontend/repositories/taskRepository.ts`, `frontend/services/taskService.ts`, `frontend/lib/syncOutcomes.ts`, `frontend/services/unifiedOutbox.ts`, `frontend/lib/outboxBench.ts`, `frontend/__tests__/repo/taskDurationPersistence.test.ts`, `frontend/__tests__/lib/outboxResilienceAndSyncOutcomes.test.ts` | `72b93457` | `DATA, PRODUCT, QA` | `2 (SYNC -> 0b7e9ea3)` |
| `F1+F2` | `PRODUCT` | `frontend/lib/taskDuration.ts`, `frontend/lib/dayBoundaryContract.ts`, `frontend/lib/capacityMetricsContract.ts`, `frontend/__tests__/lib/taskDurationAndDayContract.test.ts` | `72b93457` | `SYNC, UI, QA` | `3 (PRODUCT -> 0b7e9ea3)` |
| `F1+F2` | `REL+AI` | `docs/store/RELEASE_CHECKLIST.md`, `docs/implementation-v3/AI_RETENTION_AND_PROVIDER_CONTRACT.md`, `frontend/__tests__/repo/f1ReleaseAndAiContract.test.ts` | `72b93457` | `DATA, QA, LEAD` | `4 (REL+AI -> 0b7e9ea3)` |
| `F1+F2` | `QA` | `frontend/__tests__/fixtures/f1f2IndependentAcceptance.test.ts` | `72b93457` | `LEAD` | `5 (QA -> 0b7e9ea3)` |
| `F3-W2A` | `PRODUCT-F3` | `frontend/lib/actionSuggestion.ts`, `frontend/lib/routinePacks.ts`, `frontend/__tests__/lib/actionSuggestion.test.ts` | `0b7e9ea3` | `AI, UI, QA` | `1 (PRODUCT-F3 -> 1a82759b)` |
| `F3-W2A` | `AI-F3` | `frontend/lib/aiFirstStepAdapter.ts`, `frontend/__tests__/lib/aiFirstStepAdapter.test.ts` | `0b7e9ea3` | `PRODUCT, UI, QA` | `2 (AI-F3 -> 1a82759b)` |
| `F4-W2A` | `PRODUCT-F4` | `frontend/lib/dayPlanPreview.ts`, `frontend/__tests__/lib/dayPlanPreview.test.ts` | `0b7e9ea3` | `SYNC, UI, QA` | `3 (PRODUCT-F4 -> 1a82759b)` |
| `F3+F4-W2A` | `SYNC+NATIVE` | `frontend/lib/smallStart.ts`, `frontend/store/focusStore.ts`, `frontend/services/dayPlanCommitService.ts`, `frontend/__tests__/services/dayPlanCommitAndFocusIdempotency.test.ts` | `0b7e9ea3` | `UI, QA` | `4 (SYNC+NATIVE -> 1a82759b)` |
| `F3+F4-W2B` | `TODAY-UI` | `frontend/components/SmallStartSheet.tsx`, `frontend/components/today/DayReplanSheet.tsx`, `frontend/app/tabs/today.tsx`, `frontend/lib/todayNarrative.ts`, `frontend/locales/tr.json`, `frontend/__tests__/ui/firstActionAndReplanToday.test.tsx` | `1a82759b` | `QA, LEAD` | `1 (TODAY-UI -> 69614bee)` |
| `F3-W2B` | `ONBOARDING-UI` | `frontend/app/onboarding/plan.tsx`, `frontend/__tests__/ui/onboardingFirstAction.test.tsx` | `1a82759b` | `QA, LEAD` | `2 (ONBOARDING-UI -> 69614bee)` |
| `F4-W2B` | `RECOVERY-REVIEW-UI` | `frontend/app/screens/recovery.tsx`, `frontend/app/screens/weekly-review.tsx`, `frontend/__tests__/ui/weeklyReviewAndRecoveryFlow.test.tsx` | `1a82759b` | `QA, LEAD` | `3 (RECOVERY-REVIEW-UI -> 69614bee)` |
| `F3+F4-W2B` | `QA-F3F4` | `frontend/__tests__/fixtures/f3f4AcceptanceMatrix.test.ts` | `1a82759b` | `LEAD` | `4 (QA-F3F4 -> 69614bee)` |
| `F5+F7-W3` | `NATIVE` | `frontend/app/screens/routine-runner.tsx`, `frontend/lib/routineCuePolicy.ts`, `frontend/lib/focusRitual.ts`, `frontend/__tests__/services/f5f7NativeReliability.test.ts` | `69614bee` | `QA, LEAD` | `1 (NATIVE -> 955db95a)` |
| `F5+F7-W3` | `UI` | `frontend/lib/screenStateContract.ts`, `frontend/components/MeasurableInputModal.tsx`, `frontend/app/screens/calendar.tsx`, `frontend/__tests__/ui/f5f7AccessibilityAndStates.test.tsx` | `69614bee` | `QA, LEAD` | `2 (UI -> 955db95a)` |
| `F7-W3` | `PRODUCT-SYNC` | `frontend/lib/calendarBusyAdapter.ts`, `frontend/lib/importPreviewAdapter.ts`, `frontend/lib/calmProgress.ts`, `frontend/app/screens/achievements.tsx`, `frontend/__tests__/lib/f7ExperimentsAndAdapters.test.ts` | `69614bee` | `QA, LEAD` | `3 (PRODUCT-SYNC -> 955db95a)` |
| `F5-W3` | `REL` | `frontend/lib/analytics.ts`, `docs/implementation-v3/OBSERVABILITY_RUNBOOK.md`, `frontend/__tests__/repo/f5ObservabilityAndAnalytics.test.ts` | `69614bee` | `QA, LEAD` | `4 (REL -> 955db95a)` |
| `F5+F6-W3` | `QA` | `frontend/__tests__/perf/oneYearScaleBudget.test.ts`, `docs/implementation-v3/PILOT_EXECUTION_KIT.md`, `frontend/__tests__/fixtures/f5f6PilotAndScaleReadiness.test.ts` | `69614bee` | `LEAD` | `5 (QA -> 955db95a)` |

---

## 5. Faz Kapanış Tablosu (§1.2)

| Faz | Aday commit | İş ID’leri | Ortam / cihaz | Komut ve sonuç | Kanıt URI veya path | Sapma / risk | Karar |
|---|---|---|---|---|---|---|---|
| `F0` | `72b93457` | `Y08`, `P02` | Windows Node 24 / npm 11 yerel doğrulama + GitHub CI referansı (`45365712434`) | `verify-owner-rollout-readiness.mjs` (0), `typecheck:ci` (0), `lint:ci` (0), `run-tests.js` (147/147), `jest` F0 paketleri (8/8 suite, 46/46 test) yeşil | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `frontend/__tests__/helpers/playbookFixtures.ts`, `frontend/__tests__/lib/playbookBaselineFixtures.test.ts` | Canlı Supabase katalog sorgusu ve fiziksel cihaz erişimi operatör yetkisinde (`BLOKE`) | **GEÇTİ** (Taban kilitlendi; F1 ve F2 açıldı) |
| `F1` | `0b7e9ea3` | `Y01`, `Y02`, `Y03`, `Y06`, `Y07`, `Y09`, `Y10`, `Y11`, `Y13` | Windows Node 24 / Git Bash hermetik doğrulama | `verify-owner-rollout-readiness.mjs` (18 migration `028..045`, exit 0), `f1ReleaseAndAiContract`, `ownerRolloutReadiness`, `migrationRlsGuard`, `migrationRollbackPresent`, `sqlBehaviorTestsWired`, `f1f2IndependentAcceptance` yeşil | `docs/implementation-v3/SQL_FOR_OWNER.md`, `OWNER_ROLLOUT_QUICKSTART.md`, `AI_RETENTION_AND_PROVIDER_CONTRACT.md`, `docs/store/RELEASE_CHECKLIST.md`, `supabase/tests/13_task_estimated_minutes_045.sql` | Canlı Supabase katalog/Edge deploy ve mağaza konsolu işlemleri operatör yetkisinde (`BLOKE`, P0 canlı kapısı F6'ya taşındı) | **GEÇTİ** (Repo/CI provası tamam; canlı kapılar F6'da) |
| `F2` | `0b7e9ea3` | `E04`, `E05`, `E06`, `E08`, `E09`, `E10`, `E19` | Windows Node 24 + 4 saat dilimi (`Europe/Istanbul`, `America/New_York`, `Pacific/Auckland`, `UTC`) | `typecheck:ci` (0), `lint:ci` (0), `run-tests.js` (147/147), 19 Jest suite yeşil, `npm run test:tz` (4/4 dilimde 17/17 suite yeşil) | `supabase/migrations/045_task_estimated_minutes.sql`, `frontend/repositories/taskRepository.ts`, `frontend/lib/taskDuration.ts`, `dayBoundaryContract.ts`, `capacityMetricsContract.ts`, `syncOutcomes.ts`, `outboxBench.ts` | `045` canlıda uygulanana dek `taskRepository` `42703`/`PGRST204` dar şema fallback'ini otomatik ve görünür çalıştırır | **GEÇTİ** (Kalıcı süre ve gün/yazım sözleşmesi F3/F4'e devredildi) |
| `F3` | `69614bee` | `E01`, `E11`, `U01`, `U02`, `U03`, `U04`, `P03` | Windows Node 24 / RTL & Jest hermetik kabul (`LEAF-01..06`) | `typecheck:ci` (0), `lint:ci` (0), `run-tests.js` (147/147), `actionSuggestion.test.ts`, `aiFirstStepAdapter.test.ts`, `firstActionAndReplanToday.test.tsx`, `onboardingFirstAction.test.tsx`, `f3f4AcceptanceMatrix.test.ts`, `todayCognitiveLoad.test.tsx`, `i18nCatalogComplete.test.ts` yeşil | `frontend/lib/actionSuggestion.ts`, `frontend/lib/aiFirstStepAdapter.ts`, `frontend/components/SmallStartSheet.tsx`, `frontend/app/onboarding/plan.tsx`, `frontend/__tests__/fixtures/f3f4AcceptanceMatrix.test.ts` | Canlı Edge AI (`COACH_ACTIONS_V2_ENABLED`) operatör deploy'una dek kapalı (`BLOKE`); yerel bölücü ve şema doğrulamalı adaptör %100 aktif | **GEÇTİ** («Nereden başlayacağımı bilmiyorum» akışı çevrimdışı + AI adaptörlü doğrulandı) |
| `F4` | `69614bee` | `E02`, `E03`, `U05`, `U10`, `P01`, `P04` | Windows Node 24 / RTL & Jest hermetik kabul (`REC-01..06`) | `typecheck:ci` (0), `lint:ci` (0), `run-tests.js` (147/147), `dayPlanPreview.test.ts`, `dayPlanCommitAndFocusIdempotency.test.ts`, `firstActionAndReplanToday.test.tsx`, `weeklyReviewAndRecoveryFlow.test.tsx`, `f3f4AcceptanceMatrix.test.ts`, `designTokensRatchet.test.ts` yeşil | `frontend/lib/dayPlanPreview.ts`, `frontend/services/dayPlanCommitService.ts`, `frontend/components/today/DayReplanSheet.tsx`, `frontend/app/screens/recovery.tsx`, `frontend/app/screens/weekly-review.tsx` | Çoklu cihaz yarış testi hermetik store/repo simülasyonunda doğrulandı; fiziksel 2-cihaz testi F5/F6'da `BLOKE`/`N/R` olarak izleniyor | **GEÇTİ** («Bugün planım dağıldı» Koru -> Gör -> Uygula + receipt Undo doğrulandı) |
| `F5` | `955db95a` | `Y04`, `Y05`, `E07`, `E12`, `E13`, `E14`, `U06`, `U07`, `U08`, `U09`, `U11` | Windows Node 24 + Playwright Web (`mobile-375`, `reduced-motion-375`) + GitHub CI (`Postgres 17`, `Deno 2`, `tz-matrix`) | `f5f7NativeReliability`, `f5f7AccessibilityAndStates`, `f5ObservabilityAndAnalytics`, `oneYearScaleBudget` (`p95 < 150ms`), `e2e:web`, `expo-doctor` yeşil | `OBSERVABILITY_RUNBOOK.md`, `routineCuePolicy.ts`, `screenStateContract.ts`, `MeasurableInputModal.tsx`, `oneYearScaleBudget.test.ts` | Gerçek fiziksel Android/iPhone donanımı (`Y05`/`U08`) ve canlı Sentry DSN (`Y04`) operatör ortamında `BLOKE` | **GEÇTİ** (Hermetik/Web/CI güvenilirlik, erişilebilirlik ve ölçek bütçesi tamam) |
| `F6` | `955db95a` | `Y12` + `PILOT-01..05` | Hermetik simülasyon + Operatör pilot hazırlık kiti | `f5f6PilotAndScaleReadiness.test.ts`, `evaluationFreeze.test.ts`, `acceptanceReport.test.ts` yeşil | `docs/implementation-v3/PILOT_EXECUTION_KIT.md`, `R11_USER_ROUNDS_PLAN.md`, `R11_CORE_CLOSURE.md` | Gerçek insan katılımlı 2 tur (`5–8 × 2`) pilot (`Y12`) ve canlı DB/Edge/mağaza kapıları (`Y01..Y05`) operatör yetkisinde `BLOKE` / `N/R` | **KOŞULLU / CANLI YAYIN BLOKE** (Bkz. §6 Go/No-Go Kararı) |
| `F7` | `955db95a` | `E15`, `E16`, `E17`, `E18`, `U12`, `U13`, `U14`, `U15`, `P05`, `P06` | Windows Node 24 / RTL & Jest hermetik doğrulama | `f7ExperimentsAndAdapters.test.ts`, `f5f7NativeReliability.test.ts`, `f5f7AccessibilityAndStates.test.tsx`, `scopeAddendum.test.ts` yeşil | `calendarBusyAdapter.ts`, `importPreviewAdapter.ts`, `calmProgress.ts`, `calendar.tsx`, `achievements.tsx`, `focusRitual.ts` | `GOOGLE_CALENDAR_INTEGRATION_ENABLED = false` korunur; pilot verisi oluşana dek dış takvim OAuth açılmaz | **GEÇTİ** (Tüm deneyler kapalı bayrak / dar opt-in ve geri dönüş yoluyla doğrulandı) |

---

## 6. Yazılı Go / No-Go Kararı, Geri Dönüş Sorumlusu ve Kapanış Kontrolü (§9 & §14)

- **Yayın Kararı (Go / No-Go):**
  - **Depo Kodu ve Hermetik CI / Web E2E / Postgres 17 / Deno 2 / 4-Saat-Dilimi Matrisi:** **GEÇTİ (`GO` — İç Staging ve Pilot Hazırlığına Uygun)**
  - **Canlı Mağaza (App Store / Google Play) Yayını:** **BLOKE (`NO-GO` — Açık Operatör P0 Canlı Kapıları Nedeniyle Ürün «Yayına Hazır» İlan Edilmez)**
    - Açık operatör P0 kapıları: `Y01` (canlı `kbcuolhjjnmhjaarxxmu` salt okunur katalog + `028..045` kademeli rollout + `verify-edge-deployment.mjs`), `Y02` (`042` genişletme -> istemci uyumu -> `039` daraltma), `Y03` & `Y13` (canlı Privacy/Support/Delete HTTPS URL 200 + Apple/Play imzalı iç test kurulumu), `Y04` (canlı `EXPO_PUBLIC_SENTRY_DSN`), `Y05` (fiziksel Android + iPhone düşük ağ/OS-kill testi), `Y12` (`5–8 × 2` gerçek kullanıcı pilot turları).
- **Geri Dönüş (Rollback) ve İleri Düzeltme Sorumlusu:**
  - **Veritabanı (`028..045`):** Proje Sahibi / Operatör + `DATA` (`OWNER_ROLLOUT_QUICKSTART.md` ve `SQL_FOR_OWNER.md` §12 RPO/RTO matrisi; veri taşıyan tablolarda varsayılan yol ileri düzeltmedir, `aderyth.rollback_confirm` korumalı down betikleri yalnız doğrulanmış pencerede çalıştırılır).
  - **İstemci / Bayraklar (`featureGates.ts`) ve Dağıtım Durdurma (Canary Halt):** Proje Sahibi / Operatör + `REL` (`RELEASE_CHECKLIST.md` ve `OBSERVABILITY_RUNBOOK.md` uyarınca P0 hesap izolasyonu, `xp_drift() != 0` veya tahsilat/iade farkında dağıtım anında durdurulur).

### §14 İşi Kapatma Kontrol Listesi

- [x] Her iş bir owner, faz, kaynak ve kabul senaryosuna bağlı (`53/53` iş + `15/15` rakip farkı yukarıda kayıtlı).
- [x] Bağımsız worktree patch’leri ortak dosyaları çakıştırmadan birleşti (F1+F2, F3+F4 W2A, F3+F4 W2B ve F5+F6+F7 W3 sıralı birleştirildi; açık PR ve yetim worktree `0`).
- [x] Testler aday commit üzerinde çalıştı. `BLOKE` ve `N/R` sonuçları görünür (`Kod`/`CI` ile `Staging`/`Cihaz`/`Canlı` sütunları ayrıldı).
- [x] İlk eylem («Nereden başlayacağımı bilmiyorum» — `LEAF-01..06`) ve aynı gün toparlanma («Bugün planım dağıldı: Koru → Gör → Uygula» — `REC-01..06`) senaryoları normal kullanıcı yolunda denendi.
- [x] Şema (`028..045`), imzalı binary önkoşulları, Edge sürümü ve mağaza kanıt durumu aynı yayın kaydında (`PLAYBOOK_EXECUTION_LEDGER.md` + `RELEASE_CHECKLIST.md` + `SQL_FOR_OWNER.md`).
- [x] Opsiyonel işler (`F7`) dar opt-in / kapalı bayrak altında doğrulandı veya açık karar kaydıyla kapsam dışı (`KAPSAM DIŞI`) bırakıldı.
- [x] Üretime geçiş kararı (`Canlı Yayın BLOKE`) ve geri dönüş sorumlusu kayıtlı.
