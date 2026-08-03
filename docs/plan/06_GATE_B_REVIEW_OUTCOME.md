# 06 — Gate B Independent Review Outcome

**Decision: `FAIL`**
**Phase 1: NOT authorised**
**Date:** 2026-08-03 · Reviewer: independent, read-only, did not author the artefacts

---

## 1. Verdict accepted in full

The review returned **FAIL** on 6 of 9 items. **Every checkable claim was
independently re-verified and every one held.** No finding is disputed.

| # | Item | Verdict |
|---|---|---|
| 1 | Internal consistency | **FAIL** |
| 2 | Backlog executability | **FAIL** |
| 3 | Dependency graph | PASS WITH FINDINGS |
| 4 | Agent file-ownership | **FAIL** |
| 5 | Risk register honesty | **FAIL** |
| 6 | Sign-off validity | **FAIL** (licence half) |
| 7 | Over-claiming | **FAIL** |
| 8 | Gate A `PASS WITH FINDINGS` | **PASS** — upheld |
| 9 | Gate B completeness | **FAIL** |

---

## 2. Re-verification

| Claim | Command | Result |
|---|---|---|
| `demoSeed` ungated | `grep -n "__DEV__" frontend/app/tabs/settings.tsx` | **no matches**; `handleSeedDemoData` wired at `:339` — **confirmed** |
| "20 of 32 are L1" wrong | `grep -c "\| L1 \|" docs/qa/02` | **20 L1 *rows***, but failing L1 rows are **14** — **confirmed** |
| Doc 06 has 62 cases | `grep -c "^\| E2E-" docs/audit/06` | **62**, not 58 — **confirmed** |
| Predicted failures ≠ 21 | `grep -c "PREDICTED FAIL" docs/audit/06` | not 21 — **confirmed** |
| Migration counts disagree | `ls supabase/migrations \| wc -l` | **4** files; doc 00 says 21/4, doc 01 says 20/3 — **confirmed** |

---

## 3. The four findings that matter

### F1 · "20 of 32 failing criteria are Layer 1" — overstated by ~40 %

The real figure is **14** (7 in block A, 7 in block B). I counted L1 *rows*
(20) and reported them as failing L1 *rows*.

**Why this is load-bearing:** it was the entire justification for starting the
Habit Domain stream before the H-01 schema decision. It appears in five places
across `00`, `02` and `03`. The conclusion may still hold at 14 — but it must be
re-argued, not assumed.

### F2 · 19 of 31 tasks have no acceptance criteria

`01:48-51` asserts that 1A/1B/1C/1E specifications "are in `02 §2` and `qa/02`,
which together give each its acceptance criteria and validation command."

**They are not.** `02 §2` is a four-column dependency table with no criteria, no
validation and no rollback. `qa/02` is organised by AC-ID and never names a task
ID; nothing maps `1B-004` → `AC-H05..H08`.

So the entire Phase 1 critical path — 1A, 1B, 1C, 1E and 1D-001..004 — carries a
title and a dependency and nothing else, in a document stamped **FINAL**.

### F3 · Ungated demo-data seeder writes fabricated rows to the user's real account — **NEW, HIGH**

`frontend/app/tabs/settings.tsx:339` renders a tappable row calling
`handleSeedDemoData` → `seedDemoData()`, which inserts projects, tasks, habits,
habit logs, focus tasks, recovery plans and journal entries. **There is no
`__DEV__` guard anywhere in that file.**

This is the **same defect class as the paywall mock** — which was found and fixed
at `42b64a0`. It was missed here, and worse, three documents assert the opposite:

- `plan/00:16` "There are no fake metrics anywhere in the UI"
- `audit/04:16` "The mobile app deliberately rejected them"
- `plan/03:49` "the codebase currently has none"

Those statements are **wrong** and are corrected below. The seeder also pollutes
XP, streaks and the leaderboard with fabricated rows — corrupting the exact
metrics Phase 1B exists to fix — and `demoSeed.ts:21` uses
`toISOString().slice(0,10)`, so it is also a 1B-002 site that was not on the list.

### F4 · Phase 1E is blocked by a licence gate scheduled for Phase 8

`00:62` says the licence block "blocks nothing in Phase 1, which introduces only
`jest-expo`, `supabase/cli` and `pgTAP` — all of which must pass the gate first."

Those two clauses contradict each other. 1E-L1 needs `jest-expo`; 1E-L2 needs
`pgTAP` and `supabase/cli`. Both are Phase 1 exit criteria. The only agent
permitted to clear the gate is inactive until Phase 8.

---

## 4. Remaining accepted findings

| # | Finding |
|---|---|
| F5 | `1C-004` assigns Supabase & Security to `frontend/store/recoveryStore.ts`, which `04:13-14` forbids — a fourth ownership overlap the document does not list |
| F6 | Gate A finding **R1** (committed `generate-routine` supports 2 modes, app sends 4, "would regress production if deployed") has **no task and no risk entry**, while `1D-001..004` redeploy that exact file |
| F7 | `frontend/app/**` has **no active Phase 1 owner**, yet 10 UTC date sites live there. 1B could pass its exit criteria with `today.tsx:46` still deriving the wrong day at 00:30 |
| F8 | 1B-002 scope undercounted — `toISOString()` appears 31 times across 16 files; 11 occurrences sit in 4 store files not on the list |
| F9 | No `supabase migration repair` step for registering the squashed baseline against the 21-row live ledger |
| F10 | Doc 06's tally is wrong on every subtotal (62 cases, not 58) and propagates into `qa/02`, R-01 and the Gate A closure |
| F11 | Parity per-section subtotals do not sum to the stated totals; only *Test* has a reproducible numerator |
| F12 | `SEC-1D-001`'s "P0 candidate — user decision" appears in neither `00 §5` nor `00 §6` |
| F13 | "13 open P1" is a row count; several rows aggregate multiple defects (~24 findings) |
| F14 | No definition of "landed": no branch, merge or commit convention; no local dev prerequisites (Docker, CLI/Node versions) |

---

## 5. What the review upheld

- **Gate A `PASS WITH FINDINGS` stands.** The reviewer called the evidence discipline "the strongest thing in this package" and confirmed the predicted-vs-observed distinction is preserved everywhere and never laundered into a pass.
- **No dependency cycles**, and the one real cycle (Gate A ⇄ Gate B) was found and resolved honestly.
- **"1B needs no migration" is true** — independently verified against the live schema.
- **Security CONDITIONAL PASS is defensible** — both P0s closed by reviewed migrations with verified post-ACLs.
- **Document count, task count and the 91/32 criteria arithmetic are correct.**

---

## 6. Corrective plan before Gate B can be re-run

Ordered by the reviewer's own priority.

| # | Action | Size |
|---|---|---|
| C1 | Write acceptance criteria, validation, rollback and size for the 19 unspecified tasks | **L** |
| C2 | Build a task-ID → AC-ID map | S |
| C3 | Correct "20 of 32" → 14 in all five locations, and **re-argue** whether starting 1B early still holds | S |
| C4 | Recount doc 06; correct 58 → 62 and the predicted-failure figure; propagate to `qa/02`, R-01, doc 09 | M |
| C5 | Correct the three false "no fake data" claims; add a `demoSeed` `__DEV__` gate task; add `demoSeed.ts` to 1B-002 | S |
| C6 | Resolve the 1E licence deadlock — either clear the gate for the three dev dependencies in Phase 1, or move 1E | S |
| C7 | Fix the `1C-004` ownership violation | XS |
| C8 | Add a task and risk entry for Gate A finding R1 | S |
| C9 | Assign a Phase 1 owner for `frontend/app/**`, or accept that 1B is partial and say so in its exit criteria | S |
| C10 | Expand 1B-002 to all 16 files | S |
| C11 | Add the live-ledger reconciliation step | S |
| C12 | Recompute or re-derive the parity totals | M |
| C13 | Add branch/merge convention and dev prerequisites | S |

---

## 7. Status

**Gate B: `FAIL`. Phase 1 is NOT authorised.**

The reviewer's assessment — *"not because the analysis is bad; it is unusually
honest… These are three or four days of correction, not a re-plan"* — is
accepted.

No production code, migration, SQL write or deployment follows from this
document. The two Emergency Gate 0 migrations remain in place and are unaffected.
