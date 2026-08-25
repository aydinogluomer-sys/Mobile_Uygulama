# PROGRESS — IMPLEMENTATION_V2 Execution Log

Plan file: `C:\Users\Trade Bilisim\Downloads\IMPLEMENTATION_V2.md`
Execution model: Orchestrator → Coder (subagent) → QA (subagent) → Orchestrator.
Started: 2026-08-25

---

## Baseline audit (Orchestrator, before Phase 0)

**Rule 7 applied:** the plan document's §2/§3 "ground truth" is STALE. The document
claims `store/` contains only `useStore.ts` and `lib/` only `monthBackgrounds.ts`.
The real repository contains **25 stores** and **24 lib modules**, including every
module §P0.1 lists as missing (`lib/supabase.ts`, `lib/tokens.ts`, `lib/haptics.ts`,
`lib/todayNarrative.ts`, `store/habitStore.ts`, `store/logStore.ts`,
`store/taskStore.ts`, `store/willpowerStore.ts`, `store/focusStore.ts`,
`store/recoveryStore.ts`). Real production code is treated as correct.

### Measured Gate A state at start

| Gate A criterion | Measured | Result |
|---|---|---|
| 0 unresolved import | `tsc --noEmit` exit 0 | **PASS** |
| 0 TypeScript error | `tsc --noEmit` exit 0 | **PASS** |
| lint clean | `expo lint` exit 1 — 21 errors / 75 warnings | **FAIL** |
| project test harness | `node run-tests.js` 139/142 | **FAIL** |
| jest suite | 13 suites, 165/165 | **PASS** |
| Android export | running | pending |
| iOS export | not yet run | pending |
| CI | `.github/workflows` absent | **FAIL** |
| §32 docs (`docs/AUDIT_V2.md`, `ARCHITECTURE_V2.md`, `MIGRATION_V2.md`, `REPO_HEALTH_V2.md`) | absent | **FAIL** |

All 21 lint errors are a single rule: `react/no-unescaped-entities`.

### Assumptions recorded (no user question asked, per general rules)

- **A-01** — The plan's §2/§3 repo inventory is obsolete; Phase 0 is therefore a
  *verification + closure* phase, not a rebuild. Prior work (`docs/audit/*`,
  Gate A closure report dated 2026-08-03) is accepted as evidence and the four
  §32 documents are produced as V2-named consolidations pointing at it.
- **A-02** — Supabase project `kbcuolhjjnmhjaarxxmu` is **unreachable** (MCP
  `execute_sql` and `list_tables` both time out). Schema truth is taken from
  `frontend/lib/supabase.ts`, `supabase/migrations/*` and
  `docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md`. No migration will be
  applied to production in this run — migration files are authored on disk and
  left unapplied. Applying them is a destructive/irreversible action and is
  explicitly out of scope per the STOP rule.
- **A-03** — `frontend/run-tests.js` is the project's structural gate and counts
  toward "test" in the plan's Rule 4. A failing assertion is triaged as either
  STALE (the feature moved, assertion must follow) or REAL (the feature is
  missing, code must follow). Triage is recorded per finding.
- **A-04** — PHASE 5 (Growth) is gated by the plan itself behind "retention
  proven" and is out of scope for this run. It will be reported as deliberately
  deferred, not as incomplete.

---

## Phase log

### PHASE 0 — RECOVERY & ARCHITECTURE

**Branch:** `phase/0-recovery`

#### Orchestrator measurements (2026-08-25)

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | PASS |
| `npx jest` | 0 | 13 suites · 165/165 PASS |
| `node run-tests.js` | 1 | 139/142 — 3 failures |
| `npx expo lint` | 1 | 21 errors (all `react/no-unescaped-entities`) · 75 warnings |
| `npx expo export --platform android` | 0 | **PASS** — 6.23 MB hbc |
| `npx expo export --platform ios` | 0 | **PASS** — bundle emitted |

#### Failure triage (Orchestrator, A-03)

| # | Failing assertion | Triage | Action |
|---|---|---|---|
| 1 | `SearchButton headerRight` | **STALE** — `SearchButton` was replaced by inline `HeaderActions()` in `app/tabs/_layout.tsx:22`, mounted at `headerRight:96`, rendering a ⌘K search pill bound to `useCommandStore().open`. Capability present and richer. | Update assertion |
| 2 | `Bugünün alışkanlıkları listesi` | **STALE** — `app/tabs/today.tsx` still renders the list from `activeHabits` (:59, :289-298); only the header string changed to `RİTÜELLER · BUGÜN`. | Update assertion |
| 3 | `monthly-review: kapak + hareket + sayfa çevirme` | **REAL GAP** — `app/screens/monthly-review.tsx` genuinely lacks `heroMonth`, `MONTH_TAGLINES_TR`, `animatePage`, `pageStyle`, `active={isFocused}`; `calendar.tsx` has all of it. | Implement the feature |

#### Coder → code track — commit `92becd9`

W1 lint (8 files) · W2/W3 stale assertions rewritten · W4 monthly-review seasonal
cover + motion + page-flip implemented from `calendar.tsx` as reference.

**Orchestrator independent verification (not taken on the Coder's word):**

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | **0** |
| `expo lint` | 21 errors / 75 warn | **0 errors** / 74 warn |
| `run-tests.js` | 139/142 | **142/142** |
| `jest` | 165/165 | **165/165** |

Regression guard confirmed by diff: `calendar.tsx`, `components/seasonalMotion/**`
and `store/themeStore.ts` are untouched. `run-tests.js` diff reviewed line by line —
both rewritten assertions still assert specific real behaviour (`headerRight` +
`HeaderActions` + `useCommandStore`; `RİTÜELLER · BUGÜN` + `activeHabits`), neither
was weakened to a tautology. `monthly-review.tsx` diff contains no content deletions —
only import, wrapper and style-line changes.

#### Coder → docs + CI track — commit `85334c9`

Delivered `.github/workflows/ci.yml` and the four plan-§32 documents
(`docs/AUDIT_V2.md`, `ARCHITECTURE_V2.md`, `MIGRATION_V2.md`, `REPO_HEALTH_V2.md`).

**Orchestrator verification REJECTED the first submission** and a correction prompt
was sent back:

- **C-1 (BLOCKER)** — the Rule 4 audit reported **1** direct-DB-call violation. Its
  grep only matched the single-line `supabase.from(` form and missed the multi-line
  `supabase\n  .from(...)` form the codebase actually uses. Corrected to **16
  violations across 9 files** (`app/**` 10 / 5 files, `components/**` 6 / 4 files).
  *The Orchestrator's own correction prompt said 19 — that was an arithmetic error
  by the Orchestrator; the Coder reproduced the scan, showed the tables sum to 16,
  and correctly refused to adopt the wrong figure. 16 is the verified number.*
- **C-2 (STALE)** — "Monthly Review seasonal background actively absent" was read
  before `92becd9` landed. Corrected to RESOLVED.
- **C-3 (STALE)** — baseline drift: lint 21→0 errors, run-tests 139/142→142/142,
  iOS export in-progress→observed PASS.
- **C-4** — Gate A verdict recomputed: 5 of 6 criteria observed PASS; CI authored
  but never executed, deliberately NOT claimed as PASS.

#### QA → code track — verdict `PASS`

| Suite | Passed | Failed | Total |
|---|---|---|---|
| `run-tests.js` structural gate | 142 | 0 | 142 |
| jest (13 pre-existing suites) | 165 | 0 | 165 |
| jest `repo/seasonalRegression.test.ts` (new) | 20 | 0 | 20 |
| **TOTAL** | **327** | **0** | **327** |

QA verified W1 line by line: all 21 entity replacements sit in JSX text nodes, none
in a JS string, template literal or `Alert.alert()` argument — so no user-visible
text regressed. Route audit: **0 invalid routes** across 37 screens.

**F-01 (MINOR, found by QA, fixed — commit `a16d0af`)** — `monthly-review` gained the
seasonal background in `92becd9` but was left on the default opaque `#1D1C17` header,
which covered the top strip of its own `MonthBackground`/`heroCover`. The
`...seasonalHeader` spread was added at `app/screens/_layout.tsx:42`, matching
`calendar`. The regression test now asserts BOTH routes via `it.each`, so they cannot
drift apart again. Assertion proved load-bearing by mutation: reverting the spread
turns it red (1 failed / 19 passed), restoring it turns it green.

#### GATE A — decision

| Criterion | Result | Evidence |
|---|---|---|
| 0 unresolved import | **PASS** | `tsc --noEmit` exit 0 |
| 0 TypeScript error | **PASS** | `tsc --noEmit` exit 0 |
| 0 invalid route | **PASS** | QA route audit, 37 screens, 0 unresolved targets |
| lint clean | **PASS** | `expo lint` exit 0 — 0 errors (74 warnings, out of scope) |
| test PASS | **PASS** | run-tests 142/142 · jest 185/185 (14 suites) |
| Android export | **PASS** | exit 0, 6.23 MB hbc |
| iOS export | **PASS** | exit 0 |
| CI | **AUTHORED, first run pending** | `.github/workflows/ci.yml` — never executed; not claimed as PASS |

**PHASE 0 STATUS: `DONE` (2026-08-25)** — commits `92becd9`, `85334c9`, `a16d0af`.
Gate A passes on every criterion that can be observed locally. CI is the single
unobserved item; it cannot go green until the branch is pushed and GitHub runs it,
which is outside local control. Recorded as an open item, not a blocker.

**Carried into Phase 1 (from the V2 docs):**
- 16 Rule 4 violations to be absorbed by a repository layer
- no repository layer and no service layer exist (25 Zustand stores sit directly on Supabase)
- `tracking_type` models 2 of the 4 types the plan requires (`duration`, `abstinence` missing)
- `recovery_plans` and `daily_capacity` absent from every migration file
- `store/useStore.ts` is dead code (0 consumers); legacy `types/index.ts` Habit has 4 consumers vs 45 for the real type

---

### PHASE 1 — CORE ENGINE

**Branch:** `phase/1-core-engine` (off `phase/0-recovery`)

#### Scoping decision (Orchestrator)

Plan Gate B requires this journey end to end:
`Register → numeric habit → 10.000 target → enter 8.000 → see 80% → create 2.000
recovery → complete recovery → analytics update`.

**A-05 — Supabase is unreachable, so Phase 1 is split by blocked-ness rather than
attempted whole.** The engine work the plan calls "Core Engine" is *domain logic* and
is entirely unblocked: it is pure TypeScript with no I/O. The parts that genuinely
need the DB (persisting `duration`/`abstinence` tracking types, the new
`recovery_plans` columns, the `daily_capacity` table) are authored as **migration SQL
on disk and deliberately left unapplied**. Applying them is an irreversible
production action and is the one thing this run will not do autonomously.

Two Coders dispatched in parallel on disjoint file sets:

| Coder | Owns | Deliverables |
|---|---|---|
| A | Habit Engine V2 | `lib/habitEngine.ts` (4 tracking types, unified completion ratio §8.6), `lib/habitStrength.ts` (time-weighted strength §10), `lib/habitSchedule.ts` extension (§8.7 flexible scheduling + window-based streak) |
| B | Capacity + Recovery | `lib/capacity.ts` (§10 load model, bands, max-capacity replacing fixed max-3, mastery), `lib/recovery.ts` (§9 deficit + strategies), `supabase/migrations/20260825_phase1_core_engine.sql` (**NOT APPLIED**) |

Both are constrained to the domain layer only. Store/UI rewiring (`logStore.calcXp`,
`willpowerStore.canActivate`, `recoveryStore`) is deliberately held back to a separate
task so that a domain regression cannot take the app down with it.

**A-06 — the plan's `tracking_type` requires 4 values; the DB has 2.** Rather than
change the persisted type (blocked), both engines define the V2 union with a
documented adapter from the persisted 2-value type, so the engine is correct the
moment the migration lands. This is recorded as a known, deliberate seam.

#### A-02 CORRECTED — the Supabase blocker is a paused project, not a network fault

Earlier entries recorded the Supabase project as "unreachable / connection timeout".
The real cause has now been identified via `list_projects`:

| Project | ref | Status |
|---|---|---|
| **Alışkanlık Uygulaması** (this app) | `kbcuolhjjnmhjaarxxmu` | **`INACTIVE`** — paused |
| Mas Technic Site (foreign, not ours) | `zdqiujpeewtyhtcqhdcj` | `ACTIVE_HEALTHY` |
| Y Project | `vnnfcwpywdxepdwwuqoo` | `INACTIVE` |
| yasama-sanati | `htpduorvqmidoprkkgwy` | `INACTIVE` |
| MeritFlow | `ieiblroubtzktnykvhhz` | `INACTIVE` |

The queries time out because a paused Supabase project has no running database, not
because of a transient connection issue. This is a **better diagnosis and it changes
the remedy**: no amount of retrying will help. The project must be restored.

**Decision deliberately NOT taken autonomously.** `restore_project` would change
production infrastructure state and carries billing implications, so it is left to the
repo owner even though it is not destructive. Recorded here as the single open
infrastructure decision blocking:
- applying `supabase/migrations/20260825_phase1_core_engine.sql`
- any live schema verification
- the Gate B end-to-end journey against real data

Everything else in Phase 1 proceeds unblocked, because the Core Engine is pure domain
logic by design (A-05).

#### Coders A + B → domain core — commit `ec87457`

**Orchestrator independent verification:**

| Check | Phase 0 close | Phase 1 domain core |
|---|---|---|
| `tsc --noEmit` | 0 | **0** |
| `expo lint` | exit 0 | **exit 0** |
| `run-tests.js` | 142/142 | **142/142** |
| `jest` | 185 / 14 suites | **313 / 18 suites** (+128 tests) |

Append-only claims verified by diff: `habitSchedule.ts` and its test file show
deletions ONLY on the import lines — `isDueOn`, `weekdayIndex` and `countDueDays`
bodies are byte-identical. `lib/supabase.ts` shows 12 insertions / 0 deletions; the
three new `FrequencyConfig` fields are all optional, so every persisted row keeps its
current meaning.

Plan-verbatim acceptance cases confirmed executing (names read from `jest --verbose`):
- `Gate B numeric case: target 10000, actual 8000 -> ratio 0.8`
- `duration case: target 20 min, actual 12 -> 60%, partial`
- `missing Monday does NOT break the streak while the week is still on pace`
- `by contrast, falling genuinely short with no days left DOES break the streak`
  — the negative control, which is what makes the previous assertion meaningful
- `an explicit skip on a due day does not break the streak`

**Notable engineering decisions accepted (each documented in-code):**
- Strength buckets with **zero expected days** are dropped and weights re-normalised.
  Without this a 3-day-old perfect habit would cap at 50. Buckets that have data but a
  poor rate are *not* dropped — only true absence.
- Duration load uses `ln(1+min)/ln(1+90)`, not linear, so a 90-minute habit cannot
  swamp the day. Plan §10 explicitly demands this.
- The fixed `max 3 habit` rule is replaced by a capacity ceiling; a test proves 5 easy
  habits pass from the same baseline at which a 3rd heavy habit is refused.
- `stability_score` is variance-based, not average-based — a habit done perfectly for
  2 weeks then abandoned for 2 has a fine average but is not stable.
- Every capacity constant is labelled **v1 / tunable**; the plan forbids the product
  implying precise psychological measurement.

`supabase/migrations/20260825_phase1_core_engine.sql` — **AUTHORED, NOT APPLIED.**
Reviewed by the Orchestrator: additive only, idempotent, no `DROP TABLE`/`TRUNCATE`/
`DELETE`. The `ALTER ... DROP CONSTRAINT` statements are CHECK-widening inside a single
atomic `DO $$` block that immediately re-adds a wider constraint. Cannot be applied —
project is paused, and applying it is the repo owner's decision.

#### QA → Phase 1 domain core — verdict `PASS WITH FINDINGS`

| Suite | Passed | Failed | Total |
|---|---|---|---|
| jest — 18 Coder suites | 313 | 0 | 313 |
| jest — `phase1Adversarial.test.ts` (QA, new) | 51 | 0 | 51 |
| `run-tests.js` | 142 | 0 | 142 |
| **TOTAL** | **506** | **0** | **506** |

QA probed what the Coders did not: a 200×200 integer + decimal floating-point sweep
(zero rounding mismatches — `8000/10000` never yields 79), all-skip strength logs,
future-dated logs, the 30-vs-31-day bucket boundary, `bandFor` NaN/-1/101 clamping, a
20-habit overload day clamping to exactly 100, `monthly_count` across a real month
rollover and a 28-day February, and the `canActivate` claim re-verified from a
realistic non-zero baseline rather than a hand-picked one. All clean.

**Three findings, all reproduced by the Orchestrator before acting:**

| ID | Severity | Finding |
|---|---|---|
| A-01 | **MAJOR** | `NaN` slips past `habitEngine`'s input guards. `NaN < 0` is `false` and `NaN == null` is `false`, so `const v = value == null \|\| value < 0 ? 0 : value` passes NaN straight through → `completionRatio`/`completionPercent` return `NaN`. Reachable in production: a cleared numeric field gives `parseFloat('') === NaN`, and the whole Gate B journey runs on a numeric input. `completionPercent`'s own doc promises it clamps defensively — it did not. `deriveState` degrades safely on the same input, so the module was internally inconsistent. |
| A-03 | **MAJOR** | The legacy recovery-strategy adapter is a semantic **inversion**, not merely lossy: `skip` → `mini` → `complete_today`. A user who explicitly declined to make up a missed habit ("Telafi etme") round-trips into "I completed the recovery today" — corrupting recovery analytics and misleading the user. The Coder had documented it as acceptable loss; the Orchestrator rejected that assessment because a reversal of meaning is not loss. |
| A-02 | MINOR | Duplicate same-day logs in `habitStrength` resolve by silent last-in-array-wins. Undocumented, unlike every other edge case in that file. |

**Orchestrator decision:** A-01 and A-03 are fixed, not accepted. A-03's fix is free —
both strategy types have exactly four values, so `skip ↔ mini` makes the adapter a
**bijection** that round-trips losslessly in both directions. A-02 is documented rather
than changed, since a "better" rule would need data the type does not carry.

**Gate B — honest status.** The journey is NOT achievable end to end, and this phase
never claimed it would be. QA confirmed by grep that **no store, screen or component
references any Phase 1 export** — the domain layer is deliberately unwired. Per step:

| Gate B step | Domain maths | Wired? |
|---|---|---|
| Register | n/a | blocked — project paused |
| Create numeric habit · set 10.000 · enter 8.000 | pre-existing, untouched | already worked |
| **See 80%** | **correct and proven** (`0.8` → `80`) | **no** — nothing calls `completionRatio` |
| **Create 2.000 recovery** | **correct and proven** (`deficitFor` → 2000, 4 strategies) | **no** — `recoveryStore` untouched |
| Complete recovery | `RecoveryPlanV2` + `expirePlans` tested | **no** |
| Analytics update | out of scope this phase | `reportMetrics.ts` untouched |

Even fully wired, the journey could not run live: the project is paused and the
migration adding the required columns/table is authored but not applied.

#### Coder C → QA finding fixes — commit `93615d1`

| Finding | Decision | Result |
|---|---|---|
| A-01 | **Fixed** | `target` guarded with `!Number.isFinite`, `value` with `Number.isNaN`, plus a final `Number.isFinite` backstop in `completionRatio`. `completionPercent` now never returns `NaN` on any input. |
| A-03 | **Fixed** | `strategyFromLegacy('mini')` → `'skip'`. The adapter is now a verified **bijection**: all four pairs round-trip losslessly in both directions. |
| A-02 | **Documented, behaviour unchanged** | A "smarter" dedup rule would need a `created_at` the type does not carry; inventing one risks discarding legitimate corrections. |

**The Coder's reasoned pushback was accepted.** The Orchestrator's brief said to reject
all non-finite `value` uniformly via `Number.isFinite`. The Coder declined for
`value: Infinity`, because the existing `Math.min(v/target, 1)` already clamps it
correctly to 1 and a blanket rejection would have regressed working behaviour to "fix"
something that was not broken. `deriveState` was left untouched for the same reason.
This is the right call and is recorded as such.

Both fixes were mutation-verified: reverting A-01 turned 7 tests red, reverting A-03
turned 6 red; each was then restored byte-identical.

Caller audit for A-03 found **no production code** references the adapter at all —
zero blast radius.

Tests: 313 → **372** (19 suites). `run-tests.js` unchanged at 142/142.

#### Coder D → store wiring — DISPATCHED

Turns Gate B's "computable" steps into "wired". Targets, with the defects each fixes:

| Store | Current defect | Replacement |
|---|---|---|
| `logStore.calcXp` | **unclamped** — `baseXp * (value/targetValue)` awards >100% XP for an over-target partial log; and NaN-vulnerable, writing `NaN` XP to the DB (same root cause as A-01) | `habitEngine.completionRatio` |
| `willpowerStore.canActivate` | fixed 3-slot rule, which plan §10 explicitly requires be replaced | `capacity.canActivate` / `dailyLoad` |
| `recoveryStore` | ad-hoc, legacy shape only | `recovery.deficitFor` / `recoveryOptions` + the bijective adapter |

Constrained to the store boundary — screens/UI are a separate later task — and forbidden
from writing the `recovery_plans` columns that do not exist yet (migration unapplied,
project paused). Two invariants explicitly protected: `isStale()` gating on
`canActivate`, and `score()` returning `null` rather than a fabricated 100.

#### Coder E → repository layer (Rule 4 compliance) — DISPATCHED (parallel with D)

Plan §33 step 06. `docs/ARCHITECTURE_V2.md` recorded that **no repository layer and no
service layer exist** — 25 Zustand stores sit directly on Supabase, and 16 UI call
sites bypass even those and hit the database from inside screens/components.

Scope: create `frontend/repositories/*` (habitLog, focusSession, focusTask, review,
credit, task), migrate all 16 violating call sites, and add
`__tests__/repo/rule4NoDirectDbInUi.test.ts` as a **multi-line-aware** enforcement
guard so this specific rot cannot recur — the single-line grep is precisely what let it
go uncounted for so long. The guard carries its own scanner-sanity test.

`supabase.auth.*` and `supabase.functions.invoke` are deliberately NOT treated as Rule 4
violations.

Disjoint from Coder D by construction: D owns `store/{log,willpower,recovery}Store.ts`,
E owns `repositories/**` + `app/**` + `components/**`. Neither may touch `lib/**`.

`monthly-review.tsx` carries 2 of the violations AND the Rule 8 protected seasonal
features, so E is explicitly required to keep `seasonalRegression.test.ts` green while
migrating it.

#### Coders D + E → wiring + repository layer — commit `99d9d3d`

**Orchestrator independent verification:**

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | **0** |
| `expo lint` | exit 0 | **exit 0** |
| `run-tests.js` | 142/142 | **142/142** |
| `jest` | 372 / 19 suites | **437 / 29 suites** (+65 tests) |
| **Rule 4 violations** | **16 across 9 files** | **0** — re-measured with the multi-line scan |

**Rule 4 is now held for the first time.** All 16 UI call sites migrated, allowlist
empty. The new guard `__tests__/repo/rule4NoDirectDbInUi.test.ts` prevents recurrence
and — importantly — carries its own scanner-sanity test proving it detects the
multi-line `supabase\n  .from(...)` form. That matters because the single-line grep is
exactly what reported 1 violation instead of 16 earlier in this run. It deliberately
exempts `supabase.auth.*` and `supabase.functions.invoke`.

**Rule 8 held through the migration.** `monthly-review.tsx` carried 2 violations AND the
protected seasonal features; `seasonalRegression.test.ts` (20 tests) stayed green and the
seasonal code is byte-identical.

**Two real production defects fixed by the wiring**, both mutation-verified:
- `logStore.calcXp` awarded **more than 100% XP** for an over-target partial log
  (reverting the fix made the test return 36 instead of 30 — the bug reproducing exactly).
- The same function wrote **`NaN` XP to the database** on a cleared numeric field.
Both fixed at source by routing through `habitEngine.completionRatio`.

**Protected invariants confirmed intact:** `isStale()` remains the first check in
`canActivate`/`spend`/`refund`; `score()` untouched, still returns `null` rather than a
fabricated 100. `canActivate`'s new capacity parameter is **optional**, so every existing
caller behaves exactly as before — required, since neither Coder was allowed to touch
screens.

**Judgement calls accepted:**
- Coder D declined to wire `expirePlans`: nothing specifies *when* a plan becomes
  `expired`, so it left an available export rather than invent a write-behaviour.
- Coder E added explicit `user_id` scoping to `credit_transactions`, which previously
  relied on RLS alone. Same rows under correct RLS, so not a behaviour change, but it
  satisfies plan Rule 2/3 ("RLS is the backstop, not the only guard") and it flagged the
  change rather than sliding it in.
- Coder E preserved a subtle asymmetry in `monthly-review.tsx` (a real DB error yields
  zero-filled stats; a missing session yields an empty array) instead of collapsing both
  into one path — the kind of detail a careless refactor loses.

**Correction to the record:** Coder D reported that a parallel agent was "committing" to
the branch. It was not — `git log` confirmed no unauthorised commits; the inflated test
count it observed was Coder E's unstaged work in the shared tree.

**Still open for Phase 1:** no *screen* passes capacity data into `canActivate` or calls
`recoveryOptionsFor`, so habit activation still uses the legacy fixed-slot path at the UI
level. `store/**` retains 78 direct Supabase call sites (out of Rule 4's scope, which
governs UI). No service/hooks layer yet.

---

#### Coder F → UI capacity/recovery wiring — DISPATCHED (sole writer)

**Process change applied.** Last round two subagents wrote to the same working tree
concurrently and one misread the other's unstaged files as unauthorised commits. From
here: **one writer at a time**, commit before handing off, and verify a subagent's
report with `git status`/`git log` rather than by test counts.

Closes the gap PROGRESS.md itself named: `grep` confirms every UI call site still calls
`canActivate(cost)` with no capacity input, so the app silently takes the legacy
fixed-slot path despite plan §10 requiring it be replaced. `recoveryOptionsFor` has zero
callers, so §9's deficit maths never reaches a user.

Call sites to wire: `app/tabs/habits.tsx` (6), `app/tabs/timeline.tsx` (6),
`components/HabitOnboarding.tsx` (1), `store/habitStore.ts:113` (1).

**Method mandated: red-first.** Every change must be proven by a test that fails before
the fix. A test that passes beforehand means the diagnosis is wrong and the Coder must
stop and report rather than proceed.

#### PHASE 2 — INTELLIGENCE — scoped (Orchestrator, read-only)

Plan §11/§12 + Gate C. Gate C's bar: *"Analytics values raw database samples ile
karşılaştırılacaktır — Completion rate exact · Streak exact · Recovery rate exact ·
Capacity history exact. AI kullanılmadan doğru çalışmalıdır."* So Phase 2's core is again
**pure, exactly-testable domain logic** — which the paused project does not block.

| Item | Plan ref | Notes |
|---|---|---|
| Behavior Intelligence engine | §11 | best/worst day, strongest/most fragile habit, 4-week + 12-week trend, most-recovered habit, recovery success rate, morning/evening difference, streak stability |
| Habit Detail `/habits/[id]` | §11 | 4 tabs (GENEL/GEÇMİŞ/TAKVİM/İÇGÖRÜ); calendar must render `full`/`partial`/`miss`/`skip`/`not scheduled` in **distinct** colours |
| Insights screen | §11 | week/month/habits/capacity/recovery/focus sections |
| Weekly Review | §12 | auto-derived metrics + 3 reflection questions |
| Monthly Review | §12 | month summary, trend, best/worst habit, capacity trend, recovery trend, focus, goals, reflection |

**Note — a Phase 0 fix already discharged part of a Phase 2 requirement.** Plan §12 states
the `MonthBackground` / `GlassPanel` / seasonal-header pattern *"regression nedeniyle
kaybolmuştur. Tekrar bağlanmalıdır."* That reconnection was completed in Phase 0 (commits
`92becd9` + `a16d0af`, incl. QA finding F-01's transparent header) and is now locked by
`seasonalRegression.test.ts`. Recorded so Phase 2 does not redo it.

#### Coder F → UI capacity/recovery wiring — commit `02c351d`

**Verified with `git status`/`git log`, not test counts** (per the corrected process): no
unauthorised commits, `store/willpowerStore.ts` diff empty.

| Check | Before | After |
|---|---|---|
| `tsc` | 0 | **0** |
| `expo lint` | exit 0 | **exit 0** |
| `run-tests.js` | 142/142 | **142/142** |
| `jest` | 437 / 29 | **463 / 34** |

**Red-first evidence accepted.** The headline proof: before wiring, a 5th heavy habit was
**wrongly activated** — 4×18 = 72 current load + 18 incoming = 90, over the 85 ceiling —
because the legacy rule only asked `active_count(4) < focus_capacity(10)`. The test was
red, then green, and no write occurs. This is exactly the failure plan §10 describes.

Also proven red-first: `dailyLoad` had 0 occurrences in both screens; `recoveryOptionsFor`
had 0 occurrences in `recovery.tsx`.

All 14 call sites now pass real capacity data. When the habit list is still loading the
code deliberately falls back to the legacy call rather than passing a half-empty
`activeHabits`, which would **under-report** load and wrongly permit activation.

**Coder's reasoned deviation accepted:** `store/habitStore.ts`'s
`await import('./willpowerStore')` was converted to a static import. Those dynamic imports
could not execute under this repo's jest-expo config at all, so `activateHabit`/`pauseHabit`
were **untestable** — a pre-existing gap, not one W1 introduced. No circular dependency
(`willpowerStore` does not import `habitStore`); behaviour identical.

**Honest gaps reported by the Coder rather than hidden:**
- `Düşük yoğunlukla başla` CTA does not exist anywhere in the codebase — not invented.
- `Yine de etkinleştir` is not a true override; the button re-enables when capacity frees
  up rather than forcing through an `aşırı` verdict. No new activation flow was invented.

#### Orchestrator → plan §9 deficit gap — commit `32fbea1`

Coder F flagged, rather than buried, that its recovery display was wrong:
`fetchHabitLogsForHabitsSince` selected only `habit_id, completed_at, state` — no `value` —
so `deficitFor` had nothing to subtract on a partial day and the screen reported the
**full target** as owed. The plan's §9 headline (10.000 target / 8.000 actual → 2.000)
did not work in the UI even though the engine computed it correctly.

Fixed red-first. `__tests__/repo/recoveryPartialDeficit.test.ts` failed 3 assertions first.

**The test itself had a bug, found and fixed before trusting it:** it sliced the function
body to the first `\n}`, but the inline params object type also closes with `\n}`, so the
body was truncated before `.select(` — it was red for the *wrong reason*. Now slices to the
next top-level `export` and carries a scanner-sanity test so the suite cannot silently
start asserting against an empty string. Mutation-verified: narrowing the select turns it
red again.

Where no value exists (binary habit, or a null `value`), `null` is still passed and
`deficitFor` falls back to its documented conservative behaviour — counts the whole target
as owed, **never under-states**.

`jest` 463 → **467 / 35 suites**.

