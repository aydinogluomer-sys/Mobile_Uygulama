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
|---|---|---|---|
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

**`supabase functions deploy` has renamed files in this directory** as a side
effect — it rewrote fourteen of them in one run during Step 11B. Check
`git status` after any CLI invocation that touches the project.
