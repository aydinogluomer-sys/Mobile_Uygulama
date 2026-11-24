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
| `P3` | Takvimde doğrudan blok düzenleme | Mevcut planın ikinci giriş biçimi; sürüklemeye erişilebilir «Saati değiştir» düğmesi eşlik eder, aynı preview/commit/undo hattını kullanır | `F7` · `U12` | Planlandı (`F7`) |
| `P4` | Birden çok aksayan blok | Hafif Gün ve Telafi'ye bağlı, onaylı 3 adımlı («Koru → Gör → Uygula») yeniden planlama ve geri alma | `F4` · `E02`, `E03`, `U05` | Planlandı (`F4`) |
| `A2` | Göreve özgü AI alt adımı | Tek başlatılabilir mikro adım + yerel `taskDecomposition.ts`/`smallStart.ts` fallback | `F3` · `E01`, `E11`, `U04` | Planlandı (`F3`) |
| `A3` | AI süre tahmini | Düzeltilebilir süre/aralık ve açık kaynak etiketi (`user`/`ai`/`block`/`default`/`none`); önce `E19` kalıcılığı | `F2` `E19` → `F3` `U04` | Planlandı (`F2–F3`) |
| `F4` | OS düzeyinde app blocker | MVP koşulu değil; ağır izin/platform bağımlılığı eklenmez, kısa odak başlangıç rehberi (`focusRitual.ts`) ile sınırlı opt-in deney | `F7` · `P06` | Dar kapsamlı opt-in (`F7`) |
| `G3` | Karakter/koleksiyon/ödül ekonomisi | RPG ekonomisi kapsam dışı; yargılamayan geri dönüş ve birikimli çaba görünürlüğü iyileştirilir | `F7` · `U13` | RPG `KAPSAM DIŞI`, geri dönüş `F7` |
| `I1` | Harici takvim | Yalnız salt okunur meşgul blokları adaptörü (`GOOGLE_CALENDAR_INTEGRATION_ENABLED = false` altında) | `F7` · `E16` | Bayrak altında adaptör (`F7`) |
| `I2` | Geniş görev/sağlık/otomasyon bağlantısı | MVP dışında; yalnız versiyonlu/kuru çalışmalı veri taşıma ve ithal önizleme sözleşmesi | `F7` · `E15` | Harici sağlık OAuth `KAPSAM DIŞI`, kuru ithal `F7` |
| `I3` | Çift yönlü takvim/görev senkronu | MVP dışında; dış takvime yazma yapılmaz, tek yön okuma sınırı korunur | `F7` · `E16` | Çift yön `KAPSAM DIŞI` |
| `I4` | Widget/saat/kilit ekranı | Tek eylem kimliği, dar yetki, gizli varsayılan metin ve ekran içi rutin sesi uyumu | `F7` · `E17`, `U14` | Tek-etki adaptörü (`F7`) |
| `S1` | Kayıtlı veya yapay eşlik | Kısa, kapatılabilir başlangıç rehberi (`focusRitual.ts`); ayrı sanal karakter yok | `F7` · `P06` | Planlandı (`F7`) |
| `S2` | Canlı body doubling | Ayrı moderasyon, gizlilik ve gerçek zamanlı operasyon gerektirir | — | **`KAPSAM DIŞI`** |
| `S3` | Yapılandırılmış öz bakım içeriği | Tam içerik kütüphanesi kapsam dışı; `routinePacks.ts` üzerinden tek adımla başlatılabilir kısa paketler | `F3` · `P03` | Planlandı (`F3`) |
| `S4` | Topluluk/bakım veren/hesap verebilirlik | Bireysel mahremiyet ve sakin geri dönüş odağı korunur | — | **`KAPSAM DIŞI`** |
| `S5` | İnsan koçluğu | Yalnız kullanıcı onaylı dijital eylem önerisi | — | **`KAPSAM DIŞI`** |

---

## 3. Mimari Rapordaki 53 İşin Eşleme ve Kanıt Matrisi (§13)

Durum etiketleri: `GEÇTİ` (doğrulandı), `KISMİ` (altyapı var, hedef fazda tamamlanacak), `YENİ` (hedef fazda yazılacak), `BLOKE` (canlı/konsol/cihaz yetkisi bekliyor), `N/R` (henüz ölçülmedi).

| İş ID | Faz | Öncelik | Rol | F0 Taban Durumu | Normal Giriş Noktası ve Test Kanıtı | Kod | CI | Staging | Cihaz | Canlı |
|---|---|---|---|---|---|---|---|---|---|---|
| `Y08` | F0 | P0 | LEAD | yenilendi | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `R11_CORE_CLOSURE.md`, `acceptanceReport.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `P02` | F0 | P1 | PRODUCT | yenilendi | `docs/implementation-v3/R11_USER_ROUNDS_PLAN.md`, `playbookFixtures.ts`, `playbookBaselineFixtures.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
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
| `E05` | F2 | P1 | SYNC | tamamlandı | `frontend/lib/outboxBench.ts`, `outboxStorage.ts`, `outboxResilienceAndSyncOutcomes.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E06` | F2 | P1 | SYNC | tamamlandı | `frontend/lib/syncOutcomes.ts`, `unifiedOutbox.ts`, `outboxResilienceAndSyncOutcomes.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E08` | F2 | P1 | DATA+SYNC | tamamlandı | `taskRepository.ts` (`getTaskSchemaCapability`), `database.types.ts`, `taskDurationPersistence.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `E09` | F2 | P1 | PRODUCT | tamamlandı | `habitSchedule.ts`, `capacityMetricsContract.ts`, `taskDurationAndDayContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E10` | F2 | P1 | PRODUCT | tamamlandı | `capacity.ts`, `capacityMetricsContract.ts`, `taskDurationAndDayContract.test.ts` | `GEÇTİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E19` | F2 | P1 | DATA+SYNC+PRODUCT | tamamlandı | `045_task_estimated_minutes.sql`, `taskRepository.ts`, `taskDuration.ts`, `taskDurationPersistence.test.ts` | `GEÇTİ` | `GEÇTİ` | `BLOKE` | `N/R` | `BLOKE` |
| `E01` | F3 | P1 | PRODUCT | yeni | `frontend/lib/actionSuggestion.ts`, `todayNext.ts` (`ActionSuggestion` discriminated union) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `E11` | F3 | P1 | AI | kısmi | `frontend/lib/aiFirstStepAdapter.ts`, `coachActionsV2.ts` (şema doğrulamalı tek adım + yerel fallback) | `KISMİ` | `N/R` | `BLOKE` | `N/R` | `BLOKE` |
| `U01` | F3 | P1 | UI | kısmi | `frontend/app/tabs/today.tsx`, `NextUpStrip.tsx` (tek baskın CTA + kısa gerekçe + `<= 8` kontrol) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U02` | F3 | P1 | UI | kısmi | `frontend/store/onboardingStore.ts`, `app/onboarding/` («örnek adımı dene» / «kendi işimi ekle», izin erteleme) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U03` | F3 | P1 | UI | kısmi | `frontend/lib/todayNarrative.ts`, `locales/tr.json` («Bugün ne kadarı sığar?», «Yükü hafiflet») | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U04` | F3 | P1 | UI | kısmi | `frontend/components/SmallStartSheet.tsx`, `smallStart.ts` (metin/dikte/şablon/AI ortak onay ve odak başlatma) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `P03` | F3 | P1 | PRODUCT | kısmi | `frontend/lib/routinePacks.ts`, `starterPlan.ts` (tek adımla denenebilir kısa başlangıç paketleri) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `E02` | F4 | P1 | PRODUCT | yeni | `frontend/lib/dayPlanPreview.ts` (`DayPlanPreview`, sabit randevu koruma, sürüm/tazelik kontrolü) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `E03` | F4 | P1 | SYNC | kısmi | `frontend/services/dayPlanCommitService.ts` (`operationId`, kısmi başarıda yalnız kalanı deneme, receipt undo) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U05` | F4 | P1 | UI | yeni | `frontend/components/today/DayReplanSheet.tsx`, `app/screens/recovery.tsx`, `today.tsx` («Koru → Gör → Uygula») | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U10` | F4 | P1 | UI | kısmi | `frontend/app/screens/weekly-review.tsx`, `reviewActions.ts` («Bu hafta ne işledi?» + «Bir küçük ayar») | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `P01` | F4 | P1 | PRODUCT | yeni | `frontend/lib/dayPlanPreview.ts` (`16:00` sabit randevu + korunan iş + yük farkı senaryosu) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `P04` | F4 | P1 | PRODUCT | kısmi | `frontend/lib/recovery.ts`, `dayPlanPreview.ts` («telafi etme» ve gerçek eksik miktar koruma) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `Y04` | F5 | P0 | REL | kısmi | `frontend/lib/sentryClient.ts`, `crashReporting.ts`, `OBSERVABILITY_RUNBOOK.md` (PII scrub + müdahale) | `KISMİ` | `N/R` | `BLOKE` | `N/R` | `BLOKE` |
| `Y05` | F5 | P0 | QA | canlı/cihaz açık | `docs/implementation-v3/R02_OFFLINE_MATRIX.md`, simüle kesinti testleri (fiziksel cihaz `BLOKE`/`N/R`) | `KISMİ` | `N/R` | `N/R` | `BLOKE` | `N/R` |
| `E07` | F5 | P1 | NATIVE | mevcut / genişletilecek | `frontend/lib/focusTimer.ts`, `routineRunner.ts` (kesinti, saat kayması, hesap değişimi matrisi) | `KISMİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E12` | F5 | P1 | QA | kısmi | `docs/QUERY_BOUNDING_MATRIX.md`, `oneYearScaleBudget.test.ts` (1 yıl sentetik veri p95 bütçesi) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `E13` | F5 | P1 | REL | kısmi | `frontend/lib/analytics.ts`, `analyticsNoFreeText.test.ts` (opt-in kapalı allowlist olayları) | `KISMİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E14` | F5 | P1 | NATIVE | kısmi | `frontend/services/reminderService.ts` (`dayKey+targetId+channel` idempotent mutabakat, sessiz saat) | `KISMİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U06` | F5 | P1 | NATIVE | kısmi | `frontend/app/screens/routine-runner.tsx` (atlanan vs tamamlanan adım ayrı ikon/etiket, a11y sayaç) | `KISMİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U07` | F5 | P1 | NATIVE | kısmi | `frontend/store/focusStore.ts`, `FocusReportModal.tsx` (erken bitirmede gerçek süre + görev açık kalır) | `KISMİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U08` | F5 | P1 | UI | kısmi | `docs/implementation-v3/R06_ACCESSIBILITY.md`, Playwright `reduced-motion-375`, a11y testleri | `KISMİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `U09` | F5 | P1 | UI | kısmi | `docs/implementation-v3/R06_SCREEN_STATES.md`, `frontend/lib/screenStateContract.ts` (form metni koruma + durum ayrımı) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U11` | F5 | P1 | UI | kısmi | `frontend/app/screens/habit-detail.tsx`, `MeasurableInputModal.tsx` («1,5 L», «haftada 3», kayıt öncesi etki) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `Y12` | F6 | P0 | QA | yürütme açık | `docs/implementation-v3/R11_USER_ROUNDS_PLAN.md`, `PILOT_EXECUTION_KIT.md` (5–8 × 2 gerçek insan turu `N/R`) | `KISMİ` | `N/R` | `N/R` | `BLOKE` | `N/R` |
| `E15` | F7 | P2 | SYNC | kısmi | `docs/implementation-v3/R08_BACKUP_PROTECTION.md`, `backupService.ts` (kuru çalışma + harici ithal önizleme) | `KISMİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `E16` | F7 | P2 | SYNC | yeni (kapalı bayrak) | `frontend/lib/calendarBusyAdapter.ts`, `featureGates.ts` (`GOOGLE_CALENDAR_INTEGRATION_ENABLED = false`) | `YENİ` | `N/R` | `N/R` | `N/R` | `KAPSAM DIŞI` |
| `E17` | F7 | P2 | NATIVE | kısmi | `frontend/lib/notificationActions.ts` (çoklu yüzeyden tek eylem kimliği / gizli varsayılan metin) | `KISMİ` | `GEÇTİ` | `N/R` | `BLOKE` | `N/R` |
| `E18` | F7 | P2 | UI | mevcut / doğrulama | `frontend/lib/destinations.ts` (ortak rota kataloğu ve tek mutasyon yolu) | `KISMİ` | `GEÇTİ` | `N/R` | `N/R` | `N/R` |
| `U12` | F7 | P2 | UI | kısmi | `frontend/app/screens/calendar.tsx` («Saati değiştir» erişilebilir blok düzenleme → ortak preview/undo) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U13` | F7 | P2 | PRODUCT | kısmi | `frontend/app/screens/achievements.tsx`, `frontend/lib/calmProgress.ts` (yargılamayan geri dönüş ve birikimli çaba) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `U14` | F7 | P2 | NATIVE | kısmi | `frontend/app/screens/routine-runner.tsx`, `routineCuePolicy.ts` (sessiz saat, gizli başlık ve ekran okuyucu uyumu) | `KISMİ` | `N/R` | `N/R` | `BLOKE` | `N/R` |
| `U15` | F7 | P2 | PRODUCT | yeni | `frontend/lib/todayNext.ts` (çoklu gecikmede kapatılabilir tek adımlık geri dönüş ipucu) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `P05` | F7 | P2 | PRODUCT | yeni | `frontend/lib/capacity.ts` (`n >= 5` örneklem eşikli, sıfırlanabilir, opt-in süre kalibrasyonu) | `YENİ` | `N/R` | `N/R` | `N/R` | `N/R` |
| `P06` | F7 | P2 | NATIVE | kısmi | `frontend/lib/focusRitual.ts` (kapatılabilir kısa başlangıç rehberi; OS blocker paketi eklenmez) | `KISMİ` | `N/R` | `N/R` | `N/R` | `N/R` |

---

## 4. Tek Yazan Dosya Tahsisi Kaydı (§1.1)

| Faz | Owner | Dosya / Alan | Temel SHA | Okuyucular | Merge Sırası |
|---|---|---|---|---|---|
| `F0` | `LEAD` | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `docs/implementation-v3/R11_CORE_CLOSURE.md`, `docs/implementation-v3/R11_USER_ROUNDS_PLAN.md`, `frontend/__tests__/helpers/playbookFixtures.ts`, `frontend/__tests__/lib/playbookBaselineFixtures.test.ts` | `56577e90` | `ALL` | `1 (LEAD)` |
| `F1+F2` | `DATA` | `supabase/migrations/045_task_estimated_minutes.sql`, `supabase/rollbacks/045_task_estimated_minutes.rollback.sql`, `supabase/tests/13_task_estimated_minutes_045.sql`, `supabase/migrations/README.md`, `supabase/rollbacks/README.md`, `docs/implementation-v3/SQL_FOR_OWNER.md`, `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md`, `tools/verify-owner-rollout-readiness.mjs`, `frontend/lib/database.types.ts`, `frontend/__tests__/repo/ownerRolloutReadiness.test.ts` | `72b93457` | `SYNC, REL, QA` | `1 (DATA)` |
| `F1+F2` | `SYNC` | `frontend/lib/taskTypes.ts`, `frontend/repositories/taskRepository.ts`, `frontend/services/taskService.ts`, `frontend/lib/syncOutcomes.ts`, `frontend/services/unifiedOutbox.ts`, `frontend/lib/outboxBench.ts`, `frontend/__tests__/repo/taskDurationPersistence.test.ts`, `frontend/__tests__/lib/outboxResilienceAndSyncOutcomes.test.ts` | `72b93457` | `DATA, PRODUCT, QA` | `2 (SYNC)` |
| `F1+F2` | `PRODUCT` | `frontend/lib/taskDuration.ts`, `frontend/lib/dayBoundaryContract.ts`, `frontend/lib/capacityMetricsContract.ts`, `frontend/__tests__/lib/taskDurationAndDayContract.test.ts` | `72b93457` | `SYNC, UI, QA` | `3 (PRODUCT)` |
| `F1+F2` | `REL+AI` | `docs/store/RELEASE_CHECKLIST.md`, `docs/implementation-v3/AI_RETENTION_AND_PROVIDER_CONTRACT.md`, `frontend/__tests__/repo/f1ReleaseAndAiContract.test.ts` | `72b93457` | `DATA, QA, LEAD` | `4 (REL+AI)` |
| `F1+F2` | `QA` | `frontend/__tests__/fixtures/f1f2IndependentAcceptance.test.ts` | `72b93457` | `LEAD` | `5 (QA)` |

---

## 5. Faz Kapanış Tablosu (§1.2)

| Faz | Aday commit | İş ID’leri | Ortam / cihaz | Komut ve sonuç | Kanıt URI veya path | Sapma / risk | Karar |
|---|---|---|---|---|---|---|---|
| `F0` | `72b93457` | `Y08`, `P02` | Windows Node 24 / npm 11 yerel doğrulama + GitHub CI referansı (`45365712434`) | `verify-owner-rollout-readiness.mjs` (0), `typecheck:ci` (0), `lint:ci` (0), `run-tests.js` (147/147), `jest` F0 paketleri (8/8 suite, 46/46 test) yeşil | `docs/implementation-v3/PLAYBOOK_EXECUTION_LEDGER.md`, `frontend/__tests__/helpers/playbookFixtures.ts`, `frontend/__tests__/lib/playbookBaselineFixtures.test.ts` | Canlı Supabase katalog sorgusu ve fiziksel cihaz erişimi operatör yetkisinde (`BLOKE`) | **GEÇTİ** (Taban kilitlendi; F1 ve F2 açıldı) |
