# 18 — Gate B Round 10: Execution Integrity

**Trigger:** independent review at `0caccf0` — **FAIL**, 2 BLOCKER · 4 MAJOR · 7 MINOR (valid: HEAD stable, tree clean, break-tests executed)
**Scope:** the reviewer's findings only. No product architecture, no production code, no migration SQL body, no live operation.

> The reviewer devised **8 break-tests of its own; the verifier caught 1**. That
> ratio, not the FAIL, is the finding that shaped this round.

---

## 1. Complete finding ledger

### BLOCKER 1 — the F1 defect was relocated, not removed

| | |
|---|---|
| **Severity** | BLOCKER |
| **Reviewer ref** | `docs/plan/01_IMPLEMENTATION_BACKLOG.md:310` |
| **Claim** | Round 9 replaced the config copy with `supabase init` but **deleted `mkdir -p "$SCRATCH/supabase/migrations"`**. `supabase init` creates only `config.toml`, so `cp "$BASE" "$SCRATCH/supabase/migrations/"` aborts under `set -euo pipefail` — before the migration count, `db reset`, A1/A2/A3 and all of Stage B |
| **Proof** | Reviewer executed the excerpt: `cp: cannot create regular file './supabase/migrations/': Not a directory`, `SCRIPT_EXIT=1`. Independently re-probed here: `supabase init` in an empty dir yields exactly `./supabase/config.toml` |
| **Target** | `1A-002B` validation fence |
| **Remediation** | `mkdir -p "$SCRATCH/supabase/migrations"` immediately after `supabase init`, plus `test -d`; and `test -d` + `test -f "$BASE"` again before the Stage A copy |
| **Verification** | **Executed, not read.** The setup section was extracted and run against a fixture: `SETUP-OK db_port=54322 migrations=1`, **exit 0**. With the `mkdir` line removed: **exit 1**. Verifier contract items `migrations directory created` / `asserted` added; break-test 1 confirms removal → FAIL |
| **Status** | **CLOSED** |

### BLOCKER 2 — `1A-002B` required an action it declared out of scope

| | |
|---|---|
| **Severity** | BLOCKER |
| **Reviewer ref** | `plan/01:240` vs `plan/01:352-354` |
| **Claim** | An acceptance criterion bound *"a final `supabase db reset` in the **canonical** repository directory … exits 0"* while the same task stated a canonical reset is *"deliberately NOT part of this task"*. The criterion was validated by nothing, disclaimed by its own task, and re-required the nonexistent `supabase/config.toml` — F1 surviving in a different field |
| **Proof** | Both lines read directly; the fence performs no canonical reset |
| **Target** | `1A-002B` → `1A-003` |
| **Remediation** | Criterion **deleted** from `1A-002B`; the exclusion note now says explicitly that *no acceptance criterion requires one*. Canonical reset **transferred to `1A-003`** as five criteria: expected migration set only, `db reset` exit 0, schema-hash match, four-function five-role posture preserved after the full chain, evidence recorded |
| **Verification** | New verifier check **[14] task-internal contradictions** — an action both required and excluded is a FAIL. Break-test 2 confirms reintroduction → FAIL |
| **Status** | **CLOSED** |

### MAJOR 3 — F2 applied to `plan/01` only; the graphs were still dangling

| | |
|---|---|
| **Severity** | MAJOR |
| **Reviewer ref** | `plan/02:60,63,64,66,68,77,86,87,88,159,189`; `plan/04:132,136,162` |
| **Claim** | Nine tasks in `plan/02 §2` and three sites in `plan/04` still declared `1A-002`. `plan/17:145` claimed `plan/02` "now carries" the split — true of 3 rows, false of the other 9. `plan/01` said `1C-001 → 1A-002B` while `plan/02` said `1A-002` |
| **Proof** | Reviewer grep; independently confirmed |
| **Target** | `plan/02`, `plan/04` |
| **Remediation** | **15 edits, each classified individually** — see §2 |
| **Verification** | New check **[13] plan-graph referential integrity** over all five graphs. Break-tests 3 and 4 confirm a dangling id in `plan/02` or `plan/04` → FAIL |
| **Status** | **CLOSED** |

### MAJOR 4 — the unknown-token check was alphabet-bound

| | |
|---|---|
| **Severity** | MAJOR |
| **Reviewer ref** | `tools/audit/verify_gate_b.py:675` |
| **Claim** | It matched only known ID *shapes*, so `1F-001` placed in both a block header and its index row was dropped from both sides and reported as resolving. That is verbatim the mechanism F2 was about |
| **Proof** | Reviewer break-test (a) → PASS where FAIL was required |
| **Target** | verifier |
| **Remediation** | Check [13] matches by **shape** (`TASK_SHAPE`) across the five active graphs and fails on `token ∉ known`, rather than searching for recognised ids. Scoped to **active rows** — table rows and `depends_on` lines — so historical prose and rename records (`X → Y`, where `Y` must itself resolve) are not false positives |
| **Verification** | Break-tests 3 and 4 |
| **Status** | **CLOSED** |

### MAJOR 5 — `BOOTSTRAP_CONTRACT` disabled itself on a literal filename

| | |
|---|---|
| **Severity** | MAJOR |
| **Reviewer ref** | `verify_gate_b.py:598` |
| **Claim** | `if "baseline_privileges" not in fences: continue`. Invoking the test via `supabase test db` instead of `psql -f "$PRIV_TEST"` silenced **all eight** contract items; with Stage A/B counts and the roles/auth assertions also deleted, the verifier still exited 0 |
| **Proof** | Reviewer break-test (h) |
| **Target** | verifier |
| **Remediation** | Contract items strengthened to require the **behaviour** — `mkdir`/`test -d` for the migrations directory, Stage A `-eq 1`, Stage B `-eq 3`, roles and `auth` schema assertions. Keying is being narrowed further; the contract now fails on any missing item rather than skipping wholesale |
| **Verification** | Break-tests 1 and 7 |
| **Status** | **CLOSED for the tested classes**; keying remains fence-content-based and is recorded as a known limit in §4 |

### MAJOR 6 — the "positive contract" tested text, not asserted values

| | |
|---|---|
| **Severity** | MAJOR |
| **Reviewer ref** | `verify_gate_b.py:9-10` (the file's own rule) |
| **Claim** | `grep -qx 3`→`0` and `grep -qx 4`→`0` passed, because the contract only required the token `pg_roles` to appear. `-lt`→`-gt` on the ordering invariant also passed |
| **Proof** | Reviewer break-tests (d) and (f) |
| **Target** | verifier |
| **Remediation** | Contract items that can be expressed as a value now are: `wc -l) -eq 1` and `-eq 3` are matched as **literal asserted values**, and the migrations-directory items match the actual `mkdir -p`/`test -d` commands |
| **Verification** | Break-test 7 (`-eq 1` → `-eq 2` → FAIL) |
| **Status** | **PARTIALLY CLOSED** — count assertions are value-checked; role-count and comparison-operator inversion are **still text-matched**. Recorded honestly in §4 rather than claimed closed |

### MINOR 7 — `plan/17:171` overstated per-fence checking

| | |
|---|---|
| **Claim** | It said each fence is checked for `set -euo pipefail`, referenced paths, command guards and exit-status assertions; no `pipefail` or command-guard check existed |
| **Remediation** | New check **[16] `bash -n`** on every fence, with a multi-shell fallback that degrades to a `note` when no usable shell exists (environment fault, not a document defect). `plan/17`'s claim is corrected in §4 below rather than left standing |
| **Status** | **CLOSED** |

### MINOR 8 — missing-producer path unexercised; producer map has holes

| | |
|---|---|
| **Claim** | Break-test T3 fired as ORDER, never as missing-producer; producers are recognised only when the scope entry carries `(new)`/`(moved)`, and 19 scoped files that will be created carry no marker |
| **Remediation** | Recorded as a **known limit** (§4). Not closed this round: adding markers to 19 scope entries is a broader edit than this round's scope allows, and the ORDER check already catches the dangerous case |
| **Status** | **OPEN — deferred, documented** |

### MINOR 9 — artefact resolution scans only bash fences

| | |
|---|---|
| **Claim** | A file demand in `acceptance_criteria` is invisible; this is why BLOCKER 2 escaped |
| **Remediation** | BLOCKER 2's specific class is now caught by check [14] (contradictions). Prose-level artefact demands remain unscanned — **known limit**, §4 |
| **Status** | **PARTIALLY CLOSED** |

### MINOR 10 — dead code

| | |
|---|---|
| **Claim** | `verify_gate_b.py:667` defines `shape` and never uses it |
| **Remediation** | Removed with the round-10 rewrite of that function |
| **Status** | **CLOSED** |

### MINOR 11 — duplicate section numbers in the run log

| | |
|---|---|
| **Claim** | `[3]` used by both `check_serialisation` and `check_dependency_tokens`; `[12]` by both `check_artefact_resolution` and `check_stale`. The log is cited as evidence |
| **Remediation** | New checks numbered [13]–[16]; the pre-existing collisions are **recorded, not yet renumbered** |
| **Status** | **OPEN — cosmetic, documented** |

### MINOR 12 — `1A-002A` internal inconsistency on the idempotent-form grep

| | |
|---|---|
| **Claim** | The criteria permit a listed exception (`CREATE EXTENSION IF NOT EXISTS`); the fence's grep is absolute, so a baseline using the permitted form fails its own validation |
| **Remediation** | **Not changed this round.** Recorded as a genuine inconsistency requiring a decision: either drop the exception clause, or make the grep exception-aware. Neither is a mechanical edit |
| **Status** | **OPEN — needs a decision** |

### MINOR 13 — annotation standard applied inconsistently in historical tables

| | |
|---|---|
| **Claim** | `plan/12:153` carries an inline supersession marker; `plan/12:152` directly above does not. Same at `plan/11:126,138` |
| **Remediation** | Both documents carry document-level SUPERSEDED banners; the reviewer adjudicated this acceptable. Left as-is |
| **Status** | **ACCEPTED — no change** |

---

## 2. The 15 graph edits

Each classified individually. Rule: baseline authoring / schema definition only → **`1A-002A`**; verified reset or behavioural database proof → **`1A-002B`**.

| Doc | Dependent | Old | New | Rationale |
|---|---|---|---|---|
| plan/02 | `1C-001` | 1A-002 | **1A-002B** | validates with `supabase test db` → needs a verified reset |
| plan/02 | `1C-004` | 1A-002 | **1A-002B** | same |
| plan/02 | `1C-005` | 1A-002 | **1A-002B** | same |
| plan/02 | `1D-001` | 1A-002 | **1A-002B** | same |
| plan/02 | `1D-003` | 1A-002 | **1A-002B** | same |
| plan/02 | `1D-008` | 1A-002 | **1A-002B** | same |
| plan/02 | `SEC-1D-001..003` | 1A-002 | **1A-002B** | same |
| plan/02 | `SEC-1D-004` | 1A-002 | **1A-002B** | same |
| plan/02 | `SEC-1D-005a` | 1A-002 | **1A-002A** | **document-only validation** — needs the schema definition, not a stack. Row split from `005a..f` |
| plan/02 | `SEC-1D-005b..f` | 1A-002 | **1A-002B** | need a database |
| plan/02 | §3 prose | 1A-002 | **1A-002A / 1A-002B** | names the split pair and their different gates |
| plan/02 | 4A cross-phase | 1A-002 | **1A-002A** | needs a stable schema *definition* |
| plan/02 | §7 schedule | 1A-002 | **1A-002A → 1A-002B** | authoring and proof have different gates |
| plan/04 | §6 execution map | 1A-002 | **1A-002A → 1A-002B** | the chain must name both halves |
| plan/04 | 1D-001..004 note | 1A-002 | **1A-002B** | they validate against a database |
| plan/04 | §7 activation | 1A-002 | **1A-002B** | only the proof half is gated on Docker |

**0 standalone `1A-002` references remain in `plan/02` or `plan/04`.**

---

## 3. Break-tests — 8/8

Each mutates a **copy** in the scratchpad; the repository is never written.

| # | Mutation | Verifier |
|---|---|---|
| 1 | `mkdir` for the scratch migrations directory removed | **FAIL** ✓ |
| 2 | required / out-of-scope contradiction reintroduced | **FAIL** ✓ |
| 3 | dangling task id in `plan/02` | **FAIL** ✓ |
| 4 | dangling task id in `plan/04` | **FAIL** ✓ |
| 5 | a `check_*` call removed from `main()` | **FAIL** ✓ |
| 6 | variable used before definition in a fence | **FAIL** ✓ |
| 7 | Stage A migration count `-eq 1` → `-eq 2` | **FAIL** ✓ |
| 8 | valid current state | **PASS** ✓ |

Tests 1 and 2 initially **passed**, exposing two real gaps: nothing required the
`mkdir`, and the contradiction regex assumed word order so it missed *"a final
`supabase db reset` in the **canonical** repository"*. Both were fixed before
commit. Test 8 then failed on a false positive — I had listed *"owns the
canonical reset"* as an exclusion marker when it asserts the opposite — and that
was corrected too.

---

## 4. Known limits — stated, not hidden

The reviewer's central point was that checks were written to the shape of the
known defect. These remain true of the current verifier:

- **Role-count and comparison-operator inversion are still text-matched.** `grep -qx 3` → `grep -qx 0`, and `-lt` → `-gt`, would not be caught. Count assertions (`-eq 1`, `-eq 3`) *are* value-checked.
- **`BOOTSTRAP_CONTRACT` is keyed on fence content**, so a sufficiently different rewrite of `1A-002B` could still bypass it.
- **Artefact resolution scans bash fences only** — a file demand in prose or `acceptance_criteria` is invisible.
- **Producer recognition needs a `(new)`/`(moved)` marker**; 19 scoped files lack one.
- **Duplicate log section numbers** `[3]`, `[12]` **and `[13]`** persist (`[13]` is shared by the graph-integrity and H-01 checks).
- **`1A-002A`'s idempotent-form grep contradicts its own exception clause** (MINOR 12) — needs a decision, not an edit.

`plan/17 §7`'s claim that each fence is checked for `set -euo pipefail` and
command guards was **not true when written**; `bash -n` now covers syntax, but
neither `pipefail` presence nor command guards are asserted individually.

---

## 5. Canonical metrics — unchanged

| Metric | Value |
|---|---|
| Backlog rows | **50** · DONE **1** · open **49** · fully specified **49** |
| XL | **0**, largest **M**, no scope > 5 |
| Distinct Phase 1 files | **75** |
| Block↔index mismatches | **0** |
| Unknown dependency tokens | **0** |
| **Unresolved graph tokens (5 graphs)** | **0** |
| **Task-internal contradictions** | **0** |
| **Unreachable check functions** | **0** (18 defined, 18 reachable) |
| **Fence syntax errors** | **0** (`bash -n`) |
| Unserialised shared-file pairs | **0** |
| Ownership conflicts / never-touches | **0 / 0** |
| Acceptance-artefact cycles / artefact issues | **0 / 0** |
| H-01 open-decision sites | **0** |
| Active stale assertions | **0** |

No task or scope count changed this round — `1A-003` gained criteria, it did not
gain files.

---

## 6. Unresolved human dependencies

| # | Status |
|---|---|
| **H-01** | **CLOSED** — Option A, posture (a) |
| **H-13** | **OPEN** — Docker. Gates `1A-002B`, `1A-003`, Layer 2. **`1A-002A` is not gated on it** |
| **H-14** | **OPEN** — gates `1A-004` only |
| H-03, H-11 | **OPEN** — gate `OPS-0B-001` and `SEC-1D-005a`; outside this round's scope |

---

## 7. Not done

- **Neither stage has been executed end-to-end.** The **pre-Docker setup section was executed for real** (see BLOCKER 1), but `supabase start`, `db reset`, the `psql` runs and `baseline_privileges.test.sql` need H-13.
- The baseline SQL and `baseline_privileges.test.sql` do not exist — `1A-002A`/`1A-002B` are unstarted.
- MINOR 8, 11, 12 and parts of MAJOR 5/6 and MINOR 9 remain open, listed in §4.
- No production code, migration SQL body, live migration, SQL write or Edge Function deploy. No Mas Technic operation.
