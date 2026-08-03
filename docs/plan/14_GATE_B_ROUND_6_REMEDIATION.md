# 14 — Gate B Round-6 Remediation

**Trigger:** round-6 independent review — **FAIL**, 3 BLOCKER · 6 MAJOR · 4 MINOR
**Reviewed commit:** `bc84d4a6a738ad6fe263dda81a97526d2eaadf78` (HEAD stable start→end, tree clean both times)
**Scope:** narrow documentation/tooling remediation. No production code, no migration SQL body, no live system change, no Mas Technic operation.

> All 13 findings below are taken verbatim from the round-6 reviewer's final
> report. Nothing is inferred or added.

---

## Blockers

### B1 · `1A-002` carried no migration-ordering constraint — `db reset` would fail

| | |
|---|---|
| **Severity** | BLOCKER |
| **Claim** | `plan/10:96` says the Emergency migrations are *"ordered **after** it"*, and `plan/13:76` says *"Must error? **no**"* — but `1A-002`'s filename was an unconstrained placeholder |
| **Proof** | `supabase migration new` stamps the current time. Verified live: the CLI generated `20260803165627_probe_generated.sql`. That sorts **after** `20260802181931` and `20260802205850`, so both Emergency migrations would run **first**, against a database where the four functions do not exist. Their statements are bare `REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM PUBLIC;` — `REVOKE` on a **nonexistent function** is an `ERROR`, not a no-op. `supabase db reset` aborts before reaching the baseline |
| **Target file** | `docs/plan/01_IMPLEMENTATION_BACKLOG.md` |
| **Task block** | `1A-002` |
| **Remediation** | Baseline version **fixed at `20260801000000`**; new *Group 1a — migration ordering* criteria carry the invariant `20260801000000 < 20260802181931 < 20260802205850`, the exact fresh-reset order, and the requirement that `001`/`002` leave the active root |
| **Verification** | `tools/audit/verify_gate_b.py` §6 asserts the invariant numerically and checks the block pins the version. **CLI format verified, not assumed** (below) |
| **Status** | **CLOSED** |

**Version format verified by read-only tooling inspection — Supabase CLI 2.109.1:**

```
$ supabase migration squash --version 20260801000000 --local
supabase\migrations\20260801000000_baseline_schema.sql is already the earliest migration.

$ supabase migration squash --version notatimestamp --local
invalid version number
```

The CLI parsed the version, accepted the format, and **itself confirmed the file
is the earliest migration** among the three. The malformed control is rejected,
proving the check is real. Probe ran in a scratch directory; the repository was
not modified.

> **The distinction that was missed for two rounds:** `REVOKE` on a *never-granted
> privilege* is a no-op — true, and previously relied upon. `REVOKE` on a
> *nonexistent object* is an **error**. Only the first was accounted for.

### B2 · H-01 declared closed in one document, still open in eight

| | |
|---|---|
| **Severity** | BLOCKER |
| **Claim** | `plan/13:187,192` declare H-01 closed while `plan/10:3`, `plan/10:229-233`, `plan/00:147,166,176`, `plan/02:100,185`, `plan/12:225` still present it as an open A-or-B question. `plan/10:229` contradicted `plan/10:98` *in the same file* |
| **Proof** | Reviewer grep; independently confirmed |
| **Target file** | `plan/10`, `plan/00`, `plan/02`, `plan/12`, `plan/01`, `plan/04`, `plan/07` |
| **Task block** | `1A-002`, `1A-004` headers and index rows |
| **Remediation** | `plan/10` status → **H-01 ANSWERED**; §7 converted from *"Decision required"* into a **decision record**; a disambiguation box added distinguishing the **two question-pairs** that shared the label — *H-01/strategy* (A vs B) and *H-01/posture* ((a) vs (b)), **both answered**. `H-01` removed as a live `depends_on` from `1A-002` and `1A-004` in block **and** index (`1A-004` now depends on `H-14 approval`) |
| **Verification** | `grep -rn "H-01" docs/` returns no site presenting it as an open decision |
| **Status** | **CLOSED** |

### B3 · `plan/13 §10` omitted `bc84d4a`; `plan/11` banner claimed an annotation that did not exist

| | |
|---|---|
| **Severity** | BLOCKER |
| **Claim** | `plan/13:199-207` lists only the seven files from `e89e265`; `bc84d4a` changed `plan/11` and `plan/12`, neither listed. And `plan/11:5-6` states *"annotated inline (M7, M10)"* while **M7 carried no annotation** |
| **Proof** | `git show --stat bc84d4a`; grep of `plan/11:63` |
| **Target file** | `plan/13`, `plan/11` |
| **Remediation** | `plan/13` header records the round-6 corrections; **M7 at `plan/11` is now genuinely annotated** — it was only half done when written, and `plan/02` was corrected at round 4, the full 1D chain at round 6. §10 is superseded by §7 of this document |
| **Verification** | `plan/11` M7 and M10 both carry `❌` annotations; files-changed list below reconciles against `git show --stat` |
| **Status** | **CLOSED** |

---

## Majors

| # | Claim (`file:line`) | Proof | Target / block | Remediation | Status |
|---|---|---|---|---|---|
| **M1** | `plan/10:210` attributes an Emergency-migration retention criterion to `1A-002`; the block has none | Read of `plan/01:56-105` — no such criterion | `plan/01` · `1A-002` | **Group 1b restored to the block**: the two files are not deleted, not folded into the squash, sort after the baseline, kept for ledger continuity and audit evidence, and are **not load-bearing** for fresh-database security | **CLOSED** |
| **M2** | `1A-002` validation step 4 cannot demonstrate non-idempotency; `psql -f` exits 0 on statement errors without `-v ON_ERROR_STOP=1`, and no connection parameters were given | PostgreSQL `psql` semantics | `plan/01` · `1A-002` | Validation now defines `PSQL="psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres"` and uses it for both the second-application test and the privilege query, with a note stating why the bare form is meaningless here | **CLOSED** |
| **M3** | `plan/13:95-96` claims `has_function_privilege` "for **all five roles**"; the block checked four — `postgres` absent | Read of the query | `plan/01` · `1A-002` | `pg_exec` added; expectation line now `public_exec=f anon_exec=f auth_exec=f svc_exec=t pg_exec=t`. `plan/13`'s claim is now true of the block | **CLOSED** |
| **M4** | "13 distinct tables" and "five named nowhere" are each off by one | The six indirect *entries* resolve to **five** distinct tables (`streak_current`/`streak_best` are both `habits`), and `habits` is already direct: 8 + {`profiles`,`weekly_xp`,`global_bosses`,`boss_contributors`} = **12**; never-named = **4** | `plan/01` `DEMO-001B` · `plan/13 §7` | Both corrected to **12** and **4**, with the arithmetic shown. `plan/12:203`'s now-false "no group-B table appears in the direct list" annotated | **CLOSED** |
| **M5** | `plan/13:174` "Stale adjudication — 0 active" disproven; **14** genuinely active | Reviewer enumeration | all `docs/` | All 14 closed (§4). `plan/13 §8` annotated with the withdrawal | **CLOSED** |
| **M6** | `verify_r5.py` is not in the repository; `plan/13 §8` quotes its output as evidence | `git ls-files` → empty | `tools/audit/` | **`tools/audit/verify_gate_b.py` committed** with `tools/audit/README.md`. Read-only, no network, no DB, deterministic, fixture-free. Scratchpad output is no longer cited as evidence | **CLOSED** |

---

## Minors

| # | Claim | Remediation | Status |
|---|---|---|---|
| **m1** | `plan/12:203` "No group-B table appears in the direct list" became false after the round-5 correction | Annotated as superseded, with the 12/4 consequence stated | **CLOSED** |
| **m2** | `plan/11:70` claims the `plan/04 §3` omissions incl. `1A-004` were fixed; `1A-004` is still absent from that table | `1A-004` added to the `plan/04 §3` assignment table | **CLOSED** |
| **m3** | `1A-002` validation step 2 grepped for *any* `IF NOT EXISTS`/`CREATE OR REPLACE` while the criteria forbid only **blanket** use — stricter than the rule it validates | Note added: a specific justified exception must be listed by line in the baseline header with its justification; step 3 then reads "no match **other than** the listed exceptions". An unlisted match is a FAIL | **CLOSED** |
| **m4** | `plan/03:18` points Phase 1 entry at `doc 02 §3` (the stale A/B section) rather than at `plan/13` | Pointer retargeted to `plan/13` | **CLOSED** |

---

## 4. The 14 active stale assertions

| # | Location | Resolution |
|---|---|---|
| 1 | `plan/10:3` "execution awaits H-01" | → **H-01 ANSWERED** |
| 2 | `plan/10:229-233` "Decision required — H-01" | → §7 is now a **decision record** |
| 3 | `plan/10:210` retention criterion attributed to `1A-002` | → the block now **carries** it (M1); attribution is true |
| 4 | `plan/00:147` H-01 row | → struck through, **CLOSED** |
| 5 | `plan/00:166` H-01 blocks Phase 1 | → **CLOSED, no longer blocks** |
| 6 | `plan/00:176` "21 failures predicted" | → **23** (corrected at round 4; re-verified) |
| 7 | `plan/02:100` "1A-002 cannot start until…" | → **H-01 ANSWERED; 1A-002 unblocked** |
| 8 | `plan/02:185` "── H-01 decision ──" in the schedule | → "(H-01 already answered)" |
| 9 | `plan/12:225` H-01 blocks | → struck through, **CLOSED** |
| 10 | `plan/12:203` group-B claim | → annotated superseded (m1) |
| 11 | `plan/13:95-96` "all five roles" | → **now true**: `pg_exec` added to the block (M3) |
| 12 | `plan/13:137-139`, `plan/01:1033-1035` 13/5 | → **12/4** (M4) |
| 13 | `plan/13:174` "0 active stale" | → annotated with the withdrawal (M5) |
| 14 | `plan/11:5-6` "annotated inline (M7, M10)" | → **M7 genuinely annotated** (B3) |

**Result: 0 active stale assertions.** The verifier's remaining candidates are
all adjudicated false positives: correct values (`plan/00:80` and the "other 18"
— 32 − 14 = 18; `research/03:126` "21 live migrations, 4 repo files, 2 matching"),
transition arithmetic (`41 + 7 = 48`), and explicit correction records in
`plan/06`, `07`, `08`, `09`, `11` and `qa/02`.

---

## 5. Human dependency status

| # | Status |
|---|---|
| **H-01** | **CLOSED** — Option A (squashed baseline) **and** posture (a) (post-revoke). Both parts answered |
| **H-13** | **OPEN** — Docker not running. Blocks the entire Layer 2 lane, therefore Phase 1 *completion* and Gate C |
| **H-14** | **OPEN** — separate approval for `1A-004` live ledger cutover. Does **not** block Phase 1 start; `1A-004` is deliberately not executed in Phase 1 |

---

## 6. Verification

```
python tools/audit/verify_gate_b.py
```

Committed, read-only, no network, no database, deterministic. It asserts:
mandatory fields · block↔index `depends_on` equality · shared-file serialisation
by transitive reachability · ownership conflicts and never-touches violations ·
sizes, scope limits and dependency cycles · **the migration ordering invariant
(B1)** · the `1A-002` post-revoke contract terms · an unwhitelisted stale scan
over every `.md` under `docs/`.

Its task-ID alphabet is built from the **actual H2 headings**, so `DEMO-001A` and
`DEMO-001B` are covered — the defect that made an earlier checker blind to the
very tasks it claimed to verify.

---

## 7. Files changed this round

| File | Change |
|---|---|
| `docs/plan/01_IMPLEMENTATION_BACKLOG.md` | `1A-002`: exact filename, Group 1a ordering, Group 1b preserved-emergency, rewritten validation (`ON_ERROR_STOP=1`, connection params, five roles, ordering assertions); `1A-002`/`1A-004` headers and index rows drop `H-01`; `DEMO-001B` 12/4 arithmetic |
| `docs/plan/10_SCHEMA_RECONCILIATION_PLAN.md` | H-01 closed banner; §7 → decision record; exact baseline filename |
| `docs/plan/00_EXECUTIVE_DECISION_REPORT.md` | H-01 rows closed; blocker statement corrected |
| `docs/plan/02_DEPENDENCY_GRAPH.md` | H-01 closed; `1A-004` depends on `H-14`; schedule updated |
| `docs/plan/04_AGENT_TASK_GRAPH.md` | exact baseline filename; `1A-004` added to §3 (m2); H-01 note |
| `docs/plan/03_RELEASE_ROADMAP.md` | Phase 1 entry pointer retargeted (m4) |
| `docs/plan/07_GATE_B_REMEDIATION_REPORT.md` | "Awaits H-01" annotated |
| `docs/plan/11_GATE_B_REMEDIATION_ROUND_2.md` | **M7 annotated** (B3) |
| `docs/plan/12_GATE_B_TARGETED_REMEDIATION.md` | H-01 row closed; group-B claim annotated (m1) |
| `docs/plan/13_GATE_B_POST_REVOKE_BASELINE_DECISION.md` | ordering invariant (B1); 12/4 (M4); stale claim withdrawn (M5); round-6 header note |
| `docs/plan/14_…` | this document |
| `tools/audit/verify_gate_b.py` | **new** — committed Gate B verifier (M6) |
| `tools/audit/README.md` | **new** — how to run it, and its constraints |

**Not touched:** production code · migration SQL bodies · live database · Edge
Functions · `demoSeed.ts` · any Mas Technic (`zdqiujpeewtyhtcqhdcj`) resource.
