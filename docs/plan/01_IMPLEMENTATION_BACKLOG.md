# 01 — Implementation Backlog

**Status:** **FINAL for Phase 1** (rewritten at Gate B remediation, C1)
**Tasks:** 31 · 1 DONE · 30 open · **0 XL** · largest **L**
**Metrics source:** `08_CANONICAL_METRICS.md` — no count is restated here

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

## 1A-002 · Write the squashed baseline migration
`P1` · **MUST** · Supabase & Security · depends_on: 1A-001, **H-01 user decision** · **M**

**scope** (2 files): `supabase/migrations/<ts>_baseline_schema.sql` · `supabase/migrations/README.md`

**goal** One migration that reproduces the current live schema from empty, so `db reset` yields a database the app runs against.

**acceptance_criteria**
- Baseline creates every live table, column, constraint, index, RPC, trigger and policy identified in 1A-001
- The two Emergency Gate 0 migrations (`20260802181931`, `20260802205850`) are **preserved as separate files after the baseline**, not folded into it
- `001_initial_schema.sql` and `002_integrations.sql` moved to `supabase/migrations/archive/` with a README explaining they predate the drift
- Baseline header records: generation date, source project ref, and that it is a squash rather than a history
- **Not applied to live** in this task

**validation** `supabase db reset` on a local stack completes without error; `supabase db diff --linked` reports no differences.

**risk** HIGH — an omission produces a schema that looks right and is not.
**rollback** Delete the new file; restore `001`/`002` from `archive/`. Nothing live changed.

---

## 1A-003 · Verify local reset and register the ledger
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **S**

**scope** (1 file): `docs/audit/11_SCHEMA_RESET_VERIFICATION.md`

**goal** Prove the baseline reproduces a working database, and record how it is registered against the 21-row live ledger without re-running DDL on live.

**acceptance_criteria**
- `supabase db reset` produces a schema whose table/column/RPC/trigger inventory matches the live inventory captured in 1A-001
- Schema-hash comparison recorded (e.g. sorted `information_schema` digest) for local vs live
- The **live cutover procedure is documented but NOT executed**: `supabase migration repair --status applied <baseline-version>` so live is marked as having the baseline without re-creating 48 existing tables
- Document states the data-backup requirement that must precede any live cutover

**validation** Reset transcript attached; hash comparison shown; no live command run.

**risk** MEDIUM — a mismatch means 1A-002 is incomplete.
**rollback** N/A — documentation only.

---

# Phase 1B — Dates, scheduling and metrics

## 1B-001 · Create the canonical date module
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

**scope** (2 files): `frontend/lib/date.ts` (new) · `frontend/__tests__/lib/date.test.ts` (new)

**goal** One module that is the only place a calendar date is derived.

**acceptance_criteria**
- Exports `todayLocal()`, `ymd(d)`, `startOfWeekLocal(d)`, `parseLocalDate(s)`
- Every function is pure and accepts an injectable `now` where a clock is needed
- `todayLocal()` returns the device's local calendar date at **00:30** and at **23:30** under `TZ=Europe/Istanbul`
- No function uses `toISOString()` to derive a calendar date

**validation** `TZ=Europe/Istanbul npx jest lib/date` — green.
**risk** LOW — additive, nothing consumes it yet.
**rollback** Delete both files.

---

## 1B-002 · Route all date derivation through `lib/date.ts`
`P1` · **MUST** · Habit Domain · depends_on: 1B-001 · **M**

**scope** (5 files): `frontend/store/taskStore.ts` · `frontend/store/deepWorkStore.ts` · `frontend/store/lifeAreasStore.ts` · `frontend/lib/focusReport.ts` · `frontend/lib/journalStats.ts`

> Store-layer sites only. `frontend/lib/demoSeed.ts` is **1B-006**; the four further store files are **1B-007**; the 10 sites in `frontend/app/**` are **1B-008**. Split because `app/**` has a different owner.

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

**scope** (2 files): `frontend/lib/habitSchedule.ts` · `frontend/__tests__/lib/habitSchedule.test.ts` (new)

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

**scope** (2 files): `frontend/lib/reportMetrics.ts` · `frontend/__tests__/lib/reportMetrics.test.ts` (new)

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

**scope** (2 files): `frontend/store/logStore.ts` · `frontend/__tests__/store/logStore.test.ts` (new)

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

## 1B-006 · Gate the demo-data seeder — see **DEMO-001** below
Cross-listed for sequencing only. Full specification is `DEMO-001`.

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **M**

**scope** (2 files): `supabase/migrations/<ts>_willpower_atomic_debit.sql` · `supabase/tests/willpower.test.sql`

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
`P1` · **MUST** · Habit Domain · depends_on: 1C-001 · **S**

**scope** (2 files): `frontend/store/willpowerStore.ts` · `frontend/store/habitStore.ts`

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **M**

**scope** (2 files): `supabase/migrations/<ts>_recovery_completion_writes_log.sql` · `supabase/tests/recovery.test.sql`

> **Ownership note (Gate B remediation C7):** the client half — `frontend/store/recoveryStore.ts` — is **1C-006**, owned by Habit Domain. Supabase & Security does not edit `frontend/**`.

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **XS**

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002, **1D-000** · **S**

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **M**
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
**scope** (3 files): `supabase/functions/notion-auth/index.ts` · `supabase/functions/spotify-auth/index.ts` · `supabase/migrations/<ts>_oauth_state.sql`
**goal** Close the account-linking CSRF — `state` is minted in every flow and never checked.
**acceptance_criteria** `state` is persisted server-side with the user and a TTL · callback rejects a missing/unknown/expired/foreign `state` · single-use.
**validation** `supabase test db`; a replayed `state` is rejected.
**risk** MEDIUM — breaks in-flight OAuth sessions on deploy. **rollback** `git revert` + `DROP TABLE`.

## 1D-006 · Redirect-URI allowlist
`P1` · **MUST** · Supabase & Security · depends_on: Gate B PASS · **S**
**scope** (2 files): `supabase/functions/notion-auth/index.ts` · `supabase/functions/spotify-auth/index.ts`
**goal** Stop caller-controlled `redirect_uri` being embedded in the authorize URL.
**acceptance_criteria** A fixed allowlist is checked before use · non-allowlisted values are rejected with 400 · the app's real scheme is on the list.
**validation** a crafted `redirect_uri` returns 400.
**risk** MEDIUM — a missing entry breaks a live flow. **rollback** `git revert`.

## 1D-007 · Require an authenticated user in the Notion callback
`P1` · **MUST** · Supabase & Security · depends_on: Gate B PASS · **S**
**scope** (1 file): `supabase/functions/notion-auth/index.ts`
**goal** The callback currently proceeds with `user = null` and still creates pages in a third-party workspace.
**acceptance_criteria** Callback returns 401 without a valid user · no third-party side effect occurs before authentication · `verify_jwt` reviewed and recorded.
**validation** unauthenticated callback → 401, no Notion write.
**risk** LOW. **rollback** `git revert`.

## 1D-008 · Webhook idempotency
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **M**
**scope** (2 files): `supabase/functions/subscription-webhook/index.ts` · `supabase/migrations/<ts>_webhook_idempotency.sql`
**goal** RevenueCat retries currently re-grant credits in normal operation.
**acceptance_criteria** `provider_ref` is unique · a replayed event is a no-op returning 200 · the first delivery still grants.
**validation** `supabase test db` — AC-S16 passes.
**risk** MEDIUM. **rollback** `git revert` + `DROP CONSTRAINT`.

## 1D-009 · Wrong-project deploy guard
`P1` · **MUST** · Repository Audit · depends_on: Gate B PASS · **XS**
**scope** (2 files): `supabase/config.toml` (new) · `.github/workflows/guard.yml` or a `predeploy` script
**goal** Make it impossible to deploy this repo against `zdqiujpeewtyhtcqhdcj`.
**acceptance_criteria** Canonical `project_id` pinned in config · a pre-deploy check aborts on any other ref · documented.
**validation** a deploy attempt with a foreign ref aborts.
**risk** LOW. **rollback** delete the guard.

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **S**

**scope** (2 files): `supabase/migrations/<ts>_secure_add_xp.sql` · `supabase/tests/xp_security.test.sql`

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
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **S**

**scope** (2 files): `supabase/migrations/<ts>_secure_track_weekly_xp.sql` · `supabase/tests/xp_security.test.sql`

**signature (verified live):** `track_weekly_xp(p_user_id uuid, p_xp integer)` · `SECURITY DEFINER` · **`search_path` NOT pinned**

**goal** Same ownership defect, plus an unpinned `search_path` on a definer function referencing `weekly_xp` unqualified.

**acceptance_criteria** Ownership guard as SEC-1D-001 · `SET search_path = public` added · leaderboard still populates through the normal path · caller list confirmed before deciding whether the parameter can be dropped.
**validation** `supabase test db`; `proconfig` shows `search_path=public`.
**risk** MEDIUM.
**rollback** Restore the captured prior definition.

## SEC-1D-003 · Constrain and bound `deal_damage_to_active_boss`
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **M**

**scope** (2 files): `supabase/migrations/<ts>_secure_boss_damage.sql` · `supabase/tests/boss_security.test.sql`

**signature (verified live):** `deal_damage_to_active_boss(p_user_id uuid, p_damage integer DEFAULT 10)` · `SECURITY DEFINER` · `search_path` NOT pinned

**goal** Three defects: caller-supplied `user_id`; **unbounded** `p_damage` (one call zeroes boss HP and pays out to attacker-chosen contributors); and **negative** `p_damage`, which heals the boss and writes negative `total_damage`, corrupting the contribution leaderboard.

**acceptance_criteria** Ownership guard · `p_damage` clamped to a documented per-call maximum · `p_damage <= 0` rejected · `SET search_path = public` · trigger path still deals damage on habit completion.
**validation** `supabase test db`: cross-user raises · over-cap clamped or rejected · negative rejected · a single call cannot kill the boss · trigger still works.
**risk** MEDIUM.
**rollback** Restore the captured prior definition.

## SEC-1D-004 · Remove blanket write grants on the money tables
`P2` · SHOULD · Supabase & Security · depends_on: 1A-002 · **XS**

**scope** (1 file): `supabase/migrations/<ts>_revoke_money_table_grants.sql`

**goal** `anon` and `authenticated` hold `INSERT`, `UPDATE`, `DELETE` **and `TRUNCATE`** on `user_subscriptions` and `credit_transactions`. Only RLS default-deny stops I/U/D today, and `TRUNCATE` is not subject to RLS. Protection is incidental (no policy) rather than structural (no grant).

**acceptance_criteria** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` from `anon, authenticated` on both tables · `get_or_init_subscription`, `spend_focus_points` and the webhook path still work · client writes now fail at the grant layer.
**validation** `supabase test db` — AC-S12 still passes; grant introspection confirms the revoke.
**risk** LOW — verified nothing legitimate uses these grants.
**rollback** Re-`GRANT` the captured prior set.

## SEC-1D-005a · Profiles grant and policy design
`P1` · **MUST** · Supabase & Security · depends_on: 1A-002 · **S**

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

## 1E-L1 · jest-expo and unit tests
`P1` · **MUST** · QA & Test · depends_on: 1B-001, **1E-000** · **M**
**scope** (5 files): `frontend/jest.config.js` · `frontend/package.json` · `frontend/__tests__/lib/*.test.ts` · `frontend/__tests__/store/*.test.ts` · `frontend/jest.setup.js`
**goal** An executing unit suite covering the pure domain layer.
**acceptance_criteria** `npm test` and `npm run typecheck` exist and run · `TZ=Europe/Istanbul` pinned in config · all **14 failing L1 criteria** covered by a test that failed before its fix · no test asserts on UI copy · does not read `.env`.
**validation** `npm test` green; 14 previously-failing criteria now pass.
**risk** LOW. **rollback** delete config and tests.

## 1E-L2 · pgTAP and database tests
`P1` · **MUST** · QA & Test · depends_on: 1A-003, **1E-000** · **M**
**scope** (5 files): `supabase/tests/rls.test.sql` · `security_regression.test.sql` · `willpower.test.sql` · `recovery.test.sql` · `constraints.test.sql`
**goal** Prove the properties a client mock cannot.
**acceptance_criteria** `supabase test db` runs in one command · covers the **17 failing L2 criteria** · **AC-S01..S07 exist as permanent regression tests** for the two Emergency Gate 0 migrations · no RLS or RPC claim rests on a Layer 1 test.
**validation** `supabase test db` green.
**risk** LOW. **rollback** delete the test files.

---

# Cross-phase

## DEMO-001 · Gate the demo-data seeder
`P1` · **MUST** · Habit Domain · depends_on: Gate B PASS · **S**

> **Added at Gate B remediation (C5).** Found by the Gate B reviewer; missed by the Gate A audit, which asserted the opposite.

**scope** (3 files): `frontend/app/tabs/settings.tsx` · `frontend/lib/demoSeed.ts` · `docs/audit/13_DEMO_DATA_AUDIT.md`

**goal** `settings.tsx:339` renders a tappable row calling `handleSeedDemoData` → `seedDemoData()`. There is **no `__DEV__` guard anywhere in that file**. In a release build a user can write fabricated data into their real account.

**Access point:** `settings.tsx:30` imports `seedDemoData`; `:134` defines `handleSeedDemoData`; `:137` calls it; `:339` renders the row.

**Tables written by `demoSeed.ts`:** `projects`, `tasks`, `habits`, `habit_logs`, `focus_tasks`, `recovery_plans`, `journal_entries`.

**Collision risk with real user data**
- `habit_logs` rows pollute XP, streaks, completion percentages and the leaderboard — the exact metrics Phase 1B exists to make correct
- Seeded rows are indistinguishable from real ones: no `is_demo` flag, no marker column
- `demoSeed.ts:21` uses `toISOString().slice(0,10)`, so seeded dates are also UTC-skewed
- If a user seeds and then reports a metric bug, the data is unusable as evidence

**acceptance_criteria**
- `handleSeedDemoData` and its UI row are unreachable when `!__DEV__` — the button is not rendered, not merely disabled
- `seedDemoData()` returns early with an explicit error when `!__DEV__`, so a code path that bypasses the UI still cannot seed
- Prefer an explicit `EXPO_PUBLIC_DEMO_ENV` flag over bare `__DEV__` if the team wants seeding in a staging build; decide and document
- A release build contains no reachable path to `seedDemoData`
- Read-only audit plan written (below) — **no data is deleted by this task**

**Read-only detection plan for already-seeded data** (documented, not executed)
- `demoSeed.ts` uses recognisable literals (project names, habit names) — enumerate them
- Query per user: rows in the seven tables whose values match those literals **and** whose `created_at` clusters within one second
- Report counts per user; **propose** cleanup as a separate approved task
- Cleanup is **not** part of this task — deleting user rows on a heuristic is a data-loss risk

**validation** `grep -c "__DEV__" frontend/app/tabs/settings.tsx` ≥ 1 · a production build shows no seed row · `npx tsc --noEmit` clean.
**risk** LOW to implement; the audit plan must not become an automated delete.
**rollback** `git revert` — restores the current (unsafe) behaviour, so revert only with cause.

> `OPS-0B-001` is specified once, in the Phase 1D/OPS section above. A duplicate
> stub previously sat here and was removed at Gate B remediation.

---

## Task index

| Task | Phase | Agent | Size | Blocking dependency |
|---|---|---|---|---|
| 1A-001 | 1A | Supabase & Security | M | Gate B |
| 1A-002 | 1A | Supabase & Security | M | 1A-001 + **H-01** |
| 1A-003 | 1A | Supabase & Security | S | 1A-002 |
| 1B-001 | 1B | Habit Domain | S | Gate B |
| 1B-002 | 1B | Habit Domain | M | 1B-001 |
| 1B-003 | 1B | Habit Domain | S | Gate B |
| 1B-004 | 1B | Habit Domain | M | 1B-003 |
| 1B-005 | 1B | Habit Domain | S | Gate B |
| 1B-007 | 1B | Habit Domain | S | 1B-001 |
| 1B-008 | 1B | Expo Architecture | S | 1B-001 |
| 1C-001 | 1C | Supabase & Security | M | 1A-002 |
| 1C-002 | 1C | Habit Domain | S | 1C-001 |
| 1C-003 | 1C | Habit Domain | S | 1B-001 |
| 1C-004 | 1C | Supabase & Security | M | 1A-002 |
| 1C-005 | 1C | Supabase & Security | XS | 1A-002 |
| 1C-006 | 1C | Habit Domain | S | 1C-004, 1C-005 |
| 1D-000 | 1D | Supabase & Security | M | Gate B |
| 1D-001 | 1D | Supabase & Security | S | 1A-002, 1D-000 |
| 1D-002 | 1D | Supabase & Security | S | 1D-001 |
| 1D-003 | 1D | Supabase & Security | M | 1A-002 |
| 1D-004 | 1D | Supabase & Security | S | 1D-003 |
| 1D-005 | 1D | Supabase & Security | M | Gate B |
| 1D-006 | 1D | Supabase & Security | S | Gate B |
| 1D-007 | 1D | Supabase & Security | S | Gate B |
| 1D-008 | 1D | Supabase & Security | M | 1A-002 |
| 1D-009 | 1D | Repository Audit | XS | Gate B |
| ~~1D-010~~ | 1D | — | — | **DONE `42b64a0`** |
| SEC-1D-001 | 1D | Supabase & Security | S | 1A-002 |
| SEC-1D-002 | 1D | Supabase & Security | S | 1A-002 |
| SEC-1D-003 | 1D | Supabase & Security | M | 1A-002 |
| SEC-1D-004 | 1D | Supabase & Security | XS | 1A-002 |
| SEC-1D-005a | 1D | Supabase & Security | S | 1A-002 |
| SEC-1D-005b | 1D | Supabase & Security | S | SEC-1D-005a |
| SEC-1D-005c | 1D | Supabase & Security | S | SEC-1D-005a |
| SEC-1D-005d | 1D | Habit Domain | S | SEC-1D-005b |
| SEC-1D-005e | 1D | QA & Test | S | SEC-1D-005b |
| SEC-1D-005f | 1D | Supabase & Security | XS | SEC-1D-005b |
| 1E-000 | 1E | Open-Source Research | S | Gate B |
| 1E-L1 | 1E | QA & Test | M | 1B-001, 1E-000 |
| 1E-L2 | 1E | QA & Test | M | 1A-003, 1E-000 |
| DEMO-001 | 1 | Habit Domain | S | Gate B |
| OPS-0B-001 | 2C | Supabase & Security | XS | **H-03** |

**42 rows · 1 DONE (`1D-010`, closed in `42b64a0`) · 41 open · 0 XL · largest M.**

Every one of the 41 open tasks has a specification block above carrying all
six mandatory fields (`scope`, `goal`, `acceptance_criteria`, `validation`,
`risk`, `rollback`) plus its header line (`id`, `title`, `priority`,
`MUST/SHOULD/COULD`, `agent`, `depends_on`, `size`) — 13 fields in total.

`1B-006` is **not** a task. It is a cross-listing pointer that keeps the
demo-seeder visible in Phase 1B sequencing; the specification lives in
`DEMO-001`. It is deliberately absent from this index so it cannot be
double-counted.

The previous revision listed 31 and this table mistallied itself as 36 —
it counted its own rows as 36 when there were 37, and never expanded the
collapsed `SEC-1D-005a–f` row into the six tasks it stood for. Both errors
are corrected here. Remediation added `1D-000`, `1E-000`, `DEMO-001`,
`1B-007`, `1B-008`, and split `1C-004` into `1C-004` + `1C-006`.
