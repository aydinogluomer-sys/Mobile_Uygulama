# 00 — Executive Decision Report

**Gate B decision record** · 2026-08-03
**Status: pending independent skeptical review**

---

## 1. Verdict

**The product is more built than its git history suggested, and was less safe
than its documentation claimed. Both facts are now evidenced.**

Seven screens work end to end against Supabase. TypeScript is clean under
`strict` with zero suppressions. RLS is enabled on all 48 live tables with no
ERROR-level advisors. XP is server-authoritative and cannot be forged by a
client. No hardcoded metric *values* from the reference prototype were copied
into the UI.

> **Corrected at Gate B review.** An earlier version of this paragraph claimed
> "there are no fake metrics anywhere in the UI". That was wrong.
> `frontend/lib/demoSeed.ts` is reachable from a live, ungated Settings row
> (`settings.tsx:339`) and writes fabricated projects, tasks, habits, habit logs,
> recovery plans and journal entries into the user's real account — polluting the
> very XP, streak and leaderboard metrics Phase 1B exists to fix. See
> `06_GATE_B_REVIEW_OUTCOME.md` §F3.

Against that: **two live P0 exploits existed** — one allowing any signed-up user
to grant themselves a paid tier with 1000 credits, one allowing an
*unauthenticated* caller to rewrite any user's XP and end a global game event.
Both are now closed by reviewed migrations. **268 source files — effectively the
entire application — had never been committed to any branch.** That is now fixed.

The remaining work is concentrated and knowable: a timezone defect cluster
affecting seven subsystems simultaneously, four metric-correctness defects, a
non-atomic willpower budget, a schema that cannot be reproduced from the
repository, and no executing tests.

---

## 2. Sign-offs

### 2.1 Security sign-off — **CONDITIONAL PASS**

| Item | State |
|---|---|
| Open P0 | **None.** Both closed and independently reviewed |
| RLS coverage | All 48 tables · 0 ERROR advisors · no policy grants to `anon` |
| Cross-tenant isolation | Verified at schema level; **device verification outstanding** |
| Payment path | `mock_activate_subscription` revoked + `__DEV__`-gated; direct `user_subscriptions` writes blocked by policy absence |
| Open P1 | **13** — see doc 09 §5 |

**Conditions attached:**
1. `SEC-1D-005` (self-inflation via `profiles` column grants) is P1 and must close in Phase 1.
2. `SEC-1D-004` (blanket `TRUNCATE`/write grants on money tables) — currently latent, becomes live the moment any permissive write policy is added.
3. AC-S01..S07 must exist as permanent regression tests **before** any further grant-touching migration.
4. 17 `SECURITY DEFINER` functions have unpinned `search_path` — P2, Phase 1D.

**Signed:** Supabase & Security agent · reviewed by Skeptical Reviewer (twice, both `PASS WITH FINDINGS`)

### 2.2 Licence sign-off — **BLOCKED**

15 candidates, **15/15 permissive, 0 blocked, 0 unresolved**.

**But 0/15 satisfy the adoption gate.** The gate requires the `LICENSE` file read
at the pinned adoption version with its SHA recorded. Nothing has been cloned, so
every licence is recorded from published knowledge — a claim, not evidence.
Transitive licences across the resolved dependency tree were never reviewed.

**No repository may be adopted until both gaps close.** This blocks nothing in
Phase 1, which introduces only `jest-expo`, `supabase/cli` and `pgTAP` — all of
which must pass the gate first.

**Signed:** Open-Source Research agent — **withheld pending verification**

### 2.3 Test strategy sign-off — **PASS**

Two layers, with the reason one is insufficient stated: a mocked client can
assert a store *called* upsert; it cannot prove Postgres *rejected* a
cross-tenant read. 91 acceptance criteria, 32 known failing, **14 of them
Layer 1** — no device, no database. The other 18 need a real Postgres.

**Signed:** QA & Test agent

### 2.4 Rollback strategy — **PASS**

| Level | Mechanism | Proven |
|---|---|---|
| Task | small diffs, one concern each, per-task commit | yes — 20 commits this engagement |
| Migration | exact rollback SQL in every migration header, with pre-change state captured verbatim | yes — both Emergency Gate 0 migrations |
| Phase | branch-scoped; `chore/commit-baseline` never force-pushed | yes |
| Live change | privilege-only changes are single-statement reversible | yes — verified by the reviewer, who **corrected** one rollback that would have introduced ACL drift |

The reviewer's correction is the evidence this strategy works: a rollback that
restores a *superset* is not a restore, and the process caught it.

**Signed:** Skeptical Reviewer

---

## 3. Schema reconciliation decision — **USER DECISION REQUIRED**

Live ledger: **21** migrations. Repository: **4** files. Matching: **2**.
`supabase db reset` from the repository produces a database **the app cannot run
against** — 41 of 48 tables missing, all 40 RPCs missing, all 9 triggers missing,
5 renamed columns, and a CHECK that rejects a value the client writes.

| Option | Description | Assessment |
|---|---|---|
| **A — Squashed baseline** *(recommended)* | One migration representing the current live schema; archive `001`/`002` as historical | Fastest to a working `db reset`. Matches how the schema actually came to exist. Loses per-change history — **which is already lost**, since 19 of 21 ledger entries have no repository counterpart |
| **B — Incremental reconstruction** | ~19 migrations reconstructing each ledger entry | **Would fabricate history.** Nobody has the original SQL; reconstructing from the end-state produces files that look authoritative while being invented. 19× the work, 19× the drift risk |

**Recommendation: Option A.** This audit has consistently refused to manufacture
evidence, and should not start with the migration history. The drift is already
documented for the record in doc 07 §8.

---

## 4. Phase 1 entry criteria

| Criterion | State |
|---|---|
| Gate B `PASS` | pending review + user acceptance |
| Schema strategy chosen | **awaiting user (§3)** |
| Backlog with acceptance criteria | ready — doc 01 |
| Dependency graph | ready — doc 02 |
| Agent ownership, no overlaps | ready — doc 04 |
| Rollback strategy | ready — §2.4 |
| Test strategy | ready — qa/01 |
| Risk register + Deferred Scope | ready — doc 05 |
| Independent review | **pending** |

**Phase 1 may begin when all nine hold.** Note that the Habit Domain stream
(1B, **14 of 32** failing criteria) depends on **none** of the schema decision —
if §3 stalls, that stream still starts. The figure was previously stated as 20;
that was a miscount, corrected in `08_CANONICAL_METRICS.md` §2. At 14 the
majority of failing criteria **do** need the schema decision, which makes H-01
critical-path rather than deferrable — see `09_PHASE_1B_EARLY_START.md` §4.

---

## 5. Human dependency list

Work that cannot proceed without a person.

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| **H-01** | Schema reconciliation A or B | 1A-002 and everything DB-side | **user** |
| **H-02** | Rotate the 4 account passwords found in the agent permission allowlist (entries pruned; rotation is not mine to do) | nothing technically | **user** |
| **H-03** | Approve relocation of `backend/.env.local` (foreign service-role key) — OPS-0B-001 | 2C | **user** |
| **H-04** | Decide the fate of bad-habits tracking, webhooks and data export (currently `localhost:8000`) | 2A | **user** |
| **H-05** | Confirm `backend/server.py` is not deployed — escalates to P0 if reachable | 2C | **user** |
| **H-06** | Physical device or emulator | 15 E2E cases; 23 predicted failures remain unobserved | **user** |
| **H-07** | Resolve `awwwards-loop` browser-capture blocker | Phase 5F scoring | **user / Design** |
| **H-08** | Apple Developer + Google Play accounts | 6E | **user** |
| **H-09** | RevenueCat account and real IAP products | 6D/6E | **user** |
| **H-10** | Google Cloud OAuth app for Calendar (feature never provisioned) | 2A/2C | **user** |
| **H-11** | Confirm ownership of `last_ai_context` column | SEC-1D-005a | **user** |
| **H-12** | Approve Phase 2 start after the Phase 1 report | Phase 2 | **user** |
| **H-13** | **Docker is not running on this machine** — required by `supabase start` for every Layer 2 test | **`1E-L2`, `1E-L2a`, `1E-L2b`** | **user** |
| **H-14** | **Separate explicit approval for `1A-004`** (live ledger cutover), distinct from H-01 | `1A-004` — *not executed in Phase 1* | **user** |

**Three block Phase 1, not one:**

| # | Blocks | Effect if unresolved |
|---|---|---|
| **H-01** | `1A-002` and everything DB-side | The Schema stream idles. The Habit Domain, Expo Architecture, Repository Audit and Open-Source Research lanes still run — 14 of 32 failing criteria close without it |
| **H-13** | the entire Layer 2 test lane | `1E-L2`/`L2a`/`L2b` cannot run at all. **Phase 1 cannot reach Gate C without Layer 2**, since no RLS, RPC-atomicity or constraint claim may rest on a Layer 1 test |
| **H-14** | `1A-004` only | No effect on Phase 1 — `1A-004` is deliberately **not executed** in Phase 1. Listed so the live cutover is never treated as implied by H-01 |

The rest block later phases.

---

## 6. Decisions required now

1. **Schema reconciliation: Option A or B?** (§3 — recommend A)
2. **Gate B: accept `PASS WITH FINDINGS`?**
3. **Authorise Phase 1 to begin?**

---

## 7. What would make me wrong

Stated so it can be checked rather than assumed:

- **23 failures are predicted, not observed.** If they do not reproduce as failing tests in `1E-L1a`/`1E-L1b`, the diagnoses are wrong and Phase 1 must re-plan. This is risk R-01 and the single largest uncertainty in the plan.
- **Parity percentages carry an evidence grade.** Screen-level `[S]` rows were not read line by line. The totals are directionally sound, not precise to the point.
- **Performance targets have no baseline.** Every number in `qa/03` is provisional until a device measurement exists.
- **Licences are recalled, not read.** 15/15 permissive is a claim until each `LICENSE` is read at its pinned commit.
- **`backend/server.py` is assumed dead.** If it is deployed and reachable, it is an unauthenticated ~30-endpoint service and becomes P0 immediately.

---

## 8. Gate B status

**`PENDING` — awaiting independent skeptical review and user acceptance.**

Artefacts: `00` (this) · `01` backlog · `02` dependency graph · `03` roadmap ·
`04` agent task graph · `05` risk register — **5/5 complete**, plus the backlog
promoted from `DRAFT/SEEDED` to final.

Prohibited until Gate B `PASS` **and** explicit approval: starting Phase 1 ·
applying a live migration · running a SQL write · deploying an Edge Function ·
entering Phase 2 · any operation on Mas Technic.
