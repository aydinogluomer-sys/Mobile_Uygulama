# 09 — Gate A Closure Report

**Decision: `PASS WITH FINDINGS`**
**Date:** 2026-08-03
**Scope:** evidence and audit work — complete

---

## 1. Deliverables — 19 / 19

Gate A's denominator is **19**, not 24. The five `docs/plan/` artefacts
(`00`, `02`, `03`, `04`, `05`) are **Gate B** outputs. Counting them here created
a dependency cycle in which Gate A could never close while Gate B waited on Gate A.

> **Counting note.** `docs/` now holds **20** files. This closure report is the
> **gate decision record**, not one of the 19 deliverables it certifies — a
> document cannot be part of the set it audits. Deliverables 19 · gate record 1 ·
> files on disk 20. Gate B adds 5, giving a project total of **24 deliverables +
> gate records**.

| # | Document | Status |
|---|---|---|
| 1 | `audit/00_REPOSITORY_BASELINE.md` | `Verified` |
| 2 | `audit/01_REPOSITORY_HYGIENE_AND_SECURITY.md` | `Verified` (2 decisions open) |
| 3 | `audit/02_BUILD_RUNTIME_AND_DEPENDENCY_AUDIT.md` | `Verified` |
| 4 | `audit/03_UNFINISHED_AND_BROKEN_WORK.md` | `Verified` |
| 5 | `audit/04_PERSONAL_OS_FEATURE_INVENTORY.md` | `Verified` |
| 6 | `audit/05_FEATURE_PARITY_MATRIX.md` | `Verified` |
| 7 | `audit/06_END_TO_END_FUNCTIONAL_AUDIT.md` | `Partially verified` — device blocked |
| 8 | `audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md` | `Verified` |
| 9 | `audit/08_LIVE_CHANGE_AUDIT.md` | `Verified` |
| 10 | `research/01_GITHUB_REPOSITORY_SHORTLIST.md` | `Audited` |
| 11 | `research/02_REPOSITORY_LICENSE_MATRIX.md` | `Audited` |
| 12 | `research/03_PATTERN_ADOPTION_GUIDE.md` | `Audited` |
| 13 | `design/01_MOBILE_DESIGN_QUALITY_AUDIT.md` | `Partially verified` — rendering blocked |
| 14 | `design/02_DESIGN_SYSTEM_RECOMMENDATIONS.md` | `Planned` |
| 15 | `qa/01_TEST_STRATEGY.md` | `Planned` |
| 16 | `qa/02_ACCEPTANCE_TEST_MATRIX.md` | `Planned` |
| 17 | `qa/03_PERFORMANCE_AND_ACCESSIBILITY_BUDGET.md` | `Planned` |
| 18 | `skills/00_SKILL_MANIFEST.md` | `Verified` |
| 19 | `plan/01_IMPLEMENTATION_BACKLOG.md` | **`DRAFT / SEEDED`** — final validation and sign-off at Gate B |

**Project total remains 24: Gate A 19 + Gate B 5.**

---

## 2. Skills — 10 / 10

**All 10 are `Validated on one task`. None is `Applied project-wide`.**
`Created` is a historical state and is not double-reported.

`audit-expo-react-native-project` · `map-reference-html-to-mobile-features` ·
`verify-feature-end-to-end` · `design-mobile-product-system` ·
`audit-supabase-security` · `design-habit-domain-model` ·
`verify-date-time-and-streak-logic` · `research-and-adapt-github-repositories` ·
`plan-small-agent-tasks` · `review-mobile-release-quality`

Each has `SKILL.md` + `references/` + `checklists/` + `templates/`.

---

## 3. Phase 0C exit criteria — item by item

| Criterion | Result | Evidence |
|---|---|---|
| Canonical baseline recorded | **PASS** | project `kbcuolhjjnmhjaarxxmu`, directory root `/supabase` — doc 07 §1 |
| Foreign Mas Technic artefacts identified | **PASS** | 4 artefacts listed — doc 07 §1a |
| Files requiring ownership classification listed | **PASS** | doc 07 §1b |
| Every `backend/supabase/` file classified | **PASS** | 4 files, each with call-site **and** schema evidence — doc 07 §2b |
| Live RLS documented per table | **PASS** | all 48 tables; `rowsecurity = true` on every one |
| Unique constraints confirmed | **PASS** | 4 of 5 exist; `recovery_plans` absent — doc 07 §4 |
| RPC `prosecdef` / `proconfig` captured | **PASS** | 40 functions; 17 with unpinned `search_path` |
| Emergency Gate 0 resolved | **PASS WITH FINDINGS** | 2 migrations, each independently reviewed |
| No operation against Mas Technic | **PASS** | 0 calls of any kind — doc 08 §1 |
| Nothing moved, deleted or deployed | **PASS** | classification read-only; no `db push` / `functions deploy` |

**Phase 0C: PASS.**

---

## 4. Open P0 findings

| ID | Finding | State |
|---|---|---|
| — | `mock_activate_subscription` payment bypass | **CLOSED** — migration `20260802181931`, reviewed |
| — | `add_xp` / `track_weekly_xp` / `deal_damage_to_active_boss` unauthenticated cross-user write | **CLOSED** — migration `20260802205850`, pre-change reviewed |

**No open P0.**

---

## 5. Open P1 findings

| ID | Finding | Phase |
|---|---|---|
| SEC-1D-005 | `authenticated` holds column-level UPDATE on all 17 `profiles` columns → self-inflation of XP/level/coins | 1 |
| B1/B2 | `utils/api.ts` → `localhost:8000`; 3 features dead on device, export shows a **false success alert** | 2A |
| B3 | `google-auth` neither deployed nor provisioned → Google Calendar 404s on every call | 2A/2C |
| B4 | `notion-sync` returns `success: true` while syncing **zero** habits | 2A/2C |
| R1 | committed `generate-routine` supports 2 modes; app sends 4 → **would regress production if deployed** | 1D |
| R2 | 19 live migrations have no repository counterpart | 1A |
| P3 | no executing tests; `run-tests.js` asserts on source text | 1E |
| DATE | 7 of 8 timezone cases fail at UTC+3 | 1B |
| DOMAIN | 4 metric defects: X-per-week never due · `isDueOn` unused by metrics · `at_most` inverted · `miss`/`skip` counted | 1B |
| WILL | willpower non-atomic, TOCTOU, unconditional refund, no midnight rollover | 1C |
| TELAFI | completing a telafi moves no metric | 1C |
| SEC | credit debit is TOCTOU and **fail-open**; webhook has no idempotency; OAuth `state` never verified | 1D |
| A11Y | 20 labels, 1 `accessibilityState`, 54 sub-44pt targets across ~103 files | 5E |

---

## 6. Blocked evidence — stated, not worked around

| Blocker | Consequence |
|---|---|
| **No device / emulator run** | 15 E2E cases `BLOCKED-DEVICE`; 23 failures remain **predicted**, not observed |
| **No rendered design evidence** | `awwwards-loop` `"status": "blocked"`, `hardGatesPassed: false`, `lastScore: null` after 3 capture attempts. Motion and performance scored `n/r` |
| **No SQL writes permitted** | 1 case `BLOCKED-WRITE`; concurrency claims unproven |
| **No performance baseline** | every runtime target in `qa/03` is provisional |

**None of these was resolved by inference.** Where evidence was unavailable the
document says so.

---

## 7. Schema drift

| Measure | Value |
|---|---|
| Live migration ledger | **21** |
| Repository migration files | **4** |
| Matching both | **2** (the Emergency Gate 0 pair) |
| Live tables | 48 · repo migrations describe **7** |
| Live RPCs | 40 · repo migrations describe **0** |
| Live triggers | 9 · repo migrations describe **0** |
| Renamed columns | 5 |
| Contradictory CHECK | `001:20` rejects `status='idea'`, which the client writes |

`supabase db reset` from the repository produces a database **the app cannot run
against**. The 19 missing migrations were **deliberately not reconstructed by
guesswork** — that would create a schema that looks authoritative while diverging
from reality. Reconciliation decision is a **Gate B** output; application is
Phase 1A after a three-way diff.

---

## 8. Licence adoption limit

15 shortlisted repositories, **15/15 permissive, 0 blocked, 0 unresolved**.

**But zero satisfy the adoption gate.** The gate requires the `LICENSE` file to
be read at the pinned adoption version with its SHA recorded. No repository has
been cloned, so every licence is recorded from published knowledge — a claim,
not evidence.

Transitive licences across the resolved `package-lock.json` tree were **never
reviewed**. Filed as a Phase 6E task.

**No repository may be adopted until both gaps close.**

---

## 9. Foreign Mas Technic artefacts

`zdqiujpeewtyhtcqhdcj` ("Mas Technic Site") is a **separate, unrelated project**.

| Artefact | State |
|---|---|
| `backend/supabase/.temp/linked-project.json` | present — separation proposal, Phase 2C |
| `backend/supabase/.temp/project-ref` | present — separation proposal, Phase 2C |
| `backend/.env.local` (service-role key) | **untouched** — relocation proposal OPS-0B-001, awaiting approval |
| `backend/supabase/functions/.env.local` | present — ownership unresolved |

**Operations performed against Mas Technic: zero.** No resume, deploy,
migration, key rotation, database change or function change. Rotation of its
service-role key is **out of scope** and belongs to that project's owner.

---

## 10. Gate A decision

**`PASS WITH FINDINGS`**

| Criterion | Result |
|---|---|
| All 19 documents exist | **PASS** |
| Every REF item carries six parity values | **PASS** — 97 in-scope requirements |
| Every lint finding classified | **PASS** — 105 findings, individually |
| Skill manifest complete | **PASS** — 10/10 |
| No `UNVERIFIED` on any P0/P1 item | **PASS** |
| Evidence-based throughout | **PASS** — no claim rests on a filename |

### Why "with findings" rather than "pass"

Three limits are real and are not dismissed:

1. **Device and rendered evidence are absent.** 23 failures are *predicted* from demonstrably broken code paths, not observed. That distinction is preserved everywhere and must survive into Phase 1.
2. **The licence gate is unsatisfied for all 15 repositories.** Nothing may be adopted yet.
3. **`plan/01_IMPLEMENTATION_BACKLOG.md` is DRAFT/SEEDED**, not final. It carries the four Emergency Gate 0 follow-ups plus SEC-1D-005 and OPS-0B-001; the full backlog is a Gate B output.

### What Gate A established that changes the plan

- The app is **more built than its history suggested** — 268 files were uncommitted; 7 screens are genuinely end-to-end.
- **Data/backend parity (91 %) far exceeds UI parity (65 %)** — Phase 3 is cheaper than it looked.
- **Two live P0 exploits existed and are now closed.**
- **XP is server-authoritative**, contradicting the initial reading that it was client-spoofable.
- **The date cluster is the single highest-blast-radius defect** — 7 of 8 cases, affecting seven subsystems at once, all fixable in pure functions with no device.

---

## 11. Authorisation

**Gate A: CLOSED — `PASS WITH FINDINGS`.**
**Gate B: authorised to begin** — plan artefacts only.

Still prohibited until Gate B PASS **and** explicit user approval: starting
Phase 1 · applying a live migration · running a SQL write · deploying an Edge
Function · entering Phase 2 · any operation on Mas Technic.
