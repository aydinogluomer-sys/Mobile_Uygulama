# 01 — Implementation Backlog

**Status:** **FINAL for Phase 1** (rewritten at Gate B remediation C1; ownership rebuilt at round 2)
**Task counts:** see `08_CANONICAL_METRICS.md` — **not restated here**
**Ownership rule:** every file in this backlog has **exactly one edit owner**. See `04_AGENT_TASK_GRAPH.md` §1.

Every task below carries all 13 mandatory fields inline. **No cross-references
to other documents for acceptance criteria.** Field order: `id · title ·
priority · MUST/SHOULD/COULD · agent · depends_on · scope · goal ·
acceptance_criteria · validation · risk · rollback · size`.

---

# Phase 1A — Schema reconciliation

## 1A-001 · Produce the three-way schema diff
`P1` · **MUST** · Supabase & Security · depends_on: Gate B PASS · **M**

**scope** (1 file created): `docs/audit/10_SCHEMA_THREE_WAY_DIFF.md`

**goal** Establish exactly how the repository migrations, the live database and the code's expectations differ — before writing any migration.

**acceptance_criteria**
- Three column lists produced: repo-migration schema · live schema · schema the client references
- Every live table classified: in-repo / missing-from-repo / repo-only
- Every renamed column listed with both names and the referencing `file:line`
- Every live RPC listed with `prosecdef`, `proconfig`, client-callable yes/no
- Every CHECK constraint that contradicts a client-written value named
- Document states which live objects are **unused by the client** (candidates for exclusion from the baseline)

**validation** `docs/audit/10_SCHEMA_THREE_WAY_DIFF.md` exists; every live table from `pg_tables` appears exactly once in a classification.

**risk** LOW — read-only analysis.
**rollback** Delete the document. No system change.

---

## 1A-002A · Author the squashed baseline migration *(post-revoke posture)*
`P1` · **MUST** · Supabase & Security · depends_on: 1A-001 · **M**

> **Split from `1A-002` at round 8 (execution correction).** Authoring and
> validation are now separate tasks. Authoring needs no local stack; validation
> does, and is gated on **H-13**. Keeping them in one task made the whole of
> `1A-002` blocked by Docker when half of it is not.
>
> **H-01 is answered** (Option A, post-revoke posture) and is no longer a dependency.

**scope** (5 files): `supabase/migrations/20260801000000_baseline_schema.sql` (new) · `supabase/migrations/README.md` (new) · `supabase/migrations/archive/001_initial_schema.sql` (moved) · `supabase/migrations/archive/002_integrations.sql` (moved) · `supabase/migrations/archive/README.md` (new)

**goal** One migration that reproduces the live schema **and its current, secure privilege posture** from empty, so a reset yields a database the app runs against and which is safe on the first statement — not safe only after two later migrations happen to run.

**acceptance_criteria**

Three groups, all binding: **schema**, **security posture**, **non-idempotency**.

*Group 1 — schema*
- Baseline creates every live table, column, constraint, index, RPC, trigger and policy identified in `1A-001`
- Baseline header records: generation date · source project ref · that it is a **squash, not a history** · the schema hash it was generated from
- **Not applied to live** in this task

*Group 1a — migration ordering*

> **The blocker this closes.** The filename previously carried an unconstrained
> timestamp placeholder. `supabase migration new` stamps the current time, which
> sorts **after** both Emergency migrations. They would then run **first**,
> against a database where the four functions do not yet exist, and
> `REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text)` on a
> **nonexistent** function is an `ERROR`, not a no-op — aborting the reset.
>
> `REVOKE` on a *never-granted privilege* is a no-op; `REVOKE` on a *nonexistent
> object* is an error. Only the first was previously accounted for.

- **Baseline version is fixed at `20260801000000`.** Not a placeholder.
- **Ordering invariant, binding:** `20260801000000` **<** `20260802181931` **<** `20260802205850`
- Both Emergency Gate 0 migrations **remain separate files and sort after the baseline**
- `001_initial_schema.sql` and `002_integrations.sql` are moved to `supabase/migrations/archive/` — **they must not remain in the active migration root**, where their `001`/`002` versions would sort before the baseline
- **Canonical fresh-reset order:** baseline, then `20260802181931`, then `20260802205850`
- If a different version is ever chosen, **the same exact filename must appear in every document**

> **Version format verified, not assumed.** Supabase CLI **2.109.1**, read-only
> probe: `supabase migration squash --version 20260801000000 --local` returns
> *"...`20260801000000_baseline_schema.sql` is already the **earliest migration**"*,
> while `--version notatimestamp` returns **`invalid version number`**.

*Group 1b — Emergency Gate 0 migrations are preserved*

- `20260802181931_...sql` and `20260802205850_...sql` are **not deleted**
- They are **not folded into the squash**
- They **sort after** the baseline
- Retained for **live-ledger continuity and audit evidence** — both match live ledger entries
- **Not load-bearing for fresh-database security**: the baseline alone produces the secure posture. On a fresh reset they run as a **clean historical no-op**

*Group 2 — security posture (post-revoke contract)*

The baseline must create these four functions with a **directly secure** posture:

- `public.mock_activate_subscription(text, text)`
- `public.add_xp(uuid, integer)`
- `public.track_weekly_xp(uuid, integer)`
- `public.deal_damage_to_active_boss(uuid, integer)`

**Required state after a fresh reset, for each of the four:**

| Role | `EXECUTE` |
|---|---|
| `PUBLIC` | **false** |
| `anon` | **false** |
| `authenticated` | **false** |
| `service_role` | **true** |
| `postgres` | **true** |

- **`CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default.** The baseline must issue the `REVOKE`s **immediately after each of these four definitions, inside the same transaction** — never in a later migration, never at end of file.
- **The secure ACL is the baseline's own output contract.** It does not depend on the Emergency Gate 0 migrations, nor on migration ordering.
- **FAIL condition, absolute:** an explicit `GRANT EXECUTE ... TO PUBLIC|anon|authenticated` on any of the four fails the task. Not waivable.
- No other object may be left more permissive than live is today.

*Group 3 — non-idempotency and PUSH-UNSAFE contract*

- **A second application against an existing schema must return non-zero**
- **Blanket `IF NOT EXISTS` is forbidden**
- **Blanket `CREATE OR REPLACE` is forbidden**
- Any pattern that silently mutates an existing object, or hides the privilege posture, is forbidden
- Header carries `-- PUSH-UNSAFE: empty-database bootstrap only. Never 'db push', never 'apply_migration' against live.`
- **Applying it to live via `db push` or `apply_migration` is prohibited.** Live registration is `1A-004`'s ledger-only `migration repair`

**validation** *(static — no database required, so this task is not gated on H-13)*

```bash
set -euo pipefail

BASE="supabase/migrations/20260801000000_baseline_schema.sql"
MOCK_REVOKE="supabase/migrations/20260802181931_emergency_gate_0_revoke_mock_activate_subscription.sql"
XP_REVOKE="supabase/migrations/20260802205850_emergency_gate_0_revoke_client_exec_xp_functions.sql"

test -f "$BASE"; test -f "$MOCK_REVOKE"; test -f "$XP_REVOKE"

# ordering invariant, on the real filenames
BASELINE_V=$(basename "$BASE"    | cut -d_ -f1)
MOCK_V=$(basename "$MOCK_REVOKE" | cut -d_ -f1)
XP_V=$(basename "$XP_REVOKE"     | cut -d_ -f1)
test "$BASELINE_V" -lt "$MOCK_V"
test "$MOCK_V"     -lt "$XP_V"

# archived legacy migrations are out of the active root
test ! -f supabase/migrations/001_initial_schema.sql
test ! -f supabase/migrations/002_integrations.sql
test -f supabase/migrations/archive/001_initial_schema.sql
test -f supabase/migrations/archive/002_integrations.sql

# no client GRANT on the four P0 functions -> absolute FAIL if matched
! grep -qEi "grant +execute.*(mock_activate_subscription|add_xp|track_weekly_xp|deal_damage_to_active_boss).*(public|anon|authenticated)" "$BASE"

# no blanket idempotent forms (see the exception note)
! grep -qEi "if not exists|create or replace" "$BASE"

# an immediate REVOKE follows each of the four definitions
grep -qEi "revoke +execute.*mock_activate_subscription"   "$BASE"
grep -qEi "revoke +execute.*add_xp"                       "$BASE"
grep -qEi "revoke +execute.*track_weekly_xp"              "$BASE"
grep -qEi "revoke +execute.*deal_damage_to_active_boss"   "$BASE"

# PUSH-UNSAFE header present
grep -q "PUSH-UNSAFE" "$BASE"
```

- **Schema-hash match** against the live capture from `1A-001`
- **Behavioural proof of the secure posture is `1A-002B`**, which requires a running stack. This task must not claim it.

> **Note on the idempotent-form grep.** The criteria forbid **blanket** use. A
> specific justified exception (e.g. `CREATE EXTENSION IF NOT EXISTS`) must be
> listed by line in the baseline header with its justification, and the grep
> becomes "no match **other than** the listed exceptions". An unlisted match is a FAIL.

**risk** **HIGH — two failure modes.**
1. An omission produces a schema that looks right and is not. Mitigated by the `1A-001` diff and the schema-hash comparison.
2. **P0 re-grant.** Without the immediate `REVOKE`s, a fresh database would leave a payment bypass and an unauthenticated cross-user write open from the first statement. Under the post-revoke contract this is a **single-file property**, statically checkable here and behaviourally proven in `1A-002B`.

**rollback** Delete the new file; restore `001`/`002` from `archive/`. Nothing live changed.
**If a P0 re-grant is ever observed on live**, rollback is not "revert the baseline" — **re-apply the two Emergency Gate 0 revokes immediately**, then investigate.

---

## 1A-002B · Prove the baseline alone is secure *(Supabase-bootstrapped)*
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002A, **H-13 (Docker)** · **M**

> **Why this is a separate task.** It is the only place the defining property of
> posture (a) is *behaviourally* proven, and it is the only half of the old
> `1A-002` that needs a running stack.

**scope** (2 files): `supabase/tests/baseline_privileges.test.sql` (new) · `docs/audit/13_BASELINE_POSTURE_EVIDENCE.md` (new)

> **Ownership exception, explicit and narrow.** `plan/04 §1` gives all test files
> to QA & Test. `baseline_privileges.test.sql` is the one named exception: it
> asserts the **baseline's own output contract**, is authored with the baseline,
> and must run **before** the QA test lane exists. `plan/04 §1` records this
> exception by name so it is not a silent bypass. **`1E-L2b` remains the
> permanent regression owner** and re-asserts the **same full five-role contract** at Gate C (widened at round 9; it previously covered only `anon`/`authenticated`).
>
> **This removes the acceptance cycle.** The previous revision required
> `1A-002` to run `supabase/tests/security_regression.test.sql` — a file
> **created by `1E-L2b`**, which depends on `1E-L2` → `1A-003` → `1A-002`. The
> file would not exist when it was needed. `1A-002B` depends on **nothing that
> depends on it**.

**goal** Prove, on a database that actually resembles production, that the four P0 functions are locked down **by the baseline alone** — with the Emergency Gate 0 migrations **absent from the migration set**.

**Why a plain `createdb` database is invalid — and was rejected**

A bare PostgreSQL database created with `createdb` does **not** provide:

| Missing | Consequence |
|---|---|
| `auth` schema and `auth.users` | Any baseline object referencing them fails to create |
| `anon`, `authenticated`, `service_role` roles | **`has_function_privilege('anon', ...)` raises `role "anon" does not exist`** — the defining assertion cannot even run |
| Supabase extensions and platform helpers | Extension-dependent objects fail |

An error there would indicate a **missing Supabase bootstrap**, not a baseline
defect. The two are different failures and must not be conflated.

**The distinction this task rests on:** *Supabase platform bootstrap* (roles,
`auth` schema, extensions — provided by the local stack) is **not** part of
*project migrations* (this baseline). Stage A tests the project migration on top
of a correct platform bootstrap.

**acceptance_criteria**

*Stage A — baseline alone, on a Supabase-bootstrapped stack*
- A scratch Supabase project directory is created **outside the repository**, with a **locally generated** config (`supabase init`) — **never a copy of the repository's**, which does not exist until `1D-009`
- Its migration directory contains **only** `20260801000000_baseline_schema.sql` — **neither Emergency migration is present**
- `supabase db reset` in that directory completes with **exit 0**, giving a full Supabase bootstrap (roles, `auth` schema, extensions) plus the baseline and nothing else
- All four P0 functions **exist**
- **Five-role privilege introspection** returns `PUBLIC=f`, `anon=f`, `authenticated=f`, `service_role=t`, `postgres=t` for all four — **with the Emergency migrations absent from the migration set**
- `baseline_privileges.test.sql` encodes exactly these assertions and passes
- **No production function is called.** Privilege is introspected only

*Stage B — full chain*
- The two Emergency migrations are added to the same scratch migration directory
- `supabase db reset` again completes with **exit 0** — they apply **cleanly**, because the functions now exist and their privileges are already revoked (a no-op, not an error)
- **Privilege posture is unchanged** from Stage A
- Second application of the baseline against the populated database returns **non-zero**

*Environment — one local stack, one working directory*

> **The stack model, stated once and unambiguously (F3).** There is **exactly one
> local Supabase stack**. The scratch directory is a **separate migration/config
> working directory** that starts and owns that single stack for the duration of
> this task. There is **no second stack**, so no port collision is possible.
>
> The stack is started **from the scratch working directory**, not from the
> repository. That is deliberate: `supabase start` requires a `config.toml`, and
> the canonical `supabase/config.toml` **does not exist yet** — it is produced by
> `1D-009` in Phase 1D. Depending on it here would couple Phase 1A to Phase 1D
> for no reason. `1D-009` remains an independent production deploy guard.

- The scratch directory is created **outside the repository** and removed by a `trap` on `EXIT`, so an aborted run cannot leak it
- Its `config.toml` is **generated by `supabase init` inside the scratch directory** — never copied from the repository
- **No remote project reference of any kind.** `zdqiujpeewtyhtcqhdcj` appearing anywhere in the generated config is an **absolute FAIL**
- **No live write to the canonical project.** Everything runs against the local stack
- Postgres major version is **pinned to 17**, matching live (17.6.1) — asserted, not assumed

**validation**

> **One fence, deliberately.** Setup, Stage A and Stage B are a single procedure
> sharing one scratch directory and one stack. Splitting them across fences would
> make each depend on variables assigned in the previous one — which is not
> independently executable, and is the defect class round 8 was told to close.

```bash
set -euo pipefail

# ---------------------------------------------------------------- setup gates
command -v docker   >/dev/null || { echo "H-13: docker not available"; exit 1; }
command -v supabase >/dev/null || { echo "supabase CLI not available"; exit 1; }
docker info         >/dev/null || { echo "H-13: docker not running";   exit 1; }

REPO="$PWD"
SCRATCH="$(mktemp -d)"
trap 'cd "$REPO"; (cd "$SCRATCH" && supabase stop) >/dev/null 2>&1 || true; rm -rf "$SCRATCH"' EXIT

BASE_NAME="20260801000000_baseline_schema.sql"
MOCK_NAME="20260802181931_emergency_gate_0_revoke_mock_activate_subscription.sql"
XP_NAME="20260802205850_emergency_gate_0_revoke_client_exec_xp_functions.sql"
BASE="$REPO/supabase/migrations/$BASE_NAME"
PRIV_TEST="$REPO/supabase/tests/baseline_privileges.test.sql"

test -f "$BASE"
test -f "$REPO/supabase/migrations/$MOCK_NAME"
test -f "$REPO/supabase/migrations/$XP_NAME"
test -f "$PRIV_TEST"

# ------------------------------------------- local-only config, generated here
# Generated locally, never copied from the repository: the canonical config is
# created by 1D-009 in Phase 1D, and depending on it would couple 1A to 1D.
cd "$SCRATCH"
supabase init
# `supabase init` creates ONLY supabase/config.toml — verified by probe, CLI 2.109.1.
# The migrations directory does not exist until we make it.
mkdir -p "$SCRATCH/supabase/migrations"
test -d "$SCRATCH/supabase/migrations"

! grep -q "zdqiujpeewtyhtcqhdcj" "$SCRATCH/supabase/config.toml"   # no Mas Technic ref, ever
! grep -qE '^[[:space:]]*(project_ref|db_url)[[:space:]]*=' "$SCRATCH/supabase/config.toml"
grep -qE '^[[:space:]]*major_version[[:space:]]*=[[:space:]]*17' "$SCRATCH/supabase/config.toml"
DB_PORT="$(grep -A3 '^\[db\]' "$SCRATCH/supabase/config.toml" | grep -m1 '^port' | tr -dc '0-9')"
test -n "$DB_PORT"

# the ONE stack, started from this working directory
supabase start
PSQL=(psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres)
"${PSQL[@]}" -tAc "SELECT 1;" | grep -qx 1                     # port reachable

# ============================== STAGE A — baseline alone ======================
test -d "$SCRATCH/supabase/migrations"
test -f "$BASE"
cp "$BASE" "$SCRATCH/supabase/migrations/"
# Emergency migrations are deliberately NOT copied. Stage A must not benefit from them.
test "$(ls "$SCRATCH/supabase/migrations" | wc -l)" -eq 1

supabase db reset

# A1. Supabase bootstrap present -> a failure below is a BASELINE defect, not a
#     missing platform. Without this the two are indistinguishable.
"${PSQL[@]}" -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role');" | grep -qx 3
"${PSQL[@]}" -tAc "SELECT count(*) FROM information_schema.schemata WHERE schema_name='auth';" | grep -qx 1

# A2. all four P0 functions exist after the baseline alone
"${PSQL[@]}" -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('mock_activate_subscription','add_xp','track_weekly_xp','deal_damage_to_active_boss');" | grep -qx 4

# A3. THE DEFINING ASSERTION — five roles, Emergency migrations absent from the set.
#     Never calls any of the four functions; privilege is introspected only.
"${PSQL[@]}" -f "$PRIV_TEST"

# ============================== STAGE B — full chain ==========================
cp "$REPO/supabase/migrations/$MOCK_NAME" "$SCRATCH/supabase/migrations/"
cp "$REPO/supabase/migrations/$XP_NAME"   "$SCRATCH/supabase/migrations/"
test "$(ls "$SCRATCH/supabase/migrations" | wc -l)" -eq 3

supabase db reset          # all three in order; the two revokes are a clean no-op

# B1. posture UNCHANGED after the full chain
"${PSQL[@]}" -f "$PRIV_TEST"

# B2. second application of the baseline must FAIL (non-idempotency).
#     test -f guards against a missing file making this pass for the wrong reason.
test -f "$BASE"
set +e
"${PSQL[@]}" -f "$BASE"
status=$?
set -e
test "$status" -ne 0
```

- Every command runs against the **single local stack**. No live project is contacted; `zdqiujpeewtyhtcqhdcj` is never referenced.
- The `trap` stops the stack and removes the scratch directory on any exit path, including a `set -e` abort.
- Results recorded verbatim in `docs/audit/13_BASELINE_POSTURE_EVIDENCE.md`

> **A canonical-repository reset is deliberately NOT part of this task**, and no
> acceptance criterion above requires one. It would need `supabase/config.toml`,
> which `1D-009` produces in Phase 1D. **`1A-003` owns the canonical reset.**
>
> *Removed at round 10 (BLOCKER 2):* this task previously bound "a final
> `supabase db reset` in the **canonical** repository directory … exits 0" as an
> acceptance criterion while this note disclaimed it — a task-internal
> contradiction, and it re-required the very file BLOCKER F1 was about.

**risk** **MEDIUM.** A Stage A failure must be triaged correctly: assertion A1 exists so that a **missing Supabase bootstrap** is distinguished from a **baseline defect**. Without A1, an environment problem would be misread as a security failure, or the reverse.
**rollback** Delete `baseline_privileges.test.sql` and the evidence document; remove the scratch directory. Nothing live or in-repo is otherwise changed.

---

## 1A-003 · Verify local reset and register the ledger
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B, **1D-009**, **H-13 (Docker)** · **S**

> **`1D-009` added at round 11 (BLOCKER-A).** This task runs `supabase db reset`
> in the **canonical repository directory**, which requires `supabase/config.toml`.
> `1D-009` is that file's sole producer. The gate previously existed only in a
> blockquote further down — the same "rule lives in prose, not in the field that
> executes it" failure the transfer from `1A-002B` was meant to end.

> **H-13 added at round 8 (M4).** This task's entire acceptance is a `supabase db reset`, which requires a running local stack.

**scope** (1 file): `docs/audit/11_SCHEMA_RESET_VERIFICATION.md`

**goal** Prove the baseline reproduces a working database, and record how it is registered against the 21-row live ledger without re-running DDL on live.

**acceptance_criteria**
- `supabase db reset` produces a schema whose table/column/RPC/trigger inventory matches the live inventory captured in 1A-001
- Schema-hash comparison recorded (e.g. sorted `information_schema` digest) for local vs live
- The **live cutover procedure is documented but NOT executed**: `supabase migration repair --status applied 20260801000000` so live is marked as having the baseline without re-creating 48 existing tables
- Document states the data-backup requirement that must precede any live cutover


**acceptance_criteria — canonical full-chain reset** *(transferred from `1A-002B` at round 10)*

- The **canonical** active migration root contains exactly the expected migration set: `20260801000000_baseline_schema.sql`, `20260802181931_…`, `20260802205850_…` — and **no** `001`/`002`, which `1A-002A` archived
- `supabase db reset` in the **canonical repository directory** exits 0 with the full three-migration chain
- **Schema hash matches** the live capture from `1A-001`
- **The four P0 functions retain their privilege posture after the full chain** — `PUBLIC`=f, `anon`=f, `authenticated`=f, `service_role`=t, `postgres`=t, by introspection. **Never call the functions**
- Local evidence recorded verbatim in `docs/audit/11_SCHEMA_RESET_VERIFICATION.md`

> This task, not `1A-002B`, owns the canonical reset. It requires
> `supabase/config.toml`, so it is additionally gated on `1D-009` — **encoded in
> `depends_on`, not only stated here.**

**validation** Reset transcript attached; hash comparison shown; no live command run.

**risk** MEDIUM — a mismatch means 1A-002 is incomplete.
**rollback** N/A — documentation only.

---

## 1A-004 · Live ledger cutover *(specified; **not executed in Phase 1**)*
`P1` · **MUST** · Supabase & Security · depends_on: 1A-003, **H-14 approval** · **S**

> **Added at round 2 (item 10).** `plan/10` described the backup, cutover and
> post-cutover verification as procedure with no owning task. Every step of that
> plan now maps to a task ID; this is the one that covers the live steps. It is
> specified so it is reviewable in advance — **it does not run in Phase 1.**

**scope** (1 file): `docs/audit/12_LEDGER_CUTOVER_RECORD.md` (new)

**goal** Register the baseline against the 21-row live ledger **without executing any schema DDL against live**, and prove afterwards that the two Emergency Gate 0 revokes are still in force.

**acceptance_criteria**
- **Verified backup taken first** — `supabase db dump --linked -f backup_<date>.sql`, restorability confirmed, non-negotiable
- `1A-003` fully green, including the schema-hash match
- Independent review of the baseline completed **before** this task starts
- **Explicit user approval recorded**, separate from H-01
- Cutover is `supabase migration repair --status applied 20260801000000` — **ledger only; no DDL executes**
- `supabase db diff --linked` afterwards reports **no differences**
- **Post-cutover privilege re-assertion**: `mock_activate_subscription`, `add_xp`, `track_weekly_xp` and `deal_damage_to_active_boss` are still **not** executable by `anon` or `authenticated`, checked via `has_function_privilege`. **Never call the functions** — privilege is introspected, not exercised
- Every command run is recorded verbatim in the cutover record, as `docs/audit/08` does

**validation** `db diff --linked` empty · the four `has_function_privilege` checks all return false for both roles · ledger row count is 22.
**risk** **HIGH** — the only task in Phase 1A that touches the live project. Mitigated by: no DDL, verified backup, prior review, and a ledger-only operation that is reversible in one command.
**rollback** `supabase migration repair --status reverted 20260801000000` — ledger bookkeeping only, **no DDL runs, so no data is at risk**. Catastrophic fallback: restore from the backup taken in the first criterion.

---

# Phase 1B — Dates, scheduling and metrics

## 1B-001 · Create the canonical date module
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

**scope** (1 file): `frontend/lib/date.ts` (new)

**test_contract** → `1E-L1a` owns `frontend/__tests__/lib/date.test.ts`. This task defines the behaviour to be asserted; it does **not** edit the test file.

**goal** One module that is the only place a calendar date is derived.

**acceptance_criteria**
- Exports `todayLocal()`, `ymd(d)`, `startOfWeekLocal(d)`, `parseLocalDate(s)`
- Every function is pure and accepts an injectable `now` where a clock is needed
- `todayLocal()` returns the device's local calendar date at **00:30** and at **23:30** under `TZ=Europe/Istanbul`
- No function uses `toISOString()` to derive a calendar date

**validation** `TZ=Europe/Istanbul npx jest lib/date` — green (test authored by `1E-L1a`).
**risk** LOW — additive, nothing consumes it yet.
**rollback** Delete `frontend/lib/date.ts`.

---

## 1B-002 · Route all date derivation through `lib/date.ts`
`P1` · **MUST** · Habit Domain · depends_on: 1B-001 · **M**

**scope** (5 files): `frontend/store/taskStore.ts` · `frontend/store/deepWorkStore.ts` · `frontend/store/lifeAreasStore.ts` · `frontend/lib/focusReport.ts` · `frontend/lib/journalStats.ts`

> Store-layer sites only. `frontend/lib/demoSeed.ts` is **DEMO-001A**; the four further store files are **1B-007**; the 5 highest-impact sites in `frontend/app/**` are **1B-008** (Expo Architecture), and the remaining 5 are **1B-009**, deferred to Phase 2A. Split because `app/**` has a different owner.

**goal** Eliminate UTC/local mixing in the five highest-impact modules.

**acceptance_criteria**
- The byte-identical `ymd()` duplicates at `focusReport.ts:22-24` and `journalStats.ts:12-14` are deleted and imported from `lib/date`
- `taskStore.dueToday()` and `.overdue()` return the correct set at 01:00 local
- `deepWorkStore.weekMinutes()` bucket boundary is local Monday 00:00, not Sunday 21:00
- `lifeAreasStore.save()` writes today's date at 01:00 local, not yesterday's
- `focusReport` and `journalStats` compare local keys to local keys only
- `grep -nE "toISOString\(\)\.(slice|split)" ` over these 5 files returns **zero**

**validation** `TZ=Europe/Istanbul npx jest` — AC-D01, D03, D04, D05, D06, D07, D08 pass (7 of the 14 failing L1 criteria).
**risk** MEDIUM — changes day attribution; historical rows keep their stored values.
**rollback** `git revert` the commit; no data migration involved.

---

## 1B-003 · Implement `frequency_config.count` in `isDueOn`
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

**scope** (1 file): `frontend/lib/habitSchedule.ts`

**test_contract** → `1E-L1a` owns `frontend/__tests__/lib/habitSchedule.test.ts`.

**goal** Make "X times per week" habits actually become due.

**acceptance_criteria**
- `{kind:'weekly', count:n}` with no `days` is due on at least `n` days per ISO week
- `{kind:'weekly', days:[...]}` behaviour is unchanged
- `{kind:'monthly'}` behaviour is explicitly decided and documented in the function (currently returns `false`)
- Negative-creation-date and `end_condition` guards still hold

**validation** `npx jest lib/habitSchedule` — AC-H03 passes.
**risk** LOW — pure function, fully covered by tests.
**rollback** `git revert`.

---

## 1B-004 · Correct the metric formulas
`P1` · **MUST** · Habit Domain · depends_on: 1B-003 · **M**

**scope** (1 file): `frontend/lib/reportMetrics.ts`

**test_contract** → `1E-L1b` owns `frontend/__tests__/lib/reportMetrics.test.ts`.

**goal** Make completion percentages reflect what the user actually did.

**acceptance_criteria**
- `habitAveragePercent` calls `isDueOn`; the denominator is **due days**, not `habits × days`
- A Mon/Wed/Fri habit completed all three days scores **100 %**, not 43 %
- `habitLogPercent` honours `target_direction`: `at_most` scores higher for lower values
- `summarizeHabitProgress` excludes `state:'miss'` and `state:'skip'` from completed days
- Historical reports do not change when a habit's `status` changes today

**validation** `npx jest lib/reportMetrics` — AC-H04, H05, H06, H07, H08, H09 pass (6 of 14).
**risk** MEDIUM — user-visible percentages will change, correctly.
**rollback** `git revert`.

---

## 1B-005 · Surface habit-log write errors
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

**scope** (1 file): `frontend/store/logStore.ts`

**test_contract** → `1E-L1b` owns `frontend/__tests__/store/logStore.test.ts`.

**goal** Stop swallowing the unique-constraint violation so a failed toggle is visible.

**acceptance_criteria**
- Both branches destructure and check `error`
- Store exposes an `error: string | null` field
- The insert path uses `.upsert(..., { onConflict: 'habit_id,completed_at' })`
- An in-flight guard prevents a second request while one is pending
- On failure, local state is not mutated

**validation** `npx jest store/logStore` — AC-I02's L1 half passes (client reads and exposes the error).
**risk** LOW.
**rollback** `git revert`.

---

## 1B-006 · Gate the demo-data seeder — see **DEMO-001A / DEMO-001B** below
Cross-listing for sequencing only, **not a task**. The specification lives in
`DEMO-001A` (library guard, Habit Domain) and `DEMO-001B` (UI removal, Expo
Architecture). Deliberately absent from the task index so it cannot be
double-counted.

---

## 1B-007 · Date derivation in the remaining store files
`P2` · SHOULD · Habit Domain · depends_on: 1B-001 · **S**

**scope** (4 files): `frontend/store/focusStore.ts` · `frontend/store/readingListStore.ts` · `frontend/store/notionSessionStore.ts` · `frontend/store/insightsStore.ts`

**goal** Close the 11 `toISOString()` occurrences the reviewer found outside 1B-002's list.

**acceptance_criteria**
- All 11 occurrences replaced with `lib/date` helpers or justified in a code comment where a UTC timestamp is genuinely wanted (e.g. `started_at`)
- `grep -c "toISOString" ` over these 4 files matches the justified count only

**validation** `npx tsc --noEmit` clean; grep count recorded in the commit.
**risk** LOW — `focusStore.started_at` legitimately wants UTC; do not blanket-replace.
**rollback** `git revert`.

---

## 1B-008 · Date derivation in `frontend/app/**`
`P2` · SHOULD · **Expo Architecture** (activated for this task — see `04 §3`) · depends_on: 1B-001 · **S**

**scope** (5 files, highest impact first): `frontend/app/tabs/today.tsx` · `frontend/app/tabs/tasks.tsx` · `frontend/app/screens/journal.tsx` · `frontend/app/screens/recovery.tsx` · `frontend/app/screens/calendar.tsx`

> The remaining 5 app-level sites (`deep-work`, `ai-coach`, `hub`, and the second `journal`/`calendar` occurrences) are **1B-009**, deferred to Phase 2A with `hub.tsx` orphan resolution.

**goal** Without this, 1B can pass its exit criteria while `today.tsx` still shows the wrong day at 00:30.

**acceptance_criteria**
- All date derivations in these 5 files use `lib/date`
- `today.tsx` renders the correct calendar date at 00:30 local
- No screen derives a date independently of the stores it reads

**validation** `TZ=Europe/Istanbul npx jest` green; manual check of `today.tsx` date at a simulated 00:30.
**risk** MEDIUM — screen-level changes need visual confirmation, which is device-blocked.
**rollback** `git revert`.

---

# Phase 1C — Willpower and recovery

## 1C-001 · Atomic willpower debit RPC
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **M**

**scope** (1 file): `supabase/migrations/<ts>_willpower_atomic_debit.sql`

**test_contract** → `1E-L2a` owns `supabase/tests/willpower.test.sql`. This task specifies the concurrency assertion; QA & Test authors it.

**goal** Replace the client read-modify-write with a single atomic statement.

**acceptance_criteria**
- RPC performs `UPDATE willpower_state SET used = used + $1 WHERE user_id = auth.uid() AND state_date = $2 AND used + $1 <= daily_budget RETURNING *`
- Returns NULL / raises when the budget would be exceeded — the check and the write are one statement
- Derives the user from `auth.uid()`; takes no `user_id` parameter
- `SECURITY DEFINER` with `SET search_path = public`
- Migration header carries pre-change state and exact rollback SQL

**validation** `supabase test db` — AC-I03 passes (two concurrent debits of 4 from 15 yield `used = 12`).
**risk** HIGH — touches the budget users see.
**rollback** `DROP FUNCTION`; revert `willpowerStore` to the prior path in the same revert.

---

## 1C-002 · Close the activation TOCTOU and refund exploit
`P1` · **MUST** · Habit Domain · depends_on: 1C-001, **1C-003** · **S**

**scope** (2 files): `frontend/store/willpowerStore.ts` · `frontend/store/habitStore.ts`

> **Serialised against `1C-003` (round 2).** Both tasks edit
> `frontend/store/willpowerStore.ts`. Same agent, so this is not a cross-agent
> conflict — but they must not run concurrently. The ordering is now encoded in
> `depends_on` rather than stated only in prose, so the dependency graph enforces
> it: **`1C-003` → `1C-002`.**

**goal** Make activation atomic and stop pausing an unactivated habit from refunding budget.

**acceptance_criteria**
- `activateHabit` calls the 1C-001 RPC; there is no client-side check-then-spend
- `pauseHabit` refunds **only** if the habit was previously `active`
- The silent `return` at `habitStore.ts:113` is replaced by a user-visible error
- Willpower cost is read from the habit row, not passed by the caller

**validation** `supabase test db` — AC-I04, AC-I05 pass.
**risk** MEDIUM.
**rollback** `git revert` (must revert together with 1C-001).

---

## 1C-003 · Midnight rollover for willpower state
`P1` · **MUST** · Habit Domain · depends_on: 1B-001 · **S**

**scope** (1 file): `frontend/store/willpowerStore.ts`

**goal** Stop an app left open overnight from writing to yesterday's row.

**acceptance_criteria**
- Cached `state_date` is compared against `todayLocal()` before every read and write
- A date change triggers a refetch rather than reusing the cached row
- `score()` returns a loading state, not `100`, when `state` is null

**validation** `supabase test db` — AC-I06 passes.
**risk** LOW.
**rollback** `git revert`.

---

## 1C-004 · Link telafi completion to a real habit log
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **M**

**scope** (1 file): `supabase/migrations/<ts>_recovery_completion_writes_log.sql`

**test_contract** → `1E-L2a` owns `supabase/tests/recovery.test.sql`.

> **Ownership note (C7, re-confirmed round 2):** this task is **migration-only**. The client half — `frontend/store/recoveryStore.ts` — is **1C-006**, owned by Habit Domain. Supabase & Security does not edit `frontend/**`. Every assignment table in `plan/04` states this identically.

**goal** Make completing a makeup actually move the metrics.

**acceptance_criteria**
- Completing a plan writes a `habit_logs` row for `source_date` with `is_makeup = true`
- The existing XP trigger fires on that row
- Completion percentage for the affected period increases
- Idempotent: completing twice produces one log

**validation** `supabase test db` — AC-I08, AC-I09 pass.
**risk** MEDIUM — writes historical rows.
**rollback** `DROP` the function/trigger; the written logs are retained (deleting user data on rollback is worse).

---

## 1C-005 · Unique constraint on recovery plans
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **XS**

**scope** (1 file): `supabase/migrations/<ts>_recovery_plans_unique.sql`

**goal** Prevent duplicate telafi plans for the same missed day.

**acceptance_criteria**
- `UNIQUE (habit_id, source_date)` exists
- Pre-existing duplicates are identified and resolved **before** the constraint is added (migration includes the dedupe query)
- Client `addPlan` uses upsert with matching `onConflict`

**validation** `supabase test db` — AC-I07 passes.
**risk** MEDIUM — will fail if duplicates already exist; the dedupe step is mandatory.
**rollback** `DROP CONSTRAINT`.

---

## 1C-006 · Recovery store client adaptation
`P1` · **MUST** · Habit Domain · depends_on: 1C-004, 1C-005 · **S**

**scope** (1 file): `frontend/store/recoveryStore.ts`

**goal** Consume the new server behaviour; stop treating completion as a status flip.

**acceptance_criteria**
- `completePlan` refreshes habit logs and metrics after completion
- `addPlan` uses `onConflict: 'habit_id,source_date'`
- `fetchPlans` can retrieve completed/skipped plans, not only `planned`
- Every Supabase call reads `error`

**validation** `npx tsc --noEmit` clean; `npx jest store/recoveryStore`.
**risk** LOW.
**rollback** `git revert`.

---

# Phase 1D — Edge function and RPC security

## 1D-001 · Rate limit `generate-routine`
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B, **1D-000** · **S**

> **R-19 gate.** This task edits and redeploys `generate-routine/index.ts`. The
> committed file supports 2 modes; the app sends 4; deployed is v11. **`1D-000`
> must land first** or this deploy silently breaks two working AI modes. The gate
> is encoded in `depends_on` above — it is not merely a register entry.

**scope** (2 files): `supabase/functions/generate-routine/index.ts` · `supabase/migrations/<ts>_ai_rate_limit.sql`

**goal** Bound AI spend per user.

**acceptance_criteria** Per-user request count enforced server-side over a fixed window · limit exceeded returns 429 with `Retry-After` · limit is configurable without a redeploy · the counter is atomic.
**validation** `supabase test db`; N+1 rapid calls return 429.
**risk** MEDIUM — too tight a limit blocks legitimate use.
**rollback** `git revert` + `DROP TABLE`.

## 1D-002 · Cooldown between AI generations
`P1` · **MUST** · Supabase & Security · depends_on: 1D-001 · **S**
**scope** (1 file): `supabase/functions/generate-routine/index.ts`
**goal** Enforce the cooldown `implementation.md:421,471` claims exists but which is absent.
**acceptance_criteria** A second call within the cooldown returns 429 · cooldown is per user per mode · documented value.
**validation** two calls in quick succession → second returns 429.
**risk** LOW. **rollback** `git revert`.

## 1D-003 · Atomic credit debit
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B, **1D-000**, **1D-002** · **M**

> **Serialised (round 4).** Five tasks edit `generate-routine/index.ts`:
> `1D-000` → `1D-001` → `1D-002` → `1D-003` → `1D-004`. `1D-001`/`1D-003` and
> `1D-002`/`1D-004` were previously unordered relative to each other — both
> reachable from `1D-000` but not from one another, so two agents could have
> edited the file concurrently. `1D-002` is added here to close the chain.
>
> **B3.** This task edits `supabase/functions/generate-routine/index.ts`. **`1D-000` must land first** — the committed file supports 2 modes while the deployed function is v11 and the app sends 4, so redeploying without reconciling would silently break two working AI modes. This is risk **R-19**, and the gate is encoded here in `depends_on`, not only in the register.
**scope** (2 files): `supabase/migrations/<ts>_spend_focus_points_atomic.sql` · `supabase/functions/generate-routine/index.ts`
**goal** Close the TOCTOU between balance read (`:59`) and debit (`:110`).
**acceptance_criteria** Balance check and debit are one statement · concurrent calls cannot overspend · returns the new balance.
**validation** `supabase test db` — AC-S14 passes.
**risk** HIGH — touches billing. **rollback** restore the prior function definition.

## 1D-004 · Fail-closed credit behaviour
`P1` · **MUST** · Supabase & Security · depends_on: 1D-003 · **S**
**scope** (1 file): `supabase/functions/generate-routine/index.ts`
**goal** Stop returning the AI answer when the debit fails (`:109-112` currently swallows it).
**acceptance_criteria** A failed debit returns an error and **no** AI content · the failure is logged · the user sees an actionable message.
**validation** `supabase test db` — AC-S15 passes.
**risk** LOW. **rollback** `git revert`.

## 1D-005 · Verify OAuth `state`
`P1` · **MUST** · Supabase & Security · depends_on: Gate B PASS · **M**

> **Head of the OAuth chain (B2).** `1D-005` → `1D-006` → `1D-007` all edit `notion-auth/index.ts`; `1D-005` and `1D-006` also edit `spotify-auth/index.ts`. Serialised so the three never edit concurrently.
**scope** (3 files): `supabase/functions/notion-auth/index.ts` · `supabase/functions/spotify-auth/index.ts` · `supabase/migrations/<ts>_oauth_state.sql`
**goal** Close the account-linking CSRF — `state` is minted in every flow and never checked.
**acceptance_criteria** `state` is persisted server-side with the user and a TTL · callback rejects a missing/unknown/expired/foreign `state` · single-use.
**validation** `supabase test db`; a replayed `state` is rejected.
**risk** MEDIUM — breaks in-flight OAuth sessions on deploy. **rollback** `git revert` + `DROP TABLE`.

## 1D-006 · Redirect-URI allowlist
`P1` · **MUST** · Supabase & Security · depends_on: **1D-005** · **S**

> **Serialised (B2).** Shares `notion-auth/index.ts` and `spotify-auth/index.ts` with `1D-005` and `1D-007`. Chain: `1D-005` → `1D-006` → `1D-007`.
**scope** (2 files): `supabase/functions/notion-auth/index.ts` · `supabase/functions/spotify-auth/index.ts`
**goal** Stop caller-controlled `redirect_uri` being embedded in the authorize URL.
**acceptance_criteria** A fixed allowlist is checked before use · non-allowlisted values are rejected with 400 · the app's real scheme is on the list.
**validation** a crafted `redirect_uri` returns 400.
**risk** MEDIUM — a missing entry breaks a live flow. **rollback** `git revert`.

## 1D-007 · Require an authenticated user in the Notion callback
`P1` · **MUST** · Supabase & Security · depends_on: **1D-006** · **S**

> **Serialised (B2).** Shares `notion-auth/index.ts` with `1D-005` and `1D-006`. Chain: `1D-005` → `1D-006` → `1D-007`. Last in the chain, so it sees the `state` check and the allowlist already in place.
**scope** (1 file): `supabase/functions/notion-auth/index.ts`
**goal** The callback currently proceeds with `user = null` and still creates pages in a third-party workspace.
**acceptance_criteria** Callback returns 401 without a valid user · no third-party side effect occurs before authentication · `verify_jwt` reviewed and recorded.
**validation** unauthenticated callback → 401, no Notion write.
**risk** LOW. **rollback** `git revert`.

## 1D-008 · Webhook idempotency
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **M**
**scope** (2 files): `supabase/functions/subscription-webhook/index.ts` · `supabase/migrations/<ts>_webhook_idempotency.sql`
**goal** RevenueCat retries currently re-grant credits in normal operation.
**acceptance_criteria** `provider_ref` is unique · a replayed event is a no-op returning 200 · the first delivery still grants.
**validation** `supabase test db` — AC-S16 passes.
**risk** MEDIUM. **rollback** `git revert` + `DROP CONSTRAINT`.

## 1D-009 · Wrong-project deploy guard
`P1` · **MUST** · **Supabase & Security** · depends_on: Gate B PASS · **XS**

> **Owner corrected at round 2 (B3).** This task was assigned to Repository
> Audit, whose stated prohibition is `supabase/**`. `supabase/config.toml` is a
> Supabase configuration file, so the task moves to **Supabase & Security** —
> the single owner of that tree. This owner is now identical in `plan/01`,
> `plan/04 §3` and `plan/04 §6`.

**scope** (2 files): `supabase/config.toml` (new) · `supabase/predeploy_guard.sh` (new)

**goal** Make it impossible to deploy this repo against `zdqiujpeewtyhtcqhdcj` ("Mas Technic Site"). Today `backend/supabase/.temp/linked-project.json` points at that foreign project, and nothing prevents a deploy from picking it up.

**acceptance_criteria**
- Canonical `project_id = "kbcuolhjjnmhjaarxxmu"` pinned in `supabase/config.toml`
- The guard reads the ref the CLI would actually use and **aborts non-zero** on any other value
- The guard aborts on an **absent** ref too — fail-closed, never fail-open
- `zdqiujpeewtyhtcqhdcj` is named explicitly as a denied ref, so the failure message is unambiguous
- **The guard performs no operation against any project** — it compares strings and exits. It never connects to Mas Technic to "verify" anything

**validation** Run the guard with the ref forced to a foreign value → non-zero exit; with it absent → non-zero; with the canonical ref → zero. No network call in any case.
**risk** LOW. A guard that fails open is worse than none, so the absent-ref case is a required assertion.
**rollback** Delete both files.

## 1D-000 · Reconcile `supabase/functions/generate-routine` with production
`P1` · **MUST** · Supabase & Security · depends_on: Gate B PASS · **M**

> **Added at Gate B remediation (C8).** Gate A finding **R1** had no task while 1D-001..004 were scheduled to modify and redeploy this exact file.

**scope** (2 files): `supabase/functions/generate-routine/index.ts` · `docs/audit/12_GENERATE_ROUTINE_RECONCILIATION.md`

**goal** The committed file supports 2 modes; the app sends 4; deployed version is 11. Deploying the repo file as-is would charge `summarize` 25 FP instead of 3 and hand it the wrong prompt — a production regression.

**acceptance_criteria**
- Deployed v11 source retrieved via `get_edge_function` and diffed against the repo file
- Repo file updated to match production behaviour for all four modes (`coach`, `routine`, `summarize`, `insights`) with correct per-mode costs
- Every Mas Technic reference, connection and secret stripped — re-implemented, not copied
- Differences between repo and deployed recorded in the document
- **This task must land before any of 1D-001..004 deploys**

**validation** repo file and deployed v11 agree on mode list and cost table; `deno check` passes.
**risk** HIGH — this is the regression vector. **rollback** `git revert`; deployed version unchanged (this task does not deploy).

---

# Phase 1D — RPC hardening (SEC series)

## SEC-1D-001 · Constrain `add_xp` to the calling user
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **S**

**scope** (1 file): `supabase/migrations/<ts>_secure_add_xp.sql`

**test_contract** → `1E-L2b` owns `supabase/tests/xp_security.test.sql`.

**signature (verified live):** `add_xp(p_user_id uuid, p_xp_amount integer)` · `SECURITY DEFINER` · `search_path=public` · client EXECUTE already revoked by `20260802205850`

**goal** Client EXECUTE is revoked, but the body still trusts a caller-supplied `user_id`. Any future re-grant, or any new caller, reopens cross-user writes. Fix the body, not only the grant.

**acceptance_criteria**
- Body raises unless `p_user_id = auth.uid()`, **with a documented bypass for trigger context** (the two live callers are triggers acting legitimately for the row owner)
- Both live callers — `fn_habit_log_award`, `trigger_damage_on_habit_log` — still award XP
- Parameter retained (removing it breaks trigger use); ownership enforced instead
- Migration header carries the pre-change definition and exact rollback

**validation** `supabase test db`: A→A succeeds · A→B raises · anon raises · habit completion still awards XP (AC-S07 regression).
**risk** HIGH — a wrong guard silently stops all XP.
**rollback** `CREATE OR REPLACE` with the captured prior body.

## SEC-1D-002 · Constrain `track_weekly_xp` and pin `search_path`
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **S**

**scope** (1 file): `supabase/migrations/<ts>_secure_track_weekly_xp.sql`

**test_contract** → `1E-L2b` owns `supabase/tests/xp_security.test.sql`. Shared with `SEC-1D-001`; one file, one owner, both contracts asserted in it.

**signature (verified live):** `track_weekly_xp(p_user_id uuid, p_xp integer)` · `SECURITY DEFINER` · **`search_path` NOT pinned**

**goal** Same ownership defect, plus an unpinned `search_path` on a definer function referencing `weekly_xp` unqualified.

**acceptance_criteria** Ownership guard as SEC-1D-001 · `SET search_path = public` added · leaderboard still populates through the normal path · caller list confirmed before deciding whether the parameter can be dropped.
**validation** `supabase test db`; `proconfig` shows `search_path=public`.
**risk** MEDIUM.
**rollback** Restore the captured prior definition.

## SEC-1D-003 · Constrain and bound `deal_damage_to_active_boss`
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002B · **M**

**scope** (1 file): `supabase/migrations/<ts>_secure_boss_damage.sql`

**test_contract** → `1E-L2b` owns `supabase/tests/boss_security.test.sql`.

**signature (verified live):** `deal_damage_to_active_boss(p_user_id uuid, p_damage integer DEFAULT 10)` · `SECURITY DEFINER` · `search_path` NOT pinned

**goal** Three defects: caller-supplied `user_id`; **unbounded** `p_damage` (one call zeroes boss HP and pays out to attacker-chosen contributors); and **negative** `p_damage`, which heals the boss and writes negative `total_damage`, corrupting the contribution leaderboard.

**acceptance_criteria** Ownership guard · `p_damage` clamped to a documented per-call maximum · `p_damage <= 0` rejected · `SET search_path = public` · trigger path still deals damage on habit completion.
**validation** `supabase test db`: cross-user raises · over-cap clamped or rejected · negative rejected · a single call cannot kill the boss · trigger still works.
**risk** MEDIUM.
**rollback** Restore the captured prior definition.

## SEC-1D-004 · Remove blanket write grants on the money tables
`P2` · SHOULD · Supabase & Security · depends_on: 1A-002B · **XS**

**scope** (1 file): `supabase/migrations/<ts>_revoke_money_table_grants.sql`

**goal** `anon` and `authenticated` hold `INSERT`, `UPDATE`, `DELETE` **and `TRUNCATE`** on `user_subscriptions` and `credit_transactions`. Only RLS default-deny stops I/U/D today, and `TRUNCATE` is not subject to RLS. Protection is incidental (no policy) rather than structural (no grant).

**acceptance_criteria** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` from `anon, authenticated` on both tables · `get_or_init_subscription`, `spend_focus_points` and the webhook path still work · client writes now fail at the grant layer.
**validation** `supabase test db` — AC-S12 still passes; grant introspection confirms the revoke.
**risk** LOW — verified nothing legitimate uses these grants.
**rollback** Re-`GRANT` the captured prior set.

## SEC-1D-005a · Profiles grant and policy design
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002A, **H-11** · **S**

> **H-11 encoded at round 11.** Its acceptance criteria require `last_ai_context`
> ownership to be confirmed — that is H-11, a user decision. It was named in the
> criteria but carried in **no** `depends_on`, so the dependency graph did not
> show this task waiting on a person.

**scope** (1 file): `docs/audit/14_PROFILES_COLUMN_DECISIONS.md`
**goal** Decide, per column, whether the client may write it.
**acceptance_criteria** All 17 columns carry a decision and rationale · `email` resolved (auth-owned) · `last_ai_context` owner confirmed (**H-11**) · `INSERT` path decided (client vs `handle_new_user` trigger).
**validation** Document lists 17 columns, none unclassified.
**risk** LOW. **rollback** N/A — documentation.

## SEC-1D-005b · Column-level grant migration
`P1` · **MUST** · Supabase & Security · depends_on: SEC-1D-005a · **S**

**scope** (1 file): `supabase/migrations/<ts>_profiles_column_grants.sql`
**goal** RLS restricts rows, not columns; `authenticated` holds column-level UPDATE on all 17.
**acceptance_criteria** `REVOKE UPDATE` on server-managed, derived and identity columns from `anon, authenticated` · retain `username`, `push_token`, `ai_persona` · revoke the unused `anon` table grants · pre-change grants captured verbatim in the header.
**validation** `has_column_privilege('authenticated','profiles','total_xp','UPDATE')` = false and `...,'username','UPDATE')` = true — AC-S10 passes.
**risk** LOW — the app writes only `id`, `email`, `username`.
**rollback** `GRANT UPDATE (<captured list>)`.

## SEC-1D-005c · Safe profile-update RPC *(may prove unnecessary)*
`P2` · COULD · Supabase & Security · depends_on: SEC-1D-005a · **S**

**scope** (1 file): `supabase/migrations/<ts>_update_profile_rpc.sql`
**goal** Only if 005a concludes the client needs a write path beyond the retained columns.
**acceptance_criteria** RPC accepts only user-editable fields and derives the user from `auth.uid()` — **or** the task is closed as `not required` with that decision recorded.
**validation** `supabase test db`, or a recorded closure.
**risk** LOW. **rollback** `DROP FUNCTION`.

## SEC-1D-005d · Profile store client adaptation
`P1` · **MUST** · **Habit Domain** · depends_on: SEC-1D-005b · **XS**

**scope** (1 file): `frontend/store/profileStore.ts`
**goal** Confirm the app still works under tightened grants. Expected near-zero: it writes only `insert({id,email})` at `:46` and `update({username})` at `:73`.
**acceptance_criteria** Profile rename works · first-login bootstrap works · every Supabase call reads `error`.
**validation** `npx tsc --noEmit` clean; `npx jest store/profileStore`.
**risk** LOW. **rollback** `git revert`.

## SEC-1D-005e · Profiles RLS and integration tests
`P1` · **MUST** · QA & Test · depends_on: SEC-1D-005b · **S**

**scope** (1 file): `supabase/tests/profiles.test.sql`
**goal** Prove the column-grant restriction in `SEC-1D-005b` actually denies self-promotion of XP, coins, level and rank — and that it does so without breaking the server-side XP trigger. A grant change that is not asserted under a real client role is an assumption, not a control.
**acceptance_criteria** PATCH own `username` succeeds · PATCH own `total_xp` rejected · PATCH own `coins`/`level`/`willpower_rank` rejected · PATCH another user's row rejected · habit completion still awards XP via trigger · `anon` has no access.
**validation** `supabase test db` green.
**risk** LOW. **rollback** Delete the test file.

## SEC-1D-005f · Profiles rollback rehearsal
`P2` · SHOULD · Supabase & Security · depends_on: SEC-1D-005b · **XS**

**scope** (1 file): `docs/audit/15_PROFILES_ROLLBACK_REHEARSAL.md`
**goal** Prove the rollback restores the captured grant set exactly — a superset is not a restore.
**acceptance_criteria** Rollback executed on a **local** stack · post-rollback grants byte-match the captured pre-change set · rehearsal recorded.
**validation** Local-only grant diff shows zero difference.
**risk** LOW — local only. **rollback** N/A.

## OPS-0B-001 · Relocate the foreign `backend/.env.local`
`P1` · **MUST** · Supabase & Security · depends_on: **H-03 user approval** · **XS**

**scope** (2 files): `backend/.env.local` · `backend/supabase/functions/.env.local` — both moved out of the tree

**goal** A full-admin service-role key for the separate `zdqiujpeewtyhtcqhdcj` project sits inside this repository. Untracked and gitignored, so not a commit leak — but it does not belong here.

**acceptance_criteria** Both files copied to a machine-local secrets location outside any git work tree, verified byte-identical, then removed from this tree · no canonical function reads them (verified — Supabase auto-injects `SUPABASE_URL` / `SERVICE_ROLE_KEY` into deployed functions, per `subscription-webhook/index.ts:3`) · Notion OAuth continues via Supabase function secrets on the canonical project · **user approved beforehand**.

**validation** No `.env*` containing foreign-project credentials remains under `Mobile_Uygulama/`; Notion connect still works.
**risk** LOW for this project. **Zero operations performed on Mas Technic. No rotation** — that is Mas Technic's owner's decision, outside this engagement.
**rollback** Restore from the verified backup.

---

# Phase 1E — Test infrastructure

## 1E-000 · Dependency and licence clearance
`P1` · **MUST** · Open-Source Research · depends_on: Gate B PASS · **S**

> **Added at Gate B remediation (C6).** 1E was blocked by a licence gate assigned to Phase 8. This task moves the clearance for exactly three dev dependencies into Phase 1 as 1E's entry dependency.

**scope** (1 file): `docs/research/04_PHASE1_DEPENDENCY_CLEARANCE.md`

**goal** Clear `jest-expo`, `pgTAP` and `supabase/cli` for adoption so 1E can start.

**acceptance_criteria** For each of the three: pinned version · `LICENSE` read at that version with SHA recorded · compatibility with Expo SDK 54 / RN 0.81 / Postgres 17 stated · adoption decision · owner · Gate B approval state. All three are **dev/test-only** and never ship in the app bundle — recorded explicitly so no in-app attribution obligation arises.

**validation** document exists; each entry has a SHA; no entry says "recalled".
**risk** LOW. **rollback** N/A — documentation.

> **Restructured at round 2 (B1).** `1E-L1` and `1E-L2` previously claimed
> `__tests__/**` and `supabase/tests/**` by glob while six of those same files
> also sat in the scope of a domain or security task. Six files had two edit
> owners. The rule is now absolute: **every test file has exactly one edit
> owner, and that owner is always QA & Test.** Domain and security tasks carry a
> `test_contract` naming the QA task that owns their test, and specify what must
> be asserted — they never edit it. `1E-L1`/`1E-L2` are split so no scope
> exceeds 5 files and no glob can silently re-absorb another task's file.

## 1E-L1 · jest-expo harness
`P1` · **MUST** · QA & Test · depends_on: **1E-000**, OPS-1E-001 · **S**

**scope** (2 files): `frontend/jest.config.js` (new) · `frontend/jest.setup.js` (new)

**goal** A runnable jest-expo harness. Config only — this task authors no test.

**acceptance_criteria** `jest-expo` preset pinned to the SDK 54 major · **`TZ=Europe/Istanbul` pinned in config**, so a test cannot pass by accident of machine timezone · `frontend/__tests__/` is the roots entry · the harness does **not** read `.env` · running it with zero test files exits 0, not "no tests found" as an error.
**validation** `npm test` exits 0 on an empty suite.
**risk** LOW — additive; nothing imports it.
**rollback** Delete both files.

## 1E-L1a · L1 tests — date and scheduling
`P1` · **MUST** · QA & Test · depends_on: 1E-L1 · **M**

**scope** (2 files): `frontend/__tests__/lib/date.test.ts` (new) · `frontend/__tests__/lib/habitSchedule.test.ts` (new)

**goal** Convert the date and scheduling half of the failing L1 criteria into executing tests. Sole edit owner of both files.

**test contracts consumed:** `1B-001` (date module), `1B-003` (`frequency_config.count`).

**acceptance_criteria**
- Covers **AC-D01, D03, D04, D05, D06, D07, D08** and **AC-H03** — 8 of the 14 failing L1 criteria
- **Every test is written against unmodified code and observed to fail first**, for the diagnosed reason
- 00:30 and 23:30 cases run under `TZ=Europe/Istanbul`
- Clock is injected, never `Date.now()` read ambiently
- No test asserts on Turkish UI copy

**validation** `TZ=Europe/Istanbul npm test -- lib/date lib/habitSchedule` — 8 criteria pass after their fixes land, and each is recorded as having failed before.
**risk** MEDIUM — if a test does not fail first, the diagnosis was wrong and 1B must re-plan. That is R-01 and a finding, not a nuisance.
**rollback** Delete both files.

## 1E-L1b · L1 tests — metrics and log store
`P1` · **MUST** · QA & Test · depends_on: 1E-L1 · **M**

**scope** (2 files): `frontend/__tests__/lib/reportMetrics.test.ts` (new) · `frontend/__tests__/store/logStore.test.ts` (new)

**goal** Convert the metric-correctness half of the failing L1 criteria into executing tests. Sole edit owner of both files.

**test contracts consumed:** `1B-004` (metric formulas), `1B-005` (log error handling).

**acceptance_criteria**
- Covers **AC-H04, H05, H06, H07, H08, H09** — 6 of the 14 failing L1 criteria
- Plus the **L1 half of AC-I02**: the store surfaces the error. The L2 half — that Postgres actually rejected the duplicate — is `1E-L2a`, never asserted here
- Every test observed to fail first
- `at_most` direction covered at, above and below the limit

**validation** `npm test -- lib/reportMetrics store/logStore` — 6 criteria pass; AC-I02's L1 half passes.
**risk** MEDIUM — same first-fail rule as `1E-L1a`.
**rollback** Delete both files.

## 1E-L2 · pgTAP harness and baseline database tests
`P1` · **MUST** · QA & Test · depends_on: 1A-003, **1E-000**, **H-13 Docker** · **M**

**scope** (2 files): `supabase/tests/rls.test.sql` (new) · `supabase/tests/constraints.test.sql` (new)

**goal** A runnable pgTAP suite proving tenant isolation and the constraints the client relies on.

**acceptance_criteria** `supabase test db` runs in one command · RLS asserted on all 48 tables — a cross-tenant read **returns zero rows** under a second user's JWT · `UNIQUE (habit_id, completed_at)` asserted directly · `willpower_state` PK asserted · no assertion depends on a client mock.
**validation** `supabase test db` green.
**risk** LOW to write. **Blocked by H-13** — Docker is not running on this machine.
**rollback** Delete both files.

## 1E-L2a · L2 tests — willpower and recovery concurrency
`P1` · **MUST** · QA & Test · depends_on: 1E-L2, 1C-001, 1C-004 · **M**

**scope** (2 files): `supabase/tests/willpower.test.sql` (new) · `supabase/tests/recovery.test.sql` (new)

**goal** Prove the concurrency and linkage properties no client mock can prove. Sole edit owner of both files.

**test contracts consumed:** `1C-001` (atomic debit), `1C-004` (telafi → habit log), `1C-005` (recovery uniqueness).

**acceptance_criteria**
- **AC-I03**: two concurrent debits of 4 against a budget of 15 leave `used = 12` — asserted with two real sessions, not sequential calls
- A debit that would exceed the budget fails atomically and leaves `used` unchanged
- Completing a makeup writes exactly one `habit_logs` row; completing twice still writes one
- The recovery-plan unique constraint rejects a duplicate `(habit_id, source_date)`

**validation** `supabase test db` green; AC-I03 and the recovery criteria pass.
**risk** MEDIUM — concurrency tests that do not genuinely run in parallel prove nothing. The test must use two sessions.
**rollback** Delete both files.

## 1E-L2b · L2 tests — security regression
`P0` · **MUST** · QA & Test · depends_on: 1E-L2 · **M**

**scope** (3 files): `supabase/tests/security_regression.test.sql` (new) · `supabase/tests/xp_security.test.sql` (new) · `supabase/tests/boss_security.test.sql` (new)

**goal** Make the two Emergency Gate 0 fixes permanent. Today nothing would detect a re-grant. Sole edit owner of all three files.

**test contracts consumed:** `SEC-1D-001`, `SEC-1D-002`, `SEC-1D-003`, `SEC-1D-004`.

**acceptance_criteria**
- **AC-S01..S07 exist as permanent regression tests** asserting the **full five-role contract** for `mock_activate_subscription`, `add_xp`, `track_weekly_xp` and `deal_damage_to_active_boss`: **`PUBLIC`=f, `anon`=f, `authenticated`=f, `service_role`=t, `postgres`=t**, via `has_function_privilege`

> **Widened at round 9.** This previously asserted only `anon`/`authenticated` — 2 of 5 roles — while `plan/04` claimed `1E-L2b` "re-asserts the same properties" as `1A-002B`. It now genuinely does. `PUBLIC` matters most: `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default, so a re-created function silently reopens the hole without touching `anon` or `authenticated` at all.
- **Never invoke any of these functions to test them** — a call would itself be the exploit. Privilege is asserted, not exercised
- After `SEC-1D-001..003`: each body derives the user from `auth.uid()` and ignores a caller-supplied `user_id`
- `deal_damage_to_active_boss` rejects negative and unbounded damage
- The money tables reject a direct client write

**validation** `supabase test db` green; each assertion fails if the corresponding revoke or body change is reverted — verified by reverting one locally.
**risk** MEDIUM — a regression test that passes against the *unfixed* code is worthless. Each must be shown to fail on a deliberately reverted local database.
**rollback** Delete all three files.

## OPS-1E-001 · Add `test` and `typecheck` npm scripts
`P1` · **MUST** · Repository Audit · depends_on: Gate B PASS · **XS**

**scope** (1 file): `frontend/package.json`

> **Ownership (round 2, B1).** `package.json` is Repository Audit's file. `1E-L1`
> previously listed it, which would have made QA & Test its second editor. QA &
> Test specifies the scripts; Repository Audit applies them. One file, one owner.

**goal** `npm test` and `npm run typecheck` do not exist. Without them the harness has no entry point and CI has nothing to call.

**acceptance_criteria** `"test": "jest"` and `"typecheck": "tsc --noEmit"` present · `jest-expo` and `jest` added to `devDependencies` at the versions pinned by `1E-000` · **no production dependency added** · `npx tsc --noEmit` still clean.
**validation** `npm run typecheck` exits 0; `npm test` reaches the harness.
**risk** LOW. **rollback** `git revert`.

---

# Cross-phase

> **Split at round 2 (B3), serialised at round 5.** `DEMO-001` was one task owned
> by Habit Domain with `frontend/app/tabs/settings.tsx` in scope — a path Habit
> Domain is forbidden to touch. It is now two tasks, each with its own owner,
> criteria, validation, risk and rollback.
>
> **Order: `DEMO-001A` → `DEMO-001B`, encoded in `depends_on`.**
> The **source-level guard lands first**. Removing the UI row alone is not
> sufficient — any other caller of `seedDemoData()` would still write. Securing
> the library first means the window between the two tasks is *safe but
> cosmetically inconsistent* (a visible button that refuses), rather than
> *invisible but still exploitable*. Round 4 had this stated in prose only, in
> the reverse order, and encoded in no `depends_on`.

## DEMO-001A · Gate the seeder at the library
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

**scope** (2 files): `frontend/lib/demoSeed.ts` · `docs/audit/13_DEMO_DATA_AUDIT.md` (new)

**goal** `seedDemoData()` writes fabricated rows into the caller's real account with no environment check anywhere in the module. Hiding the button is not sufficient — any code path reaching the function must also be refused, or the guard is cosmetic.

**Tables affected — classified by write path**

> **Corrected at round 4.** `demoSeed.ts` contains **zero** `supabase.from(...)`
> calls — verified: the only direct Supabase call in the file is
> `supabase.auth.getUser()` at `:46`. Every write routes through a store. The
> earlier "direct inserts in `demoSeed.ts`" attribution was wrong, and the
> single flat table list hid a second layer of effects entirely.

**A · Direct writes** — a store function called by `demoSeed.ts` writes the row

| Table | Store call | Line in `demoSeed.ts` |
|---|---|---|
| `projects` | `addProject` | `:384` |
| `habits` | `addHabit` | `:464` |
| `habit_logs` | `logHabit` | `:479`, `:492`, `:507` |
| `tasks` | `addTask` | `:557` |
| `focus_tasks` | `addFocusTask` | `:566` |
| `recovery_plans` | `addPlan` | `:578` |
| `journal_entries` | `saveEntry` | `:615` |
| **`willpower_state`** | `spend(3)` → **UPDATE** ([willpowerStore.ts:65-75](frontend/store/willpowerStore.ts#L65-L75)); `fetchToday()` also upserts | `:596`, `:370` |

**B · Indirect trigger side effects** — no seeder code writes these; they change because a row in group A was written

`habit_logs` carries three triggers (`docs/audit/07 §5`), so **every seeded log
fires all three**:

| Trigger | Timing | Function | Tables it changes |
|---|---|---|---|
| `trg_habit_log_set_xp` | BEFORE | `fn_habit_log_set_xp` | rewrites `habit_logs.xp` itself — server-authoritative |
| `trg_habit_log_award` | AFTER | `fn_habit_log_award` | `habits.streak_current`, **`habits.streak_best`**; calls `add_xp()` → **`profiles`**; calls **`track_weekly_xp()`** → **`weekly_xp`** |
| `on_habit_completed_damage_boss` | AFTER | `trigger_damage_on_habit_log` | calls `deal_damage_to_active_boss()` → **`global_bosses`**, **`boss_contributors`** — **only when `is_completed = true`** |

**Confirmed indirect targets — six:**
`profiles` · **`weekly_xp`** · `habits.streak_current` · **`habits.streak_best`** · `global_bosses` · `boss_contributors`

> **Corrected at round 5, from the function bodies.** `weekly_xp` was previously
> listed as *suspected*; `fn_habit_log_award` calls `track_weekly_xp(...)`
> directly, so it is **confirmed**. `habits.streak_best` was missed entirely.
>
> **`weekly_xp` is the most consequential of the six: it backs the leaderboard.**
> It is the only affected table whose pollution is visible to **other users**,
> not just to the seeding user.
>
> The boss path is conditional on `is_completed = true`. `logStore.ts:60,78` sets
> `is_completed: isDone`, and `demoSeed.ts:479,507` seed two `state:'done'` logs
> — **so the boss path does fire.**

**Why the distinction matters:** group B is invisible to any detection method
built on seeder literals, because the seeder never names those tables. A user
who seeded and then reports wrong XP, a wrong level, or a wrong boss-contribution
ranking has pollution in tables the seeder does not appear to touch.

**Do not add a group-B table to group A.** They need different detection and
different reasoning, and conflating them is what produced the original
seven-table undercount.

**Collision risk with real user data**
- `habit_logs` rows pollute XP, streaks, completion percentages and the leaderboard — the exact metrics Phase 1B exists to fix
- `willpower_state` pollution corrupts the budget 1C-001 and 1C-003 are being written against
- Seeded rows are indistinguishable from real ones: no `is_demo` flag, no marker column
- `demoSeed.ts:22` uses `toISOString().slice(0,10)`, so seeded dates are also UTC-skewed
- If a user seeds and then reports a metric bug, their data is unusable as evidence

**acceptance_criteria**
- `seedDemoData()` **returns early with an explicit error** when seeding is not permitted — before any write, including the `spend(3)` call
- The gate is a single named predicate (e.g. `isSeedingAllowed()`) used by both this task and `DEMO-001B`, so the library and the UI cannot disagree
- **Decision recorded**: bare `__DEV__`, or an explicit `EXPO_PUBLIC_DEMO_ENV` flag if seeding is wanted in a staging build. Document which and why — do not leave both described
- The refusal is observable (returns an error), not a silent no-op
- Read-only audit plan written to `13_DEMO_DATA_AUDIT.md` — **this task deletes no data**

**Read-only detection plan for already-seeded data** (documented, **not executed**)

> **This plan contains no DELETE, no UPDATE and no automated cleanup of any
> kind.** It produces a report. Nothing in it may be turned into a remediation
> script without a separate, separately-approved task.

**Tier 1 — literal match (group A, 7 INSERT-written tables)**
- Enumerate the literal project/habit/task/journal names `demoSeed.ts` inserts
- Per user: rows in those 7 tables matching a literal **and** whose `created_at` clusters within one second
- These are **matches** — high confidence

**Tier 2 — correlation (group A, `willpower_state`)**
- `willpower_state` is **UPDATE-only**, has no seeder literals and no `created_at`, so Tier 1 cannot see it
- Correlate instead: a row whose `state_date` falls in a Tier-1 cluster **and** whose `used`/`active_count` exceed what that user's genuine `habit_logs` explain
- **Suspected, never confirmed**

**Tier 3 — inferred (group B, trigger side effects)**
- `profiles`, **`weekly_xp`**, `habits.streak_current`, **`habits.streak_best`**, `global_bosses`, `boss_contributors` are changed by triggers, not by the seeder. There is **no marker of any kind** distinguishing trigger-derived pollution from genuine progress
- **`weekly_xp` backs the leaderboard, so this tier is not private to the seeding user** — a seeded account can outrank real ones. Report it explicitly rather than folding it in with the rest
- Report only: "user X has N Tier-1 seeded `habit_logs`; their `profiles` XP/level/coins, streaks and boss contributions are therefore **derived from polluted input** and cannot be treated as evidence"
- **No attempt to compute a corrected value.** XP is a trigger-derived aggregate over history; recomputing it is a migration, not an audit
- **Inferred, never a match**

**Output:** a per-user report with counts at each tier and its confidence label.
Cleanup — if ever wanted — is a **separate task requiring its own approval**,
because Tier 2 is a suspicion and Tier 3 cannot be attributed at row level at
all. Deleting or "correcting" a user's XP on that basis would destroy real
progress.

**validation** Unit test: with seeding disallowed, `seedDemoData()` rejects and **zero** Supabase calls are issued (assert on a mocked client, including no `spend`) · `npx tsc --noEmit` clean.
**risk** LOW to implement. The real risk is the audit plan being turned into an automated delete — explicitly forbidden above.
**rollback** `git revert` — restores the current unsafe behaviour, so revert only with cause.

## DEMO-001B · Remove the seeder from the production UI
`P1` · **MUST** · **Expo Architecture** · depends_on: **DEMO-001A** · **XS**

**scope** (1 file): `frontend/app/tabs/settings.tsx`

> **Owner (round 2, B3).** `frontend/app/**` is Expo Architecture's tree. Habit
> Domain may not edit it. This is the second Phase 1 task in that tree, after
> `1B-008`; both are listed in `plan/04 §6`.

**goal** `settings.tsx:339` renders a tappable row wired to `handleSeedDemoData`. `grep -n "__DEV__" frontend/app/tabs/settings.tsx` exits 1 — there is no guard anywhere in the file. In a release build the row is visible and functional.

**Access point (verified):** `:30` imports `seedDemoData` · `:134` defines `handleSeedDemoData` · `:137` calls it · `:339` renders the row.

**What this row can write** — full classification in `DEMO-001A`:
- **Direct (8 tables):** `projects`, `habits`, `habit_logs`, `tasks`, `focus_tasks`, `recovery_plans`, `journal_entries`, `willpower_state`
- **Indirect trigger side effects (6):** `profiles`, `weekly_xp`, `habits.streak_current`, `habits.streak_best`, `global_bosses`, `boss_contributors` — written by the three `habit_logs` triggers, not by any seeder code

**12 distinct tables** are affected. The six indirect *entries* resolve to **five
distinct tables**, because `habits.streak_current` and `habits.streak_best` are
the same table — and `habits` is already in the direct list. So:
8 direct + {`profiles`, `weekly_xp`, `global_bosses`, `boss_contributors`} = **12**.

**Four tables are named nowhere in the seeder** — `profiles`, `weekly_xp`,
`global_bosses`, `boss_contributors` — and one of them, `weekly_xp`, backs the
leaderboard, so the damage is visible to other users. That is why removing the
row is `MUST` and not cosmetic.

> **Depends on `DEMO-001A`.** The library guard lands first; this task then
> removes the now-refusing button.

**acceptance_criteria**
- The row is **not rendered** when seeding is disallowed — not disabled, not hidden behind an alert. It does not exist in the tree
- The handler and the import are also excluded, so no dead reference survives into the bundle
- Uses the **same** `isSeedingAllowed()` predicate as `DEMO-001A` — not a second, independently-written check
- No surrounding settings row shifts position or loses its separator when the row is absent
- Navigation from Settings is unchanged in every other respect

**validation** A production-configuration build renders no seed row — verified by inspecting the rendered settings list, not by grepping · `grep -n "seedDemoData" frontend/app/tabs/settings.tsx` shows every remaining reference inside the guard · `npx tsc --noEmit` clean.
**risk** LOW. Touching a shared settings list risks disturbing adjacent rows; the criteria above cover it.
**rollback** `git revert` — single file.

> `OPS-0B-001` is specified once, in the Phase 1D/OPS section above. A duplicate
> stub previously sat here and was removed at Gate B remediation.

---

## Task index

Regenerated from the specification blocks at round 2, not hand-maintained.
Agent, size and dependency below are read from each block's header line.

| Task | Phase | Agent | Size | Files | Blocking dependency |
|---|---|---|---|---|---|
| 1A-001 | 1A | Supabase & Security | M | 1 | Gate B PASS |
| 1A-002A | 1A | Supabase & Security | M | 5 | 1A-001 |
| 1A-002B | 1A | Supabase & Security | M | 2 | 1A-002A, **H-13** |
| 1A-003 | 1A | Supabase & Security | S | 1 | 1A-002B, **1D-009**, **H-13** |
| 1A-004 | 1A | Supabase & Security | S | 1 | 1A-003, **H-14 approval** — *not executed in Phase 1* |
| 1B-001 | 1B | Habit Domain | S | 1 | Gate B PASS |
| 1B-002 | 1B | Habit Domain | M | 5 | 1B-001 |
| 1B-003 | 1B | Habit Domain | S | 1 | Gate B PASS |
| 1B-004 | 1B | Habit Domain | M | 1 | 1B-003 |
| 1B-005 | 1B | Habit Domain | S | 1 | Gate B PASS |
| 1B-007 | 1B | Habit Domain | S | 4 | 1B-001 |
| 1B-008 | 1B | Expo Architecture | S | 5 | 1B-001 |
| 1C-001 | 1C | Supabase & Security | M | 1 | 1A-002B |
| 1C-002 | 1C | Habit Domain | S | 2 | 1C-001, **1C-003** |
| 1C-003 | 1C | Habit Domain | S | 1 | 1B-001 |
| 1C-004 | 1C | Supabase & Security | M | 1 | 1A-002B |
| 1C-005 | 1C | Supabase & Security | XS | 1 | 1A-002B |
| 1C-006 | 1C | Habit Domain | S | 1 | 1C-004, 1C-005 |
| 1D-000 | 1D | Supabase & Security | M | 2 | Gate B PASS |
| 1D-001 | 1D | Supabase & Security | S | 2 | 1A-002B, **1D-000** |
| 1D-002 | 1D | Supabase & Security | S | 1 | 1D-001 |
| 1D-003 | 1D | Supabase & Security | M | 2 | 1A-002B, **1D-000**, **1D-002** |
| 1D-004 | 1D | Supabase & Security | S | 1 | 1D-003 |
| 1D-005 | 1D | Supabase & Security | M | 3 | Gate B PASS |
| 1D-006 | 1D | Supabase & Security | S | 2 | **1D-005** |
| 1D-007 | 1D | Supabase & Security | S | 1 | **1D-006** |
| 1D-008 | 1D | Supabase & Security | M | 2 | 1A-002B |
| 1D-009 | 1D | Supabase & Security | XS | 2 | Gate B PASS |
| ~~1D-010~~ | 1D | — | — | — | **DONE `42b64a0`** |
| SEC-1D-001 | 1D | Supabase & Security | S | 1 | 1A-002B |
| SEC-1D-002 | 1D | Supabase & Security | S | 1 | 1A-002B |
| SEC-1D-003 | 1D | Supabase & Security | M | 1 | 1A-002B |
| SEC-1D-004 | 1D | Supabase & Security | XS | 1 | 1A-002B |
| SEC-1D-005a | 1D | Supabase & Security | S | 1 | 1A-002A, **H-11** |
| SEC-1D-005b | 1D | Supabase & Security | S | 1 | SEC-1D-005a |
| SEC-1D-005c | 1D | Supabase & Security | S | 1 | SEC-1D-005a |
| SEC-1D-005d | 1D | Habit Domain | XS | 1 | SEC-1D-005b |
| SEC-1D-005e | 1D | QA & Test | S | 1 | SEC-1D-005b |
| SEC-1D-005f | 1D | Supabase & Security | XS | 1 | SEC-1D-005b |
| 1E-000 | 1E | Open-Source Research | S | 1 | Gate B PASS |
| OPS-1E-001 | 1E | Repository Audit | XS | 1 | Gate B PASS |
| 1E-L1 | 1E | QA & Test | S | 2 | 1E-000, OPS-1E-001 |
| 1E-L1a | 1E | QA & Test | M | 2 | 1E-L1 |
| 1E-L1b | 1E | QA & Test | M | 2 | 1E-L1 |
| 1E-L2 | 1E | QA & Test | M | 2 | 1A-003, 1E-000, **H-13** |
| 1E-L2a | 1E | QA & Test | M | 2 | 1E-L2, 1C-001, 1C-004 |
| 1E-L2b | 1E | QA & Test | M | 3 | 1E-L2 |
| DEMO-001A | 1 | Habit Domain | S | 2 | Gate B PASS |
| DEMO-001B | 1 | Expo Architecture | XS | 1 | **DEMO-001A** |
| OPS-0B-001 | 2C | Supabase & Security | XS | 2 | **H-03** |

**50 rows · 1 DONE (`1D-010`, closed in `42b64a0`) · 49 open · 49 fully
specified · 0 XL · largest **M** · no scope exceeds 5 files · no dependency
cycles · no acceptance-artefact cycles.**

> **Round 8:** `1A-002` was split into **`1A-002A`** (authoring — static
> validation, not gated on Docker) and **`1A-002B`** (baseline-only behavioural
> proof — gated on **H-13**). 49 + 1 = 50 rows. Distinct Phase 1 files 73 → 75.

### The count changed at round 2 — deliberately

Round 2 was instructed to treat **42 rows / 41 open** as canonical. That figure
was correct for the artefact as it stood, but the round-2 ownership rebuild
**necessarily creates tasks**, because the six double-owned files could only be
separated by splitting the tasks that shared them:

| Change | Reason | Net |
|---|---|---|
| `1E-L1` → `1E-L1` + `1E-L1a` + `1E-L1b` | its glob claimed four files owned by 1B tasks | +2 |
| `1E-L2` → `1E-L2` + `1E-L2a` + `1E-L2b` | it claimed `willpower.test.sql` / `recovery.test.sql` from 1C, and needed room for the xp/boss regression files freed from the SEC tasks | +2 |
| `DEMO-001` → `DEMO-001A` + `DEMO-001B` | one task spanned two agents' trees | +1 |
| `OPS-1E-001` added | `package.json` is Repository Audit's file; 1E-L1 could not own it | +1 |
| `1A-004` added | `plan/10`'s backup, cutover and post-cutover verification steps had no owning task | +1 |

**41 + 7 = 48 open** at that time. No task was removed and none was silently
dropped. Round 8 then split `1A-002`, so the canonical value is now
**50 rows / 49 open**, carried in `08_CANONICAL_METRICS.md`; 42/41 and 49/48 are
both superseded and appear nowhere as a live assertion.

Every one of the 49 open tasks carries all six body fields (`scope`, `goal`,
`acceptance_criteria`, `validation`, `risk`, `rollback`) plus its seven header
fields (`id`, `title`, `priority`, `MUST/SHOULD/COULD`, `agent`, `depends_on`,
`size`) — 13 in total.

`1B-006` is **not** a task. It is a cross-listing pointer keeping the demo-seeder
visible in Phase 1B sequencing; the specification lives in `DEMO-001A`/`B`. It is
deliberately absent from this index so it cannot be double-counted.
