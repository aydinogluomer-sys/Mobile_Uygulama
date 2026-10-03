# Implementation v3 — STATE

```yaml
implementation_version: 3.0
baseline_sha: 0ff1c74b0d8d922fd9bef46d3631a1cf443677e2
guide_commit: ecfd4e3            # docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md, verbatim
scope_authority: docs/plan/21_KAPSAM_EKI_2026-09-13.md
newer_owner_decision: none        # 2026-09-13
completed_cards: [R00.01, R00.02, R00.03, R00.04, R00.05, R00.06, R00.07, R01.01-a, R01.02-a, R01.02-b, R01.06-a, R01.02-c, R01.02-d1, R01.02-d]
active_card: null
next_ready_card: R01.02-e   # UI form fields for interval_days / range_*; consumers (R01.02-c), envelope (R01.02-d1) and validator (R01.02-d) done. KD-07 (pricing) should be decided before the form opens the mode to every user
critical_open_defects: []         # bilinen kusurlar kartlara bağlı; veri kaybı / hesap erişimi / FP kusuru yok
known_defects_bound_to_cards:
  - id: KD-01
    status: NEUTRALISED (kod duruyor, canlı girdisi yok)
    where: frontend/lib/habitSchedule.ts countDueDays + isDueOn count dalı
    what: R01.02-b sonrası HİÇBİR üretim çağıranı count-tabanlı alışkanlığı `isDueOn`'a veremiyor (her çağıran önce guard'lıyor; guard = __tests__/repo/periodConsumerMigration.test.ts). Kod silinmedi -> AC-H03 testleri `isDueOn`'un count davranışını BİLEREK pinliyor ve `isDueOn` dışa açık API; dalı silmek bu test sözleşmesini yeniden yazmak demek
    r01_02_c: doğrudan üretim çağıranı kalmadı -- gün-şeridi `isEligibleOn` soruyor; `isDueOn`'u yalnız modül-içi `dueOnExtended` çağırıyor. İSTİSNA KD-06 (bugün yazılamayan kombinasyon)
    r01_02_d1: KD-06 istisnası KAPANDI -- aralık artık şekil değil zarf; weekly+count+range `weekly_count` sınıflanır ve count guard'larına takılır. `dueOnExtended` içinde 2 isDueOn çağrısı kaldı (every_n_days temel koruma + daily/weekly_days)
    card: SAHİP KARARI bekliyor (silme = AC-H03 yeniden yazımı)
  - id: KD-02
    status: RESOLVED (R01.06-a) — kalan: "bu hafta doldu" soluklaştırması R01.06-b
    where: frontend/app/tabs/today.tsx (`selectTodayHabits`)
    what: Bugün takvimi sormuyordu; tüm aktif alışkanlıklar "kalan" sayılıyordu. Artık gün-yüzeyleri `isEligibleOn` + fail-open ile süzülüyor
    card: R01.06-a (DONE) / R01.06-b / R03.01
  - id: KD-03
    where: frontend/store/focusStore.ts:220,257
    what: resume `sessionStartedAt`'i yeniler; pause ayrılmaz; oturum kalıcı değil
    card: R05.03
  - id: KD-04
    where: frontend/lib/notifications.ts:82
    what: tek DAILY tetik; takvim tüketilmiyor
    card: R04.01
  - id: KD-05
    status: RESOLVED (R01.02-b)
    where: frontend/lib/supabase.ts:30, frontend/lib/habitSchedule.ts (V2 başlığı)
    what: "migration bloklu" yorumları bayattı — DB jsonb kabul ediyor, engel istemci validator'ı (routineProposal.ALLOWED_FREQUENCY_KEYS). Yorumlar doğrulanmış gerçekle değiştirildi
    card: R01.02-b (DONE)
  - id: KD-06
    status: RESOLVED (R01.02-d1) -- ikinci delik (interval_days + aralık -> aralıktaki her gün) de kapandı
    where: frontend/lib/habitSchedule.ts scheduleKind (range önce gelir) + dueOnExtended date_range dalı -> isDueOn count dalı -> countDueDays
    what: "`kind:weekly` + `count` + `range_start/end` satırı `date_range` sınıflanıyor, hiçbir count guard'ına takılmıyor; gün-şeridinde countDueDays günleri (Pzt/Çar/Cmt) icat ediliyordu, aralıkla kırpılmış (5,8,10,12,15,17,19 Ağustos). Aynı kök: `daily + interval_days:3 + aralık` interval'i kaybedip aralıktaki 18 günün hepsini due sayıyordu. Düzeltme: aralık şekilden çıkarılıp `withinLifetime` zarfına taşındı; `ScheduleKind`'dan `date_range` silindi"
    card: R01.02-d1 (DONE)
  - id: KD-07
    status: OPEN -- R01.02-d ile ERİŞİLEBİLİR oldu (AI Coach artık interval_days taşıyan alışkanlık kurabiliyor)
    where: "frontend/lib/triage.ts costBreakdown (FREQ_FACTOR yalnız `kind`'a bakar) -> computeWillpowerCost (buildInstallRows'un yazdığı willpower_cost); frontend/lib/capacity.ts occurrencesPerWeek (daily -> 7 * (count ?? 1)) -> frequencyWeight 1.0"
    what: "İkisi de `interval_days` okumuyor: 'her 3 günde bir' alışkanlık günlük gibi FİYATLANIYOR (irade bedeli daily faktörüyle, kapasite yükü haftada 7 / ağırlık 1.0; doğrusu ~2.33 / ~0.33). Takvim doğru (R01.02-c/d1); bedel ve yük fazla. Bu kartın kapsamı dışında (triage.ts / capacity.ts) bırakıldı, düzeltilmedi"
    card: R01.02-e öncesi karar (form modu herkese açmadan) ya da ayrı fiyatlama kartı
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
  - docs/implementation-v3/STATE.md#r0102-a-evidence
  - docs/implementation-v3/STATE.md#r0102-b-evidence
  - docs/implementation-v3/STATE.md#r0106-a-evidence
  - docs/implementation-v3/STATE.md#r0102-c-evidence
  - docs/implementation-v3/STATE.md#r0102-d1-evidence
  - docs/implementation-v3/STATE.md#r0102-d-evidence
gates_run_at_baseline:
  typecheck_ci: 0 errors
  lint_ci: 0 warnings
  jest_ci: 131 suites / 2056 tests
  run_tests_js: 145/145
  scope_guards: 54/54
timing:                           # R00.07 — dev / test / fix ayrı; erişim beklemesi ayrı
  R00: { dev_min: 21, test_min: 12, fix_min: 0, access_wait_min: 0, single_writer: true }
  R01.01-a: { dev_min: 25, test_min: 20, fix_min: 10, access_wait_min: 0, single_writer: true }
  R01.02-a: { dev_min: 30, test_min: 25, fix_min: 15, access_wait_min: 0, single_writer: true }   # fix: CRLF/LF karışımı, precision, import
  R01.02-b: { dev_min: 75, test_min: 60, fix_min: 30, access_wait_min: 0, single_writer: true }   # fix: kayıp flake logu, clip semantiği, bayat kendi yorumum
  R01.06-a: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-c: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-d1: { access_wait_min: 0, single_writer: true }  # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı. Not: önceki iki "d1 bitti" raporu bu çalışma kopyasında iz bırakmamıştı; bu koşu 3524e26'dan sıfırdan yapıldı
  R01.02-d: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
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

## R01.02-a evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `f6be768` (+ an unrelated `0828c8f` `.claude/settings.json` commit found on the branch, authored under the current session id at 06:54; not R01 work, left untouched, flagged).
- **Call-site classification (from source):** `isDueOn` is read as **obligation** everywhere — recovery backlog/consecutive-miss (`recovery.tsx:95,116`), completion denominators (`reportMetrics.ts:124`, `behaviorIntelligence.ts:228,290`, `capacity.ts` via `scheduledCompletionRate`), streaks (`behaviorIntelligence.ts:355,396`), calendar cell miss verdict (`habit-detail.tsx:174`), per-day load sets (`weekly/monthly-review`, `insights`). **No** pure-eligibility caller. Today does not call it at all (status filter only).
- **Compatibility strategy:** `isDueOn` unchanged (bridge; AC-H03 tests still pin it), `countDueDays` retained as legacy with its sole caller documented; **new** canonical `isEligibleOn` (count modes: every alive day with a target; fixed days: configured days; daily/every-N/date-range: `dueOnExtended`); lifetime guards extracted to `withinLifetime` (behaviour-identical) and shared.
- **`scheduledCompletionRate`:** count modes now go through `periodStatus` per calendar period — denominator = period target (3 / 10), never 7 or a weekday set; unique done days; partial edge periods prorated by covered days (documented approximation: a Thursday-ending 28-day window scores a Tue/Thu/Sun user 0.98, not 1.00; verdict unchanged — mastered). Day-based modes untouched.
- **Files (4 + this):** `frontend/lib/habitSchedule.ts` (+~160), `__tests__/lib/habitSchedule.test.ts` (+2 describes, 18 tests), `__tests__/lib/habitPeriod.test.ts` (+A7 describe, 3 tests), `__tests__/lib/capacity.test.ts` (+2 mastery cases). No consumer, schema or UI change.
- **Acceptance:** A1 Tue/Thu/Sun → eligible ×3, rate 3/3, `periodStatus` satisfied · A2 3 same-day → 1 · A3 open week → prorated, no miss · A4 monthly 10 → denominator 10 (not 30), 4/10 open · A5 fixed Tue/Thu identical to `isDueOn` · A6 daily/every-N/date-range fixtures pass · A7 rate ↔ `periodStatus` agree (3 cases).
- **Negative:** fixed-weekday distribution in canonical path RED; same-day dup inflating numerator RED; open period as miss RED; weekly denominator 7 RED; monthly denominator = calendar days RED (all as assertions).
- **Mutation proof:** M1 fixed `[0,2,5]` map in `isEligibleOn` → 4 red; M2 dedup removed → 6 red; M3 weekly denominator 7 → 12 red. Reverted byte-identical; green.
- **Gates:** focused 9 suites 300/300 (incl. `scopeAddendum`) · `typecheck:ci` 0 · `lint:ci` 0 · full `jest --ci` **132/2114** ×2 captured runs, no FAIL lines · `run-tests.js` 145/145 · `git diff --check` clean.
- **Flake status:** no recurrence in two captured runs; standing "worker failed to exit" warning present once, scope not widened.
- **Known remaining (separate cards):** consumer migration (R01.02-b), monthly production wiring, stale "migration bloklu" comments (KD-05), R01.03 tracking semantics, checklist (R01.04), pause/holiday intervals (R01.05), goal versioning (R01.05), timezone/week_start persistence (R01.06).

## R01.02-b evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `b155588`. `0828c8f`
  (`.claude/settings.json` -> `bypassPermissions`) is still an unrelated commit on
  this branch, not R01 work, still awaiting an owner call before any merge to main.
- **Scope taken from STATE.md's own card line** (`reportMetrics`, `recovery.tsx`,
  `weekly/monthly-review`, `insights`, `behaviorIntelligence`), plus
  `habit-detail.tsx`, which that line omits but which turned out to be the LAST
  live surface of the same defect and the blocker for the card's retirement goal.

### What each consumer now asks

| Consumer | Question it actually asks | Before | After |
|---|---|---|---|
| `reportMetrics.habitAveragePercent` / `summarizeHabitProgress` | completion denominator | day walk via `isDueOn` -> invented weekdays | count modes short-circuit to `scheduledCompletionRate` (period target) |
| `behaviorIntelligence.dueDayStats` (feeds `habitCompletionRate`, `weekdayBreakdown`, `weeklyRates`, `completionTrend`) | scheduled vs completed | same day walk | period target + unique done days |
| `behaviorIntelligence.weekdayBreakdown` | per-weekday rate | "Monday 0%" for a habit with no Monday obligation | count habits excluded -- no per-weekday claim is made |
| `behaviorIntelligence.currentStreak` / `longestStreak` | streak | consecutive due DAYS | consecutive satisfied PERIODS (`periodStreakBack` / `periodStreakLongest`); open period transparent, `closed_unmet` breaks |
| `weekly-review` / `monthly-review` / `insights` (`countOverloadDays`, `habitsDueToday`) | **how much does this day carry?** | `isDueOn` -> load on Mon/Wed/Sat | new `carriesDayLoad` -- `isDueOn` for day-based, open-and-unmet period for count-based |
| `recovery.tsx` backlog + `consecutiveMissedDue` | **was this day missed?** | phantom misses on days the user never chose | count schedules skipped: a day-level miss is undefined for them |
| `habit-detail.tsx` `dayCellFor` | per-day calendar cell | invented days painted `miss`, and a real Tuesday completion returned `not_scheduled` (work hidden from its own calendar) | a log is the only thing that gives a count day a state; unlogged owes nothing |

### Two new exports (both additive)

- `isCountBasedSchedule(habit)` -- one canonical "is a day-level verdict even
  definable?" predicate, so four call sites stop re-deriving it.
- `carriesDayLoad(habit, logs, date)` -- the load question. Day-based schedules
  delegate to `isDueOn` unchanged (pinned by a test that compares the two across
  a whole week for four shapes), so those habits cannot regress. Count-based: the
  period is open and unmet. Logs are clipped **strictly before** `date` -- the
  question is what the day BEGAN owing, because including the day's own completion
  would make exactly the days the user did the work read as free. Net effect: a
  "3 a week" habit finished Mon-Wed carries load on Mon/Tue/Wed and nothing after
  -- three loaded days for a target of three, on the days it actually happened.

### countDueDays — NOT retired, deliberately

The card asked for retirement. After the migration no production caller can pass
a count-based habit to `isDueOn`, so the branch and `countDueDays` are dead for
every real input -- pinned by `__tests__/repo/periodConsumerMigration.test.ts`.
They were still **not deleted**: the AC-H03 tests pin `isDueOn`'s count behaviour
on purpose (written before the fix and observed to fail), and `isDueOn` is
exported API. Deleting the branch means rewriting that pinned contract, which is
an owner decision rather than a side effect of a consumer-migration card. This is
the one deliberate deviation from the card and is flagged as such.

### Gates

- `typecheck:ci` 0 · `lint:ci` 0 · `run-tests.js` 145/145 · `git diff --check` clean
- full `jest --ci --maxWorkers=2` **133 suites / 2158 tests**, two consecutive
  green runs, no FAIL lines, 0 OOM markers (baseline `b155588`: 132 / 2114)
- focused 6 suites 253/253 before the screen work; new guard suite 12/12
- **Mutations** (each reverted byte-identical, sha256 verified):
  M1 `carriesDayLoad` count lane back to `isDueOn` -> 6 named red ·
  M2 clip `<` -> `<=` -> 1 red (the "began owing" case) ·
  M3 drop recovery's count guard -> 1 red ·
  M4 disable `dueDayStats`'s count branch -> 4 red ·
  M5 `habit-detail` countBased -> false -> 1 red

### Flake investigation (the card's protocol)

The R01.02-b gate went red four times before the cause was named. Verdict:
**worker/environment flake -- host memory exhaustion**, not a product regression.
Mechanism, not inference:

| Run | Workers | Tree | OOM markers | Suites that failed | Failed *tests* |
|---|---|---|---|---|---|
| 1 | 7 (default) | R01.02-b | log lost | `aiCoachActions`, `aiCoachMessages` | 2 |
| 2 | 7 | R01.02-b | 4 | `crossProjectIsolation`, `skeletonStates` | 1 |
| 3 | 2 | R01.02-b | 0 | `syncLifecycleWired` | 0 |
| 4, 5 | 2 | R01.02-b | 0 | — | 0 |
| B1 | 2 | `b155588` | 0 | — | 0 |
| B2 | 7 | `b155588` | 0 | — | 0 |
| 6 | 7 | R01.02-b | 2 | `habitStrength`, `willpowerCapacity` | 0 |

- **Nine distinct suites across four red runs, never the same set twice.** A
  product regression is deterministic; this is not.
- **Every failure is suite-level, not an assertion.** Named mechanisms:
  `FATAL ERROR: Zone Allocation failed - process out of memory` (V8 worker death),
  `A jest worker process (pid=...) was terminated by another process: signal=SIGTERM`,
  `Command failed: git ls-files` and `Command failed: grep -rl ...` (the OS
  refusing to fork a child), and a `jest-worker messageParent` circular-JSON
  crash. Runs 2 and 6 report **0 failed tests** alongside failed suites -- the
  signature of a killed worker, not of a bad expectation.
- **Host:** 7.85 GB RAM with **0.70 GB free**, 8 logical cores. Jest's default
  spawns 7 jest-expo/RNTL workers at roughly 0.3-0.6 GB each. It cannot fit.
- **Reachability:** `crossProjectIsolation`, `skeletonStates` and
  `syncLifecycleWired` are static source scanners whose project-local import
  graph is 2 modules and reaches **none** of the changed files. The two aiCoach
  suites reach `behaviorIntelligence` / `reportMetrics` by import but never
  execute them: both mock `loadReviewData` to throw, so `loadAnalyticsSummary`
  bails before any call. Every offender passes in 1-3 s in isolation.
- **Not claimed:** a red run was never reproduced at `b155588` under default
  workers (B2 was green). By then the host had freed memory, so the condition had
  eased -- the shared mechanism is the evidence, not a matched red baseline.
- **Wall time is not a usable signal on this host:** `aiCoachMessages` measured
  8.4 s / 72.1 s / 8.8 s / 5.6 s across runs. The single 90 s full run was a
  crashed-worker restart; settled runs are 28-31 s against a 46 s baseline, so
  this card carries no perf regression.
- **Follow-up for the gate, not for this card:** `--maxWorkers=2` is what this
  machine can sustain; the default is not. CI (Node 22, cloud runner) is
  unaffected and was not changed.

### Incidental

`MAX_STREAK_LOOKBACK_DAYS` (3650, documented as a DAY-step ceiling) was being
reused by the two new period-step loops, stretching "~10 years" to 70 (weekly) or
300 (monthly). Added `MAX_STREAK_LOOKBACK_PERIODS = 520` for those two; the legacy
day loop keeps the day bound. Not a live bug -- `periodStatus` returns
`closed_unmet` for an empty closed period, so the walk already stopped at the
first one -- but the bound now matches its own documentation.

### Known remaining (separate cards)

Monthly production wiring; R01.03 tracking semantics; R01.04 checklist; R01.05
pause/holiday intervals + goal versioning; R01.06 timezone/week_start
persistence; recovery's **period-deficit make-up surface** ("you were 2 short last
week") -- the day-keyed backlog list cannot express a period row, so the interim
behaviour is to offer nothing rather than a wrong-day make-up.

## R01.06-a evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `96de9be`. No new branch.
- **Files (4):** `frontend/app/tabs/today.tsx`; `frontend/__tests__/lib/todaySchedule.test.ts`
  (new, 22 tests); `frontend/__tests__/repo/todayScheduleScoped.test.ts` (new, guard,
  9 tests); this file. `lib/habitSchedule.ts` **untouched** (behaviour and text);
  `isDueOn`, `countDueDays`, AC-H03 tests untouched; `app/tabs/habits.tsx` untouched.
- **Defect (verified before the change):** `today.tsx` made zero calls to the
  schedule oracle -- `activeHabits = habits.filter(status === 'active')` was the
  list, the completed count, the percentage denominator, "N adım kaldı", the ring
  subtitle and `buildTodayNarrative`'s `totalHabits`.

### What changed on the screen

Three pure, exported selectors in `today.tsx` (no new lib file):

| Function | Question |
|---|---|
| `selectTodayHabits(habits, date)` | active ∩ (`isEligibleOn(h, date)` ∪ `isScheduleAmbiguous(h)`) |
| `summarizeTodayHabits(todayHabits, completedHabits)` | `{ total, completed, remaining, pct }` from ONE denominator; completed is counted *inside* `todayHabits`, so a log for a habit not on today's list (e.g. a Mon/Wed/Fri habit logged on Tuesday from timeline) cannot push pct over 100 or remaining below 0; `pct = 0` when `total = 0` |
| `todayHabitCopy(summary, activeCount)` | the two subtitles |

| Surface | Before | After |
|---|---|---|
| Ritüeller list (`RİTÜELLER · BUGÜN`) + its visibility condition | `activeHabits` | `todayHabits` |
| completed count | `activeHabits.filter(done)` | `todayHabits.filter(done)` |
| `habitPct` / ProgressRing / metric value | / `activeHabits.length` | `habitSummary.pct` |
| "N adım kaldı" / metric tone | `activeHabits.length - completed` | `habitSummary.remaining` / `total > 0` |
| ring subtitle `x/y tamamlandı` | y = all active | y = today's total |
| `buildTodayNarrative({ remainingHabits, totalHabits })` | all active | today's |

**The one place `activeHabits` stays, with an inline comment:** `todayHabitCopy(habitSummary,
activeHabits.length)` -- telling "no habits at all → create your first" apart from
"habits exist, none scheduled today" (new copy: `bugün planlı ritüel yok` /
`Bugün planlı ritüel yok`). Offering "create your first ritual" to someone with
five habits on their rest day would be wrong; that distinction genuinely needs
the total. It is never a denominator.

**Day input:** `parseLocalDate(todayLocal()) ?? now` -- the same local day the
screen already uses to load today's logs; weekday mapping stays inside
`habitSchedule.weekdayIndex` (no `getDay()` added; the existing `getDay()` is the
eyebrow label only, pinned by the guard).

**Why not `carriesDayLoad`:** it needs period logs; this screen only loads today's
(`fetchLogsForDate(today)`). Accepted consequence: a "3 a week" habit whose target
is met stays visible every day (it can still be logged). "Already done this week"
dimming is R01.06-b, not done here.

### Fail-open (mandatory)

`scheduleKind` classifies a `kind:'weekly'` row with neither `days` nor `count` as
`weekly_count`/`count: 0`, and `isEligibleOn` then says `false` on every day. Such
rows were visible on Bugün before this card. Hiding them would hide a loggable
habit with no surface saying so. Rule: **if the schedule is ambiguous, show it.**

Implemented on the screen side only (`isScheduleAmbiguous`), not by changing the
oracle -- the oracle's "under-count when unsure" principle is right for reports
and wrong for "what do I show". Ambiguous = count mode with target ≤ 0 (weekly
*or* monthly without a count), or fixed-day mode whose `days` holds no valid
0..6 integer index (`includes` would never match). Ambiguous rows bypass the
lifetime check too, i.e. they behave exactly as before this card.

**Behaviour change worth stating:** a habit whose dated `end_condition` has
passed (or whose `created_at` is in the future) is no longer on Bugün, because
`isEligibleOn` applies the lifetime guard. It is still listed in `habits.tsx`.

### Acceptance

| | Result | Evidence |
|---|---|---|
| A1 | Mon/Wed/Fri absent Tue, present Wed; week mask `[T,F,T,F,T,F,F]` | `todaySchedule.test.ts` A1 ×4 |
| A2 | "3 a week" present 7/7 days | A2 ×2 |
| A3 | "10 a month" present 31/31 days of Aug 2026 | A3 |
| A4 | `interval_days: 3` from Mon → Mon/Thu/Sun; `range_start..end` Wed..Fri → only Wed-Fri (fixtures; client validator still rejects the keys) | A4 ×2 |
| A5 | weekly with no days/count, `days: [] + count: 0`, monthly without count, `days: [9]` → all visible; well-formed schedules NOT ambiguous | A5 ×5 |
| A6 | pct and remaining from one total (2/1/1/0.5); denominator 0 → pct 0, finite, empty-state copy in both variants; out-of-list completion not counted | A6 ×6 |
| A7 | `habits.tsx` unchanged (`git diff` empty), still `habits.filter(status === 'active')`, no schedule filter | guard `A7` + diff |

Negative assertions (not comments): Tuesday MWF in denominator → red; count habit
hidden on any day → red; ambiguous row hidden → red.

### Mutation proof (each reverted byte-identical, sha256 `05785803…46bb4fa` verified OK)

- **M1** selector's `isEligibleOn(h, date)` → `(() => true)()`: **13 / 31 red** (2 guard +
  A1 ×3, A4 ×2, end-condition ×1, A6 ×5). First attempt of M1 lost the behaviour
  suite to `Cannot find module './elements/ForeignObject'` from `react-native-svg`
  (file present on disk; Jest's own message says it found it) -- a resolver/
  environment failure, not a test verdict. Re-run: 13 red, as listed.
- **M2** fail-open branch removed (`|| isScheduleAmbiguous(h)` dropped): **5 / 31 red**
  (1 guard + A5 ×4).

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 (`--max-warnings=0`) · `git diff --check` clean
- `run-tests.js` **145/145**. First run after the change was 144/145: check
  `Alışkanlık metrik kartı` requires the identifier `completedHabits` in
  `today.tsx`. `run-tests.js` is out of scope, so the screen keeps a real
  `const completedHabits = todayHabits.filter(...)` that feeds the summary
  (not a comment to satisfy a substring). Pinned by the guard.
- focused: 2 suites **31/31**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **135 suites / 2189
  tests**, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (baseline 133 / 2158;
  +2 suites, +31 tests).
- **Not done:** no device/emulator observation (none installed on this host). The
  render itself was not exercised by RNTL; the selectors are.

## R01.02-c evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `fc6ddff`. No new branch.
- **Defect (split brain in one module):** `interval_days` / `range_start` /
  `range_end` were read only through private `dueOnExtended` (`streakBroken`,
  `isEligibleOn`, `periodStatus`). Every other day walk asked `isDueOn`, which
  reads kind/days/count only: "every 3 days" was due EVERY day there and range
  bounds were ignored. Latent today (the client validator rejects the keys);
  fixed before R01.02-d opens them -- consumer first, validator second.

### Call sites swapped `isDueOn` -> `isEligibleOn` (11), each with its count guard

All 11 verified by reading the source, not assumed. Every guard classifies via
`scheduleKind` (`isCountBased` in reportMetrics/behaviorIntelligence is a local
`scheduleKind(...).kind === 'weekly_count' | 'monthly_count'`, identical to
`isCountBasedSchedule`). So `isEligibleOn`'s count branch (every day true) is
unreachable from these lines. No site lacked a guard; none was skipped.

| Call site | Function | Count guard (before the call) |
|---|---|---|
| `lib/habitSchedule.ts` | `scheduledCompletionRate` day walk | `sk.kind === 'weekly_count' \|\| 'monthly_count'` -> `periodCompletionRate` return |
| `lib/habitSchedule.ts` | `carriesDayLoad` day branch | `if (!isCountBasedSchedule(habit))` |
| `lib/reportMetrics.ts` | `habitAveragePercent` | `if (isCountBased(habit)) { ...; continue; }` |
| `lib/reportMetrics.ts` | `summarizeHabitProgress` | `if (isCountBased(habit)) { return {...} }` |
| `lib/behaviorIntelligence.ts` | `dueDayStats` | `if (isCountBased(habit) && days.length > 0) return` -- with empty `days` the loop never runs |
| `lib/behaviorIntelligence.ts` | `weekdayBreakdown` | `if (isCountBased(habit)) continue;` |
| `lib/behaviorIntelligence.ts` | `currentStreak` | `if (isCountBased(habit)) return periodStreakBack(...)` |
| `lib/behaviorIntelligence.ts` | `longestStreak` | `if (isCountBased(habit)) return periodStreakLongest(...)` |
| `app/screens/recovery.tsx` | backlog loop | `if (isCountBasedSchedule(h)) continue;` |
| `app/screens/recovery.tsx` | `consecutiveMissedDue` | `if (isCountBasedSchedule(h)) return 0;` |
| `app/screens/habit-detail.tsx` | `dayCellFor` | `!countBased && ...` short-circuit |

Also: the now-unused `isDueOn` import dropped from the four consumer files;
`dayCellFor` exported (pure function, for the A3 test). `isDueOn` body,
`countDueDays`, `scheduleKind`, `dueOnExtended` (still private) untouched;
`isDueOn`'s DOC caller table rewritten (it listed the old callers).
`routineProposal.ALLOWED_FREQUENCY_KEYS`, UI, `featureGates.ts` untouched.

### Finding recorded, not fixed: KD-06

`scheduleKind` puts range first, so `weekly` + `count` + `range_*` is
`date_range`: not count-based to any guard, and `dueOnExtended`'s range branch
calls `isDueOn`, whose count branch runs `countDueDays` (invented Mon/Wed/Sat).
This predates the card (before, the same row went straight to `isDueOn` ->
`countDueDays`, without even the range clip), cannot be written today, and the
fix is a classification decision (`scheduleKind` -- out of scope) or a
validator rule (R01.02-d). Classification pinned by a test; `isDueOn`'s doc
names it; KD-01 now carries the exception.

### Acceptance

| | Result | Evidence |
|---|---|---|
| A1 | every 3 days from Mon: due Mon/Thu/Sun = 3 in the week; done on those → 100% / rate 1 / streak 3; a `miss` row on an off day moves nothing | reportMetrics ×3, behaviorIntelligence ×4, habitSchedule ×2 |
| A2 | recovery's predicate is `isEligibleOn` for both walks (guard pins exactly 2 lines); off days stay off at 14:37 and 23:59 (recovery passes `subDays(now, k)`, not midnight) | guard + habitSchedule A2. **Not rendered**: the backlog is inline in the component |
| A3 | habit-detail cells: due days `miss`, the days between `not_scheduled`; range days outside → `not_scheduled` | habitDetailDayCell ×4 |
| A4 | range Wed..Fri: 3 due days in every consumer; outside days no load | reportMetrics ×2, behaviorIntelligence, habitSchedule, habitDetailDayCell |
| A5 | trap 1: Mon/Wed/Fri + range keeps the weekday filter (Thu inside range not due; 5 days over 2 weeks) -- `dueOnExtended` calls `isDueOn` first; not "fixed" | habitSchedule, reportMetrics, behaviorIntelligence |
| A6 | trap 2: no `created_at` → not narrowed, 7/7 due -- kept | habitSchedule, reportMetrics |
| A7 | daily / weekly_days unchanged: (1) `isEligibleOn === isDueOn` over 366 days for 4 shapes; (2) `daySchedulePreservation.test.ts` -- 8 consumer outputs (incl. the six the card names, plus `scheduledCompletionRate` and `weekdayBreakdown`) for 4 habits over 28 days, expected values **captured by running the fixture at `fc6ddff` before any edit**, then compared after: byte-identical JSON | 8 tests |
| A8 | count habits: period target denominator, period streak, logged-only cells -- unchanged | reportMetrics, behaviorIntelligence, habitDetailDayCell |

Negative assertions (not comments): every-3-days denominator 7 → red; out-of-range day due → red; weekday filter swallowed by range → red.

**One existing test updated, with reason:** `habitSchedule.test.ts` "carriesDayLoad
is identical to isDueOn for every day-based shape" listed `interval_days: 3`
among the identical shapes -- i.e. it pinned the defect. Split: the identity
stays for daily / weekly_days / the malformed weekly row; interval moves to a
new test against `isEligibleOn` with the explicit Mon/Thu/Sun mask.
`periodConsumerMigration.test.ts`: the two R01.02-b assertions that the four
consumers "still call `isDueOn`" now assert they call `isEligibleOn` and not
`isDueOn` (the guard-before-call ordering check kept, retargeted).

### Mutation proof (focused 6 suites, 193 tests; each reverted byte-identical, sha256 verified for all 5 source files)

- **Ma** all 11 calls back to `isDueOn` (= revert the card): **29 / 193 red**, 0 suite-level. The 8 A7 preservation tests stay GREEN under it -- the expected result if the swap is neutral for daily/weekly_days.
- **Ma'** one call (`summarizeHabitProgress`) back: **7 / 193 red** (5 reportMetrics + 2 guard).
- **Mb** `dueOnExtended` every-N modulo `=== 0` → `=== 1`: **18 / 193 red** (incl. 4 pre-existing streakBroken/isEligibleOn tests).

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 12 suites **321/321**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **137 suites / 2235 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 135 / 2189: +2 suites, +46 tests)
- **Not done:** no device/emulator observation (none on this host); recovery and habit-detail were not rendered.

## R01.02-d1 evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `3524e26`. Verified at
  start: HEAD `3524e26`, tree clean, none of the card's changes present.
- **Defect, measured at `3524e26` before editing:** `weekly + count 3 + range
  08-05..08-20` was `date_range`, not count-based, eligible on 5, 8, 10, 12, 15,
  17, 19 Aug (countDueDays' Mon/Wed/Sat, clipped) = KD-06. `daily + interval 3 +
  range 08-03..08-20` was eligible on all 18 days -- the interval was lost.

### What moved where (all in `lib/habitSchedule.ts`)

| Before | After |
|---|---|
| `scheduleKind`: `if (range_start \|\| range_end) return { kind: 'date_range' }` before reading `kind` -- the range replaced the shape | early return removed; reports the real shape (5 modes). Priority-list comment and the "SINIR — bilerek" paragraph rewritten: the old note called the combination "not expressible"; it was silently WRONG |
| `ScheduleKind` union had `date_range` (6 members) | `date_range` removed (5). `tsc` clean -- no production code compared against the literal |
| `dueOnExtended` had a `date_range` branch | removed; every path calls `isDueOn` first, which calls `withinLifetime` |
| `withinLifetime`: `created_at` + dated `end_condition` | + `withinRange` (new private helper): `ds < range_start` or `ds > range_end` → false; either end optional; no range → always true |
| count branches of `streakBroken` / `periodStatus` used the calendar window | new private `rangeSlice` (window ∩ range; for a range-less habit it returns the window object itself): `streakBroken` returns false outside the range and counts/remaining-days inside the slice; `periodStatus` returns `unknown/not_scheduled` for a period wholly outside the range, counts only in-range completions, and computes days left inside the slice |

Why the envelope in `withinLifetime` is enough for eligibility: `isDueOn` calls
it first (all day shapes) and `isEligibleOn`'s count branch is `sk.count > 0 &&
withinLifetime(...)` (all count shapes). The two window-based count branches
(`streakBroken`, `periodStatus`) do not go through it, which is why A4 needed
`rangeSlice` -- otherwise `streakBroken(w3, [], 08-22)` would read "3 left, 2
days" as broken on a day outside the range.

Not touched: `isDueOn`'s body and count branch, `countDueDays`, AC-H03 tests,
`ALLOWED_FREQUENCY_KEYS`, UI, `featureGates.ts`. `dueOnExtended` stays private.
Comments in other files that say "+ every_n_days/date_range" (R01.02-c) were
left as they are: still true in meaning (ranges are honoured), outside scope.

### Period target — decision, not silent behaviour (A6)

The target stays NOMINAL in a period the range cuts (no proration -- R01.05,
goal versioning). Known limit, written at the code site: if the slice is
shorter than the target, the period cannot be met, and `periodStatus` SAYS so:
`not_started`/`in_progress` with reason `unreachable_in_remaining_days` while
open, `closed_unmet` after. A cut period that can still make it reports `ok`.
For a period the range does NOT cut, `counted === 0` keeps its pre-existing
`'ok'` reason (A7). `periodCompletionRate` (reports) inherits this: weeks wholly
outside the range contribute target 0; weeks it touches contribute their
nominal target.

### Acceptance

| | Result |
|---|---|
| A1 | `weekly+count:3+range`: `weekly_count`, `isCountBasedSchedule` true, eligible on every one of Aug 5..20 (16 days), none outside; `[5,8,10,12,15,17,19]` asserted ABSENT. Monthly count + range same |
| A2 | `interval 3 + range 08-03..08-20`: 03, 06, 09, 12, 15, 18 -- length 6, not 18, no 21; August due-day denominator 6 |
| A3 | `weekly_days [0,2,4] + range`: 5, 7, 10, 12, 14, 17, 19 (Mon/Wed/Fri only), kind `weekly_days` -- output unchanged, now by design |
| A4 | out-of-range days (1, 4, 21, 22, 31 Aug) false for `isDueOn`, `isEligibleOn`, `carriesDayLoad` (day + count shapes); `scheduledCompletionRate` 16 not 31; `streakBroken` false outside for day + count; `periodStatus` `not_scheduled`; `summarizeHabitProgress` 16 (day) / 9 = 3×3 (count, only weeks touched); `habitAveragePercent` 100; `currentStreak` 16, `habitCompletionRate` 1, `weekdayBreakdown` Σscheduled 16 |
| A5 | only `range_start` → nothing before, open after; only `range_end` → open back to `created_at`, nothing after; both bounds inclusive |
| A6 | range from Sat 08-08 (2 days of the week for 3): `not_started`/`unreachable` with 0 logged, `in_progress`/`unreachable` with 1, `closed_unmet` after; range Mon..Wed ending mid-week → `unreachable`; 08-05..08-09 (5 days) → `ok`, target 3 (not prorated) |
| A7 | **range-less: byte-identical.** `rangelessOutputs` (8 habits: daily, weekly_days, weekly_count, monthly_count, every_n_days, malformed weekly, dated end, negative born mid-window × 12 functions, 42 days, periodStatus every day) captured at `3524e26` with lib untouched, compared after the change: `cmp` identical; pinned in `rangelessPreservation.test.ts` (13 tests). R01.02-c's `daySchedulePreservation` (8 tests) also still green |
| A8 | `ScheduleKind` has 5 members; `typecheck:ci` 0 |

Negative assertions: invented weekday pattern → red; interval+range every day → red; any out-of-range day due in any consumer → red; any range-less output changed → red (A7 test).

### Existing tests retargeted (none deleted, none narrowed)

- `habitSchedule.test.ts` "range_start/range_end produces date_range, regardless
  of the underlying kind" → "does not change the shape": asserts the underlying
  kind for ALL five shapes plus a one-sided range (was: one daily case).
- `habitSchedule.test.ts` A5 (trap 1): only the `toBe('date_range')` line →
  `'weekly_days'`, with the reason; behaviour assertions unchanged and green.
- `habitSchedule.test.ts` KD-06: pinned the defect (`date_range`, not count-based)
  → pins the fixed behaviour (card A1), same fixture, plus a negative.
- `periodConsumerMigration.test.ts` (`__tests__/repo`, outside the card's file
  list but broken by this card's mechanics): `isDueOn` calls inside
  `dueOnExtended` 3 → 2, because the range branch went; the "only inside
  `dueOnExtended`" invariant kept.
- `streakBroken — date_range` (4 tests): **no change needed, all green** -- no
  behaviour regression. `phase1Adversarial.test.ts` mentions date_range only in
  a header comment; `coachHabitSemantics.test.ts` asserts the validator still
  REJECTS `range_start` -- untouched and green.

### Mutation proof (9 focused suites, 267 tests; each reverted byte-identical, sha256 `d77d7b45…b112af` verified)

- **M1** range clip removed from `withinLifetime`: **27 / 267 red**
- **M2** bounds made exclusive (`<`→`<=`, `>`→`>=`): **22 / 267 red**
- **M3** `scheduleKind`'s early return put back (= revert the card): **17 / 267 red**
- **M4** (extra) `rangeSlice` ignores the range: **5 / 267 red** (A4 periodStatus/report, A6)
- 0 suite-level failures; the 13 range-less preservation tests stayed GREEN under all four -- the expected result for a change that must be neutral without a range.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 13 suites **413/413**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **139 suites / 2271 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 137 / 2235: +2 suites, +36 tests)
- **Not done:** no device/emulator observation (none on this host).

### Open for R01.02-d (not decided here)

- **Decided in R01.02-d (owner):** anchor = max(created_at, range_start) -- see below. Original note:
  `every_n_days` anchors on `created_at`, not on `range_start`: "every 3 days,
  10-20 Aug" for a habit created 1 Aug cycles from 1 Aug. Unchanged by this card
  (trap 2 of R01.02-c pins the anchor rule); the validator/UI card should decide
  whether a range re-anchors the cycle.
- Target proration for cut periods: R01.05.
- `isWindowSatisfied` (no production consumer -- grep finds only a comment in behaviorIntelligence.ts) still uses the calendar window.

## R01.02-d evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `1cd0bc9` (verified at start, tree clean).
- **What it opens:** `validateFrequencyConfig` (`lib/routineProposal.ts`) accepts
  `interval_days`, `range_start`, `range_end`. Callers: `lib/coachActions.ts`
  (AI Coach `propose_habit`) and `validateRoutineProposal`. Traced to the row:
  `coachActionToRoutineProposal` → `validateRoutineProposal` →
  `services/routineService.buildInstallRows` passes `frequency_config` through
  untouched; `habitRepository` selects/maps it whole. No layer filters keys.
  DB is unconstrained jsonb -- **no migration written or needed.**

### Accepted / refused (refuse-don't-coerce, same style as days / part_of_day / count)

| Config | Verdict |
|---|---|
| `{daily, interval_days: 3}` / `365` | accepted as given |
| `{daily, interval_days: 1 \| 0 \| -3 \| 3.5 \| 366 \| '3' \| null}` | refused -- 1/0 are NOT turned into plain daily |
| `{weekly \| monthly, …, interval_days: 3}` | refused (only meaningful with daily) |
| `range_start` / `range_end` alone (one-sided) | accepted |
| both, start ≤ end (incl. a one-day range) | accepted |
| range with every kind (`weekly`+`count`, `weekly`+`days`, `monthly`+`count`, `daily`+interval) | accepted -- envelope |
| `start > end` | refused |
| `'2026-02-30'`, `'5 Ağustos'`, `''`, `'2026-8-5'`, a number, `null` | refused (`parseLocalDate`, the repo's leaf date module -- no hand regex) |
| unknown key (`foo`, `intervalDays`, `range`) | refused, as before |
| `__proto__` / `constructor` next to the new keys | refused, as before |

`MIN_INTERVAL_DAYS = 2`, `MAX_INTERVAL_DAYS = 365` exported next to the count
ceilings. The allow-list doc and `validateFrequencyConfig`'s doc rewritten (why
each key is now accepted; the `monthly` limitation note kept).

### Anchor — owner decision, R01.02-d

`dueOnExtended`'s `every_n_days` cycle now counts from **max(created_at,
range_start)**. Counted from `created_at`, "every 3 days, 11-20 Aug, created
1 Aug" gave 13/16/19 -- the window's first day skipped, which cannot be
explained to a user. Now 11/14/17/20. No range → max is `created_at` →
range-less habits unaffected (A7). No `created_at` but a range → the range
start anchors. Neither → not narrowed (R01.02-c trap 2 kept). Rationale written
at the code site, marked "SAHİP KARARI, R01.02-d".

### Retargeted test

`coachHabitSemantics.test.ts` "refuses schedule fields the scheduler does not
read": its stated reason (`isDueOn` ignores the fields) was voided by R01.02-c
and d1. Not deleted -- turned to the ACCEPT side and widened into 4 tests:
accepts (7 shapes incl. range with every kind), refuses bad intervals (9
cases), refuses bad ranges (7 cases), still refuses unknown fields (3 cases).
The value it protected -- nothing unknown passes silently -- kept explicitly.

### The 9 stale comments (KD-05 class), fixed

R01.02-c's "`isEligibleOn` = `isDueOn` for daily/weekly_days, + every_n_days/date_range."
was wrong twice after d1 (`date_range` is no longer a mode; range clipping is in
`withinLifetime`, so BOTH predicates apply it). Replaced in all 9 places --
`reportMetrics.ts` ×2, `behaviorIntelligence.ts` ×4, `recovery.tsx` ×2,
`habit-detail.tsx` ×1 -- with: "`isEligibleOn` = `isDueOn` for
daily/weekly_days; it adds the every_n_days interval. The date range is not a
mode: it is the lifetime envelope (`withinLifetime`) both read." Diff: 9 comment
lines, 0 code lines. No `date_range` mention left outside `habitSchedule.ts`'s
own history notes.

### Acceptance

| | Result |
|---|---|
| A1 | `{daily, interval 3}` accepted; with weekly refused; 1, 0, 3.5 refused |
| A2 | `{weekly, count 3, 08-05..08-20}` accepted unchanged; evaluated `weekly_count`, eligible every day 5..20 |
| A3 | one-sided ranges accepted |
| A4 | start > end refused; `'2026-02-30'`, `'5 Ağustos'`, `''`, number refused |
| A5 | `foo` refused; `__proto__` / `constructor` still refused, also next to the new keys |
| A6 | validator → `scheduleKind` + `isEligibleOn`: created 1 Aug, every 3 days, 11-20 Aug → **11, 14, 17, 20** (asserted ≠ 13/16/19); created 13 Aug → 13/16/19 (max); no `created_at` → 11/14/17/20; August denominator 4 |
| A7 | **validator:** 34-config corpus without the new keys (11 valid, 23 invalid) captured at `1cd0bc9`, re-run after: verdicts, `frequency` objects, error paths and messages identical, except the allowed-key list inside 2 unknown-field messages, which grows by the three keys (normalised in the comparison and pinned exactly in its own test). **calendar:** `rangelessOutputs` re-captured at `1cd0bc9` before the anchor change and after it -- byte-identical (`cmp`); `rangelessPreservation.test.ts` keeps pinning it |
| A8 | AI Coach `propose_habit` with `{daily, interval 3, 11-20 Aug}`: accepted, action equal to the input; through `coachActionToRoutineProposal` → `validateRoutineProposal` → `buildInstallRows`: `frequency_config` identical on the row. `interval_days: 1` from the coach rejected, not installed |

Negative assertions: interval 1 accepted → red; start > end accepted → red;
unknown key accepted → red; any range-less day output changed → red.

### Mutation proof (6 focused suites, 214 tests; each reverted byte-identical, sha256 of both source files verified)

- **M1** the three keys out of `ALLOWED_FREQUENCY_KEYS`: **10 / 214 red**
- **M2** start ≤ end check removed: **1 / 214 red**
- **M3** anchor back to `created_at`: **3 / 214 red** -- all A6; `rangelessPreservation` (A7) stayed GREEN, as required
- **M4** (extra) `MIN_INTERVAL_DAYS` 2 → 1: **2 / 214 red** (validator + coach path)
- 0 suite-level failures.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 6 suites **214/214**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **140 suites / 2321 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 139 / 2271: +1 suite, +50 tests)
- **Not done:** no screen rendered in this card; no device/emulator (none on this host). `HabitOnboarding.tsx` untouched; `habit-detail.tsx` only its one comment line.

### Found, recorded, not fixed: KD-07 (now reachable)

Opening the validator makes "every N days" installable by the AI Coach, and
the cost side does not read `interval_days`: `triage.costBreakdown`'s
`FREQ_FACTOR` keys on `kind` only, and `capacity.occurrencesPerWeek` returns 7
for `daily`. An every-3-days habit is therefore priced and loaded as daily
(should be ~2.33/week, weight ~0.33). The calendar is right; willpower cost and
capacity load are high. Outside this card's files; flagged so it is decided
before R01.02-e opens the mode to every user via the form.

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
| CP01 Esnek hedef/geçmiş | **büyük ölçüde var** | kanonik motor + eligibility + count-denominator (R01.01-a/R01.02-a) ve tüm tüketiciler dönem semantiğinde (R01.02-b); kalan: izleme semantiği (R01.03), checklist (R01.04), hedef sürümleme (R01.05) |
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

**R01.02-a (DONE, M):** `isDueOn`'un `weekly_count` dalından `countDueDays` kaldırılır — sayı tabanlı modlarda **her gün uygundur** (kaçırma günlük değil dönemseldir); `scheduledCompletionRate` count modlarında paydayı `periodStatus` penceresinden alır. Kabul: T01 tüm `isDueOn` tüketicilerinde sahte kaçırma üretmez; mastery oranı Sal/Per/Paz için 1.0. Scope: `habitSchedule.ts`, `habitSchedule.test.ts`, `phase1Adversarial.test.ts` (gerekçeli güncelleme), `capacity` testleri.
**R01.02-b (DONE, M):** tüketici geçişi tamamlandı — `reportMetrics`, `behaviorIntelligence`, `recovery.tsx`, `weekly/monthly-review`, `insights` **ve** kapsam listesinde olmayan ama aynı kusuru gösteren `habit-detail.tsx` → dönem semantiği; bayat "migration bloklu" yorumları düzeltildi (KD-05). Kanıt aşağıda.

### "R01.02-a gerçekten ilk READY kart mı?" — cevap

Hayır, iki nedenle: (1) rehberin kendi bağımlılığı `depends_on: [R00.02, R01.01]`;
(2) kod kanıtı: pencere değerlendiricisi (`windowFor`/`isWindowSatisfied`/`streakBroken`)
zaten var ve test edilmiş, eksik olan **§7.1 çıktı sözleşmesi** (R01.01) ve
**`isDueOn`'un sabit-gün dalı + tüketiciler** (R01.02-a/b). Bu yüzden ilk kart
R01.01-a'dır; R01.02-a onun ardından, envanterdeki daraltılmış kapsamla gelir.
Helper reuse: `windowFor`, `completedCountInWindow`, `startOfWeekLocal`,
`addDaysLocal`, `daysBetweenLocal`, `ymd` — yeniden yazılmaz.
