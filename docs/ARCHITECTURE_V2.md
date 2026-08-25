# ARCHITECTURE_V2 — Target Architecture and Current-State Gap

**Status:** `Verified` — target restated from plan, gap measured against real repo
**Scope:** `frontend/` (Expo Router app), `supabase/` (canonical backend)
**Date:** 2026-08-25

This document has two halves: §1–§2 restate the **target** architecture from
`IMPLEMENTATION_V2.md` §4/§5/§20 verbatim in substance (the target itself is
not in dispute); §3–§4 measure **where the real repository sits against it
today**, per Rule 7 — real code, not the plan's stale inventory, is the
baseline for "current state."

---

## 1. Target layer diagram (plan §4)

```
┌───────────────────────────────────────┐
│              EXPO APP                  │
│  Today / Plan / Habits / Insights /    │
│  Profile                               │
└──────────────────┬─────────────────────┘
                    ▼
┌───────────────────────────────────────┐
│          APPLICATION LAYER             │
│  habitService · taskService ·          │
│  capacityService · recoveryService ·   │
│  analyticsService · gamificationService│
└──────────────────┬─────────────────────┘
                    ▼
┌───────────────────────────────────────┐
│          DATA ACCESS LAYER             │
│  habitRepository · logRepository ·     │
│  taskRepository · recoveryRepository · │
│  profileRepository                     │
└──────────────────┬─────────────────────┘
                    ▼
┌───────────────────────────────────────┐
│              SUPABASE                  │
│  Auth · PostgreSQL · RLS ·             │
│  Realtime (where useful) · Edge Fns    │
└──────────────────┬─────────────────────┘
                    │ optional
                    ▼
┌───────────────────────────────────────┐
│           FASTAPI / WORKERS            │
│  AI routines · AI insight generation · │
│  complex batch analytics · webhooks    │
└───────────────────────────────────────┘
```

Target file structure (plan §20, condensed): `app/` (routes only) →
`components/` (presentational) → `features/*` → `lib/` (pure infra:
`supabase.ts`, `tokens.ts`, `queryClient.ts`, `haptics.ts`, `dates.ts`) →
`repositories/*` (one file per aggregate, wraps every `supabase.from/rpc`
call) → `services/*` (business logic, calls repositories) → `store/`
(`uiStore.ts` only — ephemeral UI state) → `types/*` (`database.ts`,
`habit.ts`, `task.ts`, `recovery.ts`, `analytics.ts`).

---

## 2. Mandatory Architecture Rules (plan §5, restated)

**Rule 1 — One Source of Truth.** Supabase PostgreSQL is the production data
source. MongoDB gets no new feature work.

**Rule 2 — Every user-owned table has `user_id`.** No `user_id = "default"`
pattern in production code; every row ties to `auth.users.id`.

**Rule 3 — RLS mandatory.** Every personal table has Row Level Security with
at minimum `auth.uid() = user_id`. No client can read another user's habits,
logs, notes, tasks, journal, recovery or stats rows.

**Rule 4 — UI does not query the database directly.** This pattern is
forbidden inside a screen component:

```tsx
supabase.from('habit_logs').select(...)
```

The required path is `Screen → Hook → Service → Repository`.

---

## 3. Rule 4 compliance audit — real numbers (corrected)

> **Correction record.** This section's first version reported **1**
> violation. That count was wrong: the grep pattern used
> (`supabase\.from\(` on a single line) does not match this codebase's
> dominant call style —
> ```ts
> const { data } = await supabase
>   .from('habit_logs')
>   .select(...)
> ```
> — where `supabase` and `.from(`/`.rpc(` sit on different lines. A
> multi-line-aware scan (`perl -0777 -ne '... /supabase\s*(?:\n\s*)?\.\s*(from|rpc)\s*\(/g ...'`)
> was re-run across `frontend/app/**` and `frontend/components/**` and every
> match was confirmed by reading the surrounding source. The corrected count
> below supersedes the original "1" finding.

**`frontend/app/**` — 10 violations across 5 files:**

| File | Line | Call |
|---|---|---|
| `app/screens/weekly-review.tsx` | 73 | `supabase.from('weekly_reviews').select('*')` |
| `app/screens/weekly-review.tsx` | 104 | `supabase.from('habit_logs').select(...)` |
| `app/screens/weekly-review.tsx` | 111 | `supabase.from('focus_sessions').select(...)` |
| `app/screens/weekly-review.tsx` | 134 | `supabase.from('weekly_reviews').upsert(...)` |
| `app/tabs/stats.tsx` | 153 | `supabase.from('habit_logs').select(...)` (364-day query) |
| `app/tabs/stats.tsx` | 188 | `supabase.from('habit_logs').select(...)` (30-day query) |
| `app/screens/monthly-review.tsx` | 117 | `supabase.from('habit_logs').select(...)` |
| `app/screens/monthly-review.tsx` | 124 | `supabase.from('focus_sessions').select(...)` |
| `app/screens/recovery.tsx` | 125 | `supabase.from('habit_logs').select(...)` |
| `app/screens/credit-history.tsx` | 37 | `supabase.from('credit_transactions').select(...)` |

**`frontend/components/**` — 6 violations across 4 files:**

| File | Line | Call |
|---|---|---|
| `components/focus/FocusSettingsModal.tsx` | 71 | `supabase.from('focus_tasks').select('*')...` |
| `components/focus/FocusSettingsModal.tsx` | 72 | `supabase.from('focus_sessions').select('*')...` |
| `components/focus/FocusSettingsModal.tsx` | 123 | `supabase.from('focus_sessions').delete()...` |
| `components/focus/FocusSessionCompleteModal.tsx` | 33 | `supabase.from('focus_sessions').select(...)` |
| `components/focus/FocusReportModal.tsx` | 60 | `supabase.from('focus_sessions').select(...)` |
| `components/ADHDTaskSplitter.tsx` | 56 | `supabase.from('tasks').insert(rows).select()` |

**Verified total: 16 direct DB calls in the UI layer, across 9 files** — 10 in
`app/**` (5 files) and 6 in `components/**` (4 files); `FocusSettingsModal.tsx`
alone carries 3. Every `supabase.rpc(` search (same multi-line-aware method)
returned zero matches in either tree — all 16 are `.from(` calls. **The
repository layer Phase 1 builds must absorb these 16 call sites out of
`app/**` and `components/**`**, not the near-clean single-site picture the
original miscount implied.

**Scope beyond `app/**`/`components/**`, same corrected method:**
`frontend/store/**` contains **78** `supabase.from`/`supabase.rpc` call sites
across the 25 domain stores (also re-counted with the multi-line-aware
method — materially higher than the single-line grep's original 40).
`frontend/lib/**` contains 0. Combined client-wide total: **94** direct
Supabase call sites (78 store + 10 app + 6 components), none in `lib/`. The
16 in `app/**`/`components/**` are the ones Rule 4 governs directly (UI
layer); the 78 in `store/**` are the ones a `repositories/*` layer would
wrap so stores stop talking to Postgres themselves (§4.2 below).

---

## 4. Current state vs target — the real gap

### 4.1 What exists today

| Target layer | Real equivalent today |
|---|---|
| Expo UI (`app/`) | **Present**, 40 route files, Expo Router v5, matches the target's route-only intent reasonably well (screens call stores, not the DB, in all but 1 case — §3) |
| Application layer (services) | **Absent.** No `frontend/services/` directory exists. |
| Data access layer (repositories) | **Absent.** No `frontend/repositories/` directory exists. |
| `lib/` (pure infra) | **Present and larger than target**: 21 modules including `supabase.ts`, `tokens.ts`, `haptics.ts`, `date.ts`, plus domain-adjacent helpers (`habitSchedule.ts`, `reportMetrics.ts`, `focusReport.ts`, `journalStats.ts`, `triage.ts`, `ranks.ts`, `subscription.ts`, …) that the target's slim `lib/` (5 files) does not anticipate |
| `store/` | **25 live domain stores**, each doing what the target splits into repository + service + `uiStore.ts`. This is the actual data-access layer in the running app today — just undivided. |
| Supabase (Auth/Postgres/RLS/Edge Functions) | **Present and live** — 48 tables, RLS on all 48, 40 RPCs, 5 deployed edge functions (doc 07). Unreachable to this audit run only because the MCP connection currently times out; the deployment itself is not in question. |
| FastAPI/workers (optional, for AI/integrations only) | **Present but wrongly scoped**: `backend/server.py` is a full FastAPI + MongoDB CRUD backend (habits/tasks/completions/webhooks/bad-habits/stats/profile), not the AI-orchestration-only role the target assigns it (§21 below). Still reachable from 2 screens via `utils/api.ts` (`AUDIT_V2.md` §7.2). |

### 4.2 The gap Phase 1 must close

**There is a store layer; there is no repository layer and no service layer.**
Concretely:

1. **No `repositories/*`.** The 78 `supabase.from/rpc` calls inside
   `frontend/store/**` (§3, multi-line-aware recount) are not behind a
   repository abstraction — each store
   both holds UI-relevant state *and* talks to Postgres directly. Splitting
   these into `repositories/habitRepository.ts`,
   `repositories/logRepository.ts`, etc., without changing store call sites'
   external behavior, is Phase 1 work item "06 Repository layer" (plan §33).
2. **No `services/*`.** Business logic — capacity calculation, recovery
   deficit computation, XP/streak logic — currently lives partly server-side
   (triggers, confirmed in doc 07 §5: XP and streaks are already
   server-authoritative) and partly inline inside store actions
   (`habitStore.ts`, `logStore.ts`, `willpowerStore.ts`, etc.). There is no
   single place a `capacityService` or `recoveryService` could be dropped in
   without touching every store that currently does that work inline.
3. **`store/` is doing double duty** — Zustand holds both ephemeral UI state
   (correct, per plan §18: "Zustand ≠ database mirror") and what amounts to a
   local cache of server rows (`habits`, `habit_logs`, `tasks`, …), fetched
   and mutated directly against Supabase. The target's `store/uiStore.ts`
   (UI-only) vs TanStack Query-backed server state (plan §18) split has not
   started; `@tanstack/react-query` is not in `package.json`.
4. **`types/` is split, not unified.** Target wants
   `types/{database,habit,task,recovery,analytics}.ts`. Real repo has the
   legacy `types/index.ts` (Mongo-shaped, 4 consumers) plus ad hoc types
   defined inline inside `lib/supabase.ts` (`Habit`, `HabitLog`, `Profile`,
   `RecoveryPlan`, `WillpowerState`, `Routine`, …) and inside individual
   stores. No dedicated `types/database.ts` exists.
5. **Rule 4 is not held today** (§3, corrected count: **16** violations across
   9 files in `app/**`/`components/**`, plus **78** more call sites inside
   `store/**` that a repository layer must also absorb — **94** direct
   Supabase call sites client-wide). This is real cleanup scope, not a
   near-clean codebase with one stray call: Rule 4's *letter* (no `.from()`
   inside a screen component) is broken in 10 places across 5 screens, and
   its *spirit* (a real data-access boundary) is absent everywhere calls are
   made directly rather than through a `repositories/` layer.

### 4.3 What this means for Phase 1 sequencing

Plan §33's own ordering ("06 Repository layer" before "07 Query/state layer")
is consistent with this gap: the repository layer is greenfield work, not a
refactor of something broken, because the store layer it will sit underneath
already works and is what production currently runs on. Phase 1 does not need
to fix broken data access — it needs to **interpose** a layer between 25
working stores and Postgres without regressing any of them, which is a higher
bar than building the layer from nothing.
