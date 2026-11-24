# Migrations

Files are named `NNN_description.sql`, numbered sequentially from `001`, and the
number **is the apply order**.

Before this, the directory mixed three conventions at once — `001_`/`002_`, full
CLI timestamps (`20260802181931_`), and hand-written dates with letter suffixes
(`20260906c_`). The worst part was not the inconsistency but that the dates
*lied about the order*: within a shared date, files sorted alphabetically, so
`20260831_ceiling_xp.sql` appeared before `20260831_focus_point_atomicity.sql`
when in fact atomicity was applied first, sixteen hours earlier. Reading the
directory top to bottom gave the wrong history.

The sequence below was rebuilt from the **actual** apply order recorded in
`supabase_migrations.schema_migrations` on the canonical project, not from the
old filenames.

## Order

| # | File | Applied as (remote ledger version) | Previous filename |
| --- | --- | --- | --- |
| 001 | `001_initial_schema.sql` | — (see note) | unchanged |
| 002 | `002_integrations.sql` | — (see note) | unchanged |
| 003 | `003_emergency_gate_0_revoke_mock_activate_subscription.sql` | `20260802181931` | `20260802181931_…` |
| 004 | `004_emergency_gate_0_revoke_client_exec_xp_functions.sql` | `20260802205850` | `20260802205850_…` |
| 005 | `005_phase1_core_engine.sql` | `20260830051844` | `20260825_phase1_core_engine.sql` |
| 006 | `006_google_calendar_integrations.sql` | `20260830125719` | `20260830_google_calendar_integrations.sql` |
| 007 | `007_habit_logs_ownership_check.sql` | `20260830145934` | `20260830_habit_logs_ownership_check.sql` |
| 008 | `008_child_row_ownership.sql` | `20260830164223` | `20260830_child_row_ownership.sql` |
| 009 | `009_retire_legacy_backend.sql` | `20260830203457` | `20260830_retire_legacy_backend.sql` |
| 010 | `010_focus_point_atomicity.sql` | `20260830214906` | `20260831_focus_point_atomicity.sql` |
| 011 | `011_monthly_reviews.sql` | `20260830220424` | `20260831_monthly_reviews.sql` |
| 012 | `012_xp_integrity.sql` | `20260830222157` | `20260831_xp_integrity.sql` |
| 013 | `013_recovery_vocabulary.sql` | `20260830224359` | `20260831_recovery_vocabulary.sql` |
| 014 | `014_recovery_vocabulary_compat_rollback.sql` | `20260831015202` | `20260831_recovery_vocabulary_compat_rollback.sql` |
| 015 | `015_ceiling_xp.sql` | `20260831084103` | `20260831_ceiling_xp.sql` |
| 016 | `016_xp_drift_survives_purge.sql` | `20260831085005` | `20260831_xp_drift_survives_purge.sql` |
| 017 | `017_revoke_ddl_grants.sql` | `20260831085112` | `20260831_revoke_ddl_grants.sql` |
| 018 | `018_lock_admin_functions.sql` | `20260831101109` | `20260831_lock_admin_functions.sql` |
| 019 | `019_user_onboarding.sql` | `20260905211823` | `20260906_user_onboarding.sql` |
| 020 | `020_user_onboarding_installing_status.sql` | `20260905233428` | `20260906b_…` |
| 021 | `021_onboarding_install_identity.sql` | `20260906013327` | `20260906c_…` |
| 022 | `022_onboarding_install_return_status.sql` | `20260906054935` | `20260906d_…` |
| 023 | `023_ai_request_idempotency.sql` | `20260906120240` | `20260906e_…` |
| 024 | `024_ai_request_privileges_and_lease.sql` | `20260906123146` | `20260906f_…` |
| 025 | `025_recovery_v2_vocabulary_release.sql` | `20260906151909` | `20260906g_…` |
| 026 | `026_ai_conversations.sql` | `20260908041021` + `20260908041055` | `20260908_ai_conversations.sql` |
| 027 | `027_account_deletion_cascade.sql` | `20260908133800` | `20260908b_…` |
| 028 | `028_habit_pauses_and_goal_versions.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 029 | `029_habit_checklists.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 030 | `030_routine_runner.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 031 | `031_moods_and_review_actions.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 032 | `032_coach_actions_v2.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 033 | `033_habit_log_timezone.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 034 | `034_coach_reminder_action.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 035 | `035_coach_lighten_week.sql` | **NOT APPLIED** (DB frozen, S1/S2) | — |
| 036 | `036_live_audit_hardening.sql` | **NOT APPLIED** (proposal from the read-only live audit 2026-10-09) | — |
| 037 | `037_today_bootstrap_rpc.sql` | **NOT APPLIED** (DB frozen, S1/S2 — single-RTT Today bootstrap RPC) | — |
| 038 | `038_xp_streak_integrity.sql` | **NOT APPLIED** (P0 XP/seri bütünlüğü; 036 önkoşul) | — |
| 039 | `039_focus_point_hardening.sql` | **NOT APPLIED** (DB frozen, S1/S2 — Focus Point credit integrity) | — |
| 040 | `040_privilege_hygiene.sql` | **NOT APPLIED** (DB frozen, S1/S2 — privilege, search_path & sensitive-column hygiene + F07-R3; 028–039 prerequisite) | — |
| 041 | `041_rls_initplan_and_indexes.sql` | **NOT APPLIED** (DB frozen, S1/S2 — RLS initplan wrapping, duplicate policies removed, FK indexes) | — |
| 042 | `042_numeric_measures_and_willpower.sql` | **NOT APPLIED** (DB frozen, S1/S2 — numeric(12,2) measurable columns & atomic spend_willpower RPC) | — |
| 043 | `043_profile_time_zone.sql` | **NOT APPLIED** (DB frozen, S1/S2 — profiles.time_zone, local-day window and week) | — |
| 044 | `044_ai_messages_and_retention.sql` | **NOT APPLIED** (DB frozen, S1/S2 — AI message insert policy + AI retention function) | — |
| 045 | `045_task_estimated_minutes.sql` | **NOT APPLIED** (DB frozen, S1/S2 — nullable tasks.estimated_minutes & estimate_source + get_today_bootstrap task projection) | — |

Keep this table when adding a migration: the old names are cited throughout
`docs/audit/`, `docs/plan/`, `PROGRESS.md` and the audit reports, which are
dated records and were **not** rewritten. This table is how those citations stay
resolvable.

### Note on 001 and 002

These two predate the migration ledger — they were run by hand in the Supabase
SQL editor. The ledger's nineteen earliest rows (`20260606075913` through
`20260614105030`) correspond to no local file, and conversely not everything in
`002_integrations.sql` was ever applied (`google_calendar_integrations` was
created later, by `006`). That gap is pre-existing and documented in
`docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md`; renumbering neither
created nor closed it.

### Source of truth for the live schema

`supabase/live_schema.sql` is the owner's `pg_dump` of the canonical project and the only complete
description of the live schema (58 tables, 51 functions). `001` and `002` cannot rebuild it on
their own: they are deltas on top of a base that was created by hand in the Supabase SQL editor
(see the note above), which is why CI builds its test database by applying `live_schema.sql` first
and `028+` after it. The migrations marked **NOT APPLIED** in the table above are NOT in
`live_schema.sql` until the owner applies them and dumps again.

`frontend/lib/database.types.ts` tags every table, RPC and late column `live` or
`migration:<NNN>`, and `frontend/__tests__/repo/databaseTypesDrift.test.ts` checks it against
these files in both directions. After every owner apply: refresh `live_schema.sql`, run the
frontend tests, and change the tags the drift test lists from `migration:<NNN>` to `live`. Never
edit an applied migration to silence a drift: add a new one.

## Rollbacks

Every `NNN_*.sql` from `028` on has a rollback script, `supabase/rollbacks/NNN_<name>.rollback.sql`
(`036_live_audit_hardening.sql` has `036_live_audit_hardening.rollback.sql`, `038_xp_streak_integrity.sql`
has `038_xp_streak_integrity.rollback.sql`, which runs before 036's). The scripts live
**outside** this directory on purpose: the Supabase CLI applies every `.sql` file it finds here
forward, so a rollback filed here would be run as if it were the next migration. A script does
nothing unless the same session first ran `SET aderyth.rollback_confirm = 'NNN';` with its own
number. Run them newest to oldest, take a backup first, and check `select * from public.xp_drift();`
before and after. CI proves the cycle on a throwaway Postgres 17 (apply, roll back, compare the
catalog with the baseline, apply again). Details: `supabase/rollbacks/README.md`. The migration
files themselves are never edited.

When you add a migration, add its rollback in the same commit; `migrationRollbackPresent.test.ts`
fails otherwise.

## Rules

**Numbers are append-only.** A new migration takes the next unused number. Never
renumber, reorder, or edit the SQL body of a migration that has already been
applied — the file is the record of what ran. To change something a past
migration did, add a new one that supersedes it (`014` supersedes `013`, `025`
re-applies it; that history is legible precisely because nothing was rewritten).

**Do not run `supabase db push` against the canonical project.** The remote
ledger is keyed by timestamp versions, and these files are keyed by sequence
numbers, so the CLI sees every local file as unapplied and would try to replay
all twenty-seven. This mismatch predates the renumbering (`20260825_phase1…` was
recorded as `20260830051844`) and renumbering does not change it. Migrations are
applied through the Supabase MCP `apply_migration` tool or the dashboard, and
the ledger version is recorded in the table above.

**Do not run `supabase config push` against the canonical project.** `supabase/config.toml` is local CLI configuration. Live Auth and API settings (email confirmation, password rules, captcha, exposed schemas) are changed in the dashboard, checked with the read-only list in `docs/implementation-v3/SQL_FOR_OWNER.md` section 9, and the local file is kept at least as strict as the live project so an accidental push can only tighten.

**Explicit function and table grants (after `040`).** Migration `040_privilege_hygiene.sql` closes
the global `PUBLIC EXECUTE` default on functions and removes `anon` write/`MAINTAIN` rights on
tables. Every new `SECURITY DEFINER` function must pin `search_path` (`''`, `'public'`, or
`'public', 'pg_temp'`), write an explicit `REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC, anon;`,
and — only when clients call it directly and the body checks `(SELECT auth.uid())` — follow with
`GRANT EXECUTE ON FUNCTION <sig> TO authenticated;`. Every new `public` table must write an
explicit `REVOKE ALL ON public.<t> FROM anon, PUBLIC;` immediately followed by
`GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;` (enforced by
`migrationRlsGuard.test.ts`, OD-05).

**`supabase functions deploy` has renamed files in this directory** as a side
effect — it rewrote fourteen of them in one run during Step 11B. Check
`git status` after any CLI invocation that touches the project.
