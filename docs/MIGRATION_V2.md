# MIGRATION_V2 — Migration Map (plan §21, §26)

**Status:** `Verified` — mapping only; **no migration applied in this run**
**Date:** 2026-08-25

---

## 1. BLOCKED — read this first

**Supabase project `kbcuolhjjnmhjaarxxmu` is unreachable at time of writing.**
The orchestrator's MCP `execute_sql` and `list_tables` calls both time out.
This document performs **no live database operation of any kind**: no
`apply_migration`, no `execute_sql`, no schema push. Everything below is a
map authored from static evidence — `frontend/lib/supabase.ts`,
`supabase/migrations/*.sql`, and the live capture already recorded (while the
project *was* reachable, on 2026-08-02) in
`docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md` and
`docs/plan/10_SCHEMA_RECONCILIATION_PLAN.md`.

Applying schema SQL against a live production database is an **irreversible
action** requiring the repository owner's explicit approval and a verified
backup (`docs/plan/10_SCHEMA_RECONCILIATION_PLAN.md` §3 Step 6 already
specifies the exact procedure — backup, `migration repair --status applied`,
`db diff --linked` — none of which runs here). This document authors nothing
new on disk beyond itself; it is a map, not a migration file.

---

## 2. Legacy → target mapping

| Legacy element | Target | Disposition |
|---|---|---|
| `frontend/types/index.ts` (Mongo-shaped `Habit`, `Task`, `Completion`, `Webhook`, `BadHabit`, `Stats`, `UserProfile`, `Achievement`) | `frontend/types/{database,habit,task,recovery,analytics}.ts` (plan §20) | **Candidate for removal after dependency migration.** Live consumers today: `store/useStore.ts` (dead, §MIGRATION below), `utils/api.ts`, `app/tabs/settings.tsx` (webhook/export panel only), `components/BadHabitsTracker.tsx`. Only the latter two are load-bearing. |
| `frontend/store/useStore.ts` | `frontend/store/uiStore.ts` (ephemeral UI state only, plan §18/§20) | **Delete candidate — already dead.** `AUDIT_V2.md` §7.3 confirms 0 consumers repo-wide. Plan §25 ("`frontend/store/useStore.ts` — Migration tamamlandıktan sonra kaldır") assumed this needed a migration off of it first; in reality nothing needs to migrate off it because nothing uses it. Safe to remove independently of any other Phase 1 work, pending owner sign-off (out of scope for this read-only audit run). |
| `frontend/utils/api.ts` (axios → FastAPI `localhost:8000`) | `repositories/*` + `services/*` → Supabase directly | **2 real consumers to migrate**, not a blanket removal: `settings.tsx`'s webhook CRUD + data-export panel, and `BadHabitsTracker.tsx`'s bad-habit CRUD + savings calculation. Neither `webhooks` nor `bad_habits` has a confirmed Supabase table in this audit's evidence — that must be checked against the live 48-table inventory before this migrates (Phase 1A schema capture, see §3 below). `habitAPI`, `completionAPI`, `taskAPI`, `statsAPI`, `profileAPI` exports are dead (0 call sites) and can be deleted without migrating anything. |
| `backend/server.py` (FastAPI + MongoDB, 1064 lines, full CRUD) | Supabase for CRUD; FastAPI narrowed to AI/integration routers only (§3) | **CRUD endpoints (`/api/habits`, `/api/tasks`, `/api/completions`, `/api/stats`, `/api/user/profile`, `/api/achievements`, `/api/webhooks`, `/api/bad-habits`, `/api/export`) → Supabase.** The MongoDB path is not deleted in this run; it is inventoried here as the removal candidate once `settings.tsx` and `BadHabitsTracker.tsx` (the only two live callers) are migrated. |
| MongoDB (`motor.motor_asyncio.AsyncIOMotorClient`, `backend/.env` → `MONGO_URL`) | Fully retired once the two callers above move | **Not started.** No count comparison, no export, no cutover has been performed — this is Phase-1-and-later work per plan §26 Steps 1–8, none of which is executed here. |

---

## 3. FastAPI's new role (plan §21 "FastAPI'nin Yeni Rolü")

FastAPI is **not** removed wholesale. Plan §21 scopes it down to:

**Keep:**
```
/api/ai/routine
/api/ai/task-split
/api/ai/weekly-insight
/api/integrations/*
```

**Remove (migrate to Supabase CRUD):**
```
/api/habits CRUD
/api/tasks CRUD
```

Target end-state directory (plan §25):
```
backend/
  main.py
  routers/
    ai.py
    integrations.py
  services/
  schemas/
```

**Current reality:** `backend/server.py` is a single 1064-line file mixing
both categories — it has not yet been split into `routers/ai.py` vs
`routers/integrations.py`, and no `main.py`/`routers/`/`services/`/`schemas/`
structure exists. This is unstarted Phase 1+ work; recorded here as the
target, not claimed as done.

Separately — and out of scope for the FastAPI-role decision — `backend/`
also contains a `supabase/` subtree pointing at a **different, foreign**
Supabase project (`zdqiujpeewtyhtcqhdcj`, "Mas Technic Site"), already
classified in `docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md` §1a. That
material is not part of Atlas's migration path at all; it is a separation
proposal for the repository owner, unrelated to `backend/server.py`'s CRUD
retirement.

---

## 4. Schema gap table — Phase 1 headline item

### 4.1 Tracking types — the headline gap

Plan §8 requires **four** tracking types:

```ts
type TrackingType = 'binary' | 'numeric' | 'duration' | 'abstinence';
```

The live schema, as modeled in `frontend/lib/supabase.ts:47`, supports only
**two**:

```ts
tracking_type: 'boolean' | 'numeric';
```

| Plan requires | Live/client supports | Gap |
|---|---|---|
| `binary` | `boolean` (name differs, concept matches) | naming only |
| `numeric` | `numeric` | met |
| `duration` | — | **missing** — no dedicated tracking type; would currently have to be modeled as `numeric` with a minutes unit, losing the semantic distinction plan §8.3 wants (target/actual minutes, completion ratio) |
| `abstinence` | — | **missing** — no dedicated tracking type for negative-behavior tracking (plan §8.4: "Sigara içme", "Sosyal medya yok"); `behavior_type: 'positive'|'negative'` exists as a *label* on `Habit` but does not change how logging or completion-ratio math works, which is what `abstinence` requires |

This is recorded as **the headline Phase 1 schema gap** per this document's
brief. Closing it requires an `ALTER TYPE`/CHECK-constraint change on
`habits.tracking_type` (or a superseding column) plus completion-ratio logic
per plan §8.6 — schema authored on disk in Phase 1, **not applied here.**

### 4.2 `habit_logs.state` CHECK — present and matches plan

`supabase/migrations/001_initial_schema.sql:31`:

```sql
state text NOT NULL DEFAULT 'miss' CHECK (state IN ('done','partial','skip','miss'))
```

This matches plan §8.5's unified log state exactly
(`'done' | 'partial' | 'miss' | 'skip'`). **No gap here** — already aligned,
contrary to what a naive reading of the plan's "P0.1 everything is missing"
framing might suggest. (Doc 07 §8 separately notes a *different*, unrelated
CHECK contradiction on `habits.status` rejecting `'idea'` while the client
writes it — not a tracking-type or log-state issue, flagged there, not
duplicated here.)

### 4.3 `recovery_plans` and `daily_capacity` — absent from migrations entirely

```
grep -rn "recovery_plans\|daily_capacity" supabase/migrations/   →  0 matches
```

Neither table appears in any of the 4 files under `supabase/migrations/`.

- **`recovery_plans`**: doc 07 §4 confirms this table **does exist live**
  (captured 2026-08-02) with only a `PRIMARY KEY (id)` — no unique constraint
  on `(habit_id, source_date)`, so duplicate recovery plans for the same
  missed day are possible today. It exists live but is **not represented in
  any migration file** — it is one of the "19 lost migrations" `docs/plan/10`
  already documents (applied by hand via `execute_sql`, original SQL not
  recoverable). `frontend/lib/supabase.ts` already defines a client-side
  `RecoveryPlan` type (`id`, `user_id`, `habit_id`, `source_date`,
  `target_date`, `strategy`, `note`, `reminder_time`, `status`,
  `created_at`) matching a `recovery_plans`-shaped table, which is further
  confirmation it exists live even though this repo's migration history
  cannot reproduce it.
- **`daily_capacity`**: **no evidence of this table anywhere** — not in
  migrations, not in `frontend/lib/supabase.ts`'s type exports, not
  mentioned as a table in doc 07's 48-table live capture. Plan §17 describes
  it as a cache/materialized table, not a source of truth, which is
  consistent with it simply not existing yet — this is genuinely unbuilt,
  not lost history. Building it is pure Phase 1 net-new work (Capacity
  Engine, plan §10).

### 4.4 Summary

| Table/column | Migration file | Live (per doc 07, 2026-08-02) | Phase 1 action |
|---|---|---|---|
| `habits.tracking_type` (2 values) | describes 7 tables total incl. `habits` | `'boolean'\|'numeric'` | **Extend to 4 values** — headline gap |
| `habit_logs.state` CHECK | present, matches plan | matches | none — already correct |
| `recovery_plans` | **absent** | **exists**, `PRIMARY KEY (id)` only, no unique constraint | reconcile into the Phase 1A squashed baseline (`docs/plan/10` §2 Option A); add the missing unique constraint as a deliberate, reviewed change, not silently |
| `daily_capacity` | absent | **absent** | net-new build, Capacity Engine |

---

## 5. Migration strategy pointer (plan §26 Steps 1–8)

This document does not execute any of plan §26's steps. For status:

| Step | Plan §26 content | Status here |
|---|---|---|
| 1 | Mongo data export | Not started |
| 2 | Transform script (`ObjectId` → UUID) | Not started |
| 3 | Supabase import | Not started |
| 4 | Count comparison | Not started |
| 5 | Sample validation | Not started |
| 6 | Read-only legacy backend | Not started |
| 7 | Cutover | Not started |
| 8 | Archive | Not started |

Separately, `docs/plan/10_SCHEMA_RECONCILIATION_PLAN.md` already defines a
**more specific, already-decided** procedure for the Supabase-side schema
history gap (squashed baseline, Option A, decision H-01 closed) — that
procedure supersedes plan §26 Steps 1–5 for the Supabase schema itself; §26
Steps 1–8 above remain the map for the **MongoDB → Supabase data** migration
specifically (the 2 live legacy consumers' data: webhooks, bad-habits), which
is a separate, smaller migration than the schema reconciliation.
