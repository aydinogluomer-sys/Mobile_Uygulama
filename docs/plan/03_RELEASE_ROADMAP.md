# 03 — Release Roadmap

**Status:** Gate B artefact
**Sequencing basis:** the dependency graph (doc 02), not severity ordering

---

## Phase entry and exit criteria

Every phase has both. A phase does not start until entry criteria hold, and does
not close until every exit criterion is met. **A failed mandatory criterion stops
the phase** — it is not carried forward as a footnote.

---

## Phase 1 — Data Integrity, Domain Correctness, Backend Security

**Entry:** Gate B `PASS` · schema reconciliation strategy chosen (doc 02 §3) · agent ownership map agreed

| Sub-phase | Exit criteria |
|---|---|
| **1A** schema | `supabase db reset` produces a DB the app runs against unchanged · every live-vs-repo difference explained · RLS documented per table · critical unique constraints present |
| **1B** dates/metrics | 00:30 and 23:30 tests pass under `TZ=Europe/Istanbul` · X-per-week habits evaluate correctly · Mon/Wed/Fri habits not scored as failures on other days · `at_most` computes correctly · `miss`/`skip` excluded from completed days · habit-log errors surfaced to the user |
| **1C** willpower/telafi | parallel debits cannot corrupt the budget · post-midnight state never stale · unactivated habits produce no refund · telafi completion moves a real metric · duplicate recovery plans rejected |
| **1D** edge-fn security | each sub-task independently tested and reviewed · every fix on the canonical tree · wrong-project deploy physically prevented |
| **1E** tests | both layers green in one command each · every 1B behaviour covered in L1 · every 1A/1C constraint and concurrency guarantee covered in L2 · **no RLS or RPC claim rests on an L1 test** |

**Phase exit (Gate C):** all of the above · `tsc` clean · lint no new errors · independent review on every diff · Deferred Scope Registry updated · **stop and report; do not auto-advance**

---

## Phase 2 — Reachability, Product Honesty, Architecture, Build

**Entry:** Phase 1 `PASS` · **explicit user approval**

| Sub-phase | Exit criteria |
|---|---|
| **2A** reachability | every feature visible in the UI either works or is explicitly marked unavailable · no dead navigation · no false success message · no promised-but-unreachable flow |
| **2B** dependencies | `expo-doctor` clean · no duplicate native modules · `expo-router` 6 · Reanimated 4 under New Arch · postinstall `node_modules` patch removed · one package manager · Android and iOS build smoke pass |
| **2C** backend canonicalisation | one canonical backend path · one canonical Supabase link · no wrong-project deploy risk · foreign artefacts separated **with approval** · `backend/server.py` resolved |
| **2D** test foundation | component and integration foundations exist · E2E tool chosen · CI runs typecheck + lint + L1 |

---

## Phase 3 — Reference Feature Parity

**Entry:** Phase 2 `PASS` · approval

**Exit:** all MUST-level REF items complete · UI-only remainders listed separately · functional parity recomputed · deferred REF items justified in the Registry · **no hardcoded demo values introduced** (see `06_GATE_B_REVIEW_OUTCOME.md` §F3 — the ungated `demoSeed` path must be closed first; the earlier claim that the codebase has none was wrong)

---

## Phase 4 — Reporting, Analytics, AI Insight, Portability

**Entry:** Phase 3 `PASS` · approval

**Exit:** reports consistent between local and backend · monthly reflections persisted server-side · AI output schema-validated and traceable · export/import tested on real data · backup/restore round-trip passes · **no false success messages**

---

## Phase 5 — Design System and Interaction Quality

**Entry:** Phase 4 `PASS` · approval · **2B complete** (Reanimated 4 — motion built on the legacy line is thrown away)

**Exit:** raw hex < 100 (from 1,671) · `components/ui/` imported by > 70 files (from 11) · `accessibilityLabel` on 100 % of interactive elements · 100 % of interactive elements ≥ 44 pt or `hitSlop` · reduced motion honoured in all tiers · theme toggle visibly affects every screen · `awwwards-loop` unblocked, scored ≥ 90 · all three product-honesty items closed

---

## Phase 6 — QA, Production Readiness, Store Release

**Entry:** Phase 5 `PASS` · approval

| Sub-phase | Exit criteria |
|---|---|
| **6A** tests | component + integration + E2E suites · Android and iOS device matrices · offline and network-failure · visual regression · a11y automation · migration and RLS tests |
| **6B** CI/EAS | CI runs typecheck, lint, L1, L2, E2E · EAS Build and Submit configured · env separation · `buildNumber`, `versionCode`, `runtimeVersion` set |
| **6C** observability | crash reporting · error monitoring · structured logging · privacy-safe analytics · production alerts |
| **6D** operations | feature flags · notifications complete · rate limits · abuse controls · backup and recovery procedure |
| **6E** store | privacy policy · terms · data-safety forms · **square app icon** · metadata, screenshots, listing · in-app licences screen · full-tree licence scan |
| **6F** release | deployment checklist · DB backup · migration and app rollback · phased rollout · monitoring window · incident response · sign-off |

**Gate D:** no open P0/P1 · critical E2E pass · Android and iOS smoke pass · RLS tests pass · store builds work · monitoring active · **rollback plan tested, not merely written**

---

## Phase 7 — Git History Cleanup

**Entry:** explicit history-rewrite approval · remote and mirror backup verified

**Exit:** cache removed from all history · repo meaningfully smaller · real source history preserved · remote branches verified · CI and deployment references unbroken

**Independent of every other phase.** Deliberately last: the full-history scan
found **no committed credential**, so this is a size optimisation, not a security
requirement.

---

## Phase 8 — OSS Adoption and Skill Rollout

**Entry:** relevant phases complete · approval

**Exit:** every researched repo has one final decision · **every adopted repo's `LICENSE` read at its pinned commit with the SHA recorded** · attribution obligations discharged · research clones never mixed into the production repo · every skill validated on a real task · skills applied to their areas · conflicting or unused skills removed

---

## Sequencing rationale — why this order

| Decision | Reason |
|---|---|
| Data integrity before features | Building on incorrect metrics multiplies the correction cost |
| Reachability (2A) before parity (3) | Adding screens to a tree with dead navigation compounds the problem |
| Dependencies (2B) before design (5) | Motion built on Reanimated 3 is discarded by the Reanimated 4 upgrade |
| Tests (1E) before Phase 2 | Without them no later phase can prove it did not regress anything |
| History cleanup (7) last | No security driver; highest blast radius; needs explicit approval |
| OSS adoption (8) last | The licence gate is unsatisfied for all 15 candidates today |

## What is deliberately NOT time-estimated

No phase carries a duration. Every honest input to an estimate is missing: no
device run, no performance baseline, no CI, and 21 defects that are predicted
rather than observed. **Phase 1 will produce the first real velocity signal** —
its 20 Layer-1 acceptance criteria are precisely scoped and their completion
gives a defensible basis for estimating the rest. Estimating before that would
be a number with no evidence behind it.
