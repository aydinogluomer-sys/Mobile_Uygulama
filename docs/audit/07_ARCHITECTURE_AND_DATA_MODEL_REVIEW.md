# 07 — Architecture and Data Model Review

**Status:** `Verified` — live database captured 2026-08-02
**Phase:** 0C (canonical declaration + live capture)

> **The canonical structure is a given, not a decision made here.** Mobile_Uygulama's
> canonical project is `kbcuolhjjnmhjaarxxmu` and its canonical directory is root
> `/supabase`. This document records that baseline and classifies the foreign
> material found inside the repository. Phase 1D re-implements what is proven to
> belong here; Phase 2C separates the rest with approval.

---

## 1. Canonical baseline

| | Value |
|---|---|
| Canonical Supabase project | **`kbcuolhjjnmhjaarxxmu`** |
| Project name | **Alışkanlık Uygulaması** |
| Canonical directory | **root `/supabase`** |
| Canonical function tree | **`supabase/functions/`** |
| Canonical migrations | **`supabase/migrations/`** |

Corroborated by `frontend/.env` → `EXPO_PUBLIC_SUPABASE_URL`, by
`supabase/.temp/linked-project.json`, and by `implementation.md:534`.

The project was `INACTIVE` (paused) at audit start and was restored during
Phase 0C. During restore `list_tables` briefly returned `{"tables":[]}`; a direct
query returned `FATAL: 57P03: the database system is starting up`, confirming
that empty result was **a restore artifact, not data loss**.

## 1a. Foreign Mas Technic artifacts found inside this repository

`zdqiujpeewtyhtcqhdcj` ("Mas Technic Site") is a **separate, unrelated project**.
It is not a second environment for Mobile_Uygulama and not an alternative
backend. The following files inside this repository belong to it or point at it:

| Artifact | Evidence | Disposition |
|---|---|---|
| `backend/supabase/.temp/linked-project.json` | `{"ref":"zdqiujpeewtyhtcqhdcj","name":"Mas Technic Site"}` | Separation proposal — Phase 2C |
| `backend/supabase/.temp/project-ref` | `zdqiujpeewtyhtcqhdcj` | Separation proposal — Phase 2C |
| `backend/.env.local:3-4` | `SUPABASE_URL` + **service-role key** for `zdqiujpeewtyhtcqhdcj` | **Foreign secret.** Report + relocation proposal only. **No rotation** — that belongs to Mas Technic's owner |
| `backend/supabase/functions/.env.local` | duplicate Notion OAuth client id/secret | Ownership unresolved — §2b |

### Operations performed against Mas Technic: none

No resume, no deploy, no migration, no key rotation, no database change and no
edge-function change was performed on `zdqiujpeewtyhtcqhdcj`. Every live call in
Phase 0C — `restore_project`, `get_project`, `list_edge_functions`,
`get_edge_function`, `execute_sql`, `apply_migration`, `get_advisors` — targeted
`kbcuolhjjnmhjaarxxmu` only. The sole read of Mas Technic data was reading its
`linked-project.json` from local disk.

## 1b. Files requiring ownership classification

Everything under `backend/supabase/functions/` — classified in §2b below.

---

## 2. Edge functions — repo trees vs live deployment

### What is actually deployed on `kbcuolhjjnmhjaarxxmu`

| Function | Version | `verify_jwt` | Status |
|---|---|---|---|
| `generate-routine` | **11** | true | ACTIVE |
| `spotify-auth` | 2 | **false** | ACTIVE |
| `notion-auth` | 1 | **false** | ACTIVE |
| `notion-sync` | 1 | true | ACTIVE |
| `subscription-webhook` | 1 | **false** | ACTIVE |

### What each repo tree contains

| Function | `supabase/` | `backend/supabase/` | Deployed | Required by client |
|---|---|---|---|---|
| `generate-routine` | 142 ln, **2 modes** | 196 ln, **4 modes** | v11 | `coach`, `routine`, `summarize`, `insights` |
| `notion-auth` | 136 ln | 341 ln (+creates Notion DBs) | v1 | yes |
| `notion-sync` | **absent** | 119 ln | v1 | `notionStore.ts:212` |
| `spotify-auth` | 210 ln | **absent** | v2 | `spotifyStore.ts:39` |
| `subscription-webhook` | 84 ln | **absent** | v1 | RevenueCat (external) |
| `google-auth` | **absent** | 129 ln | **NOT DEPLOYED** | `googleCalendarStore.ts:34,62,78,109` |

**The live deployment is the union of both trees. Neither tree alone can serve
the application.** This is why the two directories drifted — functions were
deployed piecemeal from whichever tree had them.

### Confirmed defect — Google Calendar is broken in production

`store/googleCalendarStore.ts` calls `${SUPABASE_FUNCTIONS_URL}/google-auth` for
`status` (`:34`), `url` (`:62`), `callback` (`:78`) and `disconnect` (`:109`).
**`google-auth` is not in the deployed function list.** Every Google Calendar
operation returns 404. Severity **P1**; the integration is advertised as
`available` in `constants/integrations.ts:53`.

### Mode mismatch — `supabase/generate-routine` is the older function

`app/screens/ai-coach.tsx:130` sends `mode: 'summarize'` and
`app/screens/journal-insights.tsx:68` sends `mode: 'insights'`.

- `supabase/functions/generate-routine/index.ts:7` — `COST = { coach: 5, routine: 25 }`, and `:42` treats anything not `'coach'` as `'routine'`.
- `backend/supabase/functions/generate-routine/index.ts:8` — `COST = { coach: 5, routine: 25, summarize: 3, insights: 5 }`.

Against the `supabase/` version, `summarize` and `insights` would be **charged
25 Focus Points instead of 3 and 5**, and receive a routine-generation prompt.
Deployed version 11 must therefore be the `backend/` lineage. **The file in
`supabase/functions/generate-routine/` does not match production.**

## 2b. Ownership classification of `backend/supabase/functions/`

Read-only classification. **No file was moved, deleted or deployed.** Presence in
`backend/supabase/` is not by itself evidence of ownership; each file was tested
against two questions — does Mobile_Uygulama code call it, and does its data
model match the canonical live schema?

| File | Called by Mobile_Uygulama? | Schema compatible with canonical? | Classification |
|---|---|---|---|
| `notion-sync/index.ts` | **Yes** — `notionStore.ts:212` | **Partially — habits path broken** | **Mobile_Uygulama, misplaced, incompatible → re-implement** |
| `generate-routine/index.ts` | **Yes** — 4 modes sent, this is the only 4-mode version | Uses RPCs that exist (`get_or_init_subscription`, `spend_focus_points`) | **Mobile_Uygulama, misplaced → re-implement** |
| `google-auth/index.ts` | **Yes** — `googleCalendarStore.ts:34,62,78,109` | **No — target table does not exist** | **Mobile_Uygulama, misplaced, never provisioned → re-implement** |
| `notion-auth/index.ts` (341 ln) | Endpoint yes, this version no | **No — writes `parent_page_id`, which does not exist** | **Legacy / superseded** |

### Evidence — `notion-sync`

The deployed v1 on the canonical project was retrieved with `get_edge_function`
and is **substantively the same file** as `backend/supabase/functions/notion-sync/index.ts`.
It reads:

```ts
supabase.from('habit_logs').select('habit_id, state, xp, value, target_value').eq('date', syncDate)
```

Canonical live `habit_logs` columns are:
`id, habit_id, user_id, completed_at, is_completed, current_streak, notes, mood_rating, created_at, photo_url, voice_note_url, caption, value, is_makeup, state, xp`.

- `date` — **does not exist** (canonical name is `completed_at`)
- `target_value` — **does not exist** on `habit_logs` (it is a `habits` concept)

The tasks path, by contrast, is fully compatible: `tasks` has
`title, status, priority, due_date, completed, user_id` — all present.

**Confirmed production defect:** Notion sync returns `success: true` with
`synced_habits: 0` while silently syncing no habits at all. Tasks sync works.
Severity **P1**. It is owned by Mobile_Uygulama and must be **rewritten against
the real schema**, not copied.

### Evidence — `google-auth`

- `googleCalendarStore.ts` calls `${SUPABASE_FUNCTIONS_URL}/google-auth` for `status` (`:34`), `url` (`:62`), `callback` (`:78`), `disconnect` (`:109`).
- **Not present** in the canonical project's deployed function list.
- Its target table `google_calendar_integrations` — **does not exist** in the canonical database, despite being defined in canonical `supabase/migrations/002_integrations.sql:19-29`. That migration was never applied.

So the *intent* is Mobile_Uygulama's — the migration lives in the canonical tree
and the canonical client calls it — but the feature was **never provisioned**.
Every Google Calendar operation currently returns 404. Severity **P1**.

Re-implementation must create the table via a canonical migration and write the
function fresh under `supabase/functions/`, with no Mas Technic project
reference, connection or secret carried over.

### Evidence — `notion-auth` (341-line version)

Writes `parent_page_id` at `:207`. Canonical live `notion_integrations` columns
are `id, user_id, access_token, workspace_id, workspace_name, workspace_icon,
bot_id, habits_database_id, tasks_database_id, habits_url, tasks_url,
created_at, updated_at` — **no `parent_page_id`**. This version cannot be the
deployed one and is incompatible with the canonical schema.
Classification: **legacy / superseded**. Separation proposal only; no deletion
without approval.

### Consequences

- `supabase/functions/` is canonical but **incomplete and partly stale**: its `generate-routine` supports 2 modes while the app sends 4, so that file does not match production either.
- **Nothing is copied forward.** Phase 1D re-implements `notion-sync`, `generate-routine` and `google-auth` under `supabase/functions/` against the verified live schema, decoupled from all Mas Technic references.
- **No `supabase functions deploy` runs from `backend/supabase/`, ever.**

---

## 3. Live database — 48 tables

Migrations describe **7**. The live database has **48**. The gap is the
gamification and calendar subsystems, applied by hand via `execute_sql`
(`implementation.md:159` states this explicitly).

**RLS is enabled on all 48 tables.** `pg_tables.rowsecurity = true` for every one.

### Advisor summary — 164 lints, **zero at ERROR level**

| Level | Lint | Count |
|---|---|---|
| WARN | `pg_graphql_authenticated_table_exposed` | 48 |
| WARN | `anon_security_definer_function_executable` | 32 |
| WARN | `authenticated_security_definer_function_executable` | 32 |
| WARN | `pg_graphql_anon_table_exposed` | 27 |
| WARN | `function_search_path_mutable` | 23 |
| WARN | `auth_leaked_password_protection` | 1 |
| INFO | `rls_enabled_no_policy` | 1 |

**No table is missing RLS and no policy is broken.** The pre-restore fear that
~21 tables might be unprotected is **disproven**.

### Policy distribution

| Category | Tables |
|---|---|
| RLS on, **zero policies** (fail-closed) | `spotify_accounts` |
| `USING (true)` — **SELECT only**, shared catalogues | `boss_contributors`, `challenges`, `global_bosses`, `habit_templates`, `pet_stages`, `quests`, `shop_items`, `skills` |
| Policies granted to `anon` role | **none** |
| Owner-scoped (`auth.uid()`) | all remaining 39 |

`spotify_accounts` having RLS with no policy is **safe** — it denies all client
access. `spotify-auth` reaches it with the service-role key
(`spotify-auth/index.ts:12`), which bypasses RLS. Correct by design, but implicit;
worth an explicit comment.

The eight `true` policies are all `cmd = SELECT` on read-only reference data
(bosses, quests, shop items, skills, pet stages, habit templates). **Legitimate
public catalogue reads, not a leak.**

---

## 4. Constraints the client depends on — verified

| Constraint client assumes | Live reality | Verdict |
|---|---|---|
| `habit_logs (user_id, habit_id, completed_at)` | `UNIQUE (habit_id, completed_at)` — no `user_id`, but `habit_id` implies owner | **EXISTS** (different shape, functionally sufficient) |
| `journal_entries (user_id, date)` | `UNIQUE (user_id, date)` | **EXISTS** — matches `journalStore.ts:48` `onConflict` |
| `life_area_logs (user_id, date, area)` | `UNIQUE (user_id, date, area)` | **EXISTS** — matches `lifeAreasStore.ts:84` |
| `willpower_state (user_id, state_date)` | `PRIMARY KEY (user_id, state_date)` | **EXISTS** — the no-`onConflict` upsert falls back to this PK and is therefore correct |
| `recovery_plans (habit_id, source_date)` | only `PRIMARY KEY (id)` | **ABSENT** — duplicate telafi plans are possible |

### Corrections to the pre-restore assessment

Three concerns raised before the database was reachable do **not** hold:

1. **Duplicate habit logs — corrected.** `UNIQUE (habit_id, completed_at)`
   exists, so a double-tap cannot create a second row. The real defect is
   different and narrower: `logStore.ts:71-84` destructures only `{ data }` and
   **never reads `error`**, so the constraint violation is swallowed silently and
   the UI shows nothing happening. Fix is error handling plus `upsert`, not a new
   constraint. Severity drops from data-corruption to UX.
2. **`willpower_state` upsert — corrected.** The missing `onConflict` is
   harmless because the live PK is exactly `(user_id, state_date)`. No duplicate
   rows, no silent budget reset.
3. **`recovery_plans` duplicates — confirmed.** No unique constraint. This one
   stands as originally assessed.

---

## 5. Server-side XP and streaks — a significant correction

`habit_logs` carries three triggers:

| Trigger | Timing | Function |
|---|---|---|
| `trg_habit_log_set_xp` | **BEFORE** | `fn_habit_log_set_xp` |
| `trg_habit_log_award` | AFTER | `fn_habit_log_award` |
| `on_habit_completed_damage_boss` | AFTER | `trigger_damage_on_habit_log` |

`fn_habit_log_set_xp` ends with:

```sql
NEW.xp := greatest(v_award, COALESCE(OLD.xp, 0));
```

**The client-supplied `xp` is unconditionally overwritten.** The server derives
it from `habit_xp_value(habit_id, state, value)`, which weighs `difficulty`,
`impact_level`, `behavior_type`, `tracking_type`, `estimated_minutes`,
`daily_goal` and frequency kind, then applies a streak multiplier
(×1.2 at 10 days, ×1.5 at 30).

This **disproves three earlier findings**:

| Earlier claim | Reality |
|---|---|
| "XP is client-authored and trivially spoofable" | **False.** A BEFORE trigger overwrites it. |
| "`baseXp` is a flat 30, ignoring difficulty and willpower_cost" | True of the client function, but **irrelevant** — the value is discarded. |
| "Partial XP is unclamped: `value=200, target=100` yields 60 XP vs 30 for done" | **False.** `habit_xp_value` clamps: `least(v_base_xp, round(v_base_xp * (p_value/daily_goal)))`. |

What remains is a real but much smaller defect: `logStore.ts:21-27` computes an
XP value that the server will not use, so the **optimistic UI shows a number that
differs from the stored one until the next refetch**. Classification: UX
inconsistency, not an integrity or security issue. Phase 1B.

`habits.streak_current` exists and is read by the trigger, so **streaks are also
server-maintained** — not missing, as a frontend-only reading suggested.

---

## 6. RPC security posture

40 functions in `public`. 35 are `SECURITY DEFINER`.

| Property | Count | Assessment |
|---|---|---|
| `SECURITY DEFINER` with `search_path` pinned | 18 | correct |
| `SECURITY DEFINER` with **`search_path` NOT pinned** | 17 | **hardening gap** — 23 flagged by the advisor including non-DEFINER ones |
| Subscription mutators locked to service-role | 2 | `activate_subscription`, `expire_subscription` — `(none)` client grants. Correct. |

Unpinned `SECURITY DEFINER` functions include `buy_shop_item`,
`claim_quest_reward`, `upgrade_skill`, `deal_damage_to_active_boss`,
`log_makeup_completion`, `check_and_award_badges`, `get_global_leaderboard`,
`get_weekly_leaderboard`, `track_weekly_xp`, `process_habit_xp`.

Exploiting a mutable `search_path` requires the ability to create objects in a
schema earlier on the path, which `authenticated` does not have by default in
Supabase. **Severity P2, not P0** — a hardening task for Phase 1D, not an
emergency.

---

## 7. Emergency Gate 0 — resolved to PASS and applied

`mock_activate_subscription(p_tier text, p_period text)` was live,
`SECURITY DEFINER`, with `EXECUTE` granted to `PUBLIC`, `anon` and
`authenticated`. Its body:

```sql
IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
grant_amt := CASE p_tier WHEN 'plus' THEN 100 WHEN 'pro' THEN 1000 ELSE 30 END;
UPDATE public.user_subscriptions
  SET tier=p_tier, status='active', monthly_grant=grant_amt,
      focus_points=grant_amt, sub_period_end=pend, provider='mock' ...
```

Any authenticated user could call `mock_activate_subscription('pro','yearly')`
and receive Pro for a year with 1000 Focus Points — a complete payment bypass.
All five Emergency Gate 0 criteria were met once the project was reachable.

**Applied** as migration `emergency_gate_0_revoke_mock_activate_subscription`:

```sql
REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM authenticated;
```

Verified after: `authenticated_can_execute = false`, `anon_can_execute = false`,
client grants `(NONE - revoked)`. The definition is retained for local use.

**Rollback (one statement):**
```sql
GRANT EXECUTE ON FUNCTION public.mock_activate_subscription(text, text)
  TO authenticated, anon, PUBLIC;
```

**Known side effect:** `app/screens/paywall.tsx:30` `activateMock` now fails with
permission-denied. Gating that call behind `__DEV__` is the second half of the
fix and is a code change assigned to Phase 1D. **Independent skeptical review of
this change is outstanding** and is recorded as a Gate B input.

---

## 8. Schema drift — the structural problem

`supabase db reset` from `supabase/migrations/` produces a database the app
**cannot run against**:

| Drift | Detail |
|---|---|
| Missing tables | 41 of 48 |
| Missing RPCs | all 40 |
| Missing triggers | all 9 |
| Renamed columns | `type`→`tracking_type`, `target_value`→`daily_goal`, `frequency`→`frequency_config`, `habit_logs.date`→`completed_at`, `willpower_state.date`→`state_date` |
| Contradictory CHECK | `001:20` rejects `status='idea'`, which the client writes (`lib/supabase.ts:55`) |

There is no reproducible environment and no review gate on schema changes.
Phase 1A resolves this with a **three-way diff** (migrations / live / code
expectations) rather than a blind dump.

---

## 9. Phase 0C exit criteria

| Criterion | Status |
|---|---|
| Canonical baseline recorded (project + directory) | **Met** — §1 |
| Foreign Mas Technic artifacts identified | **Met** — §1a |
| Files requiring ownership classification listed | **Met** — §1b, classified in §2b |
| Every `backend/supabase/` file classified | **Met** — §2b, with call-site and schema evidence for each |
| Live RLS documented per table | **Met** — §3, all 48 tables |
| Unique constraints confirmed | **Met** — §4 |
| RPC `prosecdef` / `proconfig` captured | **Met** — §6 |
| Emergency Gate 0 resolved | **Met** — PASS, applied and verified (§7) |
| No operation performed against Mas Technic | **Met** — §1a; every live call targeted `kbcuolhjjnmhjaarxxmu` |
| Nothing moved, deleted or deployed | **Met** — classification is read-only; no `db push`, `migration up` or `functions deploy` was run from any directory |
