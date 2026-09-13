# R00 — Fark Envanteri (Implementation v3.0)

**Baseline:** `origin/main = 0ff1c74b0d8d922fd9bef46d3631a1cf443677e2` · rehber
commit'i `ecfd4e3` (`docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md`, byte-birebir).
**Kapsam otoritesi:** `docs/plan/21_KAPSAM_EKI_2026-09-13.md` (daha yeni owner
kararı yok). **Tarih:** 2026-09-13. **Yöntem:** her satır güncel `main`'den
okunan kodla kanıtlanır; dosya adının varlığı PASS sayılmaz. Kanıt sınıfı
aksi yazılmadıkça `OBSERVED_SOURCE`.

## R00.01 — Repo gerçekliği

| Alan | Değer |
|---|---|
| HEAD / origin/main | `0ff1c74` (aynı) · branch `main` · working tree temiz (yalnız `docs/22_…` adlı **untracked** kopya — owner'ın bıraktığı, `docs/plan/22_…` ile byte-birebir; dokunulmadı) |
| Runtime | Node **v26.3.0** (CI: Node 22 LTS — fark kayıtlı), npm 11.16.0, lockfileVersion 3, `packageManager npm@11.16.0` |
| Expo / RN / React | `expo ~57.0.22` (CLI 57.0.24), `react-native 0.86.3`, `react 19.2.3`, `expo-router ~57.0.21` |
| Diğer | `zustand ^5.0.10`, `@sentry/react-native ~7.11.0`, `@supabase/supabase-js ^2.107.0`, `@react-native-async-storage/async-storage ^2.2.0`, `expo-notifications ~57.0.18`, `date-fns ^4.1.0`; **`expo-sqlite` yok** |
| Test/tool | TypeScript 6.0.3, jest 29.7 + jest-expo 57.0.5, eslint 9.25; EAS CLI 24.3.0 |
| Scripts | `typecheck`, `typecheck:ci`, `lint`, `lint:ci`, `test`, `run-tests.js` (145 yapısal kontrol), `start/android/ios/web` |
| Repo-local talimat | Kök `CLAUDE.md`/`AGENTS.md` **yok**; `.claude/settings*.json`, `.codex/config.toml`, `.claude/skills/*` (10 skill), `.agents/skills/{supabase,supabase-postgres-best-practices}` |
| Skill manifesti | `docs/skills/00_SKILL_MANIFEST.md`: 10 skill, hepsi **"Validated on one task"**, 0 "Applied project-wide" — rehberin §4 uyarısıyla uyumlu: dosya var, proje geneline uygulanmış değil |
| Cihaz erişimi | `adb`/`emulator` yok, `ANDROID_HOME` yok, Windows (iOS simülatörü imkânsız). Development build/EAS internal APK erişimi var (`validation` profili). Fiziksel cihaz profiling D07 |

## R00.02 — R01–R11 eşleme (REUSE / EXTEND / NEW / DEFERRED)

Sütunlar: UI giriş · store · service · repository · kalıcılık · şema · testler ·
**mevcut user-facing davranış** · **eksik davranış** · sınıf.

### R01 — Hedef, takvim, kayıt, geçmiş → **EXTEND**

- **UI:** `app/tabs/habits.tsx`, `screens/habit-detail.tsx`, `components/HabitOnboarding.tsx` (oluşturma: `kind daily|weekly|monthly`, `days`, `count`, `part_of_day`), `screens/{weekly,monthly}-review.tsx`, `screens/insights.tsx`, `screens/recovery.tsx`.
- **store/service/repo:** `habitStore` → `habitService` → `habitRepository`; loglar `logStore` → `habitLogService` → `habitLogRepository`.
- **Kalıcılık/şema:** `habits.frequency_config` **jsonb** (kısıtsız), `type`, `tracking_type` (4 değer, migration 005), `unit`, `daily_goal`, `target_direction`, `status ∈ active|waiting|paused|completed|archived|idea`. `habit_logs` günde bir satır (UNIQUE habit_id+date). **`timezone` / `week_start` kolonu yok** — yerel gün `lib/date.ts` ile cihazdan türer.
- **Domain:** `lib/habitSchedule.ts` (441 satır): `isDueOn`, `weekdayIndex`, `countDueDays` (gizli), **V2 pencere değerlendiricisi** `scheduleKind`/`windowFor`/`isWindowSatisfied`/`streakBroken`, `scheduledCompletionRate`, `isMissedOn`, `countsTowardAverage`. `lib/habitEngine.ts` (`completionFor`/`deriveState`, ceiling), `lib/habitStrength.ts`, `lib/reportMetrics.ts`, `lib/behaviorIntelligence.ts`.
- **Testler:** `__tests__/lib/habitSchedule.test.ts`, `phase1Adversarial.test.ts` (pencere fonksiyonları dahil), `ceilingSemantics`, `habitEngine`, `habitStrength`.
- **Mevcut davranış:** günlük ve sabit-gün haftalık takvim doğru; ölçülebilir hedef + `at_least/at_most` + kısmi kayıt + negatif alışkanlık asimetrisi (`isMissedOn`) çalışıyor; skip cezasız.
- **Eksik / kusur (kanıtlı):**
  1. **Haftalık sayı (`count`) hâlâ sabit gün dağılımı:** `isDueOn` → `countDueDays(3)` = `[0,2,5]` (Pzt/Çar/Cmt). Salı/Perşembe/Pazar yapan kullanıcı, `isDueOn` tüketen her yerde 3 "kaçırma" alır (`habitSchedule.ts:52-56, 74-82`).
  2. **Aylık:** `isDueOn` bilinçli `false` (`:57-61`); `scheduledCompletionRate` için aylık alışkanlık `dueDays=0`, oran 0.
  3. **Pencere değerlendiricisinin üretimde tüketicisi yok:** `windowFor`/`isWindowSatisfied`/`streakBroken`'ı çağıran tek yer `lib/supabase.ts:28` yorumu ve testler. Tüm gerçek tüketiciler `isDueOn`: `weekly-review.tsx:104`, `monthly-review.tsx:113`, `insights.tsx:104,324`, `recovery.tsx:95,116`, `reportMetrics.ts:124`, `behaviorIntelligence.ts:228,290,355,396`, `capacity.ts:464,519` (mastery, `scheduledCompletionRate` üzerinden).
  4. **Bugün ekranı takvimi hiç sormuyor:** `app/tabs/today.tsx:64` `habits.filter(status==='active')` — Pzt/Çar alışkanlığı Salı "kalan adım" sayılır; `habitPct` paydası tüm aktifler.
  5. §7.1 çıktı sözleşmesi (`not_started|in_progress|satisfied|closed_unmet|paused|unknown`, kalan miktar, gerekçe) **yok**; "gün / oturum / miktar" ayrımında **oturum** kavramı yok (günde bir log değişmezi = gün sayımı).
  6. Checklist / alt adım **yok** (`checklist|subStep|habit_steps` → 0 sonuç). Tatil modu **yok**; `status:'paused'` var ama payda/bildirim etkisi tanımsız.
  7. Hedef sürümleme (etkin tarihli) **yok** — hedef değişimi geçmişi yeniden puanlar.
  8. `interval_days`/`range_*`: tip var, DB jsonb kabul eder; **istemci validator'ı reddediyor** (`routineProposal.ts ALLOWED_FREQUENCY_KEYS`). `lib/supabase.ts:30` ve `habitSchedule.ts` "migration bloklu" yorumları **bayat** — engel şema değil, `isDueOn`'un bu alanları okumaması.

### R02 — Kalıcı veri ve senkronizasyon → **EXTEND** (log kuyruğu) / **NEW** (genel outbox)

- **Mevcut:** `lib/syncQueue.ts` (403 satır) — **yalnız habit log** niyetleri (`HabitLogIntent`), hesap-bazlı anahtar `atlas_sync_queue_v1`+userId, `MAX_ATTEMPTS`, artan bekleme (`nextRetryDelayMs`), `markSynced/markFailed`, `orderedPending`, dead sayımı; `logStore.hydrateSyncQueue/flushPendingSync` boot + AppState'te replay (`app/_layout.tsx`); hesap izolasyonu ve lossless göç (IMPLEMENTATION_V2 §23/§27 PASS). Testler: `store/logStoreOfflineSync`, `store/syncQueue*`, `repo/syncLifecycleWired`.
- **Eksik:** görev, checklist, günlük/review, rutin/odak, ayar yazmaları **doğrudan** Supabase (kuyruksuz) → offline'da kayıp/hata; `operationId`+`expectedVersion` zarfı yok; tombstone/geç-edit politikası yok; ilişkisel yerel depo yok (`expo-sqlite` kurulu değil — aday, zorunlu değil); iki cihaz çatışma politikası yok. Sunucu tarafı idempotency yalnız AI isteklerinde (`ai_requests` request-id) — habit log için `UNIQUE(habit_id,date)` upsert tek etki sağlar.

### R03 — Bugün, küçük başlangıç, kapasite, telafi → **EXTEND**

- **Mevcut:** `app/tabs/today.tsx` (editöryel hero/metrik/Sırada, `RecoveryRailCard`, `components/today/*`), `lib/todayNarrative.ts`; **kapasite** `lib/capacity.ts` (dailyLoad, bantlar, `canActivate`, `masteryStatus`) + `capacityService` (`evaluateActivation/spend/refund`, `daily_capacity` tablosu) + `willpowerStore`; **recovery** `lib/recovery.ts` (`deficitFor`, **dört strateji** `complete_today|push_tomorrow|split_two_days|skip` — rehberin dört yoluyla birebir) + `recoveryService.completePlanWithMakeup` + `recovery_plans` (v2 sözlüğü, migration 025) + `screens/recovery.tsx`; `lib/starterPlan.ts` (onboarding başlangıç planı), `lib/taskDecomposition.ts` (AI alt görev böl, validator); `routinePacks.ts`.
- **Eksik:** **kullanıcı kontrollü yük seçimi ("bugün daha az")** yok (`hafif|lighter|reduceLoad` → 0); **küçük başlama eylemi** (işi seç → ilk adımı düzenle → başlat) UI'da yok — `taskDecomposition` AI önerisi var, "başlat" bağlantısı yok; recovery eksik-birim önizlemesinde **yeni gün yükü** gösterimi yok; recovery `isDueOn` üzerinden (R01 kusuru #1 buraya yansır); kapasite skorunun açıklaması UI'da kısa değil (R03.02).

### R04 — Hatırlatıcılar → **EXTEND**

- **Mevcut:** `lib/notifications.ts` (153 satır): `ensurePermission`, `scheduleHabitReminder` (**tek `DAILY` trigger**, `:82`), `scheduleRecoveryReminder` (`DATE`), `cancel*`, `syncAllReminders`; `habit_reminders` tablosu; yerel bildirim, push yok (doğru).
- **Eksik:** takvim motoru tüketimi yok (Pzt/Per alışkanlığı her gün hatırlatılır), çoklu saat/gün grubu/erteleme/sessiz saat yok, bildirimden eylem (tamamla/ertele/atla) yok, pause/tamamlanan dönemde uzlaştırma yok, OS bekleyen limit/DST temizliği yok.

### R05 — Rutin yürütme ve odak → **NEW** (runner) / **EXTEND** (odak)

- **Mevcut:** `routineStore/routineService/routineRepository` = **AI rutin önerisi ve kurulum** (`installProposal`), `routines`+`routine_items` tabloları; `focusStore` (Pomodoro `DURATIONS`, `FocusSettings` AsyncStorage `focus.settings.v1`, `FocusTask`, `completeWorkPhase` → `focus_sessions`), `deepWorkStore` (`deep_work_sessions`), `app/tabs/focus.tsx`, `screens/deep-work.tsx`, `components/focus/*`, `lib/focusReport.ts`.
- **Eksik / kusur (kanıtlı):** **adım adım runner yok** (`runner|currentStep|routine_sessions` → 0). Odak zamanlayıcı: `tick()` `setInterval` ile saniye düşürür; `start()` **resume'da da** `sessionStartedAt`'i yeniden damgalar (`focusStore.ts:220`) → pause+devam sonrası önceki aktif segment kaybolur; `completedSeconds = now − sessionStartedAt` pause aralığını ayırmaz; **çalışan oturum kalıcı değil** (yalnız ayarlar AsyncStorage'da) → app kill oturumu yok eder. T11/T12 bugün geçmez. Sesli adım/titreşim rehberi yok.

### R06 — Sadelik, erişilebilirlik, mahremiyet → **EXTEND**

- **Mevcut:** `lib/tokens.ts` + `docs/DESIGN_TOKENS.md` (0 açıklanamayan magic renk), `components/ui/*` (Button, FloatingLabelInput, Skeleton, ErrorBoundary, EmptyState…), `useAccent`, `themeStore`, reduce-motion desteği (seasonalMotion), `accessibilityLabel/Role/State` yaygın; gizlilik ekranı; hesap silme.
- **Eksik:** Bugün'de **tek baskın "başla/devam et"** eylemi yok (metrik + rail + çoklu CTA); ortak form/önizleme/hata bileşeni checklist/recovery/review'de standart değil; a11y kanıtı yalnız kaynak (render ortamında odak sırası/kontrast/büyük yazı ölçülmedi — `N/R`); hassas içerik gizleme tercihi bildirimlere uygulanmıyor.

### R07 — Günlük, duygu, review → **EXTEND**

- **Mevcut:** `journalStore` (`saveEntry(date, content, mood:number|null)`, günde tek kayıt, `appendEntry`), `journal-archive/reader/insights` ekranları, `journalMoods` (sabit skala), `journalStats`, AI özet (`summarize` 3 FP), `journal_insights`; **review:** `reviewService` (`loadWeeklyReflection/saveWeeklyReflection`, monthly draft+final, `monthly_reviews` tablosu), `screens/{weekly,monthly}-review.tsx`; `behaviorIntelligence` (weekday, streak, fragility, trend, `recoverySuccessRate`, `morningEveningDifference`).
- **Eksik:** etiket/biçimlendirme/rutin bağlantısı yok; **özelleştirilebilir duygu tanımı** yok (sayısal skala), günde çoklu kayıt yok, sürümlü duygu kimliği yok; arama/etiket filtresi yok; **duygu–alışkanlık ilişkisi kartı yok**; review'de "gelecek hafta ne değişsin" **plana bağlı eylem yok** (`weekly-review.tsx` yansıma metni kaydeder, R01/R03 komutuna gitmez); çevrimdışı taslak yok.

### R08 — Tam yedek, restore, taşıma → **NEW** (restore/import) / **REUSE** (export)

- **Mevcut:** `exportService.buildBackup/renderBackup` (JSON/CSV/Excel-XML), `EXPORT_FORMAT_VERSION`, `drain` sayfalama, webhook başlıkları hariç; test `repo/exportIsNotABackup` **restore'un bilinçli olarak olmadığını** pinler; hesap silme + cascade (47 FK) var.
- **Eksik:** restore/import akışı **yok**; manifest/checksum/ilişki haritası yok; dry-run yok; yerel rotasyon yok; genel CSV içe alma yok; XP/FP otorite kuralı (dosyadan yeniden yetki verilmemesi) tasarımda yok.

### R09 — Uygulama içi AI → **REUSE** / **EXTEND**

- **Mevcut (Step 11A.2.x, kapalı):** durable thread'ler (`ai_conversations/ai_messages`, `aiConversationStore/aiCoachService/aiConversationRepository`), zorunlu tool-use (`COACH_TOOL`), önerilen habit doğrulama (`routineProposal`/`coachActions`/`coachClarify`/`units`), onay kartı (`CoachActionCard`), FP tek etkisi (`spend_focus_points_v2`, request-id, lease — `023/024`), `withEdgeDeadline`. Testler: `aiCoachConversations`, `coachHabitSemantics`, `generateRoutine*` (edge), `aiIdempotency`, `aiRequestLeaseAndPrivileges`.
- **Eksik:** eylem listesi yalnız **alışkanlık oluştur/log** — hedef/saat düzenleme, pause, görevi taşı, küçük adım öner **yok**; `expectedVersion`'lı onay önizlemesi yok; "yorgunum" → yük azaltma önerisi yok; içgörü açıklaması R07'ye bağlı; günlük bağlamı kullanıcı kontrolü yok.

### R10 / R11 → süreç; **DEFERRED değil, R00 sonrası**

Gate/iptal guard'ları mevcut (`scopeAddendum`, `freeMvpReleaseShape`, `mvpIntegrationAvailability`, `layerBoundary`, `edgeCallDeadline`, `queryBounding`, `xpIsEarned`, …). Bağımsız reviewer yok (belge kendini onaylamaz).

## R00.06 — Kapsam guard'ları (bu oturumda çalıştırıldı)

| Guard | Kanıt |
|---|---|
| FREE MVP; Google/Notion/yeni Spotify OAuth; IAP/paywall; `PUBLIC_SITE_URLS_LIVE` | `featureGates.ts:59,119,120,178,222` beşi de `false`; `scopeAddendum` + `freeMvpReleaseShape` + `mvpIntegrationAvailability` **54/54** |
| Widget / Watch / Live Activity | bağımlılık yok, managed workflow (`/ios/`,`/android/` gitignore) — guard'da |
| Sentry runtime smoke | `main`'de smoke kodu yok (`eas.json`'da `sentry-smoke` 0); iş `sentry-runtime-smoke-deferred` yerel branch'inde (D07) |
| RPG/pet/garden · finans · klinik/canlı video | istemcide yok (guard); sunucu RPG kalıntısı uyuyor, dokunulmadı |

Hiçbir gate açılmadı.

## R00.07 — Efor ölçüm zemini

R00'un kendi ölçümü (tek yazıcı, çakışan preview yok): rehber kopyası+commit
22:02 → keşif+doğrulama 22:14 → belge yazımı ~22:35 (≈33 dk; erişim
beklemesi 0). İlk üç kartın **geliştirme / test / düzeltme** süreleri
`STATE.md › timing` altında ayrı ayrı yazılacak; kart yürütülmeden tahmin
verilmez.

## Tamamlanma hesabı (R00 sonu)

CORE kabul kartı sayısı R01'in ilk alt kartları çözüldükçe sabitlenecek;
**bu turda 0/… tamamlanmış kart**, kritik açık kusur 0 (bilinen kusurlar
kartlara bağlı, veri kaybı/erişim/FP kusuru yok). DEFERRED: D01–D09 ayrı.
