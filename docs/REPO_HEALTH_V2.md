# REPO_HEALTH_V2 — Health Dashboard

**Status:** `Verified` — measured baseline (orchestrator) + this audit's static analysis
**Date:** 2026-08-25 · **Branch:** `phase/0-recovery`

---

## 1. Baseline table

> **Updated after re-verification.** The first version of this table used the
> orchestrator's initial measurement. Several numbers moved during this run
> (a parallel coder landed fixes) and were re-observed; each row below states
> which measurement it reflects.

| Check | Command | Result |
|---|---|---|
| Typecheck | `cd frontend && npx tsc --noEmit` | **exit 0 — clean** (unchanged) |
| Jest | `cd frontend && npx jest` | **13 suites, 165/165 pass** (unchanged) |
| Structural gate | `cd frontend && node run-tests.js` | **142/142** (observed) — was `139/142` at initial baseline; see §3 for what changed |
| Lint | `cd frontend && npx expo lint` | **0 errors** (was 21), **74 warnings** (was 75) — observed after a parallel coder's fix; see §2 |
| Android export | `npx expo export --platform android` | **exit 0 — PASS**, bundle **6.23 MB** (hbc) |
| iOS export | `npx expo export --platform ios` | **exit 0 — PASS** (observed) — was reported "in progress" at initial baseline |
| Supabase project `kbcuolhjjnmhjaarxxmu` | MCP `execute_sql` / `list_tables` | **UNREACHABLE** — both time out; schema truth taken from `frontend/lib/supabase.ts`, `supabase/migrations/*.sql`, `docs/audit/07` |
| CI | `.github/workflows/ci.yml` | **authored by this pass** (`D1`) — has **never executed**; status is "authored, first run pending", not PASS (no green run has been observed by anyone) |

---

## 2. Lint — before → after

| | Errors | Warnings |
|---|---|---|
| Initial baseline (this run, first measurement) | 21 | 75 |
| **Observed now** | **0** | **74** |

**All 21 original errors were the single rule `react/no-unescaped-entities`**
(confirmed by the orchestrator's initial measurement) — a parallel coder
fixed all of them during this run, bringing errors to 0. `expo lint` now
exits 0.

The current 74 warnings were **not broken down per-rule in this pass** — the
0-errors number is the observed, current fact; a fresh per-rule warning
breakdown was not re-run. (`docs/audit/02_BUILD_RUNTIME_AND_DEPENDENCY_AUDIT.md`
§1/§3 has an older per-rule breakdown from an earlier lint run — 23 errors /
82 warnings at that time — but it predates both the error fix just landed and
the warning count moving from 82 → 75 → 74 across two rounds of interim
fixes, so it is presented here only as historical context, not as the current
per-rule shape. Reusing it as if it still summed to today's 74 would be a
stale claim, which is why it has been removed from this section rather than
carried forward again.)

---

## 3. Test counts by suite

### Jest — 13 suites, 165/165 pass (measured, orchestrator)

Static count of top-level `it(`/`test(` call sites per file (not equal to the
executed 165 in every case — some suites use parameterized/`.each` patterns
that expand at runtime; this is a structural inventory, not a re-measurement):

| Suite | Call sites (static) |
|---|---|
| `__tests__/edge/oauthState.test.ts` | 18 |
| `__tests__/edge/redirectAllowlist.test.ts` | 15 |
| `__tests__/lib/date.test.ts` | 33 |
| `__tests__/lib/demoSeed.test.ts` | 6 |
| `__tests__/lib/focusReport.test.ts` | 7 |
| `__tests__/lib/habitSchedule.test.ts` | 15 |
| `__tests__/lib/reportMetrics.test.ts` | 14 |
| `__tests__/repo/logHabitErrorsSurfaced.test.ts` | 5 |
| `__tests__/repo/noUtcDayKeys.test.ts` | 3 |
| `__tests__/store/dateDerivation.test.ts` | 7 |
| `__tests__/store/logStore.test.ts` | 7 |
| `__tests__/store/willpowerDayWatch.test.ts` | 3 |
| `__tests__/store/willpowerRollover.test.ts` | 13 |
| **Total (static)** | **146** |

### `run-tests.js` — structural gate, now 142/142 (was 139/142 at initial baseline)

Not a jest suite — a standalone Node script of source-text assertions
(`351` lines, ~98–106 static `test(` call sites, more executed at runtime via
`.forEach`-driven generation, e.g. the `seasonalMotion/*` file-existence
block). `PROGRESS.md`'s own failure triage (recorded by the orchestrator)
originally classified 3 failures behind the `139/142` count; all 3 are now
resolved, observed as `142/142`:

| # | Failing assertion | Triage | Resolution |
|---|---|---|---|
| 1 | `SearchButton headerRight` | was **STALE** — `SearchButton` was replaced by inline `HeaderActions()`; capability present and richer | **Resolved** — reflected in the `142/142` count; this pass did not independently re-verify whether the fix was a code change or an assertion update |
| 2 | `Bugünün alışkanlıkları listesi` | was **STALE** — list still renders from `activeHabits`; only the header string changed | **Resolved** — same caveat as #1 |
| 3 | `monthly-review: kapak + hareket + sayfa çevirme` | was **REAL GAP** — `monthly-review.tsx` lacked `heroMonth`/`MONTH_TAGLINES_TR`/`animatePage`/`active={isFocused}` | **Resolved — independently re-verified in this pass.** `monthly-review.tsx` now contains all required tokens (commit `92becd9`); see `AUDIT_V2.md` §9 for the file:line confirmation |

---

## 4. Bundle size

| Platform | Result | Size |
|---|---|---|
| Android | PASS | **6.23 MB** (hbc bundle) |
| iOS | **PASS (observed)** | exit 0; bundle size not separately measured in this pass |

---

## 5. Open decisions carried over from `docs/audit/01_REPOSITORY_HYGIENE_AND_SECURITY.md`

| # | Finding | Severity | Status | Decision owner |
|---|---|---|---|---|
| 1 | Foreign project's service-role key (`zdqiujpeewtyhtcqhdcj`, "Mas Technic Site") present in `backend/.env.local`, untracked/ignored, not used by this app | P1 | **Proposal pending approval** (§6 of doc 01 — relocate out of the repo tree; no rotation, that belongs to Mas Technic's owner) | Repo owner |
| 2 | Real passwords + live JWTs captured in `.claude/settings.local.json`'s permission allowlist (never committed, now gitignored) | P1 | **Blocked** — awaiting explicit go-ahead to prune the allowlist entries; password rotation is the owner's to perform | Repo owner |
| 3 | `packageManager: yarn@1.22.22` declared in `frontend/package.json`, but only `package-lock.json` exists (no `yarn.lock`) | P2 | **Planned**, doc 01 targets Phase 2B. This audit's CI workflow (`.github/workflows/ci.yml`) already works around it by using `npm ci` per Rule 7 — see the workflow's own header comment — but the stale `packageManager` field itself is untouched, since `frontend/` is out of scope for this run. | Repo owner / next frontend coder |
| 4 | `.git` at 45 MB from historical `.metro-cache` blobs | P3 | **Deferred** — Phase 7, size only, not a security requirement | Repo owner |

No new open decision was found in this pass; §5 is a pointer, not a re-audit.

---

## 6. Gate A verdict

Plan §24's Gate A criteria, evaluated against this pass's evidence:

| Criterion | Result | Evidence |
|---|---|---|
| 0 unresolved import | **PASS** | `tsc --noEmit` exit 0; `AUDIT_V2.md` §2 independent import-resolution check confirms |
| 0 TypeScript error | **PASS** | `tsc --noEmit` exit 0 |
| 0 invalid route | **PASS** | `AUDIT_V2.md` §4 — every discovered `router.push`/`href` target resolves to an existing file; 2 files (`dashboard.tsx`, `hub.tsx`) have no discovered *inbound* navigation, which is a reachability note, not an invalid-route finding (both exist and would render correctly if navigated to) |
| Android export PASS | **PASS** | exit 0, 6.23 MB bundle |
| iOS export PASS | **PASS (observed)** | exit 0 — observed directly; superseded the earlier "in progress" status |
| CI PASS | **Authored, first run pending** | `.github/workflows/ci.yml` was authored in this pass (`D1`) but has **never executed** — no one has observed a green (or red) run. Not claimed as PASS. |

**Overall: 5 of 6 criteria observed PASS; CI pending its first run.** Import
resolution, TypeScript, route validity, Android export and iOS export are all
directly observed PASS. CI is the one remaining criterion — the workflow
exists and is believed correct (it mirrors the exact command sequence already
individually verified above), but "believed correct" is not the same as
"observed green," and this document does not claim the latter. Gate A's
technical criteria will be fully satisfied once GitHub Actions runs this
workflow once and it passes; that observation is outside this document's
scope (it authors the CI workflow and the audit documents, it does not itself
trigger or wait on a CI run).

This is separate from, and narrower than, the **existing** Gate A closure
recorded in `docs/audit/09_GATE_A_CLOSURE_REPORT.md`
(`PASS WITH FINDINGS`, 2026-08-03), which certified the 19-document
audit/research/design/qa/skills deliverable set under the *original* plan's
Gate A definition. This section evaluates the **narrower, code-focused**
Gate A criteria list that `IMPLEMENTATION_V2.md` §24 states
(`0 unresolved import / 0 TypeScript error / 0 invalid route / Android export
PASS / iOS export PASS / CI PASS`) — a different rubric, applied fresh, not a
re-statement of the earlier verdict.
