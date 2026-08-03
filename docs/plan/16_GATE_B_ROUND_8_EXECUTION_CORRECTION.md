# 16 — Gate B Round 8: Execution Correction

**Trigger:** two execution blockers in `1A-002`'s validation, found on review of commit `5bf56ce`.
**Scope:** those two blockers only. No new architecture, no feature, no production code, no migration SQL body, no live operation.

---

## 1. Why a plain PostgreSQL database was invalid

The previous Stage A built its own database:

```
dropdb   gateb_stage_a
createdb gateb_stage_a
psql -d gateb_stage_a -f baseline
```

**That is not a valid environment for a Supabase baseline.** A database created
with `createdb` provides none of the platform bootstrap the baseline assumes:

| Missing | Consequence |
|---|---|
| `auth` schema, `auth.users` | Any baseline object referencing them fails to create |
| `anon`, `authenticated`, `service_role` roles | **`has_function_privilege('anon', …)` raises `role "anon" does not exist`** |
| Supabase extensions and platform helpers | Extension-dependent objects fail |

**The second row is the fatal one.** The five-role privilege introspection — the
*defining assertion* of posture (a) — could not have executed at all. It would
have raised on the role lookup before evaluating anything about the baseline.

And a failure there would have been ambiguous: **a missing Supabase bootstrap
looks exactly like a baseline defect** if the two are not distinguished. The
previous validation had no way to tell them apart.

### The distinction the corrected task rests on

> **Supabase platform bootstrap** — roles, `auth` schema, extensions — is
> provided by the local stack.
> **Project migrations** — this baseline — are what we are testing.
> Stage A tests the project migration **on top of** a correct platform bootstrap.

`1A-002B` now asserts the bootstrap **first** (assertion A1: the three roles
exist and the `auth` schema exists), so an environment problem is reported as an
environment problem rather than misread as a security failure — or, worse, the
reverse.

---

## 2. The corrected Stage A / Stage B method

**Stage A — baseline alone, on a Supabase-bootstrapped stack**

- A scratch Supabase project directory **outside the repository** (`mktemp -d`), with a safe copy of the canonical `config.toml`
- Its migration directory contains **only** `20260801000000_baseline_schema.sql` — **neither Emergency migration is copied**
- `supabase db reset` there gives a full Supabase bootstrap *plus the baseline and nothing else*
- **A1** the bootstrap is verified: `anon`/`authenticated`/`service_role` exist, `auth` schema exists
- **A2** all four P0 functions exist
- **A3** five-role privilege introspection via `baseline_privileges.test.sql` — **with the Emergency migrations absent from the migration set**

**Stage B — full chain**

- The two Emergency migrations are copied into the same scratch directory (now 3 files)
- `supabase db reset` again — they apply **cleanly** as a no-op, because the functions now exist and their privileges are already revoked
- Privilege posture **unchanged**
- A final `supabase db reset` in the **canonical** repository directory
- Second application of the baseline returns **non-zero**

The scratch directory is deleted afterwards. **No connection to Mas Technic. No
live write to the canonical project.** Everything runs against the local stack.

**This is stronger than the previous "apply the Emergency migrations later"
formulation:** they are not merely deferred, they are *absent from the migration
set*, so Stage A cannot accidentally benefit from them.

---

## 3. The acceptance-artefact cycle

Round 8 claimed to have removed the cycle by having `1A-002` **run**
`supabase/tests/security_regression.test.sql` directly instead of waiting on
`1E-L2b` to pass.

**That did not remove the cycle.** That file is *produced by* `1E-L2b`, and

```
1E-L2b → 1E-L2 → 1A-003 → 1A-002
```

so at `1A-002` time **the file does not exist**. Running it directly changes
nothing: the artefact still comes from a task that transitively depends on the
task requiring it.

### Chosen solution — the preferred one

`1A-002` is **split**:

| Task | Owner | Scope | Gated on H-13? |
|---|---|---|---|
| **`1A-002A`** authoring | Supabase & Security | baseline `.sql`, `migrations/README.md`, 3 `archive/` paths (5 files) | **no** — validation is static |
| **`1A-002B`** baseline-only validation | Supabase & Security | `supabase/tests/baseline_privileges.test.sql`, `docs/audit/13_BASELINE_POSTURE_EVIDENCE.md` (2 files) | **yes** |

`baseline_privileges.test.sql` is **new and independent**. It asserts only the
five-role privilege contract, calls no production function, and is produced by
the task that needs it. `1A-002B` depends on nothing that depends on it.

**`1E-L2b` remains the permanent regression owner** and re-asserts the same
properties at Gate C. The two are complementary, not duplicative: one proves the
baseline at authoring time, the other prevents regression thereafter.

**Splitting also fixed a second problem:** the old single `1A-002` was entirely
blocked by H-13, when only half of it needs a database. `1A-002A` can now proceed
without Docker.

### Ownership exception, named rather than silent

`plan/04 §1` gives all test files to QA & Test. `baseline_privileges.test.sql` is
**the one named exception**, recorded by name in `plan/04 §1` and encoded in the
verifier as an explicit allow-list entry — so it appears as a `note`, not as a
silent pass. **No other test file may be owned outside QA & Test.**

---

## 4. New verifier behaviour checks

| Check | What it rejects |
|---|---|
| **[10] Supabase-bootstrapped environment** | Any validation block that builds its environment with `createdb`/`dropdb`. Also fails a block that introspects privileges without establishing a Supabase stack |
| **[11] Acceptance-artefact cycles** | `task → required artefact → artefact's owner task → dependency path back to the task`. Not just task-ID cycles: a task requiring a file produced by something that depends on it is a **FAIL**, because the file will not exist when needed. Also fails an artefact **no task produces** |

Two further robustness fixes, both prompted by this round:

- **The deletion-regression check is now split-aware.** It compares the *union* of every block under a tracked prefix, so splitting `1A-002` into `1A-002A`/`1A-002B` is reported as a split — not as seven deleted criteria. It initially did report seven deletions, which is how the gap was found.
- **Checks 6, 7, 8 and the contract check no longer hardcode a task id.** They resolve the tracked prefix, so a future split cannot silently disable them. All five failed for this reason before the fix.

---

## 5. Canonical metrics after the split

| Metric | Value |
|---|---|
| Backlog rows | **50** |
| — DONE | **1** (`1D-010`) |
| — open | **49** |
| — fully specified (13 fields) | **49** |
| — XL | **0**, largest **M** |
| Distinct Phase 1 files | **75** |
| Block↔index mismatches | **0** |
| Unserialised shared-file pairs | **0** |
| Ownership conflicts / never-touches violations | **0 / 0** |
| **Acceptance-artefact cycles** | **0** |
| H-01 open-decision sites | **0** |
| Active stale assertions | **0** (25 candidates, all adjudicated) |

Propagated to `plan/01` (blocks, index, footer), `plan/04` (assignment table,
computed checks), `plan/08` (canonical table + corrections row). `plan/15 §6` is
annotated as superseded, since it stated the pre-split counts.

---

## 6. Verifier result at this commit

```
[1]  all 49 open tasks carry all 13 fields
[2]  block and index agree for all 49 tasks, human tokens included
[3]  0 unserialised shared-file pairs
[4]  0 ownership conflicts, 0 never-touches violations
     note: 1A-002B owns baseline_privileges.test.sql — NAMED exception
[5]  0 XL, no scope over 5 files, 0 declared cycles
[6]  baseline 20260801000000 < both emergency versions, parsed from scope + disk
[7]  every variable assigned inside the fence; ON_ERROR_STOP reaches psql;
     test -f guard present; exit status captured and asserted
[8]  Stage A present; baseline-alone posture proof present; Stage B present
[9]  no deletion regression (split correctly detected)
[10] no validation block uses a plain createdb environment
[11] 0 acceptance-artefact cycles
[13] no document presents H-01 as an open decision

FAILURES: NONE
```

---

## 7. Human dependencies

| # | Status |
|---|---|
| **H-01** | **CLOSED** — Option A, posture (a) |
| **H-13** | **OPEN** — gates `1A-002B`, `1A-003`, and the whole Layer 2 lane. **`1A-002A` is no longer blocked by it** |
| **H-14** | **OPEN** — gates `1A-004` only |

---

## 8. Not done

- **Neither stage has been executed.** H-13: no Docker. `db reset`, the `psql` runs and `baseline_privileges.test.sql` are specified but unrun. Their correctness is reasoned, not observed.
- The baseline SQL and `baseline_privileges.test.sql` do not exist yet — `1A-002A`/`1A-002B` are unstarted.
- No production code, migration SQL body, live migration, SQL write or Edge Function deploy. No Mas Technic operation.
