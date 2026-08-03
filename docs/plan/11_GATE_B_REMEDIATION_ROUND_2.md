# 11 — Gate B Remediation, Round 2

**Status:** ⚠ **SUPERSEDED in part — historical record of ROUND 2**

> Rounds 3, 4 and 5 followed. Two claims below were **false when written** and are
> annotated inline (M7, M10). Current state: `08_CANONICAL_METRICS.md` (counts),
> `12_GATE_B_TARGETED_REMEDIATION.md` (round 4), and
> `13_GATE_B_POST_REVOKE_BASELINE_DECISION.md` (round 5, H-01 decision) — the
> last of which governs anything touching the baseline.

**Trigger:** Gate B re-review returned `FAIL` — 3 BLOCKER, 7 MAJOR, 8 MINOR
**Constraint:** documentation only. No production code, no live migration, no SQL write, no Edge Function deploy, no `demoSeed` code change, no operation on `zdqiujpeewtyhtcqhdcj`.

---

## 1. Blocker remediation

### B1 · Six files had two edit owners — **fixed**

`willpower.test.sql`, `recovery.test.sql` and four `__tests__` files were claimed
both by a domain/security task and by `1E-L1`/`1E-L2`'s **globs**. The glob was
the mechanism: `frontend/__tests__/lib/*.test.ts` silently absorbed files that
1B tasks had listed explicitly.

**Resolution — three structural changes, not a re-wording:**

1. **Test files removed from every domain and security scope.** Ten tasks lost a test file from `scope` and gained a **`test_contract`** field naming the QA task that owns it. They specify what must be asserted; they never edit it.
2. **`1E-L1` and `1E-L2` split into six tasks with explicit file lists — no globs.** A glob cannot re-absorb another task's file if there are no globs.
3. **`package.json` moved out of `1E-L1` into `OPS-1E-001`** (Repository Audit), which owns that file.

**Verified:** ownership matrix regenerated from every task's `scope`/`agent`
field — **0 files with two different agents**, and all 14 test files owned by
QA & Test.

### B2 · `1C-004` ownership violation survived in the assignment table — **fixed**

`plan/04 §1a` declared `1C-004` migration-only while `plan/04 §3` still listed it
as `Supabase & Security · migration + frontend/store/recoveryStore.ts`. The
document contradicted itself, and the summary carried the old pairing.

**Resolution:** `plan/04` rebuilt with **exactly one assignment table**. There is
no second table or summary that can disagree. `1C-004` is migration-only in
`plan/01` and in that table; `1C-006` (Habit Domain) owns the client file.

### B3 · Two scopes violated their own agent's prohibition — **fixed**

| Task | Was | Now |
|---|---|---|
| `1D-009` | Repository Audit → `supabase/config.toml`, which that agent may not touch | **Supabase & Security**, identical in `plan/01`, `plan/04 §3`, `plan/04 §7` |
| `DEMO-001` | Habit Domain → `frontend/app/tabs/settings.tsx`, a path `plan/04` also declared unowned | Split: **`DEMO-001A`** (Habit Domain, `demoSeed.ts`) + **`DEMO-001B`** (**Expo Architecture**, `settings.tsx`) |

**Verified:** 0 never-touches violations across all 48 open tasks.

---

## 2. Major remediation

| # | Finding | Resolution |
|---|---|---|
| **M4** | 7 stale figures survived in the exact locations `plan/08` named as corrected | All 7 fixed. **Method changed**: the round-1 sweep grepped fixed phrases (`"20 of"`, `"21 predicted"`) and missed `"20 failing tests"`, `"20 Layer-1"`, `"21 defects"`, `"18 device-blocked"`. Round 2 uses a **numeric scan with context matching** that distinguishes a live assertion from a deliberate quotation |
| **M5** | `plan/01:4` header said 31 · 30 open · largest L; footer said 42 · 41 · largest M | Header no longer states a count — it points at `plan/08`. One canonical value, one location |
| **M6** | `R-19` referenced in `plan/07` but absent from the register | **`R-19` added to `plan/05`**, with four further risks: **R-20** demo-seed pollution, **R-21** ownership drift, **R-22** stale canonical metrics, **R-23** licence-condition drift. Each carries owner, likelihood, impact, mitigation and trigger |
| **M7** | `plan/02`/`plan/04 §5` never received the new gating edges; `1D-001..004` was scheduled with no `1D-000` — R-19's exact trigger | `plan/04 §6` execution map rebuilt with the gating edges, encoded in `depends_on`. ❌ **Only half done when written** — the round-3 review found `plan/02` itself still asserted `1D-001..004 | 1A-002` with no `1D-000`, and `1E-L1 | 1B-001`. `plan/02` was genuinely corrected at **round 4**, and the full 1D chain at **round 6** |
| **M8** | `DEMO-001` listed 7 tables; `demoSeed.ts:596` also writes **`willpower_state`** via `spend(3)` | Table list corrected to **8**. The detection plan now has an **UPDATE-aware** method for `willpower_state`, which has no literals and no `created_at` and is invisible to the clustering heuristic. Flagged as *suspected*, never confirmed. `demoSeed.ts:21`→`:22` corrected |
| **M9** | C12 parity withdrawal never annotated in `audit/05`; the "Phase 3 entry task" was never filed | Both closed — see §3 |
| **M10** | `plan/10` Step 2 never constrained baseline generation; an idempotent dump would re-grant the two revoked P0 privileges on an accidental `db push` | Step 2 binds the baseline to be non-idempotent and marks it push-unsafe. ❌ **"adds a `grep` assertion to `1A-002`" was FALSE when written** — the round-4 reviewer confirmed `1A-002` contained no such criterion. Genuinely added to the task block at **round 5** |

### Minor findings also fixed

`SEC-1D-005d` size mismatch (index vs block) · `1C-002`/`1C-003` serialisation now in `depends_on` rather than prose · `plan/04 §3` omissions (`1C-006`, `1D-000`, `1E-000`, `DEMO-001*`, `1B-007`, `1B-008`, `OPS-1E-001`, `1A-004`) · `1B-006` pointer retargeted to `DEMO-001A`/`B` · `1B-009` deferral stated with its Phase 2A destination.

---

## 3. M9 — parity withdrawal, actually closed

Round 1 withdrew the parity percentages as unreconcilable and said recomputation
"is filed as a Phase 3 entry task". The reviewer checked: **no such task
existed**, and `audit/05` still presented the six totals as authoritative with
status `Verified`.

Both are now true rather than promised:

- `audit/05` carries a **withdrawal notice at the head of its totals**, so a reader consulting the parity artefact sees the figures are not authoritative.
- The recomputation is filed as a **Phase 3 entry task** in `plan/03`, with the condition that makes it possible: line-level verification of the `[S]`-graded rows.

The withdrawal itself stands. Recomputing 97 requirements across six dimensions,
a third of them screen-level, would produce equally unreliable numbers with a
false air of precision. **No Phase 1 decision depends on parity** — the 1B
early-start argument rests on 14/32, which is independently verified.

---

## 4. Final ownership matrix

Regenerated from `plan/01`, not hand-maintained.

| Agent | Owns exclusively | Tasks |
|---|---|---|
| **Supabase & Security** | `supabase/migrations/**`, `supabase/functions/**`, `supabase/config.toml` | 26 |
| **Habit Domain** | `frontend/store/**`, `frontend/lib/**` | 11 |
| **QA & Test** | `frontend/__tests__/**`, `supabase/tests/**`, jest config | 7 |
| **Expo Architecture** | `frontend/app/**`, navigation entry points | 2 |
| **Repository Audit** | `frontend/package.json`, build config | 1 |
| **Open-Source Research** | `docs/research/**` | 1 |
| **Skeptical Reviewer** | **nothing — read-only** | 0 |

| Check | Result |
|---|---|
| Distinct Phase 1 files | 70 *(round-2 figure; **73** since round 8 — see `plan/08`)* |
| **Files with two different edit owners** | **0** |
| **`never touches` violations** | **0** |
| Test files not owned by QA & Test | **0** |
| Reviewer-owned production files | **0** |
| Same-agent multi-task files | **4** — all serialised via `depends_on` |

---

## 5. Canonical metric sweep result

| Metric | Value |
|---|---|
| E2E cases | **62** — 16 PASS · 7 VERIFIED FAIL · 23 PREDICTED FAIL · 15 BLOCKED-DEVICE · 1 BLOCKED-WRITE |
| Acceptance criteria | **91**, of which **32 failing** — **14 L1**, 17 L2, 1 mixed |
| Migrations | **21** live · **4** repo files · **2** matched · gap **19** |
| Live tables / RLS-enabled | **48 / 48** |
| Backlog | **49 rows · 1 DONE · 48 open · 48 fully specified · 0 XL · largest M** |

**Stale live assertions remaining: 0.** Six were found and fixed
(`audit/06:192`, `audit/09:197`, `plan/02:43`, `plan/03:120`, `plan/03:122`,
`plan/05:14`). Old values survive **only** where a document explicitly quotes
them as a corrected error — `plan/06`, `07`, `08`, `09`, `11` and one passage in
`qa/02`.

---

## 6. Final task count

**49 rows · 1 DONE (`1D-010`) · 48 open · 48 fully specified · 0 XL · largest M · no scope over 5 files · no dependency cycles.**

The count rose from 42 because the ownership rebuild **required** splitting
tasks — not because anything was recounted:

| Change | Reason | Net |
|---|---|---|
| `1E-L1` → `1E-L1` + `1E-L1a` + `1E-L1b` | its glob claimed four files owned by 1B tasks | +2 |
| `1E-L2` → `1E-L2` + `1E-L2a` + `1E-L2b` | claimed `willpower`/`recovery` tests from 1C; needed room for the xp/boss files freed from SEC tasks | +2 |
| `DEMO-001` → `DEMO-001A` + `DEMO-001B` | one task spanned two agents' trees | +1 |
| `OPS-1E-001` | `package.json` is Repository Audit's | +1 |
| `1A-004` | `plan/10`'s backup/cutover/verification steps had no owning task | +1 |

**41 + 7 = 48 open.** No task was removed or silently dropped.

---

## 7. Risk register correction

`plan/05` now runs **R-01 … R-23**. `R-19` exists as a real entry rather than a
dangling reference. Every entry carries `owner · likelihood · impact ·
mitigation · trigger`.

| ID | Risk | Score |
|---|---|---|
| **R-19** | Redeploying the stale `generate-routine` (v11 vs 2-mode committed file) | **HIGH** |
| **R-20** | Demo seeder pollutes real user data across **8** tables | **HIGH** |
| **R-21** | Ownership drift — two rounds found double-owned files | **HIGH** |
| **R-22** | Stale canonical metrics — same error survived a full round | **HIGH** |
| **R-23** | Licence-condition drift — conditional clearance never discharged | MED |

`R-01` corrected from 21 to **23** predicted failures.

---

## 8. Licence clearance result

`research/04` is no longer "conditional" in an undefined sense. Each of the three
carries **eight executable fields**: exact pinned version · official licence
source · compatibility source · approval owner · install task · validation
command · rollback · **condition to PASS**.

| Dependency | Licence expected | Ships? | Install task | Accepting owner | State |
|---|---|---|---|---|---|
| `jest-expo` | MIT | no | `OPS-1E-001` | QA & Test | **PENDING `1E-000`** |
| `supabase/cli` | Apache-2.0 | no | operator | Supabase & Security | **PENDING `1E-000`** |
| `pgTAP` | PostgreSQL | no | `1E-L2` (local only) | QA & Test | **PENDING `1E-000`** |

**`PENDING` is not a soft PASS.** `1E-000` is a hard `depends_on` of `1E-L1` and
`1E-L2`: no test code may be written until all three read PASS. Gate B does not
require the tools to be installed — it requires the procedure to be unambiguous.

---

## 9. Schema-task traceability

Every step in `plan/10` now has an owning task. **No step is unowned.**

| Step | Task | Runs in Phase 1? |
|---|---|---|
| Three-way diff + schema hash | `1A-001` | yes — read-only |
| Baseline generation (**non-idempotent**) | `1A-002` | yes — file only |
| Emergency Gate 0 migration preservation | `1A-002` AC | yes |
| Archive `001`/`002` | `1A-002` AC | yes |
| Local `db reset` | `1A-003` | yes — local |
| Schema-hash comparison | `1A-003` AC | yes |
| Post-reset revoke assertion | `1E-L2b` | yes — regression test |
| **Backup** | `1A-004` | **no** |
| **Cutover (`migration repair`)** | `1A-004` | **no** |
| **Post-cutover revoke re-assertion** | `1A-004` | **no** |
| Rollback (local / cutover) | `1A-002`,`1A-003` / `1A-004` | n/a |

**`1A-004` is the only task touching the live project**, and it is gated on H-01
*plus* a separate explicit approval. It executes no DDL.

---

## 10. Unresolved human decisions

| # | Decision | Blocks |
|---|---|---|
| **H-01** | Schema reconciliation **A or B** (A recommended) | `1A-002` and all DB-side work |
| **H-13** | **Docker is not running** — required for Layer 2 | `1E-L2`, `1E-L2a`, `1E-L2b` |
| H-02 | Rotate 4 account passwords | nothing technically |
| H-03 | Approve `OPS-0B-001` relocation | 2C |
| H-04 | Fate of bad-habits / webhooks / export | 2A |
| H-05 | Confirm `backend/server.py` not deployed | 2C · **P0 if reachable** |
| H-06 | Physical device | 15 blocked E2E cases; 23 predicted failures unobserved |
| H-07 | `awwwards-loop` capture blocker | 5F |
| H-08..H-10 | Store accounts · RevenueCat · Google OAuth | 6E · 6D · 2A |
| H-11 | Confirm `last_ai_context` ownership | `SEC-1D-005a` |
| **H-14** | **Separate approval for `1A-004`**, distinct from H-01 | live ledger cutover |

**H-01 and H-13 block Phase 1.** The rest block later phases.

---

## 11. Not done in this round

Stated so it is not mistaken for completeness:

- **No production code changed.** `demoSeed.ts` and `settings.tsx` are specified, not modified.
- **No live migration, SQL write, or Edge Function deploy.** No operation of any kind on `zdqiujpeewtyhtcqhdcj`.
- **Parity percentages still withdrawn**, not recomputed — now properly annotated and filed (§3).
- **Licence conditions not discharged** — that is `1E-000`'s first step, by design.
- **The 23 predicted failures are still predicted.** No device, no runner. This is R-01 and only `1E-L1a`/`1E-L1b` can close it.
- **`1B-009`** (remaining 5 `app/**` date sites) remains deferred to Phase 2A.
