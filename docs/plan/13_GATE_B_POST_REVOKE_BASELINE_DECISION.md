# 13 — Post-Revoke Baseline Decision (H-01, Round 5)

**Decision owner:** user · **Decision: (a) POST-REVOKE SQUASHED BASELINE**
**Scope of round 5:** targeted Gate B remediation. No production code, no live DB, no Edge Function.

> **Round-6 corrections applied to this document:** the ordering invariant (§4),
> the 12/4 table arithmetic (§7), and the withdrawn "0 active stale assertions"
> claim (§8). The decision itself stands unchanged.

---

## 1. The decision

> **The baseline reproduces the current secure effective schema and privilege
> posture — not the historically insecure intermediate state of the live system.**

Round 4 left `1A-002` **unsatisfiable**: one criterion made any client-role
`GRANT EXECUTE` on the four P0 functions an absolute FAIL, while another field of
the same block required the baseline to carry "the original permissive grants".
The task could not be completed in either direction. Decision (a) resolves it.

---

## 2. Why pre-revoke was rejected

Option (b) would have had the baseline reproduce the live system *as it was
before* the two Emergency Gate 0 revokes, leaving those migrations to close the
holes afterwards.

| Reason | Detail |
|---|---|
| **Security would depend on migration ordering** | A fresh database would be exploitable between the baseline and the two revokes. Any partial apply, reordering, or `db push` of the baseline alone leaves a payment bypass and an unauthenticated cross-user write open |
| **It made the FAIL condition self-contradictory** | The baseline would have to contain exactly the `GRANT` text the same task forbids |
| **Its premise was technically wrong** | `REVOKE` on a privilege that was never granted is a **no-op** in PostgreSQL, not an error. The revokes never needed permissive grants to "have something to revoke" — that reasoning, introduced in round 2, was mistaken |
| **It made security untestable in isolation** | Under (b) no single artefact is secure; only a sequence is. Under (a) the baseline is a **single file with a directly testable property** |

**Under (a) the safe state is the default.** An accidental apply of the baseline
alone cannot leave the four functions open.

---

## 3. `1A-002` final security contract

The baseline must create these four functions with a directly secure posture:

- `public.mock_activate_subscription(text, text)`
- `public.add_xp(uuid, integer)`
- `public.track_weekly_xp(uuid, integer)`
- `public.deal_damage_to_active_boss(uuid, integer)`

**Required state after a fresh `supabase db reset`, for each:**

| Role | `EXECUTE` |
|---|---|
| `PUBLIC` | **false** |
| `anon` | **false** |
| `authenticated` | **false** |
| `service_role` | **true** |
| `postgres` | **true** |

- `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default, so the baseline must issue the `REVOKE`s **immediately after each function definition, in the same transaction** — never in a later migration, never at end of file.
- **The secure ACL is the baseline's own output contract.** It does not depend on the Emergency Gate 0 migrations, nor on migration ordering.
- **FAIL condition, absolute:** an explicit `GRANT EXECUTE ... TO PUBLIC|anon|authenticated` on any of the four fails the task. Not waivable.
- The removed clause ("original permissive grants") is **deleted in full**. No sentence in `1A-002` permits a client-role grant under any condition.

---

## 4. Emergency migration semantics

`20260802181931` and `20260802205850` are **retained, never deleted, never squashed**.

> **Baseline establishes the secure post-revoke posture. Emergency migrations
> preserve historical ledger continuity and regression evidence; they are not
> relied upon to make a fresh database secure.**

| Property | Value |
|---|---|
| Retained as files | **yes** — they match live ledger entries |
| Effect on a fresh database | **security no-op** — the baseline already produced the secure ACL |
| Must error? | **no — but only if the baseline runs first.** `REVOKE` on a never-granted *privilege* is a no-op; `REVOKE` on a **nonexistent function** is an `ERROR`. See the ordering invariant below |
| Load-bearing for security? | **no** |
| Why keep them | ledger continuity, and the record that two P0s were found, reviewed and closed |

> ## ⚠ Ordering invariant — added at round 6 (B1)
>
> The "security no-op" property **depends entirely on the baseline running first**.
> The baseline version is fixed at **`20260801000000`**, giving:
>
> **`20260801000000` < `20260802181931` < `20260802205850`**
>
> Had the baseline kept a natural current timestamp (`20260803…`), both Emergency
> migrations would have run **before** the functions existed, and
> `REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text)` would
> have **errored**, aborting `supabase db reset`. This invariant now lives in the
> `1A-002` task block (Group 1a), not only here.
>
> **Verified with Supabase CLI 2.109.1**, read-only: `migration squash --version
> 20260801000000 --local` reports the file *"is already the earliest migration"*,
> while `--version notatimestamp` returns `invalid version number`.

---

## 5. Non-idempotency contract

The baseline is an **empty-database bootstrap only**:

- **A second application against an existing schema must return non-zero.**
- Blanket `IF NOT EXISTS` — **forbidden**
- Blanket `CREATE OR REPLACE` — **forbidden**
- Patterns that silently mutate an existing object or hide the privilege posture — **forbidden**
- Header carries `-- PUSH-UNSAFE: empty-database bootstrap only. Never 'db push', never 'apply_migration' against live.`
- Applying it to live via `db push`/`apply_migration` is **prohibited**; live registration is `1A-004`'s ledger-only `migration repair`

**Validation, all in the `1A-002` block:** client-GRANT grep (no match) ·
idempotent-form grep (no match) · first apply on empty stack PASS · **second
apply returns non-zero** · schema-hash match · `has_function_privilege` for all
five roles · pgTAP `AC-S01..S07` green **before** any Emergency migration runs ·
never call the functions.

---

## 6. DEMO serialisation

**`DEMO-001A` → `DEMO-001B`**, encoded in `depends_on`.

The **source guard lands first**. Removing the UI row alone is insufficient —
any other caller of `seedDemoData()` would still write. Securing the library
first makes the window between tasks *safe but cosmetically inconsistent* (a
visible button that refuses), rather than *invisible but still exploitable*.

Round 4 had this in prose only, in the **reverse** order, encoded in no
`depends_on`. Now identical in the task blocks, index, `plan/02`, `plan/04` and
`plan/09`.

---

## 7. Corrected indirect effects

Verified from the actual trigger function bodies.

**Direct store writes (8):** `projects` · `habits` · `habit_logs` · `tasks` ·
`focus_tasks` · `recovery_plans` · `journal_entries` · `willpower_state`

**Indirect trigger effects (6):** `profiles` · **`weekly_xp`** ·
`habits.streak_current` · **`habits.streak_best`** · `global_bosses` ·
`boss_contributors`

| Change | Detail |
|---|---|
| **`weekly_xp` is CONFIRMED, not suspected** | `fn_habit_log_award` calls `track_weekly_xp(...)` directly |
| **`habits.streak_best` added** | the same function writes it; previously only `streak_current` was listed |
| Boss path condition stated | fires only when `is_completed = true`; `logStore.ts:60,78` sets it and `demoSeed.ts:479,507` seed two `done` logs, **so it does fire** |

**`weekly_xp` backs the leaderboard** — the only affected table whose pollution
is visible to *other* users. It is now named in group B and in Tier 3 of the
detection plan.

Direct and indirect lists are kept strictly separate. **12 distinct tables** are
affected: the six indirect entries resolve to five distinct tables (`streak_current`
and `streak_best` are both `habits`), and `habits` is already in the direct list —
so 8 + {`profiles`, `weekly_xp`, `global_bosses`, `boss_contributors`} = **12**.
**Four are named nowhere in the seeder.**

The detection plan remains three tiers by confidence with **no DELETE, no UPDATE,
no automated cleanup**, and computes no "corrected" value for trigger-derived data.

---

## 8. Verification-script redesign

`verify_r4.py` had two structural blind spots that each concealed a real defect:

| Blind spot | What it hid |
|---|---|
| Task IDs matched by regex `(?:…\|DEMO)-[0-9a-z]+\b` — cannot match `DEMO-001A`/`B` (uppercase suffix defeats `\b`) | The two tasks with prose-only ordering were **invisible to the checker that reported "all 48 agree"** |
| Stale scan skipped six plan documents by filename whitelist | `plan/09`'s stale "10 sites" survived |

`verify_r5.py` changes both:

- **The task-ID alphabet is built from the actual H2 headings** in `plan/01`, then matched by literal alternation, longest-first. No ID pattern is guessed, so `DEMO-001A`/`DEMO-001B` are covered naturally.
- **Every `.md` under `docs/` is scanned** — `plan`, `audit`, `qa`, `research`, `skills`. **No document-level whitelist.** A historical value is ignored only when its own line marks it superseded, or when it sits inside a table whose header names a "Was"/"Previously"/"Claimed" column — i.e. an explicit correction record.

**Round-5 result:**

```
task ID alphabet ......... 48 ids; DEMO ids seen: ['DEMO-001A', 'DEMO-001B']
1. block vs index ........ mismatches: 0
2. shared-file serialise .. unserialised pairs: 0
3. ownership ............. two-agent files: 0   never-touches violations: 0
4. counts ................ 48 open, 49 rows, 0 XL, 70 files, scope>5 none, cycles none
5. 1A-002 contract ....... 14/14 terms present; permissive-grant clause absent
6. stale scan ............ 23 candidates, all adjudicated (see below)

FAILURES: NONE
```

**Stale adjudication at round 5 — claimed 0 active.** ❌ The round-6 review found **14** genuinely active, chiefly the H-01 status contradictions and this document's own claims. All 14 are closed at round 6; see `14_GATE_B_ROUND_6_REMEDIATION.md`. Original round-5 text follows:

 The 23 candidates are: correct values
(`plan/00:80` and `plan/02:199` "the other 18" — 32−14=18; `research/03:126`
"21 live migrations, 4 repo files, 2 matching"), a commit hash (`42b64a0`),
transition arithmetic (`41 + 7 = 48`), and explicit correction records in
`plan/06`, `07`, `08`, `09`, `11` and `qa/02`. One genuine survivor was found and
fixed this round: `plan/07:23`.

---

## 9. Unresolved human decisions

| # | Decision | Blocks Phase 1? |
|---|---|---|
| ~~H-01~~ | **ANSWERED — (a) post-revoke baseline** | resolved |
| **H-13** | **Docker not running** — required by `supabase start` | **yes** — the Layer 2 lane **and all of Phase 1A past authoring** (`1A-002` Stage A/B, `1A-003`). Phase 1 cannot reach Gate C without it |
| **H-14** | Separate approval for `1A-004` (live ledger cutover) | **no** — `1A-004` is deliberately not executed in Phase 1 |
| H-02..H-12 | passwords · env relocation · product decisions · device · store accounts · RevenueCat · OAuth | later phases |

**H-01 is closed.** `1A-002` is now specifiable and executable. **H-13 is the
only remaining Phase 1 blocker.**

---

## 10. Files changed

> **This table covers `e89e265` only.** `bc84d4a` additionally changed
> `docs/plan/11_GATE_B_REMEDIATION_ROUND_2.md` and
> `docs/plan/12_GATE_B_TARGETED_REMEDIATION.md` (supersession banners and
> corrections). Round-8 changes are recorded in `14_GATE_B_ROUND_6_REMEDIATION.md`
> and the round-8 commit message. Noted at round 8 (M1).

| File | Change |
|---|---|
| `plan/01_IMPLEMENTATION_BACKLOG.md` | `1A-002` rewritten for post-revoke (contradictory clause deleted; five-role ACL table; same-transaction REVOKE; non-idempotency contract; 5-step validation); `DEMO-001B` → `depends_on: DEMO-001A`; indirect effects corrected to six; Tier 3 and `DEMO-001B` summary updated; index row |
| `plan/10_SCHEMA_RECONCILIATION_PLAN.md` | Step 3 rewritten with the governing principle; Step 2 and Step 5 aligned to post-revoke; block-governs note |
| `plan/02_DEPENDENCY_GRAPH.md` | DEMO chain direction corrected in the table and the day-1 schedule |
| `plan/04_AGENT_TASK_GRAPH.md` | DEMO chain in the execution map |
| `plan/09_PHASE_1B_EARLY_START.md` | `1B-008` scope 10 → **5 sites**; DEMO ordering |
| `plan/07_GATE_B_REMEDIATION_REPORT.md` | C1 row annotated as a superseded round-1 figure |
| `plan/13_…` | this document |

**Not touched:** production code · live database · Edge Functions · `demoSeed.ts`
· any Mas Technic (`zdqiujpeewtyhtcqhdcj`) resource.
