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

### PHASE 1 — GATE (plan Rule 4: tsc + lint + test + build)

| Requirement | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npx expo lint` | **PASS** | exit 0 — 0 errors (74 warnings, out of scope) |
| test — jest | **PASS** | 467/467, 35 suites |
| test — `run-tests.js` | **PASS** | 142/142 |
| build — Android export | **PASS** | exit 0 |
| build — iOS export | **PASS** | exit 0 |

**PHASE 1 STATUS: `DONE` (2026-08-25)** — commits `ec87457`, `93615d1`, `99d9d3d`,
`02c351d`, `32fbea1`.

Rule 5 satisfied: no failing test. Rule 8 satisfied: Calendar + Monthly Review seasonal
backgrounds, `GlassPanel` and transparent header all still asserted green by
`seasonalRegression.test.ts` through a repository migration that touched
`monthly-review.tsx` directly.

#### What Phase 1 actually changed for a user

The three engines the plan calls Atlas's differentiators went from "correct in isolation"
to "reachable":

| Plan §  | Before Phase 1 | After |
|---|---|---|
| §8.6 completion ratio | ad-hoc `baseXp * (value/target)` — **unclamped** (>100% XP) and **NaN-writing** | clamped, NaN-safe, via `habitEngine` |
| §8.7 flexible schedule | a `3x/week` habit's Monday miss broke the streak | judged over the weekly window |
| §9 recovery | no deficit concept in UI | real computed deficit, 10.000/8.000 → 2.000 |
| §10 capacity | fixed `max 3 habit`; a 5th heavy habit activated at load 90 vs ceiling 85 | capacity ceiling actually refuses it |
| Rule 4 | 16 direct DB calls inside screens | **0**, guarded by a multi-line-aware test |

#### Gate B — status, stated honestly

Gate B's journey (`Register → numeric habit → 10.000 → 8.000 → 80% → 2.000 recovery →
complete → analytics`) is now **wired end to end in code**, but **cannot be executed and
therefore cannot be certified**: Supabase project `kbcuolhjjnmhjaarxxmu` is `INACTIVE`
(paused) and the Phase 1 migration is authored-but-unapplied. Every step is unit-proven
against fixtures; none is proven against a live database.

Per Rule 5, Gate B is **NOT** marked passed. It is marked *code-complete, live-verification
blocked* — the block is an infrastructure decision belonging to the repo owner
(restore the project, review and apply `20260825_phase1_core_engine.sql`), not a coding gap.

---

### PHASE 2 — INTELLIGENCE

#### Coder G → Behavior Intelligence engine — DISPATCHED (sole writer)

Gate C's bar is *exactness*: "Analytics values raw database samples ile karşılaştırılacaktır
— Completion rate exact · Streak exact · Recovery rate exact · Capacity history exact. AI
kullanılmadan doğru çalışmalıdır." So the brief requires each metric be **hand-computed in
the test** and asserted for exact equality, not compared against whatever the implementation
returns.

Three correctness constraints imposed up front, each a place this kind of engine usually
goes wrong:
- **denominators are scheduled days, not calendar days** — a 3×/week habit must not be
  scored against 7
- **`skip` excluded from both numerator and denominator**, consistent with the rest of the codebase
- **insufficient data returns an explicit signal, never a fabricated number** — following the
  established `willpowerStore.score() → null` precedent ("a guess presented as a measurement
  is a bug")
- **fragility is volatility, not just a low rate** — a steady 60% habit is less fragile than
  one oscillating 100/0, consistent with `capacity.masteryStatus`'s `stability_score`
- **morning/evening**: `habit_logs.completed_at` is a **date string, not a timestamp**, so the
  Coder is instructed to report an honest unsupported-signal rather than infer it

#### Coder G → Behavior Intelligence engine — commit `87f6102`

Verified with `git status`/`git log`: only the two new files, no commits by the subagent.

| Check | Before | After |
|---|---|---|
| `tsc` / `lint` / `run-tests` | 0 / 0 / 142 | **0 / 0 / 142** |
| `jest` | 467 / 35 | **489 / 36** |

**The Coder's red-first evidence was rejected as insufficient and re-done by the
Orchestrator.** Its "red" was `Cannot find module '../../lib/behaviorIntelligence'` —
that only proves the module was absent, not that any individual assertion is
load-bearing. A suite of 22 tests could contain 22 tautologies and still produce that
red. So the Orchestrator mutation-tested the three claims that matter:

| Mutation | Result |
|---|---|
| removed the `skip` exclusion | **1 test red** |
| added `'planned'` back into the recovery-rate denominator | **2 tests red** |
| ranked fragility by mean instead of `stdDev` | **1 test red** |

All three caught, all restored, 22/22 green. The assertions are real.

**Gate C exactness confirmed by reading the test file** — the expected values are
hand-computed in comments and asserted with `toEqual`/`toBe`, not compared against
implementation output:
- completion rate: 3×/week habit, 2 done → **exactly `2/3`, not `2/7`**
- streak: `done,done,skip,done,partial,none` → **exactly 4**, `skip` transparent
- recovery rate: 5 plans (2 completed, 1 expired, 1 cancelled, 1 planned) → **exactly 0.5**,
  `planned` excluded from the denominator

**Honest gap, exactly as anticipated:** `sabah/akşam farkı` is **structurally
uncomputable**. `habit_logs.completed_at` is a date-only string with no time-of-day;
`frequency_config.part_of_day` records intent, not observed behaviour; `created_at` is
row-write time. The engine returns an explicit unsupported signal rather than
substituting a different question for the one the plan asked. This is the correct
outcome — the alternative was a fabricated metric.

Every metric returns `{ok:true,value}` or `{ok:false,reason}`, never a fabricated
number — the same rule as `willpowerStore.score() → null`.

#### Coder H → Habit Detail screen (§11) — DISPATCHED (sole writer)

Route convention deviates from the plan deliberately (Rule 7): the plan writes
`/habits/[id]`, but this repo uses flat `app/screens/*.tsx` with `expo-router`, so the
screen is `app/screens/habit-detail.tsx`. Real code wins over the doc.

Two requirements called out as non-negotiable: the calendar must render
`full / partial / miss / skip / not scheduled` in **five distinct colours** (the plan
states this explicitly), and every `{ok:false}` metric must render its `reason` rather
than a fabricated `0`.

Red-first bar raised after Coder G: a "module not found" red is not accepted as proof.

#### Coder H → Habit Detail screen — commit `03f557d`

| Check | Before | After |
|---|---|---|
| `tsc` / `lint` / `run-tests` | 0 / 0 / 142 | **0 / 0 / 142** |
| `jest` | 489 / 36 | **511 / 37** |

**Route convention deviates from the plan on purpose (Rule 7).** The plan writes
`/habits/[id]`; this repo uses flat `app/screens/*.tsx` with `expo-router`. Real code
wins, so the screen is `app/screens/habit-detail.tsx`.

**This Coder did red-first properly and set the standard.** Rather than accept its own
"file does not exist" red as proof, it registered the route and wrote a **deliberately
wrong stub with two seeded bugs** (`skip`/`miss` sharing a colour, and a
`r.ok ? r.value : 0` fabricated zero). Four assertions then failed for their real reason
— `Expected: 5, Received: 4` on colour distinctness, the literal-zero detector flagging
line 26, the "actually CALLS the Result functions" check, and the navigation check —
**while 18 of 22 assertions in the same run passed**, proving the failures were specific
rather than a blanket "nothing built yet".

**Five distinct calendar colours (plan §11's explicit requirement)** — verified by the
Orchestrator against real token values, not token names:
`full #87A678 · partial #D4A84A · miss #C76A6A · skip #7C97C5 · not_scheduled #56544B`.
Mutation-tested: aliasing `skip` to `miss` turns the assertion red.

**Insufficient data is never fabricated.** Every `Result` branches on `.ok`; the false
branch renders the real `reason`. Numeric slots use this codebase's established em-dash
convention, never a `0`. `currentStreak`/`longestStreak`/`habitStrength` are exempt and
correctly so — they always return a real number, where `0` is an earned answer rather
than a placeholder.

**A repository addition was justified, not assumed:** `fetchHabitLogsForHabit` was added
because `fetchHabitLogsForHabitsSince` filters to `done`/`partial` only, which would have
**silently hidden `miss`/`skip`** from both the calendar and the streak/fragility maths.

Rule 4 held (the single `supabase` reference is a type-only import). Rule 8 held —
`seasonalHeader` still spread on both `calendar` and `monthly-review` after the
`_layout.tsx` edit.

`HabitListView`'s row tap now reaches the detail screen instead of the previous dead-end
`/tabs/habits` push.

#### Coder I → Insights screen + Weekly/Monthly Review completion — DISPATCHED (sole writer)

Plan §11 Insights + §12 Reviews. Rule 8 is the main hazard: `monthly-review.tsx` carries
the protected seasonal treatment AND needs nine new content blocks. The brief requires a
self-regression fence asserting the seasonal code survives its own edits.

Red-first bar now explicitly set to Coder H's standard: seeded-bug stub, right-reason
failures, unrelated assertions passing in the same run.

`morningEveningDifference` is deliberately NOT surfaced — permanently unsupported by the
schema, and dead "unsupported" text is worse than omission.

#### PHASE 3 — ROUTINES & AI — scoped (Orchestrator, read-only)

Plan §13 + Gate D. Existing infrastructure found: `store/routineStore.ts`,
`app/screens/ai-coach.tsx`, `supabase/functions/generate-routine/index.ts`,
`lib/aiInvoke.ts`. So Phase 3 completes and hardens rather than starts from zero.

**The architectural rule is the whole point of this phase.** Plan §13 states:
> AI hiçbir zaman doğrudan database write yapmayacaktır.
```
AI proposal → schema validation → capacity evaluation → user preview
→ explicit confirmation → database
```
Gate D reinforces it: *"AI olmadan uygulamanın bütün core işlevleri çalışmalıdır. AI
failure core product failure yaratmamalıdır."*

So the deliverables are, in priority order:
1. **A validation + capacity gate between AI output and any write.** AI proposes
   structured JSON; nothing reaches the DB without schema validation, a `capacity.ts`
   evaluation, and an explicit user confirmation step.
2. **Routine Packs** (not a giant habit library — the plan explicitly rejects that):
   `MORNING RESET` load 24 · `DEEP WORK` 38 · `SLEEP RESET` 29 · `FITNESS FOUNDATION` 41.
   Installation must be **capacity-aware** — the plan's worked example activates 3 habits
   and queues 2 when the pack would raise daily load by 31%.
3. **AI Coach fed by deterministic summaries, not raw data.** §13 is explicit: send
   `walking_completion_30d = 72`, `monday_completion = 41`, etc. — exactly what
   `lib/behaviorIntelligence.ts` now produces. The engine built in Phase 2 is the
   intended input.
4. **Gate D proof:** a test demonstrating core flows work with AI unavailable/failing.

#### Coder I → Insights + Weekly/Monthly Review — commit `6789bc9`

**The subagent DIED on a network error** (`ENOTFOUND`) immediately before running its
verification commands, so it produced no report. Its work was complete in the tree.
The Orchestrator re-verified everything from scratch rather than trusting an unfinished
hand-off — and that caught a real defect.

| Check | Before | After |
|---|---|---|
| `tsc` / `lint` / `run-tests` | 0 / 0 / 142 | **0 / 0 / 142** |
| `jest` | 511 / 37 | **581 / 42** |

Delivered: `app/screens/insights.tsx` (all six §11 sections, drawer-linked), weekly-review
completed with the six §12 metrics + three reflection questions, monthly-review completed
with all nine §12 blocks, plus `repositories/recoveryRepository.ts`.

`En sorunlu habit` correctly uses `mostFragileHabit` — **volatility, not merely the lowest
rate**. A steady 60% habit is less fragile than one oscillating 100/0.

**ORCHESTRATOR-FOUND DEFECT — a fabricated zero.** The Coder applied the
never-invent-a-number rule correctly to `recoveryCompletion` (`{ok:false,reason}`) and
`taskCompletionRate` (`null`), but missed `totalCompletions`: when the habit-log query
**failed**, the screen rendered `Toplam Tamamlama: 0` — telling the user they accomplished
nothing that week. A fabricated answer, not a missing one; exactly the bug this codebase
already settled via `willpowerStore.score() → null`. Now nullable, rendering `Veri yok`.

Fixed red-first: `__tests__/repo/reviewNoFabricatedZero.test.ts` failed 3 of 4 assertions
while its scanner-sanity check passed — red for the right reason. Mutation-verified
(`: null` → `: 0` turns it red).

**The Orchestrator's own test had the brittleness bug it keeps catching in others.** The
first version was LINE-based; the fix made the expression multi-line, so the assertion
would have stopped finding it and started passing for the wrong reason. Rewritten
window-based. This is the third appearance of the single-line-matcher trap in this run
(after the Rule 4 census and the `recoveryPartialDeficit` body-slicer) — it is now
recorded as a standing hazard for any source-text invariant test in this repo.

### PHASE 2 — GATE (plan Rule 4 + Gate C)

| Requirement | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npx expo lint` | **PASS** | exit 0, 0 errors |
| jest | **PASS** | 581/581, 42 suites |
| `run-tests.js` | **PASS** | 142/142 |
| Android export | **PASS** | exit 0 |
| iOS export | **PASS** | exit 0 |

**Gate C — analytics exactness, without AI:**

| Gate C bullet | Status | Evidence |
|---|---|---|
| Completion rate exact | **PASS** | hand-computed `2/3` (scheduled days, not `2/7`) |
| Streak exact | **PASS** | hand-computed `4`, `skip` transparent |
| Recovery rate exact | **PASS** | hand-computed `0.5`, `planned` excluded from denominator |
| Capacity history exact | **PASS** | `dailyLoad`/`bandFor`, all six band boundaries asserted (Phase 1) |
| Works without AI | **PASS** | the entire engine is pure deterministic TypeScript; zero AI calls |

Orchestrator mutation-verified the engine rather than accepting the subagent's
"module not found" red: removing the `skip` exclusion, re-adding `planned` to the
recovery denominator, and swapping fragility from `stdDev` to mean each turned tests red.

**PHASE 2 STATUS: `DONE` (2026-08-25)** — commits `87f6102`, `03f557d`, `6789bc9`.

One plan §11 item is deliberately NOT delivered: `sabah/akşam farkı` is **structurally
uncomputable** — `habit_logs.completed_at` is date-only with no time-of-day. Reported as
an explicit unsupported signal rather than inferred from `created_at` (row-write time) or
`part_of_day` (intent, not behaviour). Recorded as an honest gap, not silently skipped.

### PHASE 3 — ROUTINES & AI

#### Coder J → AI write-gate + Routine Packs — commit `e3a9a33`

**The pre-existing write path was confirmed unvalidated — verified by the Orchestrator
from git history, not taken on report:**
```ts
difficulty: 3, estimated_minutes: 0,          // hardcoded
await supabase.from('habits').insert(inserts); // bare insert of AI JSON
```
`estimated_minutes: 0` meant `capacity.habitLoad` computed ~0 for every AI-created habit —
the capacity engine was **structurally blind** to them, so a user could install AI routines
indefinitely without the ceiling ever noticing. `AIRoutineModal.tsx:73` wrote on a single
tap, with an `as any` cast defeating the remaining type safety.

Now: `lib/routineProposal.ts` is a hand-written defensive validator (no dependency added)
treating AI output as hostile — prototype-pollution keys, wrong types, absurd values,
duplicates, unknown `tracking_type`, extra keys. Errors accumulate rather than fail-fast;
`ok:false` never carries a proposal. No coercion, because coercion is how bad data gets in.

Pack loads computed **live** from `capacity.ts`, with the plan's numbers stored as data and
never presented as computed. 12% tolerance, justified in the test: `capacity.ts` documents
its own weights as "v1 heuristic, not a measured quantity", so the plan's figures cannot be
reverse-derived exactly.

Red-first with seeded bugs: disabling the schema gate → exactly 2 red / 56 green;
`if (fits)` → `if (true)` → 5 red (habits that should queue appeared force-activated) /
62 green.

`jest` 581 → **664 / 45 suites**.

#### Orchestrator → Rule 8 regression found and fixed — commit `2db2639`

Coder J reported honestly that its own change broke "Rutin Oluştur": the edge function's
`SYSTEM_PROMPT` asks the AI for a **different schema** than plan §13 and never requests
`difficulty`/`estimated_minutes`, so under the new strict validator **every real AI routine
was rejected**. Plan Rule 8 forbids one feature regressing another's working implementation.

Regression reproduced before fixing — the actual rejections against today's real payload:
```
unknown tracking_type 'boolean' — expected one of binary, numeric
difficulty: expected a number, got undefined
estimated_minutes: expected a number, got undefined
```

**The edge function was NOT touched** — deploying it is an irreversible production action
and out of scope. The fix is entirely client-side.

**The trap avoided:** silently defaulting the two missing fields *is* the bug that was just
removed. Instead the adapter marks them `null`, flags the proposal `incomplete`, and the
preview collects `difficulty`/`estimated_minutes` from the user before confirm unlocks.
Nothing auto-fills. User-supplied values are re-run through the full validator — the user is
not trusted either.

A three-way discriminated union (`ok:false` / `complete:true` / `complete:false`) makes
TypeScript itself prevent an incomplete proposal reaching `evaluateProposal`.

Orchestrator mutation check: replacing `null` with a silent `3` turns **6 tests red** — the
"never invent it" rule is genuinely carried by tests, not just by comments.

`jest` 664 → **690 / 47 suites**.

**Reported, not fixed (out of scope):** `supabase/functions/generate-routine/index.ts`
performs **zero** server-side schema validation (`text.match(/\{[\s\S]*\}/)` + `JSON.parse`)
and its prompt diverges from plan §13. Updating it requires an edge-function deploy —
a repo-owner decision.

#### Phase 3 interim gate (after `2db2639`)

| Requirement | Result |
|---|---|
| `tsc --noEmit` | PASS — exit 0 |
| `expo lint` | PASS — 0 errors |
| jest | PASS — 690/690, 47 suites |
| `run-tests.js` | PASS — 142/142 |
| Android export | **PASS** |
| iOS export | **PASS** |

§24 Phase 3 checklist status:

| Item | Status |
|---|---|
| Routine Library | **DONE** — 4 Routine Packs (plan rejects a large habit library) |
| routine install | **DONE** — validate → evaluate → preview → confirm → repository write |
| capacity-aware installation | **DONE** — over-ceiling habits queued, never force-activated |
| AI routine builder | **DONE** — gated; real edge-fn output adapted + user-completed |
| AI task splitter V2 | Coder L — in progress |
| AI weekly insights | Coder L — in progress |
| AI monthly insights | Coder L — in progress |

#### Coder L → splitter V2 + weekly/monthly AI insights — DISPATCHED (sole writer)

Plan §15 preserves the splitter feature but changes its architecture to
`task → decomposition service → AI → validated subtasks → preview → save`.
Plan §13 requires AI be fed **deterministic analytics summaries, not raw data** —
`walking_completion_30d = 72`, `monday_completion = 41` — which is exactly what
`lib/behaviorIntelligence.ts` now produces.

One rule carried forward explicitly: a `{ok:false}` metric must never enter a digest as a
fabricated `0`. Sending `monday_completion = 0` when the data was insufficient would make
the AI **assert something false to the user** — a worse failure than saying nothing.

The Coder is instructed to follow `lib/routineProposal.ts`'s established pattern rather
than invent a second, different validator style.

#### PHASE 4 — PRODUCT POLISH — scoped (Orchestrator, read-only audit)

| §24 item | Actual state |
|---|---|
| notifications | **PRESENT** — `lib/notifications.ts` |
| haptics | **PRESENT** — `lib/haptics.ts` |
| empty states | **PRESENT** — `components/ui/EmptyState.tsx` (editorial variant added in ETAP 15) |
| animations | **PRESENT** — seasonal motion, page-flip, reduce-motion guard |
| skeleton states | **ABSENT** |
| offline sync | **ABSENT** |
| crash reporting | **ABSENT** |
| analytics events | **ABSENT** |
| accessibility | partial — `accessibilityRole`/`accessibilityLabel` used in places, never audited |
| performance audit · onboarding · widgets · store assets | not started |

**The two items that are architecture, not polish:**

1. **Offline-first completion (§18).** The plan calls habit completion "kritik interaction"
   and requires: tap → local optimistic state → UI updates immediately → sync queue →
   Supabase → server confirmation, with network failure held as `pending sync`. This is
   real engineering, and it interacts with `logStore`'s existing serialised write chain
   (one promise per habit/day) — which must not be broken.
2. **Analytics event layer (§22)** with an explicit privacy constraint:
   *"hassas journal metinleri event platformlarına gönderilmemelidir."* Sensitive journal
   text must never leave the device. That is a hard rule, testable by a source-invariant
   guard in the same style as `rule4NoDirectDbInUi`.

Both are unblocked by the paused Supabase project (offline sync can be unit-tested with a
mocked client; the analytics layer is pure until a provider is wired). Widgets and store
assets require native/native-store work outside this run's reach and will be reported as
such rather than faked.

#### Privacy pre-audit for §22 (Orchestrator, read-only)

What actually leaves the device today:

| Call site | Payload | Assessment |
|---|---|---|
| `app/screens/journal-insights.tsx:68` | `{ mode:'insights', period, entries: text }` — **raw journal text** | **Not a §22 violation.** §22 forbids sending sensitive journal text to *event/analytics platforms*; this is the AI journal-insights feature the user explicitly invoked, and the text is its whole input. Recorded because the distinction is easy to lose. |
| `app/screens/ai-coach.tsx`, `store/routineStore.ts` | habit/task summaries, now enriched with `behaviorIntelligence` digests | Aligned with §13 (summaries, not raw rows) |
| `store/notionStore.ts` | `notion-sync` | Out of scope this phase |

**Consequence for the Phase 4 analytics layer:** the constraint is not "journal text never
leaves" — it is "journal text never reaches an *analytics/event* sink." The event layer
(§22's `habit_created`, `habit_completed`, `recovery_created`, `routine_installed`,
`weekly_review_completed`, `ai_routine_generated`, …) must carry **ids, counts, enums and
timestamps only — never free text**. That is a source-invariant worth enforcing with a
guard test rather than a code-review promise, in the same style as `rule4NoDirectDbInUi`.

#### Offline-sync design constraint (Orchestrator, read-only analysis of `logStore`)

`logStore` already serialises writes: `const chains = new Map<string, Promise<unknown>>()`
keyed `habitId|date` (`store/logStore.ts:82-93`). Its documented purpose — *"a second tap
on the same habit waits for the first write to settle, so it observes the row the first one
created and takes the update branch instead of inserting again"* — is what prevents
double-tap duplicate rows.

**Two properties of that chain matter for §18 offline-first, and they pull in opposite
directions:**

1. It is **in-memory and per-process.** It does not survive an app restart. A sync queue
   that persists across restarts (which §18 requires — `pending sync` must outlive the
   session) therefore cannot rely on it for de-duplication on replay.
2. Replaying a queued write after restart hits the **same** insert-vs-update decision with
   **no** in-memory chain protecting it. Naively replaying is how the duplicate rows the
   chain was built to prevent get created anyway — just on a different code path.

So the Phase 4 offline work must persist the queue AND carry the insert/update decision
into replay, rather than assuming the existing chain covers it. The
`habit_logs (habit_id, completed_at)` UNIQUE constraint (confirmed present in
`docs/audit/07`) is the real backstop and should be treated as such — the queue should
reconcile against it, not hope to avoid it.

This is recorded now, before any code is written, because it is exactly the kind of
interlock that looks fine in a unit test with a fresh module and fails on a real device
after a cold start.

#### Coder L → Task Splitter V2 + AI weekly/monthly digests — commit `6b664bc`

| Check | Before | After |
|---|---|---|
| `tsc` / `lint` / `run-tests` | 0 / 0 / 142 | **0 / 0 / 142** |
| `jest` | 696 / 48 | **780 / 51** |

**Honest finding that changed the task: `ADHDTaskSplitter` was DEAD CODE and contained no
AI at all.** No screen imports it (Orchestrator-verified). Its real behaviour: tap
15/25/45 min → build three subtasks from a **hardcoded label table** → write straight to
the DB. No preview, no confirm, failures swallowed into `console.error` where the user
never saw them. So the brief's premise ("AI writes unvalidated here") was wrong — there was
no AI. The Coder said so instead of building a pipeline around a fictional AI call, and
`buildLocalSplitProposal` is an honest deterministic stand-in rather than a fake AI hop.

**The digest rule is genuinely enforced.** A `{ok:false}` metric is **omitted entirely**,
never emitted as `0`. Sending `monday_completion = 0` when data was insufficient would make
the AI **confidently assert something false to the user** — worse than silence. Orchestrator
mutation check: fabricating a `0` turns **4 tests red**.

Raw data is structurally impossible in a digest — the input types can only hold `Result<T>`,
numbers and `{habitName, rate}`; they cannot carry `habit_id`/`completed_at`/`state`. The
two matches for those words in `insightDigest.ts` are doc comments asserting their absence.

**The Coder caught its own methodology error** — its seeded-bug comment contained the text
`return;`, so the assertion **false-passed on a substring match**. It noticed, anchored the
regex to a real line (`/^\s*return;\s*$/m`), re-seeded the real bug, and got a correct red.
This is the **third form** the shallow-text-matching trap has taken this run.

**Edge-function findings — reported, NOT fixed (deploy is a repo-owner action):**
1. No task-decomposition edge function exists at all.
2. `generate-routine` truncates `message` at 500 chars; a realistic weekly digest is ~586 —
   the tail would be **silently** dropped before reaching the model.
3. `mode:'summarize'` falls through to the `'routine'` branch, which expects `prompt` not
   `transcript` — a pre-existing bug, discovered not caused.
4. `context.analytics` is a dead parameter the server never reads.

#### Orchestrator → §22 analytics event layer — commit `06c7a68`

Built directly (zero collision with Coder L). The design decision that matters: enforce the
privacy rule by **allowlisting value SHAPE**, not by blocklisting sensitive key names. A
string passes only if it is structurally a uuid, a short enum token, or an ISO date — prose,
habit titles and journal text fail regardless of which key carries them. A blocklist forgets
the moment someone adds a field; a shape allowlist does not.

Careless payloads are **dropped, not thrown** (a sloppy call site must not crash the app, but
must not leak either), with dropped keys reported on the event so leaks stay observable. An
**undeclared event name throws** — silently emitting one would put an unreviewed payload on
the wire.

The Orchestrator held itself to its own red-first standard: the first red was "module not
found", which it had been rejecting from subagents, so it wrote a seeded-bug stub and got
**exactly 2 red / 4 green**. Mutation-verified.

Pure module + guard only; store/screen wiring is a separate unit.

#### Coder M → offline-first completion (§18) — DISPATCHED (sole writer)

Briefed with the Orchestrator's interlock analysis: the persisted queue **cannot** rely on
`logStore`'s in-memory `serialise()` chain for replay de-duplication, because that chain dies
with the process while `pending sync` must outlive it. The queue must reconcile against the
`habit_logs` UNIQUE constraint — resolving a collision to an UPDATE — rather than trying to
out-clever it in application code.

### PHASE 3 — GATE (plan Rule 4 + Gate D)

| Requirement | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npx expo lint` | **PASS** | exit 0, 0 errors |
| jest | **PASS** | 780/780, 51 suites |
| `run-tests.js` | **PASS** | 142/142 |
| Android export | **PASS** | exit 0 |
| iOS export | **PASS** | exit 0 |

**§24 Phase 3 checklist — all seven items:**

| Item | Status |
|---|---|
| Routine Library | **DONE** — 4 capacity-rated packs (plan rejects a large habit library) |
| routine install | **DONE** — validate → evaluate → preview → confirm → repository write |
| capacity-aware installation | **DONE** — over-ceiling habits queued, never force-activated |
| AI routine builder | **DONE** — gated; real edge-fn output adapted, user completes capacity fields |
| AI task splitter V2 | **DONE** — §15 architecture; found the feature was dead code with no AI in it |
| AI weekly insights | **DONE** — deterministic digest, `{ok:false}` omitted not zeroed |
| AI monthly insights | **DONE** — same |

**Gate D — "AI olmadan uygulamanın bütün core işlevleri çalışmalıdır":**

| Claim | Evidence |
|---|---|
| AI cannot write to the DB | Both new `lib/**` modules import no supabase/repository; 24-test `aiGateD` suite |
| AI failure ≠ product failure | AI throwing / returning garbage → no write, no crash; `dailyLoad`, `canActivate`, `recoverySuccessRate` all proven working in the same run |
| 8 classes of garbage AI output | none reaches a write spy |
| Unvalidated AI output blocked | the pre-existing bare `supabase.from('habits').insert(...)` path is gone |

**PHASE 3 STATUS: `DONE` (2026-08-25)** — commits `e3a9a33`, `2db2639`, `6b664bc`.

**The most consequential thing Phase 3 fixed:** before it, AI JSON was inserted directly with
`difficulty: 3, estimated_minutes: 0` hardcoded. Because `estimated_minutes: 0` makes
`habitLoad` compute ~0, **the capacity engine was structurally blind to every AI-created
habit** — a user could install AI routines without limit and the ceiling would never notice.
That is now impossible: nothing reaches the DB without validation, capacity evaluation and
explicit confirmation, and the two capacity-critical fields are never invented.

**Open, requires repo-owner action (not a coding gap):**
1. Restore paused Supabase project `kbcuolhjjnmhjaarxxmu`; review + apply
   `supabase/migrations/20260825_phase1_core_engine.sql`. Blocks Gate B live verification.
2. Edge-function fixes (deploy required): no server-side schema validation in
   `generate-routine`; `message` truncated at 500 chars vs a ~586-char digest;
   `mode:'summarize'` routed to the wrong branch; `context.analytics` never read.

#### Coder M → offline-first completion (§18) — commit `1696557`

| Check | Before | After |
|---|---|---|
| `tsc` / `lint` / `run-tests` | 0 / 0 / 142 | **0 / 0 / 142** |
| `jest` | 787 / 52 | **813 / 54** |

**The interlock the Orchestrator flagged in advance was exactly where the danger was, and it
was resolved the right way.** Replay does not re-derive the insert-vs-update decision at
all: live taps and cold-start replays funnel through **one shared `attemptWrite`** that
reconciles against the real `UNIQUE (habit_id, completed_at)` constraint
(`insert → 23505 → select + update`). That is idempotent regardless of which process
attempts it, so a cold start with an empty `chains` map is safe **by construction**, not by
hope.

**A subtlety the Coder found that the Orchestrator had not anticipated:** `attemptWrite`'s
"does a row already exist?" check must explicitly ignore the app's **own optimistic
placeholder**. Otherwise a live tap mistakes its own optimistic row for a confirmed DB row
and sends an UPDATE against an id the database never issued. Orchestrator mutation check:
removing that guard fails **18 of 22 tests, including pre-existing baseline ones**.

Two design calls worth recording:
- **Ordering uses a counter, not a timestamp.** Two taps in the same millisecond tie under
  wall-clock time; a counter cannot tie.
- **Network failures do not consume the retry budget.** Being offline is not a reason for a
  tap to expire — only a server that was reached and said *no* counts. Offline-first would
  be self-defeating otherwise. A `rejected` op backs off exponentially and becomes terminal
  `dead` after 5 attempts, staying visible rather than vanishing.

**Interlock verified:** `serialise()`/`chains` bodies are byte-identical (only call sites
were extracted to a variable), and the pre-existing `logStore.test.ts` / `logStoreXp.test.ts`
pass **unmodified** against the new code.

**The cold-start test is a real cold start, not a simulation:** the queue is written straight
to `AsyncStorage` (never via `logHabit`), so `chains` is genuinely empty for that key; and
the mock enforces the actual UNIQUE constraint rather than hand-injecting a 23505 — so what
replay reconciles against is the constraint itself.

Five seeded bugs, all right-reason reds (3/17, 2/17, 18/22, exactly 1, exactly 2 — the last
including a **pre-existing** test, proving rollback is load-bearing beyond the new suite).

#### Orchestrator → Skeleton primitive — commit `1808f8d`

Built directly. Honours reduce-motion, uses the native driver (animates off the JS thread —
which matters precisely when that thread is busy with the fetch it covers), and is
non-interactive (it sits where tappable content will appear).

**The Orchestrator's own test was wrong and mutation caught it.** The "non-interactive"
assertion was **file-scoped**; mutating the primitive to remove `pointerEvents="none"` left
the test green, because `SkeletonLines` further down the same file still had it. Re-scoped to
the default export's own JSX and re-mutated — now correctly red.

**This was the FOURTH form of the shallow-text-match trap in this run:**

| # | Where | Symptom |
|---|---|---|
| 1 | Rule 4 census grep | reported **1** violation instead of **16** |
| 2 | `recoveryPartialDeficit` | body-slicer cut before `.select(` — red for the wrong reason |
| 3 | `aiGateD` | matched `return;` inside a **comment** — false pass |
| 4 | `skeletonStates` | file-scoped match satisfied by a **different component** |

All four produced *silent false confidence* rather than a visible failure. The fix was
identical every time: **anchor the scope, not the pattern.** This is now standing guidance
for every source-text invariant test in this repo.

#### Coder N → wire sync lifecycle + analytics emission — DISPATCHED (sole writer)

Both subsystems are finished and tested but **inert**: `hydrateSyncQueue`/`flushPendingSync`
are called by nothing, no UI shows `pending sync`, and no code emits an analytics event.
This unit makes them live. Requirements called out: hydrate must run **before** any
`logHabit` (its contract replaces the queue wholesale), concurrent flushes must be
prevented, `dead` must be visibly distinct from `pending` (a permanently-failed write that
looks queued is silent data loss from the user's side), and events must be emitted from the
store layer — a screen can be bypassed.


---

## SESSION 2 — 2026-08-30 (Orchestrator resumes at PHASE 4)

### Orchestrator verification of prior state (Rule 7: real code is truth)

Prior phases were re-verified by reading production files, not by trusting the log.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0 |
| `node run-tests.js` | **PASS** — 142/142 |
| Phases 0–3 marked DONE in log | accepted; gate evidence present and consistent with live tsc/run-tests |

### PHASE 4 — measured item-by-item audit (not from the log)

| §24 Phase 4 item | Verified evidence | Verdict |
|---|---|---|
| notifications | `lib/notifications.ts`; call sites in `store/habitStore.ts`, `store/recoveryStore.ts`, `app/tabs/timeline.tsx`; `expo-notifications` plugin present in `app.json` | **DONE** |
| haptics | `lib/haptics.ts`; 12 call sites across tabs, screens and components | **DONE** |
| skeleton states | `components/ui/Skeleton.tsx` (commit `1808f8d`) | **DONE** |
| animations | `components/seasonalMotion/*` (native driver), Skeleton pulse | **DONE (scope met)** |
| offline sync | `lib/syncQueue.ts` + `logStore.hydrateSyncQueue`/`flushPendingSync` fully implemented and tested | **CODE DONE / INERT** — grep proves the only callers are the test file. Nothing calls them at boot or on foreground. |
| analytics events | `lib/analytics.ts` complete + `__tests__/repo/analyticsNoFreeText.test.ts` | **CODE DONE / INERT** — grep proves **zero** emission sites in `app/`, `store/`, `components/`. |
| crash reporting | grep for `Sentry|crashlytics|ErrorBoundary|captureException` across `frontend/` | **ABSENT** — zero matches. No error boundary at all; any render throw is a white screen. |
| empty states | `components/ui/EmptyState.tsx` used in 6 files; repo has 33 routes | **PARTIAL** |
| accessibility | 46 `accessibilityLabel`/`accessibilityRole` occurrences across 13 source files; most of the 25 `app/screens/*` have none | **PARTIAL** |
| onboarding | `components/HabitOnboarding.tsx` is a *habit-creation wizard*, not first-run product onboarding | **ABSENT (first-run)** |
| store assets | `app.json` splash plugin points at `./assets/images/splash-icon.png` — **file does not exist** (real file is `splash-image.png`). `icon/adaptive-icon/favicon` are byte-identical 255,372-byte Expo template placeholders. | **DEFECT + PLACEHOLDER** |
| performance audit | no measurement artefact in repo | **NOT STARTED** |
| widgets | no widget target, no config plugin, no native dirs | **NOT STARTED** |

### Assumptions recorded this session

- **A-05** — **Widgets are deferred, with cause.** iOS WidgetKit / Android
  App Widgets require a native target plus a config plugin and can only be
  built and verified through a custom dev build; this repo is Expo-managed
  with no `ios/`/`android/` directories, and no gate in the plan can observe a
  widget. Writing an unverifiable native target would be code that cannot be
  proven to work — the opposite of what Rule 5 asks. Reported as deliberately
  deferred with the reason, not silently skipped.
- **A-06** — **Store assets: the broken reference is fixed, the artwork is not
  invented.** The missing `splash-icon.png` reference is a genuine build-facing
  defect and is in scope. Producing real brand icon artwork is a design
  deliverable, not a coding one; the placeholders are reported, not replaced.
- **A-07** — **Supabase project `kbcuolhjjnmhjaarxxmu` remains unreachable/paused**
  (carried from A-02). No migration is applied. Live Gate B verification stays
  blocked on a repo-owner action.

### PHASE 4 — work dispatched this session

| Unit | Owner | Scope | Files owned (disjoint by design) |
|---|---|---|---|
| N | Coder | offline sync lifecycle + `logStore` analytics emission | `app/_layout.tsx`, `store/logStore.ts`, `lib/analytics.ts`, `components/ui/SyncStatusBadge.tsx`, `components/ui/index.ts`, `app/tabs/today.tsx`\|`habits.tsx` |
| O | Coder | analytics emission in the remaining stores | `store/habitStore.ts`, `recoveryStore.ts`, `routineStore.ts`, `focusStore.ts` |
| P | Coder | 25 secondary screens: loading states, empty states, accessibility | `app/screens/*.tsx` |
| — | Orchestrator | crash reporting + store-asset defect | `lib/crashReporting.ts`, `components/ui/ErrorBoundary.tsx`, `app.json` |

#### Orchestrator → store-asset defect (§24 "store assets")

`app.json`'s splash plugin pointed at `./assets/images/splash-icon.png` — **a file
that has never existed in this repository** (`git log --all -- <path>` returns
nothing). The real asset is `splash-image.png`.

**Why nothing caught it, which is the part worth recording:** `tsc` does not read
`app.json`; `expo lint` does not read `app.json`; `npx expo config --type prebuild`
exits **0** and echoes the broken path straight back, because config resolution
never stats the file; and jest had never opened `app.json`. A missing store asset
was invisible to *every* gate this project runs, and would have first surfaced as a
build artefact with no splash screen.

Fixed, and guarded by `__tests__/repo/appConfigAssetsExist.test.ts`, which walks
`app.json` generically for `./`-prefixed asset paths rather than checking four
known keys — a hardcoded list would pass forever the day a fifth asset is added,
which is the same "green because it never looked" failure the missing splash
already demonstrated. The suite includes a `refs.length >= 4` assertion so that a
walker returning `[]` cannot make every other assertion vacuously true.

Mutation: restoring the broken path fails **exactly 2 of 7** (the parameterised row
and the named splash assertion), the other 5 stay green.

#### Orchestrator → crash reporting (§24 "crash reporting", §27 "crash monitoring")

Before this: **nothing**. Grep for `Sentry|crashlytics|ErrorBoundary|captureException`
across `frontend/` returned **zero matches**. Any render throw unmounted the whole
app to a blank screen with no diagnostic.

**No SDK was added, deliberately.** Wiring Sentry means committing a vendor
dependency plus a DSN for an account that does not exist, and user error data would
start leaving the device immediately. That is a repo-owner decision, not something to
include inside a "polish" commit. What was built is the seam: one capture funnel
(`reportError`), one swappable sink (`setCrashSink`), chained global handlers, and an
`ErrorBoundary`.

**The design problem that took the actual work — and the mistake worth recording.**
`lib/analytics.ts` can allowlist value *shape* because it authors its own payloads. A
crash report cannot: its message comes from whatever threw, and error messages quote
the offending value back — `JSON.parse` of a journal entry puts that entry verbatim
into a `SyntaxError`; PostgREST puts a habit title into a query string. §22 forbids
sending that.

The first implementation used a **"looks like prose" heuristic** — redact any run of
3+ space-separated words. **Its own tests killed it immediately:** it redacted
`undefined is not an object` and `JSON object requested from habits`, i.e. it
destroyed the diagnostic value of essentially every real error while adding no
protection the structural rules did not already give. The lesson generalises: user
text is not identifiable by *shape* — a word-count rule cannot separate an English
error sentence from a Turkish journal sentence. It is identifiable by **position**:
user content arrives inside a delimiter, because that is how it was interpolated
(runtime-quoted, quoted by our own throws — every interpolating throw in this repo
does it, e.g. `lib/recovery.ts:153` — or in a URL query value).

So the scrubber is structural and high-precision (quoted literals, query values,
emails, tokens) plus a length cap as backstop. The **known gap is documented rather
than papered over**: an undelimited interpolation (`'x: ' + title`) is not caught,
the fix belongs at the throw site, and no such call site exists in the repo today.

A second real bug the tests caught: the Windows path scrubber used `[^\s)]+`, which
**stops at a space** — so `C:\Users\Trade Bilisim\...` left the OS user name in the
report. Personal data riding along in something nobody thinks of as a payload.

**`__tests__/lib/errorBoundary.test.tsx` is the repo's first `.test.tsx`.** It is a
real render test, on purpose: an ErrorBoundary is the *worst* possible candidate for
this repo's source-text instrument, because the only thing worth asserting is a
runtime React behaviour. `getDerivedStateFromError` can look correct and still fail
to catch. The helper `textOf` had to walk `tree.toJSON()` — `root.findAllByType(Text)`
returns test *instances*, not strings, and silently yields `''`, which would have made
every `not.toContain` assertion pass. That asymmetry is exactly the silent-false-pass
family this run keeps meeting.

**Mutation results — 10 mutations, each isolating its own assertion:**

| # | Mutation | Red |
|---|---|---|
| M1 | remove quoted-literal rule | journal excerpt leaks — 1 |
| M2 | remove query-value rule | habit title leaks — 1 |
| M3 | remove install-once guard | double-report — 1 |
| M4 | remove `reportError` try/catch | throwing sink escapes — 1 |
| M5 | remove context shape gate | user text smuggled via `context` — 1 |
| M6 | remove length cap | runaway message uncapped — 1 |
| E1 | `getDerivedStateFromError` stops latching | 5 red, "renders children" correctly stays green |
| E2 | remove `resetKeys` recovery | boundary latches forever — 1 |
| E3 | always reset | infinite throw/catch loop — 1 |
| E4 | remove `reportError` from `componentDidCatch` | crash unreported — 1 |

New suites: `crashReporting` 22/22, `errorBoundary` 6/6, `appConfigAssetsExist` 7/7.

**Still to wire (blocked on Coder N, who owns `app/_layout.tsx`):**
`installGlobalErrorHandlers()` at boot and `<ErrorBoundary>` around the navigator.
The subsystem is complete and tested but, until that wiring lands, **inert** — the
same condition this session found the sync queue and analytics layer in.

#### Orchestrator → **CI has been RED the entire time** (Rule 5 violation, found this session)

The single most important finding of this session, and it invalidates part of the
previous session's gate reporting.

`gh run list` shows the CI workflow **failing on every push**, for every commit of
the previous session — including the ones that closed Phase 1, Phase 2 and Phase 3.
The prior log recorded CI as "the single criterion that cannot be observed locally"
and closed Gate A on that basis. It was observable; it was simply never observed.
Plan **Rule 5** says a phase whose tests do not pass cannot be marked DONE.

**The failing step and why local runs disagreed:**

```
app/_layout.tsx(102,16): error TS2493: Tuple type '[string]' of length '1' has no element at index '1'.
app/_layout.tsx(102,53): error TS2493: Tuple type '[string]' of length '1' has no element at index '1'.
```

Line 102 is ordinary pre-existing auth routing:
`segments[1] === 'forgot-password' || segments[1] === 'reset-password'`.

Root cause, verified rather than inferred:

- `frontend/tsconfig.json` includes `.expo/types/**/*.ts`.
- `.expo/types/router.d.ts` is expo-router's **generated** typed-routes declaration.
- `frontend/.gitignore:7` ignores `.expo/`.

So on a developer machine the declaration exists and `useSegments()` resolves to a
union of real route tuples — `segments[1]` typechecks. In CI's fresh clone it is
absent, `useSegments()` degrades to the 1-tuple `[string]`, and the index is a
tuple out-of-range error. **`npx tsc --noEmit` was checking a different program in
the two places, and the local one was the weaker.**

Reproduced deterministically: moving `.expo/types/router.d.ts` aside locally
produces those exact two errors; restoring it makes them vanish.

Also established, because it changes the fix: **CI can never have that file.**
`npx expo export` does not emit it (tested directly — the types directory comes
back empty). Typed routes are written by the dev server only. Therefore the source
must typecheck *without* typed routes; typed routes are a local nicety and must
never be a load-bearing input to a gate.

**Fixes applied (Orchestrator):**

1. `frontend/tsconfig.ci.json` — same config minus `.expo/types` — plus a
   `typecheck:ci` npm script. `npm run typecheck:ci` now reproduces CI's exact view
   on any machine, so the divergence cannot recur invisibly.
2. `.github/workflows/ci.yml` typecheck step now runs `npm run typecheck:ci`, so
   what CI checks is stated explicitly instead of depending on the accidental
   absence of a gitignored artefact.
3. `react-test-renderer` + `@types/react-test-renderer` promoted to explicit
   devDependencies. A **second** CI-only failure: the new `errorBoundary.test.tsx`
   imported `react-test-renderer`, which was present transitively but undeclared
   and untyped (`TS7016`). Relying on a transitive dependency was a genuine mistake
   in the Orchestrator's own unit, caught by running under CI conditions.
4. The `segments[1]` fix itself is delegated to Coder N, who owns `app/_layout.tsx`
   this round, with the reproduction and the verification procedure.

**Consequence for the record:** Gates A–D were closed against a green local
typecheck while the CI gate was red. The code they certified is not thereby wrong —
`tsc`, jest, `run-tests.js` and both exports really did pass locally — but "CI PASS"
in Gate A was **not** established. It is being established now, for the first time,
as part of the Phase 4 gate.

#### Coder O → §22 analytics emission from the store layer — commit `b2a70d9`

Six of the eleven declared events now actually fire. **Orchestrator verification:**
commit contains exactly the 8 claimed files (disjoint from the other coders), and
the four new suites run **39/39 green** on an independent run.

| Event | Funnel | Why there |
|---|---|---|
| `habit_created` | `habitStore.addHabit`, inside `!error && data` | the only single-habit creation path |
| `recovery_created` | `recoveryStore.addPlan`, past the `error \|\| !data` bail-out | the only place a plan row is born |
| `recovery_completed` | `completePlan`, gated on the UPDATE | the UPDATE is what makes it done |
| `routine_installed` | `routineStore.confirmInstall`, its single success exit | AI path and Routine Pack path both funnel through it |
| `ai_routine_generated` | `generateRoutine`, just past the `adapted.ok` gate | one line covers both accepted branches |
| `focus_started` | `focusStore.start`, **only on `idle → running`** | see below |
| `focus_completed` | `nextPhase`, gated on the `focus_sessions` insert | the row is what makes a session real |

**Three findings that are more than wiring:**

1. **`start()` is also the resume path.** `focus.tsx` calls the same `start()` for
   "Başla" and "Devam Et". An unconditional emit would have inflated session counts
   by one per pause/resume — an analytics layer that lies about its headline metric.
   Gated on the `idle → running` transition.
2. **`nextPhase`'s auto-start inlined `status:'running'`**, so an auto-chaining
   pomodoro would have produced `focus_completed` events **with no matching
   `focus_started`**. Rerouted through `start()`; resulting state identical.
3. **`PHASE_TOKEN`.** The `Phase` union is camelCase, and raw `'shortBreak'` fails
   `buildEvent`'s `ENUM_RE` — it would have been **silently dropped**, leaving every
   focus event without its most important dimension. This is the privacy filter
   working as designed and biting a legitimate caller; mapped to
   `work`/`short_break`/`long_break`.

**Two pre-existing bugs discovered, not caused:** `recoveryStore.completePlan` and
`focusStore.nextPhase` both **discarded the Postgrest result entirely**, so a
rejected write still updated local state. "Do not emit when the action fails" was
not even expressible until the error was captured. The error is now captured and
gates only the event; prior behaviour is unchanged and asserted unchanged.

**15/15 mutations red for the expected reason.** All tests are behavioural: the mock
keeps the **real** `buildEvent` via `requireActual` and replaces only `emitEvent`, so
every assertion exercises the shipping privacy filter against a real
`AnalyticsEvent`. No source-text matching anywhere — the right instrument for this job.

**The shallow-match trap appeared a FIFTH time, and the Coder caught it themselves:**
a loose `grep -l "review" store/` reported a hit on `routineStore.ts` — the substring
came from the word "p*review*" in a comment. The anchored check
(`weekly.review|reviewRepository`) returns zero. Same lesson, fifth form: anchor the
scope, not the pattern.

**Deliberately left unwired, with reasoning — `weekly_review_completed`.** There is
no weekly-review store; the save path is `app/screens/weekly-review.tsx:244` →
`repositories/reviewRepository.ts::upsertWeeklyReview`. The repository is the only
honest non-screen funnel, and it was not this coder's to edit. Monthly review is
worse — screen-level AsyncStorage. **Caveat for whoever wires it:** the function is
an **upsert**, so a user editing their review a second time would fire a second
"completed"; it needs an insert-vs-update distinction.

**Recorded risk:** `b2a70d9` does not compile standalone — it needs Coder N's
`emitEvent`/`setAnalyticsSink` export, which was still uncommitted when it was
pushed. Harmless once N lands, but the branch is briefly non-bisectable.

#### Coder N → sync lifecycle + logStore analytics — commit `e406ece`

Verified: 11 files, `typecheck:ci` 0 errors (the `segments[1]` CI fix landed), and
`hydrateSyncQueue` awaited in the boot chain with `flushPendingSync` on boot and on
`AppState -> 'active'`, confirmed by reading the file.

**A pre-existing bug the brief assumed did not exist:** `_layout.tsx` did **not**
gate rendering on `loading` — it gated only the *redirect* effect, so `<Stack>`
rendered unconditionally. The "hydration before first tap is structural" guarantee
the brief took for granted was not actually there. A render gate was added, which is
what makes it true.

**A SIXTH form of the shallow-match trap, found by the Coder mutating their own
tests:** `expect(a.indexOf(x)).toBeGreaterThan(a.indexOf(y))` **passes when `y` is
deleted**, because `indexOf` returns `-1` and every real index beats it. Removing the
hydration call initially turned only 2 assertions red; two ordering checks
false-passed. Fixed with an `at()` helper that throws on absence — the mutation then
goes red on 4. **Any ordering assertion in this repo built on raw `indexOf` has this
bug.** This is now standing guidance alongside "anchor the scope, not the pattern".

Other decisions worth keeping: the badge is deliberately **not tappable** (a retry
button would be a lie — `orderedPending` excludes `dead`, so a flush never touches
it; recovery is `enqueue`'s revival-on-fresh-tap, which the a11y label states);
emission is gated on `result.ok` after the rollback branch, and `runFlushPass`
**never** emits, so replay cannot double-count; the analytics default sink is a
**no-op, not a dev console** — the opposite of `crashReporting.ts`'s choice, because
a crash is rare and a habit completion is not.

12 mutations, all red for the right reason, including two honest limits the Coder
recorded: M5 leaves the *structural* assertion green (only the behavioural test
catches it — correct division of labour), and M9 needed an M9b because the call site
has its own catch.

#### Coder P → 25 screens: accessibility, skeletons, empty states — commit `d778b41`

**134 `accessibilityRole`, 118 Turkish `accessibilityLabel`, 48 `accessibilityState`,
14 `accessibilityHint`, 56 decorative icons hidden — from a baseline of literally
zero.** Every one of ~116 touchables in `app/screens/` is now labelled.

**The Orchestrator's brief was wrong about the size of the spinner problem, and the
Coder corrected it with evidence.** "47 ActivityIndicator across 19 files" came from
`grep -c`, which counts *lines*, not elements: the real figure was 20 JSX sites
across 15 files, only **5 full-screen**. 7 were replaced with skeletons; **13 were
deliberately left** — in-button indeterminate actions, pull-to-refresh, and the
ai-coach "typing" bubble (an LLM reply has no known geometry, so a skeleton would
lie about it). The real gap was accessibility, not spinners.

**A bug the brief did not know about:** `notes`, `deep-work`, `goals` and
`reading-list` all destructure `loading` from their store and **never read it** — so
they render "Henüz not yok" *while the fetch is still in flight*. A false empty state
is worse than a spinner, because it tells the user their data is gone. Fixed in all
four. **`monthly-review`'s real gap was not a spinner either:** two report sections
were `{x.length > 0 && ...}`, so heading and all vanished silently when empty.

**Process incident, self-corrected:** the Coder's first `git commit` (no pathspec)
swept in 11 files another agent had staged in the race window. They caught it,
`reset --soft`, and re-committed with an explicit pathspec. Nothing was lost or
misattributed in the final history. **Standing rule for this branch: never a bare
`git commit`/`git add -A` while agents share a working tree — always
`git commit -F <msg> -- <paths>`.**

**Escalated to a follow-up unit:** `components/ui/Button.tsx` and `Chip.tsx` render
bare `TouchableOpacity` with closed prop types that forward **no** accessibility
props — `Chip` takes a `selected` prop and never emits `accessibilityState`. A
screens-scoped scan cannot see this. Dispatched as Coder Q.

#### Orchestrator → crash reporting wired — commit `47a2484`

`installGlobalErrorHandlers()` at **module scope, not in an effect**: an effect runs
no earlier than after the first render commits, so a throw in this module's own
import chain or in the first render itself happens before the handler exists and is
lost — and a boot crash is the crash most worth reporting. `ErrorBoundary` wraps the
navigator with `resetKeys={[segments[0]]}` — never resetting latches the user into
the fallback until they force-quit; resetting on *every* route change would
re-render the broken subtree instead of the fallback. 4 mutations red for the right
reason; W1 deliberately left the comment behind and still went red, proving
`stripComments` works.

#### Orchestrator → performance audit + waterfall fix — commit `5738b8a`

Full audit in `docs/PERFORMANCE_AUDIT_V2.md`, measured against §28's three criteria.

- **Waterfall: one violation, FIXED.** `stats.tsx` awaited four independent things on
  four lines. None consumes another's output — they were serialised only because each
  `await` sat on its own line, costing the Stats tab **4 round trips instead of 2**.
  Not a missing capability: `today.tsx:74` already batches five fetches in one
  `Promise.all`. Mutation: restoring the waterfall turns all 6 real assertions red
  while the 4 scanner-sanity tests correctly stay green.
- **Unbounded chart render: PASS.** Every chart input is structurally capped.
- **Full-data fetch: 4 violations, REPORTED NOT FIXED.** `noteStore`, `taskStore`,
  `projectStore`, `readingListStore` fetch every row the user has ever created.
  **Adding `.limit(n)` without pagination UI would not make the app faster — it would
  make it silently wrong**, hiding the user's older data with no indication anything
  was withheld. That is a worse defect than the one being fixed and is not what
  "performance audit" authorises. Needs its own feature-shaped unit.

The audit also states its own **limits** explicitly: static analysis only; frame
time, list virtualisation, re-render volume and bundle size are out of scope and need
a device profiler.

#### Orchestrator → **the TZ pin had never worked** — commit `4b5d4ae`

With typecheck and lint finally green in CI, the next failure appeared: 3 suites /
5 tests, all timezone.

`jest.setup.js` sets `process.env.TZ = 'Europe/Istanbul'`, and its own comment claims
it runs "before any module — and therefore any Date — is loaded". It does not.
`setupFiles` runs **inside an already-running worker**, by which point Node has
resolved and cached the local zone; the assignment changes the variable and nothing
else.

**So the mechanism had never worked — and nothing revealed it, because the machine
this project is developed on IS Europe/Istanbul.** The pin was invisibly redundant
locally and inert in CI: `date.test.ts` was passing for the *wrong reason* on one
machine and failing honestly on the other.

**This is the SECOND bug of exactly this class found this session** — the local
environment silently supplying what the code assumed, so a broken mechanism looked
sound. The first was `.expo/types/router.d.ts`. Both were invisible to every gate
until CI was actually read.

Fixed with `jest.globalSetup.js`, which runs once in the parent **before any worker is
forked**, so workers inherit `TZ` at spawn and Node *starts* in the right zone. The
`jest.setup.js` assignment is kept for `--runInBand`. No new test was added, on
purpose: the correct test already existed — `date.test.ts`'s
`getTimezoneOffset() === -180` guard, whose comment reads *"If this fails, every
assertion below is meaningless."* It did exactly its job. Evidence is the before/after:
`TZ=UTC npx jest` saw `0` instead of `-180`; with the fix, the **full suite passes
985/985 across 69 suites under `TZ=UTC`**.

#### Orchestrator → **the structural gate depended on a gitignored `.env`** — commit `99ced94`

With typecheck, lint and jest all finally green in CI, the next failure surfaced:
`run-tests.js` exited 1. Locally it reports 142/142; in CI it **crashed before
running**, because line 144 did `read('./.env')` and `.env` is gitignored, so a clean
clone has none. `ENOENT` took the whole script down.

**This is the THIRD bug of this exact class found this session:**

| # | Gate | Local-only file it silently depended on |
|---|---|---|
| 1 | `tsc --noEmit` | `.expo/types/router.d.ts` — tsconfig includes it, .gitignore excludes it, CI never has it |
| 2 | `jest` TZ pin | none — but the dev machine *is* Europe/Istanbul, so a pin that never worked looked fine |
| 3 | `run-tests.js` | `.env` |

And the diagnosis had **already been written down**: `jest.config.js`'s own comment
reads *"Never read .env - the old run-tests.js did, and a test that depends on a
gitignored file is not reproducible."* It was fixed for jest and left in place in
`run-tests.js`.

The fix is not to make the read tolerant. The meaningful, reproducible invariant is
not the *contents of a developer's `.env`* — it is that the client is configured from
the right environment variable names, and that fact lives in the repository, in
`lib/supabase.ts` (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`). A
missing `.env` is a setup problem the app surfaces at runtime; it is not something a
structural gate can meaningfully assert. Assertion count unchanged (2 → 2), still
142/142, and CI parity proven directly by moving `.env` aside and re-running.

#### Orchestrator → §24 "onboarding" — VERIFIED ALREADY DONE, and an earlier audit entry corrected

**Correction to this session's own Phase 4 audit.** The audit recorded onboarding as
"ABSENT (first-run)", on the reasoning that `components/HabitOnboarding.tsx` is a
habit-creation wizard rather than a first-run product intro. That reasoning imported
an assumption the plan does not make: **the plan never asks for a first-run intro
anywhere.** §24's one-word "onboarding" bullet is specified concretely in §25, which
asks for `HabitOnboarding.tsx` to become a *Habit Creation Wizard V2* with a named
seven-step flow.

Checked against the real file (Rule 7 — production code is the truth). It declares
`TOTAL_STEPS = 7` and covers every step §25 names:

| §25 step | Where |
|---|---|
| 1 Identity | step 1 — name, behaviour type, life area |
| 2 Tracking | step 2 — binary / numeric + unit + goal |
| 3 Schedule | step 3 — daily / weekly / monthly frequency |
| 4 Difficulty | step 5 — difficulty + willpower cost, with a transparent breakdown |
| 5 Reminder | step 3 — reminder toggle + time presets + free entry |
| 6 Capacity preview | step 7 — `canActivate` against real `activeHabits`, slot and budget arithmetic |
| 7 Activate / Queue | step 7 — `plannedStatus` resolves to `active` \| `waiting` \| `idea` |

Step 7 is the substantive one and it is genuinely the Capacity Engine surfacing at
creation time, not a summary screen: it names the destination, shows
`active_count + 1 / focus_capacity` and `used + willpower_cost / daily_budget`, and
handles the capacity-full case explicitly ("Kapasite dolu … Yer açarak
aktifleştirebilirsin") rather than silently activating over the ceiling.

Two deviations from §25's literal ordering, both judged acceptable: the reminder is
folded into the schedule step rather than standing alone (it is a scheduling
decision), and there is an **extra** step 4 for priority/triage that §25 does not
list. The plan's list is a flow sketch; every named concern is covered and one more
besides.

**No work was done here, deliberately.** Building a first-run carousel would have been
scope the plan never asked for, layered on top of a feature that already satisfies
the requirement.

### 🟢 CI IS GREEN — for the first time in this project's recorded history

Run `33291446570`, commit `99ced94`, **3m13s, all seven steps passed**: `npm ci`,
`typecheck:ci`, `expo lint`, `jest --ci`, `run-tests.js`, Android export, iOS export.
Remaining annotations are warnings only (Node 20 deprecation notice, exhaustive-deps).

This closes the finding that opened this session. Gate A's **"CI PASS"** criterion is
now *established* rather than assumed — the previous session recorded CI as
unobservable and closed Gates A–D against a green local run while every push was red.
Getting here took three fixes, all of the same class (a gate silently depending on a
file only the developer's machine has): `tsconfig.ci.json` for the generated
typed-routes declaration, `jest.globalSetup.js` for the TZ pin that had never worked,
and removing `run-tests.js`'s read of a gitignored `.env`.

#### Coder R → `weekly_review_completed` from the repository — commit `69c8459`

**Orchestrator verification:** 2 files, 18/18 green on an independent run, and the
guard reads as described — `isFirstSave = probeError == null && existing == null`.

The eleventh and last emittable event. The substance was not the emission but the
**upsert double-fire**: `upsertWeeklyReview` cannot tell insert from update, so a user
editing their review a second time would fire a second "completed".

Solved with a `select('id')` probe on `(user_id, week_key)` before the upsert. Two
details make it honest rather than merely working:

1. **A failed probe is not read as "no row".** `probeError == null && existing == null`
   — unknown means silent. For an exactly-once event, under-counting is the correct
   failure direction.
2. **The probe's error is never returned.** A read that exists only to answer an
   analytics question must not be able to fail the user's save.

**The race is documented in the file, not hidden.** Probe + upsert are two round
trips, so two writers inside that window both see "no row" and both emit. Accepted
because the key is `(user_id, week_key)`: the only writer who can collide with you is
you, on a second device, on the same week, within a few hundred milliseconds — and
the blast radius is bounded to analytics, since the upsert remains one atomic
statement with unchanged last-write-wins semantics. No review is lost or corrupted.

Three alternatives were evaluated and rejected **in the file, with reasons** — the
`created_at`/`updated_at` discriminator the Orchestrator's brief suggested turned out
to be **unavailable**: no in-repo migration defines `weekly_reviews` at all (it exists
only remotely), and `WeeklyReviewRow` declares `created_at` alone. The Coder correctly
declined to query the live database to check, per the standing constraint, and
recorded the choice as *rejected for lack of evidence* rather than rejected on fact.
`insert()`-then-`update()`-on-`23505` is genuinely atomic and is the right answer if
this ever becomes contended; it was rejected because it rewrites the user's save path
to buy accuracy on a counter.

**The mutation pair worth keeping (M4 / M4b).** A *long prose* leak is invisible in
`props` — the shipping filter eats it — so only `expect(dropped).toEqual([])` catches
it. A *short token* survives the filter, so only key-set equality catches it. Two
different assertions, each load-bearing against a different leak shape, both proven by
mutation. 8 mutations total, all red for the right reason.

**Monthly review — investigated, deliberately not wired.**
`app/screens/monthly-review.tsx:295` writes straight to `AsyncStorage` inside
`handleSave`. There is no monthly-review repository, store, or table. Emitting an event
there would mean either putting analytics in a bypassable screen, or hanging it off an
AsyncStorage key where "first save" is *per device* and a reinstall silently re-fires
it — **an event whose funnel is device-local storage measures devices, not reviews.**
`monthly_review_completed` is not in `ANALYTICS_EVENTS` and `buildEvent` throws on
undeclared names, so nothing can emit it by accident meanwhile.

The Coder also surfaced the underlying product defect, already logged in
`docs/audit/03_UNFINISHED_AND_BROKEN_WORK.md` as P1/P2: monthly reflections are
device-local, lost on reinstall, and the UI says "Kaydedildi" regardless.
Recommendation: give monthly reviews a real table + repository mirroring
`weekly_reviews`, *then* add the event. Carried to open items.

**Shared-tree hazard confirmed as live, not theoretical.** Coder R observed a
concurrent agent's suite grow from 1 test to 38 mid-verification, and correctly
reported both the raw figure and the figure excluding the other agent's in-progress
file. They also caught that the Orchestrator's stated jest baseline (975/68) was
already stale (985/69) — a consequence of briefing from numbers captured before two
other units landed.

### §22 analytics — all eleven declared events verified emitting

Checked by resolving each declared name to a production call site (excluding
`lib/analytics.ts` itself and all test files):

| Event | Emitted from |
|---|---|
| `habit_created` | `store/habitStore.ts` |
| `habit_completed` / `habit_partial` / `habit_missed` | `store/logStore.ts` |
| `recovery_created` / `recovery_completed` | `store/recoveryStore.ts` |
| `routine_installed` / `ai_routine_generated` | `store/routineStore.ts` |
| `focus_started` / `focus_completed` | `store/focusStore.ts` |
| `weekly_review_completed` | `repositories/reviewRepository.ts` |

**11/11, and not one of them from a screen.** Six production files carry emission.
The layer went from zero call sites at session start to complete.

### §27 Definition of Done — independently verified, with two honest nuances

Confirmed by reading production code rather than trusting the log:

- **notifications are genuinely wired**, not stubbed: `scheduleHabitReminder` on
  create / update / activate, `cancelHabitReminder` on delete / deactivate
  (`store/habitStore.ts:92,129,130,137,146,162`), permissions requested in
  `lib/notifications.ts:25`.
- `EmptyState` now used in **17** files under `app/`, `Skeleton` in **11**.

Two DoD items need a qualifier rather than a tick:

1. **"duration habits" — expressible and tested, but not reachable.**
   `lib/habitEngine.ts:22` declares `'duration'` in `TrackingType`, and the engine
   and its tests handle the case. But `adaptTrackingType` **never produces it**:
   lines 44–48 state plainly that today's schema has no field distinguishing
   "numeric with a duration unit" from any other numeric habit. So a user cannot
   currently create a duration-tracked habit. This is a **documented, deliberate**
   decision recorded in the code, not a hidden gap — but the DoD box is not honestly
   tickable until the schema carries the distinction.

2. **RLS is authored, not proven live.** Policies exist across
   `001_initial_schema.sql` (5), `002_integrations.sql` (2) and
   `20260825_phase1_core_engine.sql` (1). Per assumptions A-02/A-07, the Phase 1
   migration remains **unapplied** because the Supabase project is paused. §28's
   "RLS tested / cross-user isolation proven" therefore cannot be claimed from this
   run — it needs the project restored and the migration applied, which is a
   repo-owner action deliberately out of scope.

#### Coder Q → `components/ui` accessibility contract — commit `56bbee8`

14 files, +810/−45, 38 new render assertions. **Nine of fourteen** primitives had
closed prop types, not the two the brief named.

**The uniform contract:** props became `AccessibilityProps & {…}` (the accessibility
surface only, not all of `TouchableOpacityProps`), rest-spread as `...a11y`, and in
JSX **defaults are written first, `{...a11y}` second** — so a caller-supplied
role or label always wins. Owned state merges last as
`{...owned, ...a11y.accessibilityState}`: the component's truth is the base, the
caller wins on a conflicting key. M2 (moving the spread before the defaults) locks
the ordering in.

**Two defects the brief did not anticipate, both worse than the ones it named:**

1. **`SyncStatusBadge` had a carefully written `accessibilityLabel` that was never
   read** — the container lacked `accessible`, so the two pill texts were announced
   separately and the label was inert. The casualty was the `dead`-op recovery
   sentence ("tekrar dokun"), i.e. **the one genuinely actionable accessibility
   string in the app reached nobody.** Ironically this was the badge built one unit
   earlier in this same session, whose whole design rationale was that a
   permanently-failed write must not look like a queued one.
2. **Every input on every auth screen was nameless.** `FloatingLabelInput` floats
   its label as a *sibling* `<Text>` and sets `placeholder=""` deliberately, so a
   screen reader had nothing to announce. Login, register, forgot-password and
   reset-password were all affected.

**Judgement calls worth keeping:**
- **`Chip` emits `accessibilityState={{selected}}` only when `selected` was actually
  passed.** Always emitting it would announce "not selected" on a static label chip —
  a new lie replacing an old silence. M6 locks this in.
- **`Card` gets no default label.** Its children are text and `TouchableOpacity`
  already aggregates them; a synthesised label would *replace* that aggregation and
  lose information.
- **`ProgressBar`/`ProgressRing` have two modes:** unlabelled → hidden as decorative
  (every current caller already has adjacent text stating the number, so announcing
  it again context-free is noise); labelled → `role="progressbar"` with a clamped
  `accessibilityValue`. `ProgressRing`'s `<Svg>` is always hidden but its `children`
  deliberately are not — the text in the middle of the ring is its only meaningful
  output.
- **`SectionHeader` was deliberately NOT widened** with `AccessibilityProps`: it
  *contains* a pressable but is not one, so "which element do these apply to?" would
  be ambiguous. It got explicit `actionAccessibilityLabel`/`Hint` props instead.

**18 mutations — and M18 is the one worth recording, because it stayed GREEN.**
It disproved a claim the Coder had written in a comment (that an extra
`setTimeout(0)` tick was load-bearing), and they **deleted the redundant line rather
than keep an unearned claim**. They then found the sharper mutation:
`await act(async …)` → `act(() => …)` leaves the whole file green — because the icon
font is already loaded by the time later tests run — but fails with
`Received length: 0` when the icon test is the *first* render in the process. The
comment now states exactly that, including that the mutation is invisible in a
whole-file run.

**A new trap for this repo's collection, specific to component tests:**
`@expo/vector-icons` renders a props-less `<Text />` until its font resolves, so a
naive "the decorative icon is hidden" assertion **passes even with the fix fully
deleted**. Anyone writing component tests here needs to wait for the font first.

Also: a first-draft assertion that `accessibilityState` is `undefined` on a pressable
`Card` failed, because RN's own Pressability always synthesises
`{selected: undefined, disabled: undefined, …}` on a touchable. Retargeted to the
`selected` key on the pressable branch and object-absence only on the plain-`View`
branch. Every negative assertion in the file is paired with a positive that would
fail if the tree were empty.

---

## PHASE 4 — GATE (plan Rule 4 + §24 checklist + §28 Quality Gates)

Run on `phase/1-core-engine` HEAD after all five units landed.

| Rule 4 requirement | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** | 0 errors |
| `npm run typecheck:ci` (CI parity) | **PASS** | 0 errors — new this session |
| `npx expo lint` | **PASS** | 0 errors, 73 warnings |
| `npx jest` under `TZ=UTC` | **PASS** | **1041 / 1041, 71 suites** |
| `node run-tests.js` | **PASS** | 142 / 142 |
| Android export | **PASS** | in CI |
| iOS export | **PASS** | in CI |
| **CI** | **PASS** | run `33291446570`, 3m13s, all seven steps — **first green CI in this project's recorded history** |

Baseline at session start: 813 tests / 54 suites. Net **+228 tests, +17 suites**, all
green, and green under CI's conditions rather than only this machine's.

### §24 Phase 4 checklist — item by item

| Item | Status | Note |
|---|---|---|
| notifications | **DONE** | pre-existing; verified genuinely wired (schedule on create/activate, cancel on delete/deactivate), not stubbed |
| widgets | **DEFERRED (A-05)** | needs a native target + config plugin; no gate in this plan can observe one, and this is an Expo-managed repo with no `ios/`/`android/`. Writing unverifiable native code would violate Rule 5 |
| animations | **DONE** | pre-existing `seasonalMotion` + `Skeleton` pulse, native driver, reduce-motion honoured |
| haptics | **DONE** | pre-existing, 12+ call sites |
| accessibility | **DONE** | screens: 0 → 134 roles / 118 Turkish labels / 48 states (Coder P). Primitives: 9 of 14 had closed prop types, now a uniform contract (Coder Q) |
| empty states | **DONE** | `EmptyState` in 17 files under `app/` |
| skeleton states | **DONE** | primitive from the prior session, now applied; `Skeleton` in 11 files |
| offline sync | **DONE + WIRED** | was complete, tested, and **called by nothing** |
| crash reporting | **DONE + WIRED** | was **entirely absent** — zero matches for `Sentry\|ErrorBoundary\|captureException` |
| analytics events | **DONE** | **11 / 11** declared events emit, all from store/repository funnels, none from a screen. Was zero call sites |
| performance audit | **DONE** | `docs/PERFORMANCE_AUDIT_V2.md`; one waterfall fixed, one criterion passed, four findings reported not fixed |
| onboarding | **DONE** | verified: the existing 7-step wizard already meets §25's named flow, including capacity preview and activate/queue |
| store assets | **DONE (defect) / REPORTED (art)** | splash pointed at a file that never existed; fixed + guarded. Icon art is still Expo placeholder — a design deliverable, not a coding one |

### §28 Quality Gates

| Gate | Verdict |
|---|---|
| No blocking dashboard query waterfall | **PASS** — one violation found and fixed (`stats.tsx`, 4 round trips → 2) |
| No unbounded chart render | **PASS** — every chart input structurally capped |
| No unnecessary full-data fetch | **FINDINGS OPEN** — 4 stores fetch every row ever created; fixing needs pagination UI, not a silent `.limit()` |
| Offline habit completion / retry on sync / no duplicate logs | **PASS** — reconciled against the real `UNIQUE` constraint, proven by a genuine cold-start test |
| RLS tested / cross-user isolation proven | **NOT ESTABLISHED** — 8 policies authored across migrations, but the Phase 1 migration is unapplied (project paused). Requires a repo-owner action |
| Secrets server-only | **PASS** — no AI key on the client; `run-tests.js` no longer reads `.env` at all |

**PHASE 4 STATUS: `DONE` (2026-08-30)** — commits `e406ece`, `d778b41`, `b2a70d9`,
`635a209`, `47a2484`, `5738b8a`, `4b5d4ae`, `99ced94`, `69c8459`, `56bbee8`.

### PHASE 5 — deliberately not started

The plan itself gates Phase 5 behind *"Ancak retention kanıtlandıktan sonra"* (only
after retention is proven) and states that global leaderboard is explicitly not a
P0/P1 feature. Retention cannot be proven from a repository — it needs shipped users
and the §29 metrics. Recorded as **deferred by the plan's own precondition**
(assumption A-04), not as incomplete work.

---

# OVERALL SUMMARY REPORT — IMPLEMENTATION_V2 execution

Compiled 2026-08-30 on `phase/1-core-engine` @ `aac7cb6`.

## Phases

| Phase | Status | Gate evidence |
|---|---|---|
| 0 — Recovery & Architecture | **DONE** (prior session) | Gate A criteria; the four §32 documents verified present this session |
| 1 — Core Engine | **CODE-COMPLETE** (prior session) | Gate B's journey is computable and wired end to end; **live verification still blocked** — see Open Issue 1 |
| 2 — Intelligence | **DONE** (prior session) | Gate C exactness verified against raw samples |
| 3 — Routines & AI | **DONE** (prior session) | Gate D: AI cannot write to the DB; core works with AI failing |
| 4 — Product Polish | **DONE** (this session) | full gate below |
| 5 — Growth | **DEFERRED BY THE PLAN** | §24 gates it behind *"ancak retention kanıtlandıktan sonra"*; retention needs shipped users, not a repository |

## Test status

| Gate | Session start | Session end |
|---|---|---|
| `npx tsc --noEmit` | 0 errors | **0 errors** |
| `npm run typecheck:ci` (CI parity) | *did not exist* | **0 errors** |
| `npx expo lint` | 0 errors | **0 errors**, 73 warnings |
| `npx jest` | 813 / 54 suites | **1041 / 1041, 71 suites** |
| same, under `TZ=UTC` | *would have failed* | **1041 / 1041** |
| `node run-tests.js` | 142 / 142 | **142 / 142** |
| Android + iOS export | pass | **pass** |
| **CI** | **RED on every push** | **GREEN, twice consecutively** |

Net **+228 tests / +17 suites**, and — the part that matters more — the suite now
passes under CI's conditions rather than only on this machine.

## The single most important finding

**CI had been red on every push of the previous session**, including the commits that
closed Gates A, B, C and D. The log recorded CI as "the single criterion that cannot
be observed locally"; it was observable, and simply was never observed. Plan **Rule 5**
forbids marking a phase DONE while its tests fail.

Behind it sat **one bug class, found three separate times**: a gate silently depending
on something only the developer's machine has.

| # | Gate | Hidden local dependency | Why it was invisible |
|---|---|---|---|
| 1 | `tsc --noEmit` | `.expo/types/router.d.ts` — tsconfig **includes** it, `.gitignore` **excludes** it | expo-router's generated typed-routes file exists locally, never in CI. `useSegments()` degraded to a 1-tuple, so `segments[1]` was `TS2493`. Local checked a *weaker program* than CI |
| 2 | `jest` TZ pin | none — but the dev machine **is** Europe/Istanbul | `setupFiles` runs inside an already-started worker, after Node cached the zone. The pin had **never worked**; the machine's own timezone masked it |
| 3 | `run-tests.js` | `.env` | `read('./.env')` threw `ENOENT` in a clean clone, killing the script before a single assertion |

The third is the sharpest lesson: the diagnosis had **already been written down** —
`jest.config.js`'s own comment reads *"Never read .env - the old run-tests.js did, and
a test that depends on a gitignored file is not reproducible."* It was fixed for jest
and left in place in `run-tests.js`.

All three are now fixed, and each fix makes CI's view **reproducible locally**
(`npm run typecheck:ci`, `jest.globalSetup.js`, and asserting the code-level env
contract instead of a developer's file).

## The second theme: finished work that nothing called

Three subsystems were complete, documented, unit-tested — and **unreachable from the
running app**:

- the offline sync queue (`hydrateSyncQueue`/`flushPendingSync` — only callers were tests),
- the analytics layer (`lib/analytics.ts` — **zero** emission sites),
- crash reporting (which did not exist at all: zero matches for `Sentry|ErrorBoundary|captureException`).

All three are now wired and guarded by tests that assert the *call sites*, not just the
behaviour — because no behavioural test can catch this failure mode: it calls the
module directly and passes whether or not production ever does.

## What was built this session

| Area | Before | After |
|---|---|---|
| Crash reporting | nothing | capture funnel, swappable sink, chained global handlers, `ErrorBoundary` on the navigator, privacy scrubber |
| Offline sync | inert | hydrated before first render, flushed on boot + foreground, re-entrancy guarded, `dead` visibly distinct from `pending` |
| Analytics | inert | **11 / 11** declared events emitting from store/repository funnels, **none from a screen** |
| Accessibility (screens) | **literally zero** | 310 accessibility props across 25 screens |
| Accessibility (primitives) | 9 of 14 had closed prop types | uniform contract: defaults first, caller always wins |
| Performance | unmeasured | audit published; Stats waterfall 4 round trips → 2 |
| Store assets | splash pointed at a nonexistent file | fixed + guarded by a generic asset-path test |

## Known open issues

1. **Supabase project `kbcuolhjjnmhjaarxxmu` is paused/unreachable.** Blocks: live
   Gate B verification, applying `supabase/migrations/20260825_phase1_core_engine.sql`,
   and §28's *"RLS tested / cross-user isolation proven"* (8 policies are authored;
   none is proven live). **Repo-owner action** — deliberately out of scope, since
   applying a migration to production is irreversible.
2. **Four unbounded queries** — `noteStore`, `taskStore`, `projectStore`,
   `readingListStore` fetch every row a user has ever created. **Reported, not fixed
   on purpose:** adding `.limit(n)` without pagination UI would not make the app
   faster, it would silently hide the user's older data — a worse defect. Needs a
   feature-shaped unit with its own acceptance criteria.
3. **Monthly review reflections are device-local.** `monthly-review.tsx` writes
   straight to `AsyncStorage`; there is no table, repository or store. Answers are lost
   on reinstall while the UI says "Kaydedildi". Fix the product defect first, *then*
   add `monthly_review_completed` — an event whose funnel is device-local storage
   measures devices, not reviews.
4. **`duration` habits are expressible but unreachable.** `TrackingType` includes it
   and the engine is tested for it, but `adaptTrackingType` never produces it: the
   schema has no field distinguishing a duration unit. Documented in
   `habitEngine.ts:44-48`. §27's DoD box is not honestly tickable until the schema
   carries the distinction.
5. **Widgets not started (A-05).** Needs a native target + config plugin in an
   Expo-managed repo with no `ios/`/`android/`; no gate in this plan can observe one.
   Writing unverifiable native code would violate Rule 5.
6. **Store icon artwork is still the Expo placeholder.** `icon`, `adaptive-icon` and
   `favicon` are byte-identical template files. A design deliverable, not a coding one.
7. **Four edge-function defects, reported not fixed** (deploy is a repo-owner action):
   no server-side schema validation in `generate-routine`; `message` truncated at 500
   chars against a ~586-char digest; `mode:'summarize'` routed to the wrong branch;
   `context.analytics` never read.
8. **73 lint warnings** (0 errors) — mostly `react-hooks/exhaustive-deps`. Left alone:
   changing dependency arrays alters runtime behaviour and is not polish.

## Methodology note — the shallow-match trap, six forms

Every source-text invariant test in this repo has been bitten by an assertion matching
too loosely and producing **silent false confidence**. The six forms found so far:

| # | Form |
|---|---|
| 1 | a grep census reported 1 violation instead of 16 |
| 2 | a body-slicer cut before the target — red for the wrong reason |
| 3 | a pattern matched `return;` inside a **comment** |
| 4 | a file-scoped assertion satisfied by a **different component** in the same file |
| 5 | `grep -l "review"` matched the word "p**review**" in a comment |
| 6 | `expect(a.indexOf(x)).toBeGreaterThan(a.indexOf(y))` **passes when `y` is absent**, because `indexOf` returns `-1` |

Standing guidance, now applied throughout: **strip comments before matching, anchor
the scope rather than the pattern, and make absence fail first.** A seventh, specific
to component tests, was added this session: `@expo/vector-icons` renders a props-less
`<Text />` until its font loads, so a naive "the decorative icon is hidden" assertion
passes even with the fix fully deleted.

Every unit this session was **mutation-verified**: production code was broken one
invariant at a time and the expected test had to go red for the expected reason.
Roughly 70 mutations across the five units. Two of them are worth remembering because
they stayed **green** and taught something: one disproved a claim a coder had written
in a comment (the line was deleted rather than kept unearned), and one showed a
structural assertion that only a behavioural test could catch — the correct division
of labour, recorded rather than papered over.

---

## GATE B — LIVE VERIFICATION (2026-08-30)

The blocker recorded since the first session (assumptions A-02 / A-07) is cleared.
Gate B was previously "code-complete, live-verification blocked". It has now been
run against the live canonical database.

### What was done, in order

1. **Restored** the paused project `kbcuolhjjnmhjaarxxmu` ("Alışkanlık Uygulaması").
   `INACTIVE` → `COMING_UP` → `ACTIVE_HEALTHY`.
   *A reading taken mid-restore showed 0 tables / 0 users and was nearly reported as
   data loss. Waiting for `ACTIVE_HEALTHY` showed the truth: **48 tables, 3 users,
   16 MB, intact.** Recorded because the near-miss is the lesson — a restore in
   progress is indistinguishable from an empty database if you sample it too early.*

2. **Found a live misconfiguration.** `frontend/.env` pointed at
   `zdqiujpeewtyhtcqhdcj` — "Mas Technic Site", an unrelated manufacturing ERP with
   3 real users and live business data (customers, orders, financial_documents).
   The repo's own `supabase/predeploy_guard.sh` names that exact ref as **DENIED**
   and pins the canonical one, so a previous session had already anticipated this
   hazard; the dev machine was violating it. Repointed to the canonical project
   after backing the file up (`.env.backup-before-repoint`, gitignored via `*.env.*`).

3. **Applied** `20260825_phase1_core_engine.sql` — with the user's explicit approval,
   after a pre-flight that checked exactly the two things the migration's own header
   warns about:

   | Pre-flight | Result |
   |---|---|
   | rows violating the widened `tracking_type` CHECK | **0** (live values: `boolean`, `numeric`) |
   | duplicate `(habit_id, source_date)` in `recovery_plans` | **0** (table empty) |

   | | PRE | POST |
   |---|---|---|
   | habits / habit_logs rows | 6 / 13 | **6 / 13 — unchanged** |
   | public tables | 48 | **49** (+`daily_capacity`) |
   | `recovery_plans` columns | 10 | **15** |
   | `daily_capacity` | absent | present, **RLS enabled, 1 policy** |

   No data was read, written, moved or deleted by the migration — as its
   "ADDITIVE ONLY" header promised.

### The journey, step by step

Run over HTTPS against PostgREST with a real user JWT — the same path the app takes,
with RLS enforced. Not SQL with admin privileges, which would have proved nothing
about policies.

| Gate B step | Result | Evidence |
|---|---|---|
| Register | **FAIL — see finding below** | `signUp()` → *"Error sending confirmation email"* |
| Create numeric habit | **PASS** | `tracking_type=numeric` |
| Set 10.000 target | **PASS** | `daily_goal=10000` |
| Enter 8.000 | **PASS** | `value=8000, state=partial` |
| See 80% | **PASS** | read back from the DB: `8000/10000 = 80%` |
| Create 2.000 recovery | **PASS** | `deficit_value=2000, deficit_type=numeric, source_log_id` linked |
| Complete recovery | **PASS** | `status=completed`, `completed_at` set |
| Analytics update | **PASS** | `recovery_rate=1.0`, `recovered=2000` |

**The recovery step failed first, for a reason the migration had predicted.**
`strategy: 'yarin_telafi'` was rejected by `recovery_plans_strategy_check`. The
migration's header states explicitly that it does **not** widen the strategy
vocabulary and that `frontend/lib/recovery.ts` adapts between v1 and v2 in the
meantime. Reading that adapter gives the real mapping — `push_tomorrow` →
`'reschedule'` — and with the value the app would actually write, the step passes.
The constraint was right and the invented value was wrong.

### §28 "RLS tested / cross-user isolation proven" — now CLOSED

Previously recorded as *not established*. Proven directly:

| Check | Result |
|---|---|
| anonymous request (apikey, no JWT) | `42501 permission denied for table habits`, HTTP 401 — the `anon` role has no table grant at all, **stricter** than RLS returning zero rows |
| authenticated user vs. other users' habits | DB holds **6** habits from other users; test user sees **1** (its own) — 0 leaked |
| authenticated user vs. other users' logs | DB holds **13** logs from other users; test user sees **1** — 0 leaked |

*The first check initially read as a FAIL. The assertion expected "0 rows"; the
database returned an error instead, because isolation is enforced one level lower
than assumed. The test was wrong, not the security.*

### Teardown — the database was left as found

Every row created was deleted through the authenticated user (HTTP 204 ×3), and the
provisioned test user and its identity removed.

| | Before verification | After teardown |
|---|---|---|
| auth users | 3 | **3** |
| habits / habit_logs / recovery_plans | 6 / 13 / 0 | **6 / 13 / 0** |

The only persistent changes are the intended schema additions.

### New finding — registration is broken on this project

`signUp()` fails with **"Error sending confirmation email"**. Email confirmation is
required and no working SMTP is configured (Supabase's built-in sender is heavily
rate-limited and unsuitable for production). 2 of the 3 existing users are confirmed,
so registration worked at some point — this is an environment/SMTP problem, not
application code.

**This makes Gate B's literal first step unverifiable through the public API**, and
more importantly means **no new user can register today**. The journey was verified by
provisioning a confirmed account directly, so everything downstream of registration is
proven; registration itself is not.

Fix: configure a real SMTP provider in Auth settings, or disable email confirmation
for non-production. Repo-owner decision — an auth-configuration change, not code.

### Still open

- `backend/supabase/.temp/` still links to the denied `zdqiujpeewtyhtcqhdcj`. The
  predeploy guard warns about it on every run and names it as task OPS-0B-001.
- The `strategy` vocabulary remains v1 (`full|half|mini|reschedule`) with a documented
  lossy adapter in `lib/recovery.ts`. Widening it is the migration's own named
  follow-up.
