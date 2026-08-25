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

