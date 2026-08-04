# 17 — Gate B Round 9: Dependency Soundness

**Trigger:** independent review at `7ef22fa` — **FAIL**, 2 BLOCKER · 3 MAJOR · 4 MINOR (valid review: HEAD stable, tree clean, break-tests executed)
**Scope:** the verified findings only. No new architecture, no product code, no migration SQL body, no live operation.

---

## 1. F1 — the scratch config blocker

`1A-002B`'s Stage A copied `$REPO/supabase/config.toml`. **That file does not
exist** — `supabase/` contains only `functions/` and `migrations/` — and it is
created by **`1D-009`**, a Phase 1D task with no ordering relative to `1A-002B`.
Under `set -euo pipefail` the `cp` aborted the fence before any assertion ran.

**Resolution: the scratch environment no longer depends on any repository
artefact.** The config is generated *in the scratch directory* by `supabase init`.

**Verified by read-only probe before being written into the task — CLI 2.109.1:**

| Check | Result |
|---|---|
| `supabase init` succeeds in an empty directory | `Finished supabase init.` |
| Generates | `supabase/config.toml` |
| `project_id` | `"init_probe"` — **derived from the directory name**, not a remote ref |
| Mas Technic ref (`zdqiujpeewtyhtcqhdcj`) | **0 occurrences** |
| `major_version` | **17** — matches live 17.6.1 |
| Remote keys (`project_ref`, `db_url`) | none; `api_url = "http://127.0.0.1"` |

The task asserts each of these at runtime rather than trusting them: a Mas
Technic reference anywhere in the generated config is an **absolute FAIL**, and
the Postgres major version is asserted, not assumed.

**`1D-009` stays independent.** It remains the production wrong-project deploy
guard. `1A-002B` does **not** depend on it — coupling Phase 1A to Phase 1D for a
config file would have been unrelated phase coupling.

---

## 2. F3 — the local stack model, stated once

The previous text simultaneously claimed an independent scratch project, the
canonical port `54322`, and a copied canonical `project_id`. Those cannot all
hold.

**Model chosen: one stack, one working directory.**

- There is **exactly one** local Supabase stack. No second stack is started, so **no port collision is possible**.
- The scratch directory is a separate **migration/config working directory** that starts and owns that single stack for the task's duration.
- The stack is started **from the scratch working directory** — not from the repository, because `supabase start` needs a `config.toml` the repository does not yet have.
- The DB port is **read from the generated config**, not hardcoded.

**Setup assertions run before either stage**, so an environment fault is never
misread as a baseline defect: `docker` available · `supabase` CLI available ·
`docker info` succeeds · config generated and clean · port reachable
(`SELECT 1`).

**Cleanup:** `trap 'cd "$REPO"; (cd "$SCRATCH" && supabase stop) …; rm -rf "$SCRATCH"' EXIT`
— the stack stops and the directory is removed on **every** exit path, including
a `set -e` abort.

A canonical-repository reset is **deliberately not** part of this task: it would
require `supabase/config.toml`. `1A-003` owns the canonical reset.

---

## 3. F2 — the 11 dangling `1A-002` dependencies

The round-8 split renamed `1A-002` to `1A-002A`/`1A-002B` but left 11 task blocks
and 11 index rows pointing at the old ID. Because the token matched no known
task, the verifier dropped it **identically from both sides**, so the equality
check reported agreement while 11 edges silently vanished.

**Each was classified from its own validation, not blanket-replaced:**

| Task | Old | New | Block | Index | Why |
|---|---|---|---|---|---|
| `1C-001` | 1A-002 | **1A-002B** | 579 | 1308 | validation runs `supabase test db` → needs a verified working reset |
| `1C-004` | 1A-002 | **1A-002B** | 644 | 1311 | same |
| `1C-005` | 1A-002 | **1A-002B** | 667 | 1312 | same |
| `1D-001` | 1A-002 | **1A-002B** | 706 | 1315 | same |
| `1D-003` | 1A-002 | **1A-002B** | 731 | 1317 | same |
| `1D-008` | 1A-002 | **1A-002B** | 785 | 1322 | same |
| `SEC-1D-001` | 1A-002 | **1A-002B** | 840 | 1325 | same |
| `SEC-1D-002` | 1A-002 | **1A-002B** | 861 | 1326 | same |
| `SEC-1D-003` | 1A-002 | **1A-002B** | 877 | 1327 | same |
| `SEC-1D-004` | 1A-002 | **1A-002B** | 893 | 1328 | same |
| **`SEC-1D-005a`** | 1A-002 | **1A-002A** | 905 | 1329 | validation is **document-only** ("lists 17 columns") → needs the baseline *schema definition*, not a running database |

**11 block lines + 11 index rows rewritten; 0 dangling `1A-002` remain.**
`plan/02 §2` now carries `1A-002A`, `1A-002B` and `1A-003 → 1A-002B`.

---

## 4. Verifier — dependency token resolution

Every `depends_on` token must now resolve to one of:

| Class | Members |
|---|---|
| **A** real task ID | any H2 task heading, plus the index-only DONE task `1D-010` |
| **B** human dependency | `H-01`, `H-03`, `H-11`, `H-13`, `H-14` |
| **C** gate token | `Gate B PASS`, `Gate C`, `separate explicit approval` |

Anything else is **UNKNOWN DEPENDENCY → FAIL**. An unknown token is never
silently normalised away, and **block/index agreement does not excuse it** —
if both sides carry the same unknown token, both fail.

---

## 5. F4 — artefact resolution widened to all paths

Previously only `supabase/tests/*.sql` was resolved, which is why `config.toml`
slipped through. Now every repository artefact referenced in a fence is resolved
across `supabase/**`, `frontend/**`, `backend/**`, `docs/**`, `tools/**` with
extensions `.sql .sh .py .ts .tsx .js .toml .json .md`:

- file missing **and** no task produces it → **FAIL**
- producer transitively depends on the consumer → **ACCEPTANCE CYCLE FAIL**
- producer exists but the consumer does not depend on it → **ORDER FAIL**
- two tasks both *create* the same file → **FAIL**

Two refinements were needed to make this correct rather than noisy:

- **"Producer" means *creates*, not *edits*.** Several tasks may edit one file; that is governed by serialisation and single-agent ownership. The producer is the task whose scope marks the file `(new)`/`(moved)`.
- **Scratch-relative paths and shell comments are excluded.** `"$SCRATCH/supabase/config.toml"` is not a repository artefact, and a `#` comment cannot require a file.

## 6. F4 — bootstrap check is now a positive contract

Plain-PostgreSQL bootstrap is matched broadly — `createdb`, `dropdb`,
`CREATE DATABASE`, `DROP DATABASE`, case-insensitive, **in executable fences
only** (the prose explaining why plain `createdb` was rejected does not trigger
it). Beyond the blacklist, the baseline-only proof task must satisfy a positive
contract:

`supabase start` or an asserted running stack · scratch migration directory ·
**Stage A asserts exactly ONE migration** · **Stage B asserts all THREE** ·
Supabase roles assertion · `auth` schema assertion · Emergency-migrations-absent
statement · local-only assertion.

## 7. F5 — per-fence independent validation

Fences are **no longer joined**. Each is checked on its own for: variables
assigned in *that* fence and before use, referenced paths, and exit-status
assertions.

> ⚠ **Corrected at round 10 (MINOR 7).** This sentence originally also claimed
> `set -euo pipefail` and command-guard checks. **Neither existed.** Round 10
> adds `bash -n` syntax checking of every fence; `pipefail` presence and command
> guards are still not asserted individually — see `plan/18 §4`.

A variable defined in one fence cannot satisfy another, and **document order does
not change the result**.

Checks are also scoped to fence capability: a static fence with no `psql` is not
required to set `ON_ERROR_STOP`, and a fence that never re-applies the baseline
is not required to assert a non-zero second application.

> This check immediately caught a defect **in this round's own work**: the
> initial rewrite split setup/Stage A/Stage B into three fences, so Stage A and
> B used `REPO`, `SCRATCH`, `PSQL` and `BASE_NAME` assigned only in the setup
> fence. They are now a **single self-contained fence**.

---

## 8. Break-tests — all eight behave as required

Each mutates a **copy** of the repository in the scratchpad and asserts the
verifier fails. The repository itself is never written.

| # | Mutation | Verifier |
|---|---|---|
| 1 | same unknown dependency `1A-999` added to **both** block and index | **FAIL** ✓ |
| 2 | missing `supabase/config.toml` required by a fence | **FAIL** ✓ |
| 3 | non-test missing script `supabase/predeploy_guard.sh` required | **FAIL** ✓ |
| 4 | producer depends back on consumer (`security_regression.test.sql`) | **FAIL** ✓ |
| 5 | `CREATE DATABASE` in an executable fence | **FAIL** ✓ |
| 6 | variable defined only in another fence | **FAIL** ✓ |
| 7 | Emergency migration added to Stage A | **FAIL** ✓ |
| 8 | valid current state | **PASS** ✓ |

**8/8.** Test 7 initially passed — `BOOTSTRAP_CONTRACT` was defined but never
called. That is the same vacuous-definition failure the round-7 review found, and
it was caught here **before** commit rather than by the next reviewer.

---

## 9. Stale assertions

The four the review verified, all corrected:

| Location | Was | Now |
|---|---|---|
| `plan/08:87` | "current figure is 49 rows · 48 open" | **50 rows · 49 open** |
| `plan/01:1314` | "canonical value is now 49 rows / 48 open" | **50 / 49**, with 42/41 and 49/48 both marked superseded |
| `plan/01:1318` | "Every one of the 48 open tasks" | **49** |
| `plan/02:52–53` | `1A-002` a live node; `1A-003 \| 1A-002` | `1A-002A`, `1A-002B`, `1A-003 \| 1A-002B` |

The stale dictionary now covers the transitions **48→49**, **49→50**, **73→75**.
Transition arithmetic (`41 + 7 = 48`, `49 + 1 = 50`) and explicit historical
records remain acceptable false positives, as intended.

**Active stale assertions: 0.**

---

## 10. Five-role permanent regression

`plan/04` claimed `1E-L2b` "re-asserts the same properties" as `1A-002B`. It did
not: it covered only `anon`/`authenticated` — **2 of 5 roles**.

**Chosen: widen `1E-L2b`**, so the claim becomes true. Its `AC-S01..S07` now
assert the full contract — `PUBLIC`=f, `anon`=f, `authenticated`=f,
`service_role`=t, `postgres`=t.

**`PUBLIC` matters most:** `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by
default, so a re-created function reopens the hole **without touching `anon` or
`authenticated` at all** — invisible to the old two-role assertion.

---

## 11. Canonical metrics

| Metric | Value |
|---|---|
| Backlog rows | **50** · DONE **1** · open **49** · fully specified **49** |
| XL | **0**, largest **M**, no scope > 5 |
| Distinct Phase 1 files | **75** |
| Block↔index mismatches | **0** |
| **Unknown dependency tokens** | **0** |
| Unserialised shared-file pairs | **0** |
| Ownership conflicts / never-touches | **0 / 0** |
| Acceptance-artefact cycles | **0** |
| **Artefact resolution issues** | **0** |
| H-01 open-decision sites | **0** |
| Active stale assertions | **0** |

---

## 12. Unresolved human dependencies

| # | Status |
|---|---|
| **H-01** | **CLOSED** — Option A, posture (a) |
| **H-13** | **OPEN** — Docker. Gates `1A-002B`, `1A-003` and the Layer 2 lane. **`1A-002A` is not gated on it** and can proceed |
| **H-14** | **OPEN** — gates `1A-004` only |

---

## 13. Not done

- **Neither stage has been executed.** H-13: no Docker. `supabase init`'s output was verified by probe, but `db reset`, the `psql` runs and `baseline_privileges.test.sql` are specified and unrun. Their correctness is reasoned, not observed.
- The baseline SQL and `baseline_privileges.test.sql` do not exist yet — `1A-002A`/`1A-002B` are unstarted.
- No production code, migration SQL body, live migration, SQL write or Edge Function deploy. No Mas Technic operation.
