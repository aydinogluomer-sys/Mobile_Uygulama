# 12 — Gate B Targeted Remediation (Round 4)

**Scope:** narrow and mechanical. No new architecture, no backlog rewrite, no production code, no live system change.
**Trigger:** Gate B round-3 review `FAIL` — 3 BLOCKER, 8 MAJOR, 6 MINOR.

> ## ⚠ §1 (B1) is SUPERSEDED by round 5
>
> The round-4 review found the B1 fix described below made `1A-002`
> **self-contradictory** and left the non-idempotency requirement absent from the
> task block. The user then decided **H-01 = (a) post-revoke baseline**.
>
> **`13_GATE_B_POST_REVOKE_BASELINE_DECISION.md` and the current `1A-002` block
> govern.** §1 below is retained only as the record of what round 4 attempted.
> §2 (serialisation) and §3 remain accurate; §4 and §5 carry inline corrections.

**Method change:** after every fix, the **actual task block** was re-read and the required terms located inside it. Not the report that claims the fix.

> **Why the method changed.** Rounds 1–3 each wrote a fix into the document that
> *describes* a rule rather than the task that *executes* it, then verified by
> reading the report. B1 is the clearest case: `plan/10` and `plan/11` both stated
> that a non-idempotency assertion had been added to `1A-002`, and `1A-002`
> contained none of it. Every claim below is backed by a grep **inside the task
> block**, not by a cross-reference.

---

## 1. B1 — `1A-002` security criteria

**Fix location:** `docs/plan/01_IMPLEMENTATION_BACKLOG.md`, the `1A-002` block.

Added directly to that block, with a note stating that **if this block and
`plan/10` ever disagree, the block governs**:

- The baseline may not weaken the live security posture.
- `mock_activate_subscription`, `add_xp`, `track_weekly_xp`, `deal_damage_to_active_boss` must not have `EXECUTE` reopened to `PUBLIC`/`anon`/`authenticated`.
- **FAIL condition:** a `GRANT EXECUTE ... TO PUBLIC|anon|authenticated` on any of those four fails the task. Not waivable.
- Blanket `CREATE OR REPLACE`, uncontrolled `GRANT`, posture-hiding `IF NOT EXISTS` and equivalent **PUSH-UNSAFE** patterns require separate review.
- The Emergency Gate 0 security outcome is preserved via **schema hash and privilege introspection**, not by the migrations merely existing as files.

**Validation added to the block:** baseline SQL grep for the four functions ·
PUSH-UNSAFE pattern grep · `supabase db reset` then `has_function_privilege`
for `anon` and `authenticated` on all four · pgTAP `AC-S01..S07` (`1E-L2b`)
against the freshly reset database · explicit "never call the functions".

**Risk/rollback:** the P0 re-grant vector is named in the block's `risk` field.

> ⚠ **This clause is superseded.** Round 4 required the baseline to carry the
> permissive grants "so the revokes have something to revoke", making ordering
> load-bearing. Under decision (a) that requirement is **deleted**: the baseline
> produces the secure ACL directly, and `REVOKE` on a never-granted privilege is
> a no-op, so the premise was wrong as well as self-contradictory.

Rollback states that an observed live re-grant is closed by **re-applying the two
revoke migrations first**, then investigating. That part still stands.

### Task-block evidence

Searched inside the `1A-002` block only:

| Term | Occurrences in block |
|---|---|
| `security posture` | 1 |
| `mock_activate_subscription` | 3 |
| `add_xp` | 3 |
| `track_weekly_xp` | 3 |
| `deal_damage_to_active_boss` | 3 |
| `task fails` | 1 |
| `CREATE OR REPLACE` | 2 |
| `IF NOT EXISTS` | 2 |
| `PUSH-UNSAFE` | 3 |
| `schema hash` | 1 |
| `privilege introspection` | 2 |
| `has_function_privilege` | 3 |
| `pgTAP` / `AC-S01` | 1 / 1 |
| `re-grant` | 3 |

---

## 2. B2 — serialisation

### The OAuth chain

`1D-005` → `1D-006` → `1D-007`. All three edit `notion-auth/index.ts`;
`1D-005` and `1D-006` also edit `spotify-auth/index.ts`.

| Task | `depends_on` in block | `depends_on` in index |
|---|---|---|
| `1D-005` | Gate B PASS | Gate B PASS |
| `1D-006` | **1D-005** | **1D-005** |
| `1D-007` | **1D-006** | **1D-006** |

Ordering rationale: `state` persistence first, then the redirect allowlist, then
the callback auth requirement — so the last task sees both prior controls in place.

### A second collision, found by our own script

The round-3 reviewer reported 3 unserialised pairs on `notion-auth`. Our
verification script found **4 more on `generate-routine/index.ts`**, which the
reviewer had recorded as serialised:

```
FAIL supabase/functions/generate-routine/index.ts
     unordered = [(1D-001,1D-003), (1D-001,1D-004), (1D-002,1D-003), (1D-002,1D-004)]
```

`1D-001` and `1D-003` were both reachable from `1D-000` but **not from each
other** — two branches off one gate, editing one file. Closed by adding
`1D-002` to `1D-003`'s `depends_on`, giving a single chain:

**`1D-000` → `1D-001` → `1D-002` → `1D-003` → `1D-004`**

### Result — all four shared files

```
ok  frontend/store/willpowerStore.ts              1C-002 -> 1C-003
ok  supabase/functions/generate-routine/index.ts  1D-001 -> 1D-002 -> 1D-003 -> 1D-004 -> 1D-000
ok  supabase/functions/notion-auth/index.ts       1D-005 -> 1D-006 -> 1D-007
ok  supabase/functions/spotify-auth/index.ts      1D-005 -> 1D-006
unserialised pairs: 0
```

Verified by transitive reachability over `depends_on`, not by reading prose.
Synchronised in: task blocks · task index · `plan/04 §2` and `§6` · `plan/02 §2`
and `§7` · `plan/05` R-19.

---

## 3. B3 — `1D-003` block/index consistency

| | Value |
|---|---|
| **Block** (`plan/01`) | `depends_on: 1A-002, **1D-000**, **1D-002**` |
| **Index row** | `1A-002, **1D-000**, **1D-002**` |
| `plan/02` | `1A-002, **1D-000**, **1D-002**` |
| `plan/05` R-19 mitigation | names the block-level encoding for `1D-001` and `1D-003` |

`1D-000` is present as required; `1D-002` was added to close the shared-file
chain (§2). The R-19 gate is now in the **task blocks** of both `1D-001` and
`1D-003` — `1D-001`'s block gained an explicit R-19 note — so the register no
longer describes a mitigation that exists only in the register.

**Programmatic result: block and index `depends_on` task-ID sets agree for all 48 open tasks.**

---

## 4. Corrected canonical metrics

| Metric | Value |
|---|---|
| E2E cases | **62** — 16 PASS · 7 VERIFIED FAIL · 23 PREDICTED FAIL · 15 BLOCKED-DEVICE · 1 BLOCKED-WRITE |
| Acceptance criteria | **91**, **32 failing**, **14 at L1** |
| Backlog | **49 rows · 1 DONE · 48 open · 48 fully specified · 0 XL · largest M** |
| Distinct Phase 1 files | 70 *(round-4 figure; **73** since round 8 — see `plan/08`)* |
| Migrations | **21** live · **4** repo · **2** matched |
| Files with two edit owners | **0** |
| Unserialised shared-file pairs | **0** |
| Active stale assertions | ❌ claimed **0**; round-4 review found `plan/09:75` still stale. Fixed at round 5 |

**Fixed this round:** `plan/00:176` (21→23) · `plan/04:44` (69→70) ·
`plan/08 §2` (42/41 marked superseded) · `plan/07` marked **SUPERSEDED** with
its six live assertions neutralised, including two that were **wrong when
written** (zero ownership conflicts, zero concurrent edits) ·
`plan/09 §3` ownership rows (`DEMO-001`→`A`/`B`, `1D-009`→S&S).

**14 scanner candidates were reviewed and all are false positives** — line
references (`logStore.ts:21-27`), IDs (`AC-S12`), test values (`used = 12`),
correct figures (`research/03:126` states 21/4/2, which is right; "the other 18
need a real Postgres" is right, since 32 − 14 = 18), and deliberate quotations
of corrected errors.

---

## 5. demoSeed — direct vs indirect

`demoSeed.ts` contains **zero** `supabase.from(...)` calls. The only direct
Supabase call in the file is `supabase.auth.getUser()` at `:46`. The previous
"direct inserts in `demoSeed.ts`" attribution was wrong.

**A · Direct writes (8)** — a store call writes the row

`projects` `:384` · `habits` `:464` · `habit_logs` `:479/:492/:507` ·
`tasks` `:557` · `focus_tasks` `:566` · `recovery_plans` `:578` ·
`journal_entries` `:615` · **`willpower_state`** `:596` (`spend(3)` → UPDATE) and `:370`

**B · Indirect trigger side effects** — no seeder code writes these

`habit_logs` carries three triggers, so every seeded log fires all three:

| Trigger | Changes |
|---|---|
| `trg_habit_log_set_xp` (BEFORE) | rewrites `habit_logs.xp` server-side |
| `trg_habit_log_award` (AFTER) | **`profiles`** (XP, level, coins), `habits.streak_current` |
| `on_habit_completed_damage_boss` (AFTER) | **`global_bosses`**, **`boss_contributors`** |

> ⚠ **Corrected at round 5.** Round 4 listed `weekly_xp` as *suspected*. It is
> **CONFIRMED** — `fn_habit_log_award` calls `track_weekly_xp(...)` directly.
> `habits.streak_best` was missed entirely. The confirmed indirect set is **six**,
> not four: `profiles` · `weekly_xp` · `habits.streak_current` ·
> `habits.streak_best` · `global_bosses` · `boss_contributors`.
> **`weekly_xp` backs the leaderboard** — the only affected table whose pollution
> is visible to other users. See `plan/13 §7` and the `DEMO-001A` block.

> ⚠ **Superseded (round 6).** This previously read "No group-B table appears in the direct list." After the round-5 correction added `habits.streak_current`/`streak_best` to group B, `habits` **is** in both lists — which is why the distinct-table count is **12**, not 13, and only **4** tables are never named by the seeder. Twelve tables are affected in
total; four of them are never named by any seeder code.

### Detection plan — three tiers, zero deletes

| Tier | Target | Confidence |
|---|---|---|
| 1 | 7 INSERT-written tables, literal + `created_at` cluster | **match** |
| 2 | `willpower_state` — UPDATE-only, no literals, no `created_at`; correlated against `state_date` and unexplained `used` | **suspected** |
| 3 | `profiles`, **`weekly_xp`**, `streak_current`, **`streak_best`**, `global_bosses`, `boss_contributors` — reported as *derived from polluted input*, with **no corrected value computed** | **inferred** |

**The plan contains no DELETE, no UPDATE and no automated cleanup.** It produces
a report. Cleanup would require its own approved task, because Tier 2 is a
suspicion and Tier 3 cannot be attributed at row level at all — "correcting" a
user's XP on that basis would destroy real progress.

---

## 6. Remaining human blockers

| # | Decision | Blocks Phase 1? |
|---|---|---|
| ~~**H-01**~~ | **CLOSED after this round** — Option A, post-revoke posture (`plan/13`) | **no longer blocks anything** |
| **H-13** | **Docker not running** — required by `supabase start` | **yes** — the whole Layer 2 lane; Phase 1 cannot reach Gate C without it |
| **H-14** | Separate approval for `1A-004` (live cutover), distinct from H-01 | **no** — `1A-004` is deliberately not executed in Phase 1 |
| H-02..H-12 | passwords · env relocation · product decisions · device · store accounts | later phases |

`plan/00 §5` previously said "H-01 is the only one blocking Phase 1." Corrected:
**three are listed, two genuinely block.**

---

## 7. Files changed

| File | Change |
|---|---|
| `plan/01_IMPLEMENTATION_BACKLOG.md` | `1A-002` security criteria + validation; `1D-001` R-19 note; `1D-003` deps; `1D-005/006/007` chain; `DEMO-001A` direct/indirect + 3-tier detection; `DEMO-001B` effect summary; index rows |
| `plan/00_EXECUTIVE_DECISION_REPORT.md` | 21→23; H-13/H-14 added; Phase 1 blocker statement corrected |
| `plan/02_DEPENDENCY_GRAPH.md` | 1D chain; OAuth chain; 1E gating; new tasks added to §2; §7 schedule |
| `plan/04_AGENT_TASK_GRAPH.md` | 69→70; generate-routine single chain; execution map |
| `plan/05_RISK_REGISTER.md` | R-19 mitigation synced to blocks; R-10/R-16 triggers filled; **D-17** (`1B-009`) added |
| `plan/07_GATE_B_REMEDIATION_REPORT.md` | marked **SUPERSEDED**; six live assertions neutralised |
| `plan/08_CANONICAL_METRICS.md` | 42/41 marked superseded by 49/48 |
| `plan/09_PHASE_1B_EARLY_START.md` | ownership rows corrected |
| `plan/12_GATE_B_TARGETED_REMEDIATION.md` | this document |

**Not touched:** production code · live database · Edge Functions · `demoSeed.ts`
· any Mas Technic (`zdqiujpeewtyhtcqhdcj`) resource.

---

## 8. Verification

`scratchpad/verify_r4.py` parses the **real task blocks** in `plan/01` — it reads
no report and trusts no stated total. Checks: block↔index `depends_on` diff ·
shared-file serialisation by transitive reachability · B1 terms inside the
`1A-002` block · counts · active stale-metric scan · `plan/10` step → task →
acceptance-criterion traceability.

```
1. block vs index depends_on ...... task-ID sets agree for all 48 tasks
2. shared-file serialisation ...... unserialised pairs: 0
3. B1 terms inside 1A-002 block ... 13/13 present
4. counts ......................... 48 open, 49 rows, 0 XL, 70 files, scope>5: none
5. stale assertions ............... 14 candidates, all reviewed, all false positives
6. schema step -> task -> AC ...... 1A-001, 1A-002, 1A-003, 1A-004, 1E-L2b all present with AC

FAILURES: NONE
```
