-- ============================================================
-- COMPATIBILITY ROLLBACK — recovery vocabulary only.
--
-- ## Why this exists
--
-- `20260831_recovery_vocabulary` narrowed `recovery_plans.strategy` and
-- `.status` to the v2 vocabulary and was applied to the live project. The
-- `final-v2-hardening` branch is not released, so the client running against
-- this database is still `main` — and `main` writes the legacy words. Probed
-- live as an ordinary authenticated caller, `main` could no longer:
--
--     create a plan   strategy = 'full'      -> check violation
--     complete a plan status   = 'done'      -> check violation
--     skip a plan     status   = 'skipped'   -> check violation
--
-- The live database had moved ahead of the deployed client, which broke the
-- recovery flow on `main`. That is a deployment-sequencing mistake, not a
-- defect in the v2 design.
--
-- **This is a temporary compatibility rollback.** The v2 vocabulary migration
-- is re-applied as part of a coordinated release when the v2 branch is ready
-- to ship. Re-applying it is a RELEASE GATE, recorded in
-- `docs/IMPLEMENTATION_V2_FINAL_PREMERGE_AUDIT.md` §0b: shipping the v2 client
-- without it would break the branch's recovery flow in the mirror image of
-- what this migration fixes.
--
-- ## What is rolled back: the vocabulary, and nothing else
--
-- `recovery_plans` holds ZERO rows, so no data migration is involved — this is
-- two CHECK expressions.
--
-- ## What is deliberately NOT rolled back
--
--   source_log_id, deficit_type, deficit_value, distributed_days, completed_at
--   recovery_plans_distributed_days_shape
--   recovery_plans_deficit_value_nonneg
--   recovery_plans_completed_at_agrees_with_status
--
-- None of those is the source of the `main` incompatibility. The five columns
-- are nullable and `main` simply never writes them; the three constraints only
-- constrain values `main` never supplies. Removing them would give up real
-- integrity to fix a problem they do not cause.
--
-- The migration history is not rewritten. `20260831_recovery_vocabulary` stays
-- exactly as applied; this is a forward migration that supersedes its
-- vocabulary half, so the sequence remains readable as what actually happened.
--
-- ## One interaction worth knowing about
--
-- `recovery_plans_completed_at_agrees_with_status` requires `completed_at` to
-- be NULL unless the status is exactly `'completed'`. So a row that the v2
-- client completed (status `'completed'`, `completed_at` set) cannot then be
-- moved to the legacy `'done'` by `main` without clearing `completed_at`.
--
-- Not a live risk today: the table is empty and `main` is the only client
-- until the coordinated release. Recorded because it is the one place these
-- two vocabularies can meet on the same row, and it is better written down
-- than rediscovered.
--
-- ## Pre-flight (read from the live project before applying)
--
--   recovery_plans rows ..... 0
--   strategy CHECK .......... ('complete_today','push_tomorrow','split_two_days','skip')
--   status CHECK ............ ('planned','completed','expired','cancelled')
--   status default .......... 'planned'
-- ============================================================

-- ── 1. strategy: back to the legacy contract `main` writes ──────────────
alter table public.recovery_plans
  drop constraint if exists recovery_plans_strategy_check;

alter table public.recovery_plans
  add constraint recovery_plans_strategy_check
  check (
    strategy = any (
      array['full', 'half', 'mini', 'reschedule']
    )
  );

-- ── 2. status: the pre-migration compatibility set ─────────────────────
-- Both vocabularies, which is what `20260825` left in place and what `main`
-- and the v2 client can each write without seeing the other's words.
alter table public.recovery_plans
  drop constraint if exists recovery_plans_status_check;

alter table public.recovery_plans
  add constraint recovery_plans_status_check
  check (
    status = any (
      array[
        'planned',
        'done',
        'skipped',
        'completed',
        'expired',
        'cancelled'
      ]
    )
  );

-- The default is already 'planned' and is correct under both vocabularies;
-- it is left alone rather than restated, so this migration touches only what
-- it claims to.

comment on column public.recovery_plans.strategy is
  'LEGACY vocabulary while the v2 branch is unreleased: full | half | mini | reschedule. The v2 set (complete_today | push_tomorrow | split_two_days | skip) is re-applied by 20260831_recovery_vocabulary as part of the coordinated v2 release — see that file and the release gate in the pre-merge audit §0b.';
