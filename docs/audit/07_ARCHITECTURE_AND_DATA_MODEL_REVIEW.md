# 07 — Architecture and Data Model Review

**Status:** `Verified` — live database captured 2026-08-02
**Phase:** 0C (canonical declaration + live capture)

> **This document is the single place where the canonical Supabase project and
> canonical edge-function tree are declared.** Phase 1D applies security fixes on
> the declared tree; Phase 2C physically retires the other. Neither re-opens the
> decision.

---

## 1. Supabase project connection matrix

| Signal | Value | Project |
|---|---|---|
| `frontend/.env` → `EXPO_PUBLIC_SUPABASE_URL` | `kbcuolhjjnmhjaarxxmu.supabase.co` | **App** |
| `supabase/.temp/linked-project.json` | `kbcuolhjjnmhjaarxxmu` — "Alışkanlık Uygulaması" | **App** |
| `backend/supabase/.temp/linked-project.json` | `zdqiujpeewtyhtcqhdcj` — "Mas Technic Site" | **Wrong** |
| `backend/supabase/.temp/project-ref` | `zdqiujpeewtyhtcqhdcj` | **Wrong** |
| `backend/.env.local:3-4` | `SUPABASE_URL` + service-role key for `zdqiujpeewtyhtcqhdcj` | **Wrong** |
| `implementation.md:534` webhook URL | `kbcuolhjjnmhjaarxxmu.supabase.co/functions/v1/subscription-webhook` | **App** |
| `supabase/config.toml` / `backend/supabase/config.toml` | **absent in both trees** | — |

Both projects sit in org `jiabjxuhjspbiythhexg` (`aydinogluomer@gmail.com's Org`),
plan **free**.

### DECLARATION 1 — canonical project

> **`kbcuolhjjnmhjaarxxmu` ("Alışkanlık Uygulaması") is the canonical Supabase
> project.** Every client call resolves against `EXPO_PUBLIC_SUPABASE_URL`, which
> points there. `zdqiujpeewtyhtcqhdcj` ("Mas Technic Site") is unrelated to this
> product and must never receive a deployment from this repository.

The project was `INACTIVE` (paused) at audit start and was restored during
Phase 0C. During restore `list_tables` briefly returned `{"tables":[]}`; a direct
query returned `FATAL: 57P03: the database system is starting up`, confirming
that empty result was **a restore artifact, not data loss**.

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

### DECLARATION 2 — canonical edge-function tree

> **`supabase/functions/` is the canonical tree**, because it is the only one
> linked to the canonical project and it holds `spotify-auth` and
> `subscription-webhook`.
>
> It is currently **incomplete**. Before it can be deployed as the source of
> truth it must absorb, from `backend/supabase/functions/`:
> 1. `generate-routine` — the 4-mode version (replacing the stale 2-mode file)
> 2. `notion-sync` — exists only there
> 3. `google-auth` — exists only there **and is not deployed at all**
>
> `notion-auth` requires a deliberate choice between the 136-line version and the
> 341-line version that also provisions Notion databases; the deployed v1 must be
> diffed against both before either is overwritten. Assigned to Phase 1D.
>
> **`backend/supabase/` is non-canonical.** It is retired in Phase 2C, only after
> the three functions above are ported. Until then, no `supabase functions
> deploy` runs from that directory.

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
| Connection matrix built | **Met** — §1 |
| Canonical project declared | **Met** — DECLARATION 1 |
| Canonical function tree declared | **Met** — DECLARATION 2 |
| Live RLS documented per table | **Met** — §3, all 48 tables |
| Unique constraints confirmed | **Met** — §4 |
| RPC `prosecdef` / `proconfig` captured | **Met** — §6 |
| Emergency Gate 0 resolved | **Met** — PASS, applied and verified (§7) |
| No deploy before declaration | **Met** — no `db push`, `migration up` or `functions deploy` was run |
