# ATLAS — RLS SEMANTIC MATRIX

**Project:** `kbcuolhjjnmhjaarxxmu` (canonical) · **Date:** 2026-08-30
**Method:** two disposable users (A, B) and an anonymous client, driven through
PostgREST with real JWTs — the same path the app takes, RLS enforced.
**No result here comes from a service-role query.** An admin connection bypasses
policies, so it can only prove a table exists, never that it is protected.

Test users were created and removed within the run. Row counts before and
after are identical (users 3, profiles 3, habits 6, habit_logs 13, pets 3).

---

## 1. Why policy counting is not an audit

The previous pass flagged `spotify_accounts` as a defect because it had zero
policies. That reasoning would have made an OAuth refresh-token table readable
by any client holding the user's JWT — a security *regression* bought for a
tidier number. Conversely, a table with four CRUD policies can still be wide
open if the expressions are `true`.

Every table below is therefore classified by **what it is for**, and the
verdict is drawn from an observed request, not from a count.

| Class | Meaning | Correct posture |
|---|---|---|
| **A · owner-scoped client table** | The user's own records, read and written by the app | RLS on, every policy scoped to `auth.uid()` |
| **B · server-only, fail-closed** | Secrets/tokens reached only by an edge function via the service role | RLS on, **zero** client policies |
| **C · public catalog** | Static reference data, identical for everyone | RLS on, SELECT-only, readable by all |
| **D · server-written ledger** | Written by server/RPC, read by its owner | RLS on, SELECT-only for the client |

---

## 2. Results

50 public tables. **All 50 have `relrowsecurity = true`.**

### 2.1 Class B — server-only, fail-closed (2)

| Table | RLS | Policies | Client reach | Verdict |
|---|---|---|---|---|
| `spotify_accounts` | on | **0** | none — B read: 0 rows; anon: `42501` | **CORRECT BY DESIGN** |
| `google_calendar_integrations` | on | **0** | none — B read: 0 rows; anon: `42501` | **CORRECT BY DESIGN** |

Both hold OAuth `refresh_token`s. Zero policies denies every client outright,
including the owner; the tokens are reached only by `spotify-auth` /
`google-auth` through the service role, after the function has verified the
caller itself. Frontend references: **0** (`grep -rn spotify_accounts frontend/`).

**Do not add owner-scoped CRUD policies to these tables.** It would expose a
long-lived credential to any holder of that user's JWT.

### 2.2 Class A — owner-scoped client tables (39)

`ai_calls`, `boss_contributors`, `calendars`, `credit_transactions`,
`daily_capacity`, `deep_work_sessions`, `event_templates`, `events`,
`focus_sessions`, `focus_tasks`, `goals`, `habit_deletions`, `habit_logs`,
`habit_reminders`, `habits`, `journal_entries`, `journal_insights`,
`key_results`, `life_area_logs`, `notes`, `notion_integrations`, `okrs`,
`profile_badges`, `profiles`, `projects`, `reading_list`, `recovery_plans`,
`reminders`, `routine_items`, `routines`, `tasks`, `user_challenges`,
`user_gamification`, `user_inventory`, `user_pets`, `user_quests`,
`user_skills`, `user_subscriptions`, `weekly_reviews`, `weekly_xp`,
`willpower_state`

**Leakage sweep — user B owns nothing, so any row it sees belongs to someone
else.** The project holds real data for three existing users, so this is a
live leak test rather than a self-test against empty tables.

| Check | Result |
|---|---|
| Foreign rows visible to B across all 39 tables | **0** |
| Tables where B saw only its own auto-provisioned row (`profiles`, `user_pets`) | 2, verified `id === B` |

**Targeted cross-user CRUD.** A creates a row, B attacks it:

| Table | B SELECT | B UPDATE | B DELETE | B INSERT as A |
|---|---|---|---|---|
| `habits` | BLOCKED (0) | BLOCKED (0) | BLOCKED (0) | BLOCKED `42501` |
| `tasks` | BLOCKED (0) | BLOCKED (0) | BLOCKED (0) | BLOCKED `42501` |
| `notes` | BLOCKED (0) | BLOCKED (0) | BLOCKED (0) | BLOCKED `42501` |
| `journal_entries` | BLOCKED (0) | BLOCKED (0) | BLOCKED (0) | BLOCKED `42501` |
| `projects` | BLOCKED (0) | BLOCKED (0) | BLOCKED (0) | BLOCKED `42501` |
| `goals` | BLOCKED (0) | — | — | BLOCKED `42501` |
| `habit_logs` | BLOCKED (0) | — | — | BLOCKED `42501` (after §3) |

**`profiles` — the highest-value row in the schema** (it carries `email` and
`push_token`), checked separately:

| Check | Result |
|---|---|
| B lists profiles | 1 row, its own |
| B reads A's profile by id | 0 rows |
| B updates A's profile | 0 changed |

**Join-scoped tables** (no `user_id` of their own) were confirmed to scope
through their parent rather than being open:

| Table | Scoped via |
|---|---|
| `routine_items` | `routine_id IN (select id from routines where user_id = auth.uid())` |
| `habit_reminders` | `EXISTS (select 1 from habits where habits.id = habit_id and habits.user_id = auth.uid())` |
| `reminders` | `EXISTS (events JOIN calendars … calendars.user_id = auth.uid())` |
| `profiles` | `id = auth.uid()` |

### 2.3 Class C — public catalogs (7)

`global_bosses`, `pet_stages`, `quests`, `shop_items`, `skills`, `challenges`,
`habit_templates`

SELECT-only, no `user_id`, readable without a session. **This is intentional**
— they are static reference data with no personal content. The sweep script
flags anonymous visibility as `LEAK` by default; for these seven the
classification overrides that reading, and each was checked for personal
columns (none carry any).

### 2.4 Deliberate cross-user projection — the leaderboard

`get_global_leaderboard` and `get_weekly_leaderboard` are `SECURITY DEFINER`,
so they bypass RLS by construction. That is the point of a leaderboard, and
the question is what they expose:

```
returns: user_id, username, level, total_xp, willpower_rank, rank
         (+ weekly_xp)
```

**No `email`, no `push_token`, no free-form user content.** A minimal,
deliberate projection. Verified live from B's session.

---

## 3. Finding — and fix — `habit_logs` accepted foreign habit ids

Found live during this audit:

```
B: insert into habit_logs (habit_id = <A's habit>, user_id = B)  -> ACCEPTED
```

Every policy checked `user_id = auth.uid()`; none checked that `habit_id`
belonged to the caller.

**Severity: integrity, not disclosure.** The created row is owned by B, so A
never sees it (A's SELECT is user-scoped) and A's statistics are untouched.
What it permitted was a user polluting their own account, and the table, with
logs pointing at habits they cannot read. Stated plainly rather than inflated:
no cross-user data was readable through this.

Fixing it required changing **two** policies, not one. Permissive policies are
OR-ed, and `habit_logs` carried a blanket `ALL` policy with no `WITH CHECK` —
so Postgres used its `USING` expression as the insert check, and tightening
only the INSERT policy would have been OR-ed straight back open. The `ALL`
policy was redundant with the four per-command policies anyway.

`supabase/migrations/20260830_habit_logs_ownership_check.sql`, applied
2026-08-30:

| | before | after |
|---|---|---|
| `habit_logs` rows | 13 | **13 — untouched** |
| policies | 5 (`ALL` + 4 per-command) | **4, one per command** |

Verified live afterwards, including the regression side:

| Check | Result |
|---|---|
| owner can still INSERT a log for their own habit | **PASS** |
| owner can still UPDATE their own log | **PASS** (changed=1) |
| B attaches a log to A's habit | **BLOCKED `42501`** |
| B can still log its OWN habit | **PASS** |
| B can read A's logs | **0 rows** |

---

## 4. Open observations (not defects)

| # | Observation | Assessment |
|---|---|---|
| O-1 | `weekly_xp` carries `SELECT USING (auth.role() = 'authenticated')` — any signed-in user can enumerate every user's weekly XP directly | Unnecessary surface: the client never reads this table directly (`grep`: 0 direct reads), the leaderboard goes through the SECURITY DEFINER RPC. Removing the policy would reduce exposure without changing behaviour. Left in place because it is not a defect and removing a policy needs its own verification pass. |
| O-2 | `boss_contributors` carries `SELECT USING (true)` | Same shape as O-1. `anon` is denied by table grant, so only authenticated enumeration is possible; contents are `boss_id, user_id, total_damage` — no personal content. |
| O-3 | `tasks` has **3** overlapping `ALL` policies with equivalent expressions | Not a hole; a drift risk. Whichever is edited, the others still apply. |
| O-4 | Anonymous access is denied two different ways: 21 tables reject with `42501` (no table grant), 22 return 200 with 0 rows (grant present, RLS filters) | Both are safe today. The `42501` posture is strictly stronger, since it does not depend on a policy being correct. Worth normalising. |

---

## 5. Verdict

| Question | Answer |
|---|---|
| RLS enabled on every public table? | **Yes — 50/50** |
| Any cross-user data readable? | **No** — 0 foreign rows across 39 owner-scoped tables |
| Any cross-user write possible? | **No** — every UPDATE/DELETE/foreign-INSERT blocked |
| Anonymous access to personal data? | **No** — denied or empty on all 43 non-catalog tables |
| Token tables client-reachable? | **No** — fail-closed, 0 policies, by design |
| Leaderboard exposure | `username`/`level`/`xp`/`rank` only |
| Defects found | 1 (`habit_logs` foreign habit id) — **fixed and re-verified live** |

**RLS status: PASS.**


---

## Appendix A — AI Coach conversation tables (added 2026-09-08)

The audit above is a point-in-time record of 50 tables and is left as it was
written. Three tables were added afterwards by
`supabase/migrations/20260908_ai_conversations.sql` (durable AI Coach threads),
so they are verified here by the same method: two disposable users driven
through PostgREST with real JWTs, plus an anonymous client. No result below
comes from a service-role query.

| Table | Class | RLS | Client policies |
|---|---|---|---|
| `ai_conversations` | A · owner-scoped | on | SELECT / INSERT / UPDATE / DELETE, all `auth.uid() = user_id` |
| `ai_messages` | A · owner-scoped, **append-only** | on | SELECT / INSERT / DELETE — **no UPDATE policy, and UPDATE revoked from `authenticated`** |
| `ai_conversation_actions` | A · owner-scoped | on | SELECT / INSERT / UPDATE / DELETE, all `auth.uid() = user_id` |

**Live results** (A owns the rows, B attacks them):

| Check | Result |
|---|---|
| B reads A's conversations | **0 rows** |
| B reads A's messages | **0 rows** |
| B renames A's conversation | **0 changed** |
| B deletes A's conversation | **0 deleted** |
| B inserts a message into A's conversation | **BLOCKED `42501`** |
| B inserts a row carrying A's `user_id` | **BLOCKED `42501`** |
| A files a conversation under **B's** project | **BLOCKED `42501`** |
| anonymous client, all three tables | **BLOCKED `42501`** at the table grant |

Two properties are specific to this feature rather than to RLS, and were
proven in the same run:

| Check | Result |
|---|---|
| second assistant row for the same `(conversation_id, request_id)` | **blocked** by the partial unique index |
| user row sharing that `request_id` with its assistant row | **allowed** (the index is partial on purpose) |

Probe rows were removed inside the run; all three tables were left at 0 rows.

**Why `ai_messages` has no UPDATE.** A transcript is the record of what was
said, and it is also the exact text the edge function replays to the model as
history. If a row could be edited after the fact, "what did the model actually
see" would stop being answerable. RLS refuses it (no policy) and the grant
refuses it too, so neither alone is load-bearing.

**Project assignment does not create a second project concept.** A conversation
points at an existing `public.projects` row, and the INSERT/UPDATE policies
require that project to belong to the caller — checked in the policy rather
than in a `CHECK` constraint, because a constraint cannot see another table.
