# Implementation v3 — STATE

```yaml
implementation_version: 3.0
baseline_sha: 0ff1c74b0d8d922fd9bef46d3631a1cf443677e2
guide_commit: ecfd4e3            # docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md, verbatim
scope_authority: docs/plan/21_KAPSAM_EKI_2026-09-13.md
newer_owner_decision: none        # 2026-09-13
completed_cards: [R00.01, R00.02, R00.03, R00.04, R00.05, R00.06, R00.07, R01.01-a]
active_card: null
next_ready_card: R01.02-a
critical_open_defects: []         # bilinen kusurlar kartlara bağlı; veri kaybı / hesap erişimi / FP kusuru yok
known_defects_bound_to_cards:
  - id: KD-01
    where: frontend/lib/habitSchedule.ts:52-56,74-82
    what: weekly `count` -> sabit gün dağılımı (countDueDays); Sal/Per/Paz kullanıcıya sahte 3 kaçırma. periodStatus (R01.01-a) doğru cevabı veriyor; isDueOn ve tüketiciler henüz değil
    card: R01.02-a
  - id: KD-02
    where: frontend/app/tabs/today.tsx:64
    what: Bugün takvimi sormuyor; tüm aktif alışkanlıklar "kalan" sayılır
    card: R01.06 / R03.01
  - id: KD-03
    where: frontend/store/focusStore.ts:220,257
    what: resume `sessionStartedAt`'i yeniler; pause ayrılmaz; oturum kalıcı değil
    card: R05.03
  - id: KD-04
    where: frontend/lib/notifications.ts:82
    what: tek DAILY tetik; takvim tüketilmiyor
    card: R04.01
  - id: KD-05
    where: frontend/lib/supabase.ts:30, frontend/lib/habitSchedule.ts (V2 başlığı)
    what: "migration bloklu" yorumları bayat — DB jsonb; engel istemci validator'ı
    card: R01.02-b (yorum düzeltmesi tüketici geçişiyle)
deferred_ids: [D01, D02, D03, D04, D05, D06, D07, D08, D09]
cancelled_ids: [X01, X02, X03]
core_implementation: IN_PROGRESS
core_quality: NOT_MEASURED
release_readiness: DEFERRED
evidence_locations:
  - docs/implementation-v3/R00_GAP_INVENTORY.md
  - docs/implementation-v3/R00_CORE_JOURNEY_MAP.md
  - docs/implementation-v3/R00_TEST_MATRIX.md
  - docs/implementation-v3/STATE.md#r0101-a-evidence
gates_run_at_baseline:
  typecheck_ci: 0 errors
  lint_ci: 0 warnings
  jest_ci: 131 suites / 2056 tests
  run_tests_js: 145/145
  scope_guards: 54/54
timing:                           # R00.07 — dev / test / fix ayrı; erişim beklemesi ayrı
  R00: { dev_min: 21, test_min: 12, fix_min: 0, access_wait_min: 0, single_writer: true }
  R01.01-a: { dev_min: 25, test_min: 20, fix_min: 10, access_wait_min: 0, single_writer: true }
  R01.02-a: { dev_min: null, test_min: null, fix_min: null }
  R01.02-b: { dev_min: null, test_min: null, fix_min: null }
```

## R01.01-a evidence

- **Branch:** `feature/r01-period-status` (from `897dee3` = origin/main)
- **Files:** `frontend/lib/habitSchedule.ts` (+274, additive: `periodStatus`, `PeriodStatus`, `PeriodUnit`, `PeriodStatusKind`, `PeriodReason`, `PeriodStatusOptions`, private `oneLogPerDay`/`amountTarget`/`unknownStatus`); `frontend/__tests__/lib/habitPeriod.test.ts` (new, 35 tests). `frontend/lib/supabase.ts` **untouched** — every input already exists (`tracking_type`, `daily_goal`, `target_direction`, `status`, `frequency_config`, `HabitLog.value`).
- **Reused, not rewritten:** `scheduleKind`, `windowFor`, `completedCountInWindow`, `dueOnExtended` (private), `ymd`, `daysBetweenLocal`; engine `state` for amount verdicts.
- **Divergences made visible in tests (not fixed here):** `isDueOn` fixed-day mapping for weekly count (T01); `isDueOn` false for monthly (T03); `isWindowSatisfied` counts rows not days (3 same-day rows → satisfied vs evaluator `in_progress`); `streakBroken` says broken where evaluator says `in_progress`/`unreachable_in_remaining_days` (complementary).
- **Basis stated in every result:** `{ timezone: 'device-local', weekStart: 'monday' }` — no per-habit column exists.
- **Mutation proof:** (1) feed raw rows to the counter → 4 cases red; (2) open count period → `closed_unmet` → 7 cases red. Both reverted; tree green.
- **Gates:** focused 8 suites 263/263 · `typecheck:ci` 0 · `lint:ci` 0 · full `jest --ci` **132/2091** (two consecutive runs; one earlier parallel run showed 3 suites red, not reproduced, names not captured — recorded as an unexplained flake next to the repo's standing worker-exit warning) · `run-tests.js` 145/145 · `git diff --check` clean.
- **Consumer behaviour changed:** none. **Data/schema impact:** none.

## Paket sınıflandırması (R00.02 özeti)

| Paket | Sınıf | Gerekçe (kanıt envanterde) |
|---|---|---|
| R01 | EXTEND | Pencere değerlendiricisi var, tüketicisi yok; `isDueOn` sabit gün; sözleşme/oturum/checklist/sürümleme yok |
| R02 | EXTEND (log kuyruğu) / NEW (genel outbox) | Yalnız habit log kuyruklu |
| R03 | EXTEND | Kapasite + 4 stratejili recovery var; yük seçimi ve küçük adım başlatma yok |
| R04 | EXTEND | Tek DAILY tetik |
| R05 | NEW (runner) / EXTEND (odak) | Runner yok; odak zamanlayıcı kusurlu ve kalıcı değil |
| R06 | EXTEND | Token/bileşen sistemi var; tek CTA ve render kanıtı yok |
| R07 | EXTEND | Günlük/review var; duygu modeli, ilişki kartı, plana bağlı review yok |
| R08 | NEW (restore) / REUSE (export) | Restore bilinçli yok |
| R09 | REUSE / EXTEND | Durable AI + tek etki kapalı; eylem listesi dar |
| R10, R11 | süreç | Guard'lar var; bağımsız reviewer yok |

## CP01–CP08 mevcut durumu (puan verilmedi — §2.3 gereği ölçülmemiş)

| CP | Durum | Not |
|---|---|---|
| CP01 Esnek hedef/geçmiş | **açık** | KD-01; aylık tüketilmiyor; sözleşme yok |
| CP02 Kapasite/küçük adım/recovery | kısmi | recovery 4 yol var; yük seçimi + küçük adım yok |
| CP03 Rutin yürütme | **yok** | runner yok |
| CP04 Odak/bildirim | kısmi | odak var (KD-03); bildirim tek tetik (KD-04) |
| CP05 Günlük/duygu/review | kısmi | temel var; duygu modeli/ilişki/plan bağı yok |
| CP06 Yerel veri/taşıma | kısmi | log kuyruğu + export var; outbox/restore yok |
| CP07 Uygulama içi AI | büyük ölçüde var | eylem listesi dar |
| CP08 Sadelik/erişilebilirlik | kısmi | sistem var; tek CTA ve render kanıtı yok |

## R01.01-a kartı (DONE)

```yaml
id: R01.01-a
status: DONE
priority: CORE MUST
owner_role: Habit domain
skills: [S02, S03, S08]     # design-habit-domain-model, verify-date-time-and-streak-logic, plan-small-agent-tasks
depends_on: [R00.02]
scope:
  - frontend/lib/habitSchedule.ts                 # mevcut; `periodStatus()` eklenir, `windowFor`/`completedCountInWindow` REUSE
  - frontend/lib/supabase.ts                      # planlandı, GEREKMEDİ: tüm girdiler mevcut tipte; dosya dokunulmadı
  - frontend/__tests__/lib/habitPeriod.test.ts    # YENİ; T01–T04 kanonik fixture'ları
size: S
goal: >
  §7.1 çıktı sözleşmesini tek fonksiyonda kurmak: periodStatus(habit, logs, date) ->
  { window, unit: 'days'|'sessions'|'amount', target, counted, actual, remaining,
    status: not_started|in_progress|satisfied|closed_unmet|paused|unknown, reason }.
  Günlük uygunluk (isDueOn) ile dönem başarısı ayrılır. 'sessions' tipte kabul edilir,
  değerlendirici R05 runner gelene kadar status=unknown, reason='sessions_unsupported' döner.
acceptance:
  - Sal/Per/Paz done kayıtları, weekly count=3 -> satisfied (T01)
  - aynı gün 3 kayıt -> counted=1 gün (günde-bir-log değişmezi korunur) (T02)
  - ayın 12'si, monthly count=10, 4 done -> in_progress, remaining=6; closed_unmet DEĞİL (T03)
  - hafta sonu ve done<count -> closed_unmet; hafta ortası ve yetişilebilir -> in_progress
  - status='paused' alışkanlık -> paused; count<=0 -> unknown, reason='no_target'
  - daily/weekly_days/every_n_days/date_range -> window=null, status günlük uygunluktan türer (mevcut isDueOn ile birebir)
  - hiçbir mevcut test değişmez; hiçbir tüketici bu kartta değişmez
validation:
  - npx jest __tests__/lib/habitPeriod.test.ts __tests__/lib/habitSchedule.test.ts __tests__/lib/phase1Adversarial.test.ts
  - npm run typecheck:ci && npm run lint:ci
risk: Yeni API tüketicisiz kaldığında "yazıldı ama bağlanmadı" — R01.02-a/b bu kartın ardılıdır ve aynı fixture'ı kullanır.
rollback: Eklemeli; fonksiyon ve tip silinerek geri alınır, veri etkisi yok.
effort: S
next: R01.02-a
```

**R01.02-a (READY, M) — sıradaki kart:** `isDueOn`'un `weekly_count` dalından `countDueDays` kaldırılır — sayı tabanlı modlarda **her gün uygundur** (kaçırma günlük değil dönemseldir); `scheduledCompletionRate` count modlarında paydayı `periodStatus` penceresinden alır. Kabul: T01 tüm `isDueOn` tüketicilerinde sahte kaçırma üretmez; mastery oranı Sal/Per/Paz için 1.0. Scope: `habitSchedule.ts`, `habitSchedule.test.ts`, `phase1Adversarial.test.ts` (gerekçeli güncelleme), `capacity` testleri.
**R01.02-b (M):** tüketici geçişi — `reportMetrics`, `recovery.tsx`, `weekly/monthly-review`, `insights`, `behaviorIntelligence` → `periodStatus`; bayat "migration bloklu" yorumları düzeltilir (KD-05).

### "R01.02-a gerçekten ilk READY kart mı?" — cevap

Hayır, iki nedenle: (1) rehberin kendi bağımlılığı `depends_on: [R00.02, R01.01]`;
(2) kod kanıtı: pencere değerlendiricisi (`windowFor`/`isWindowSatisfied`/`streakBroken`)
zaten var ve test edilmiş, eksik olan **§7.1 çıktı sözleşmesi** (R01.01) ve
**`isDueOn`'un sabit-gün dalı + tüketiciler** (R01.02-a/b). Bu yüzden ilk kart
R01.01-a'dır; R01.02-a onun ardından, envanterdeki daraltılmış kapsamla gelir.
Helper reuse: `windowFor`, `completedCountInWindow`, `startOfWeekLocal`,
`addDaysLocal`, `daysBetweenLocal`, `ymd` — yeniden yazılmaz.
