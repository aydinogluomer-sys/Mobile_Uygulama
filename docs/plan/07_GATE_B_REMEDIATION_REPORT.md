# 07 — Gate B Remediation Report

**Status:** ⚠ **SUPERSEDED — historical record of remediation ROUND 1 only**
**Trigger:** Gate B `FAIL` (`06_GATE_B_REVIEW_OUTCOME.md`)

> **Do not cite this document for current state.** Round 1 was reviewed and
> returned `FAIL`; rounds 2 and 4 followed. Figures and status claims below were
> true of round 1 and several are **now known to have been wrong even then** —
> the round-2 reviewer found six double-owned files while §7 here asserts zero.
>
> **Current state lives in:** `08_CANONICAL_METRICS.md` (counts) ·
> `11_GATE_B_REMEDIATION_ROUND_2.md` (round 2) ·
> `12_GATE_B_TARGETED_REMEDIATION.md` (round 4) · `04_AGENT_TASK_GRAPH.md`
> (ownership). Every count below is retained **only** as a record of what was
> claimed at the time.

---

## 1. C1–C13 status

| # | Action | Status | Where |
|---|---|---|---|
| **C1** | Acceptance criteria for the 19 unspecified tasks | **DONE** | `01` — round-1 figure was 41 open tasks; **superseded, now 48** |
| **C2** | Task-ID → AC-ID map | **DONE** | each task's `validation` names its AC ids; `09 §2` maps all 14 failing L1 |
| **C3** | Correct "20 of 32" → 14 and re-argue | **DONE** | `08` §2, `09` (full rebuild) |
| **C4** | Recount doc 06; propagate | **DONE** | `08` §1 — 62 cases, 23 predicted |
| **C5** | demoSeed task + corrected claims | **DONE** | `DEMO-001` in `01`; three false claims corrected |
| **C6** | Resolve the 1E licence deadlock | **DONE** | `research/04`; `1E-000` added |
| **C7** | Fix the `1C-004` ownership violation | **DONE** | split into `1C-004` + `1C-006`; `04 §1a` |
| **C8** | Task + risk entry for Gate A finding R1 | **DONE** | `1D-000`; risk **R-19** below |
| **C9** | Phase 1 owner for `frontend/app/**` | **DONE** | Expo Architecture activated for `1B-008`; unowned paths named in `04 §6` |
| **C10** | Expand 1B-002 scope | **DONE** | split: `1B-002` (5) · `1B-007` (4) · `1B-008` (5) · `1B-009` deferred |
| **C11** | Live-ledger reconciliation step | **DONE** | `10 §3` Step 6 — `migration repair`, no DDL on live |
| **C12** | Recompute parity totals | **NOT DONE — withdrawn instead** | `08 §3` |
| **C13** | Branch convention + dev prerequisites | **DONE** | §5 below |

**12 of 13 done. C12 is deliberately not done** — see §3.

---

## 2. Corrected metrics

Full table: `08_CANONICAL_METRICS.md`. Every count now lives in exactly one place.

| Metric | Was | **Is** |
|---|---|---|
| E2E cases | 58 | **62** |
| Predicted failures | 21 | **23** |
| Verified passes | 12 | **16** |
| Blocked-device | 18 | **15** |
| **Failing Layer 1 criteria** | **20** | **14** |
| Live / repo / matched migrations | 20 / 3 / — | **21 / 4 / 2** |
| Backlog tasks | 31, then 36 | **42** (1 done, 41 open) |

**The backlog figure was wrong twice.** A recount from source — not from the
stated total — found the first remediation pass had itself mistallied: 37 index
rows reported as 36, with `SEC-1D-005a–f` left collapsed as one row standing for
six tasks. The same recount surfaced a duplicated `OPS-0B-001` heading and a
`SEC-1D-005e` block missing its `goal`. All four are fixed in `plan/01`.

---

## 3. C12 — why parity was withdrawn rather than recomputed

The reviewer found that `05_FEATURE_PARITY_MATRIX` per-section subtotals do not
sum to its stated totals. Only *Test* has a reproducible numerator.

**Recomputing would require re-scoring 97 requirements across six dimensions.**
Roughly a third carry evidence grade `[S]` — screen-level, not read line by line.
A recomputation would produce equally unreliable numbers with a false air of
precision.

**Instead the percentages are withdrawn as authoritative** (`08 §3`). What
survives is what holds under any reasonable recount:

- data/backend parity is substantially **higher** than UI parity — the gaps are screens not built, not models missing
- UI and functional parity are **close** — no UI shells over dead logic
- test parity is lowest by a wide margin; behavioural test parity is effectively **0 %**

No roadmap decision depends on the exact percentages. Proper recomputation
requires line-level verification of the `[S]` rows and is filed as a **Phase 3
entry task**, not a Gate B blocker.

---

## 4. Final backlog status

| Property | Value | How verified |
|---|---|---|
| Tasks *(round-1 figure; now **49**/48 — see `plan/08`)* | 42 (1 DONE, 41 open) | index rows, `SEC-1D-005a–f` expanded |
| XL tasks | **0** — largest is M | size field on every header line |
| Open tasks with all 13 fields *(round-1 figure; now **48/48**)* | 41 / 41 | field-presence scan per H2 block |
| Duplicate headings | **0** | heading-id frequency count |
| Index ↔ heading mismatches | **0** | set difference both directions |
| Unresolved cross-references | **0** | `1B-006` documented as a pointer, not indexed |
| Abstract titles ("refactor", "fix security") | **0** | read |
| Tasks exceeding 5 files | **0** | scope field |

Counted by script against the file, not read off a stated total — the method
that caught the mistally described in §2.

Tasks added during remediation: `1D-000` (R1 reconciliation), `1E-000` (licence
clearance), `DEMO-001` (seeder gate), `1B-007`, `1B-008`, `1C-006`
(ownership split).

---

## 5. Working conventions (C13)

| Item | Decision |
|---|---|
| Branch | Phase 1 work on `phase-1/<task-id>`, branched from `chore/commit-baseline` |
| Commit | one per task; subject `<type>(<scope>): <task-id> <summary>` |
| "Landed" | reviewed by Skeptical Reviewer + `tsc` clean + task's validation command green + merged to `chore/commit-baseline` |
| Merge | no self-merge; the reviewer's verdict is recorded in the commit body |
| `main` | untouched until Gate C |
| Node | as required by Expo SDK 54 (18+); pinned at `1E-000` |
| Docker | required for `supabase start` (Layer 2). **Currently not running** on this machine — a Phase 1E prerequisite |
| Supabase CLI | pinned at `1E-000`; must support Postgres 17 |
| Timezone | every test run pins `TZ=Europe/Istanbul` |

---

## 6. Dependency clearance result

`research/04_PHASE1_DEPENDENCY_CLEARANCE.md` clears **three** dev/test
dependencies as `1E-000`:

| Dependency | Licence | Ships in bundle? | State |
|---|---|---|---|
| `jest-expo` | MIT | no | **Cleared, conditional** |
| `supabase/cli` | Apache-2.0 | no | **Cleared, conditional** |
| `pgTAP` | PostgreSQL Licence | no | **Cleared, conditional** |

Conditional because none has yet been read at a pinned commit — discharged by
`1E-000` before any test code is written. **The other 12 candidates remain
blocked until Phase 8A.** No production dependency is cleared.

---

## 7. Ownership map result

| Check | Result |
|---|---|
| Two agents owning one file | ❌ **claimed 0 — actually 6.** The round-2 reviewer found `willpower.test.sql`, `recovery.test.sql` and four `__tests__` files double-owned. Fixed at round 2 |
| Phase 1 files without an owner | named explicitly in `04 §7` *(section renumbered)* |
| Reviewer owning a production file | **0** — correct then and now |
| Edit vs review ownership separated | **yes** — correct then and now |
| Concurrent edits to one file | ❌ **claimed 0 — actually 3 unserialised** (`1D-005/006/007` on `notion-auth`). Fixed at round 4 |

Two agents (Expo Architecture, Open-Source Research) activated with **one named
task each**, resolving deadlocks where Phase 1 needed work only they could
legitimately do.

---

## 8. Schema decision

`10_SCHEMA_RECONCILIATION_PLAN.md` — **Option A (squashed baseline) recommended**,
with a 7-step procedure, Emergency Gate 0 migration preservation, schema-hash
verification, mandatory backup, a `migration repair` cutover that runs **no DDL
against live**, and rollback at every stage.

**Awaits H-01. Not executed.**

---

## 9. New risk added

**R-19 · Redeploying the stale `generate-routine`** — `HIGH`
Owner: Supabase & Security. The committed file supports 2 modes; the app sends 4;
deployed is v11. `1D-001..004` all modify and redeploy this file.
**Mitigation:** `1D-000` must land first. **Trigger:** any 1D deploy scheduled
before `1D-000` closes.

---

## 10. Unresolved human dependencies

| # | Decision | Blocks |
|---|---|---|
| **H-01** | Schema reconciliation A or B | `1A-002` and all DB-side work |
| H-02 | Rotate 4 account passwords (entries pruned; rotation is yours) | nothing technically |
| H-03 | Approve `OPS-0B-001` relocation | 2C |
| H-04 | Fate of bad-habits / webhooks / export | 2A |
| H-05 | Confirm `backend/server.py` not deployed | 2C · **P0 if reachable** |
| H-06 | Physical device | 15 blocked E2E cases; 23 predicted failures unobserved |
| H-07 | `awwwards-loop` capture blocker | 5F |
| H-08..H-10 | Store accounts · RevenueCat · Google OAuth app | 6E · 6D · 2A |
| H-11 | Confirm `last_ai_context` ownership | `SEC-1D-005a` |
| **H-13** | **Docker not running** — required for Layer 2 | `1E-L2` |

**H-01 and H-13 block Phase 1.** The rest block later phases.

---

## 11. Phase 1 entry criteria

| Criterion | State |
|---|---|
| Gate B `PASS` | **pending fresh independent review** |
| Schema strategy chosen | **awaiting H-01** |
| Backlog: 42 tasks, all 13 fields, 0 XL *(round-1 figure; now **49** rows / 48 open)* | superseded — see `plan/12` |
| Canonical metrics, single source | ❌ **WRONG when written** — seven stale assertions survived. Fixed across rounds 2 and 4 |
| Dependency graph, no cycles | **met** |
| Ownership map, no overlaps | ❌ **WRONG when written** — the round-2 reviewer found **six** double-owned files. Fixed at round 2; verified 0 at round 4 |
| Rollback strategy per task | **met** |
| Test strategy, two layers | **met** |
| Licence clearance for 1E | **met (conditional)** |
| Risk register incl. R-19 | ❌ **WRONG when written** — R-19 was referenced but absent from `plan/05`. Added at round 2 |
| Docker available for Layer 2 | **awaiting H-13** |
| Test-first rule accepted | **met** — `09 §5` |

**Phase 1 may begin when Gate B passes and H-01 is answered.** `1B` and `1A-001`
start immediately on those two; `1E-L2` additionally needs H-13.

---

## 12. Not done in this remediation

Stated so it is not mistaken for completeness:

- **No production code changed.** `demoSeed` is specified, not gated.
- **No live migration, SQL write or deployment.**
- **Parity percentages not recomputed** (§3).
- **`1B-009`** (remaining 5 `app/**` date sites) deferred to Phase 2A.
- **Licence conditions not yet discharged** — that is `1E-000`'s first step.
