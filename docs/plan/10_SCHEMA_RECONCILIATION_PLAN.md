# 10 — Schema Reconciliation Plan

**Status:** Gate B remediation **C11** — recommendation final, **execution awaits H-01**
**Decision owner:** user

---

## 1. Evidence

| Fact | Value | Source |
|---|---|---|
| Live migration ledger | **21** | `list_migrations` |
| Repository migration files | **4** | `ls supabase/migrations` |
| Files matching a ledger entry | **2** | the two Emergency Gate 0 migrations |
| **History gap** | **19** | 21 − 2 |
| Live tables | 48 · repo migrations describe **7** | |
| Live RPCs | 40 · repo migrations describe **0** | |
| Live triggers | 9 · repo migrations describe **0** | |
| Renamed columns | 5 | `type`→`tracking_type`, `target_value`→`daily_goal`, `frequency`→`frequency_config`, `habit_logs.date`→`completed_at`, `willpower_state.date`→`state_date` |
| Contradictory CHECK | `001:20` rejects `status='idea'`, which the client writes | `lib/supabase.ts:55` |
| **Original SQL for the 19** | **does not exist anywhere** | `implementation.md:159` records they were applied via `execute_sql` on the live DB |

`supabase db reset` from the repository produces a database **the app cannot run
against**.

---

## 2. Recommendation — Option A, squashed baseline

| | Option A — squashed baseline | Option B — incremental reconstruction |
|---|---|---|
| What | One migration reproducing the current live schema | ~19 migrations reconstructing each ledger entry |
| Source of truth | The live database, which is real | The current end-state, working backwards |
| History | Explicitly a squash; the gap is documented in doc 07 §8 | **Fabricated.** Nobody has the original SQL |
| Effort | 1 migration | 19 migrations |
| Drift risk | 1 opportunity for error | 19 |
| Honesty | states what it is | produces files that *look* authoritative and are invented |

**Recommend A.** Option B would manufacture evidence. This engagement has
refused to do that everywhere else — including declining to reconstruct these
same 19 migrations by guesswork during Gate A — and should not start now. The
per-change history is **already lost**; a reconstruction would not recover it,
only disguise its absence.

---

## 3. Procedure

Executed as `1A-002` and `1A-003`, **only after H-01**.

### Step 1 — Capture (read-only)
Dump the live schema: tables, columns, types, defaults, constraints, indexes,
RPCs with `prosecdef`/`proconfig`, triggers, policies, grants. Record a **schema
hash** — a sorted digest over `information_schema` — as the comparison baseline.

### Step 2 — Author the baseline
`supabase/migrations/<ts>_baseline_schema.sql`, containing everything from Step 1.

Header records: generation date · source project ref · that it is a squash, not
a history · the schema hash it was generated from.

#### The baseline MUST be non-idempotent — and is push-unsafe until repaired

> **Added at round 2 (M10).** The plan's stated protection against an accidental
> live apply was "applying the baseline to live would attempt to re-create them
> and fail." **That only holds if the baseline is authored non-idempotently**,
> and Step 2 did not say so. A generated schema dump normally emits
> `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` and bare `GRANT`.
> Under those constructs an accidental `supabase db push` would **not** fail —
> it would succeed and **re-grant `EXECUTE` on `mock_activate_subscription`,
> `add_xp`, `track_weekly_xp` and `deal_damage_to_active_boss` to `anon` and
> `authenticated`, reopening both Emergency Gate 0 P0s.**

Binding requirements on the generated file:

| Requirement | Why |
|---|---|
| **No `IF NOT EXISTS`** on any `CREATE TABLE` / `CREATE INDEX` / `CREATE TYPE` | so an accidental apply against a populated live database aborts on the first object |
| **No `CREATE OR REPLACE`** on functions — plain `CREATE FUNCTION` | `OR REPLACE` silently overwrites a hardened body with the permissive original |
| **No `DROP … IF EXISTS`** preamble | a "clean slate" preamble would drop live objects |
| Header carries **`-- PUSH-UNSAFE: apply only via 'migration repair', never 'db push'`** | the warning travels with the file |
| `1D-009`'s guard is **not** sufficient protection | it checks the project ref, not which migration is being applied |

**Verification (part of `1A-002`'s acceptance criteria):**
`grep -icE "if not exists|or replace|drop .*if exists" <baseline>` returns **0**.

### Step 3 — Preserve the Emergency Gate 0 migrations
**`20260802181931` and `20260802205850` are NOT folded into the baseline.** They
remain separate files, ordered *after* it.

Reason: they are the only two migrations whose intent is security-critical and
independently reviewed. Folding them into a squash would erase the record that a
payment bypass and an unauthenticated cross-user write were found and closed —
and would make the regression tests (`AC-S01..S07`) look unmotivated.

Consequence: the baseline must create the four functions **with their original
permissive grants**, so the two revokes still have something to revoke. Verified
by running all three in order on a clean local database.

### Step 4 — Archive the superseded files
`001_initial_schema.sql` and `002_integrations.sql` → `supabase/migrations/archive/`
with a README explaining they predate the drift and are retained for provenance
only.

### Step 5 — Local reset validation
```bash
supabase start
supabase db reset
```
Then verify:
- table/column/RPC/trigger inventory matches the Step 1 capture
- **schema hash matches**
- the app's four RPCs exist and are callable
- RLS is enabled on all 48 tables
- post-reset, `mock_activate_subscription`, `add_xp`, `track_weekly_xp`, `deal_damage_to_active_boss` are **not** executable by `anon`/`authenticated` — proving the Emergency Gate 0 migrations still apply on a fresh database

### Step 6 — Cutover (documented; **not executed in Phase 1A**)

The live database **already has** these 48 tables. Applying the baseline to live
would attempt to re-create them and fail.

```bash
# 1. Back up first — mandatory, non-negotiable
supabase db dump --linked -f backup_<date>.sql

# 2. Mark the baseline as already applied WITHOUT running its DDL
supabase migration repair --status applied <baseline-version>

# 3. Confirm the ledger and the repository now agree
supabase db diff --linked      # expect: no differences
```

**Prerequisites before Step 6 runs:** verified backup · Step 5 fully green ·
independent review of the baseline · explicit user approval. Step 6 is a
separate authorised action, not part of `1A-002`.

### Step 7 — Rollback

| Stage | Rollback |
|---|---|
| Steps 1–5 (local only) | delete the new file, restore `001`/`002` from `archive/`. **Nothing live touched** |
| Step 6 (`migration repair`) | `supabase migration repair --status reverted <baseline-version>` — ledger bookkeeping only; **no DDL runs, so no data is at risk** |
| Catastrophic | restore from the Step 6 backup |

`migration repair` changes only the ledger table. That is what makes this cutover
low-risk: **no schema DDL executes against live at any point.**

---

## 4. What the baseline deliberately excludes

| Excluded | Why |
|---|---|
| The 19 lost migrations as separate files | would be fabricated |
| `auth`, `storage`, `realtime` schemas | Supabase-managed |
| Row data | schema only; demo/user data is not migration content |
| `supabase_migrations.schema_migrations` contents | managed by the CLI |

Objects present live but unused by the client are **included** but flagged in
`1A-001`. Removing them is a separate decision, not a side effect of a baseline.

---

## 5. Post-reconciliation invariant

Once complete, this must hold permanently:

> **Every schema change is a file in `supabase/migrations/` first, applied
> second.** CI asserts `supabase db diff --linked` is empty.

Both Emergency Gate 0 migrations already demonstrate the pattern — pre-change
state captured verbatim, exact rollback in the header. **The pattern is proven in
this repository; Phase 6B makes it enforced.**

---

## 6. Step → task traceability

**Every step below has an owning backlog task.** No step in this plan is
unowned; nothing is left as prose that someone is expected to notice.

| # | Step | Task ID | Agent | Executed in Phase 1? |
|---|---|---|---|---|
| 1 | Capture live schema (read-only) + **schema hash** | **`1A-001`** | Supabase & Security | yes — read-only |
| 2 | Author the baseline (**non-idempotent**, push-unsafe) | **`1A-002`** | Supabase & Security | yes — file only, not applied |
| 3 | **Preserve the two Emergency Gate 0 migrations** outside the squash | **`1A-002`** (acceptance criterion) | Supabase & Security | yes |
| 4 | Archive `001`/`002` to `migrations/archive/` | **`1A-002`** (acceptance criterion) | Supabase & Security | yes |
| 5 | Local `db reset` validation | **`1A-003`** | Supabase & Security | yes — local only |
| 6 | **Schema-hash comparison** local vs live | **`1A-003`** (acceptance criterion) | Supabase & Security | yes |
| 7 | Post-reset revoke assertion — the 4 functions are **not** client-executable on a fresh DB | **`1E-L2b`** | QA & Test | yes — permanent regression test |
| 8 | **Backup before cutover** (`supabase db dump --linked`) | **`1A-004`** | Supabase & Security | **no — needs H-01 + explicit approval** |
| 9 | **Cutover** (`migration repair --status applied`) | **`1A-004`** | Supabase & Security | **no — separate authorised action** |
| 10 | Post-cutover `db diff --linked` shows no differences | **`1A-004`** | Supabase & Security | **no** |
| 11 | **Post-cutover revoke re-assertion** — prove the two P0s are still closed on live | **`1A-004`** | Supabase & Security | **no** |
| 12 | Rollback, Steps 1–5 (local) | **`1A-002`** / **`1A-003`** rollback fields | Supabase & Security | n/a |
| 13 | Rollback, Step 9 (`repair --status reverted`) | **`1A-004`** rollback field | Supabase & Security | n/a |

**`1A-004` is specified in the backlog but does not run in Phase 1.** It is
gated on H-01 *and* a separate explicit approval, and it is the only task in
this plan that touches the live project. Steps 1–7 are the whole of Phase 1A's
executable content, and none of them changes anything live.

---

## 7. Decision required — H-01

**Option A (squashed baseline) or Option B (incremental reconstruction)?**

Recommendation: **A**. `1A-002` cannot start until this is answered. `1A-001`
(the three-way diff) is read-only and starts regardless.
