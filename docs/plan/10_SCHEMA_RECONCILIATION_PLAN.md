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

## 6. Decision required — H-01

**Option A (squashed baseline) or Option B (incremental reconstruction)?**

Recommendation: **A**. `1A-002` cannot start until this is answered. `1A-001`
(the three-way diff) is read-only and starts regardless.
