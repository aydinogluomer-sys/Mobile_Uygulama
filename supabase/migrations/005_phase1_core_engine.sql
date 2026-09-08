-- ============================================================
-- Phase 1 -- Capacity Engine V1 + Recovery Engine V1: schema catch-up.
--
-- *** APPLIED to the canonical project kbcuolhjjnmhjaarxxmu on 2026-08-30. ***
--
-- History, kept because it explains the file's shape: this was authored during
-- a Supabase outage (the project was unreachable for the whole of that task),
-- so the reviewable SQL would exist alongside the domain logic it supports
-- (frontend/lib/capacity.ts, frontend/lib/recovery.ts). It carried a
-- "NOT APPLIED" banner for that reason. The project was later restored and the
-- migration was run with the repo owner's explicit approval.
--
-- Preconditions verified immediately before applying -- exactly the two risks
-- this file's own scope notes call out:
--   * rows violating the widened tracking_type CHECK ........ 0
--     (live values at the time: 'boolean', 'numeric')
--   * duplicate (habit_id, source_date) in recovery_plans ... 0
--     (table was empty, so the new UNIQUE constraint could not reject data)
--
-- Observed result:
--                          | BEFORE | AFTER
--   habits / habit_logs     |  6/13  |  6/13  (unchanged -- no data touched)
--   public tables           |   48   |   49   (+ daily_capacity)
--   recovery_plans columns  |   10   |   15
--   daily_capacity          | absent | present, RLS enabled, 1 policy
--
-- A duration habit was persisted end to end through PostgREST with a real user
-- JWT on 2026-08-30 (20 min target / 12 logged -> reads back as 60%), together
-- with negative+numeric and explicit abstinence rows, confirming the widened
-- CHECK accepts all four values in the app's own path and not just under
-- admin privileges. Those rows were removed afterwards.
--
-- Do not re-run this expecting it to be a no-op review artifact: every
-- statement is idempotent, so re-running is safe, but the schema it describes
-- is already live.
--
-- Written against the LIVE schema as documented in
-- docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md (48 live tables, all
-- RLS-enabled; `habits.tracking_type` and `recovery_plans` as described in
-- that review's §3-4), NOT against supabase/migrations/001_initial_schema.sql
-- -- that file predates the live column renames
-- (`type`->`tracking_type`, `target_value`->`daily_goal`, etc, per §8 of the
-- same review) and reproduces a schema the live database no longer has.
--
-- Scope: ADDITIVE ONLY.
--   * No DROP of any table, column, row or constraint's semantics.
--   * No destructive ALTER (no type narrowing, no NOT NULL tightening).
--   * No data deletion, no data migration/backfill.
--   * Every statement is idempotent -- safe to run more than once.
--
-- Sections:
--   A. Widen habits.tracking_type to accept 'duration' and 'abstinence'
--      alongside today's 'boolean'/'numeric'.
--   B. recovery_plans: add the columns the plan (§9) requires that the live
--      table is missing (source_log_id, deficit_type, deficit_value,
--      distributed_days, completed_at); widen the status CHECK to accept
--      the plan's planned|completed|expired|cancelled alongside today's
--      planned|done|skipped; add the (habit_id, source_date) UNIQUE
--      constraint that docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md
--      §4 records as ABSENT today (duplicate telafi plans are possible).
--   C. daily_capacity: new table per plan §17 (exists in no migration file
--      today), with RLS + an auth.uid() = user_id policy (plan Rule 3).
--
-- NOT in scope here (documented, not silently dropped):
--   * recovery_plans.strategy is NOT widened for the new v2 strategy
--     vocabulary (complete_today|push_tomorrow|split_two_days|skip). The
--     task defining this migration's scope named only the status
--     reconciliation, not strategy; frontend/lib/recovery.ts's
--     toLegacyRecoveryPlan/fromLegacyRecoveryPlan adapt between the two
--     vocabularies in the meantime (documented as lossy there). Follow-up.
--   * No RLS/policy change to `recovery_plans` or `habits` -- both already
--     have RLS with an owner-scoped policy per the live audit; only the new
--     `daily_capacity` table needs one.
--
-- ROLLBACK (manual, since nothing here is applied yet -- this is what a
-- reviewer would run to undo it AFTER a `db push`, not a script executed by
-- this migration):
--   ALTER TABLE public.habits DROP CONSTRAINT IF EXISTS habits_tracking_type_check;
--   ALTER TABLE public.habits ADD CONSTRAINT habits_tracking_type_check
--     CHECK (tracking_type IN ('boolean','numeric')); -- restores the narrower set
--   ALTER TABLE public.recovery_plans DROP CONSTRAINT IF EXISTS recovery_plans_status_check;
--   ALTER TABLE public.recovery_plans ADD CONSTRAINT recovery_plans_status_check
--     CHECK (status IN ('planned','done','skipped'));
--   ALTER TABLE public.recovery_plans DROP CONSTRAINT IF EXISTS recovery_plans_habit_source_unique;
--   ALTER TABLE public.recovery_plans
--     DROP COLUMN IF EXISTS source_log_id,
--     DROP COLUMN IF EXISTS deficit_type,
--     DROP COLUMN IF EXISTS deficit_value,
--     DROP COLUMN IF EXISTS distributed_days,
--     DROP COLUMN IF EXISTS completed_at;
--   DROP TABLE IF EXISTS public.daily_capacity;
--
-- WARNING for whoever applies this: the (habit_id, source_date) UNIQUE
-- constraint in section B will FAIL to apply if duplicate (habit_id,
-- source_date) rows already exist in live recovery_plans -- which the
-- architecture review's §4 says is possible today (no constraint has ever
-- prevented it). Run a dedupe query first, e.g.:
--   SELECT habit_id, source_date, count(*) FROM public.recovery_plans
--   GROUP BY habit_id, source_date HAVING count(*) > 1;
-- and resolve any rows it returns before applying section B in full.
-- ============================================================


-- ------------------------------------------------------------
-- A. habits.tracking_type -- widen to accept 'duration' and 'abstinence'.
--
-- The CHECK constraint's name is not assumed (it may have been created by
-- hand, per the audit's note that the gamification/calendar subsystems were
-- applied via execute_sql rather than a tracked migration). Instead, any
-- existing CHECK constraint on public.habits that mentions tracking_type is
-- located and dropped by its real name, then replaced with the widened one
-- under a fixed, predictable name -- which also makes this block safe to
-- run again (the second run finds and replaces its own prior constraint).
-- ------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'habits'
  ) THEN
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'habits'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%tracking_type%'
    LOOP
      EXECUTE format('ALTER TABLE public.habits DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE public.habits
      ADD CONSTRAINT habits_tracking_type_check
      CHECK (tracking_type IN ('boolean', 'numeric', 'duration', 'abstinence'));
  END IF;
END $$;


-- ------------------------------------------------------------
-- B. recovery_plans -- new columns, widened status, uniqueness.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recovery_plans'
  ) THEN

    -- New columns the plan (§9) requires. All nullable and additive --
    -- existing rows are simply missing this information, not invalid.
    ALTER TABLE public.recovery_plans
      ADD COLUMN IF NOT EXISTS source_log_id uuid REFERENCES public.habit_logs(id) ON DELETE SET NULL;
    COMMENT ON COLUMN public.recovery_plans.source_log_id IS
      'The habit_logs row this recovery plan responds to. Nullable: existing rows predate this column and older writers may not populate it either, until frontend/store rewiring lands (see frontend/lib/recovery.ts).';

    ALTER TABLE public.recovery_plans
      ADD COLUMN IF NOT EXISTS deficit_type text;
    ALTER TABLE public.recovery_plans
      ADD COLUMN IF NOT EXISTS deficit_value numeric;
    COMMENT ON COLUMN public.recovery_plans.deficit_type IS
      'numeric | binary. See frontend/lib/recovery.ts DeficitType -- a numeric/duration target falls short by an amount; a boolean/abstinence habit is a whole unit owed or not.';

    ALTER TABLE public.recovery_plans
      ADD COLUMN IF NOT EXISTS distributed_days jsonb;
    COMMENT ON COLUMN public.recovery_plans.distributed_days IS
      'Per-day split produced by the "2 güne böl" strategy, e.g. [{"date":"2026-08-05","value":1000},{"date":"2026-08-06","value":1000}]. Null for every other strategy. See frontend/lib/recovery.ts recoveryOptions/splitAcrossDays for the exact split rule (odd deficits give the earlier day the larger half; zero-value days are omitted).';

    ALTER TABLE public.recovery_plans
      ADD COLUMN IF NOT EXISTS completed_at timestamptz;
    COMMENT ON COLUMN public.recovery_plans.completed_at IS
      'Set when status transitions to completed. Distinct from created_at (when the plan was made) and target_date (when it was scheduled for).';
  END IF;
END $$;

-- deficit_type is a closed vocabulary; enforced the same
-- drop-by-discovered-name-then-recreate way as section A, so this block is
-- idempotent (a second run finds and replaces its own prior constraint).

DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recovery_plans' AND column_name = 'deficit_type'
  ) THEN
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'recovery_plans'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%deficit_type%'
    LOOP
      EXECUTE format('ALTER TABLE public.recovery_plans DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE public.recovery_plans
      ADD CONSTRAINT recovery_plans_deficit_type_check
      CHECK (deficit_type IS NULL OR deficit_type IN ('numeric', 'binary'));
  END IF;
END $$;

-- Status reconciliation: today's live CHECK almost certainly restricts
-- status to ('planned','done','skipped') (frontend RecoveryStatus,
-- lib/supabase.ts). Widen it to ADD the plan's vocabulary
-- ('completed','expired','cancelled') without removing the values already
-- written by every row inserted so far -- narrowing would break existing
-- data and any writer not yet migrated to the v2 vocabulary.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recovery_plans'
  ) THEN
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'recovery_plans'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE public.recovery_plans DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE public.recovery_plans
      ADD CONSTRAINT recovery_plans_status_check
      CHECK (status IN ('planned', 'done', 'skipped', 'completed', 'expired', 'cancelled'));
  END IF;
END $$;

-- (habit_id, source_date) UNIQUE -- absent today per the architecture
-- review §4 ("only PRIMARY KEY (id) ... ABSENT -- duplicate telafi plans
-- are possible"). See the WARNING at the top of this file: this WILL fail
-- to apply if duplicate rows already exist and must be dealt with first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recovery_plans'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'recovery_plans'
      AND con.conname = 'recovery_plans_habit_source_unique'
  ) THEN
    ALTER TABLE public.recovery_plans
      ADD CONSTRAINT recovery_plans_habit_source_unique UNIQUE (habit_id, source_date);
  END IF;
END $$;


-- ------------------------------------------------------------
-- C. daily_capacity -- new table per plan §17.
--
-- Persists the output of frontend/lib/capacity.ts's dailyLoad() so a day's
-- computed load can be looked back on (history/trend), rather than only
-- ever existing transiently in the client. One row per user per day;
-- re-computing a day overwrites its row (upsert on the primary key), it
-- does not accumulate duplicates.
--
-- All numeric fields mirror dailyLoad()'s DailyLoadResult plus the four
-- summands that produced it (habit_load, task_load, focus_load,
-- overdue_pressure) -- kept individually, not just the sum, so the
-- breakdown survives for later display/debugging, not just the final
-- number.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_capacity (
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capacity_date    date NOT NULL,
  habit_load       numeric NOT NULL DEFAULT 0,
  task_load        numeric NOT NULL DEFAULT 0,
  focus_load       numeric NOT NULL DEFAULT 0,
  overdue_pressure numeric NOT NULL DEFAULT 0,
  raw_load         numeric NOT NULL DEFAULT 0,
  normalised_load  numeric NOT NULL DEFAULT 0 CHECK (normalised_load BETWEEN 0 AND 100),
  band             text NOT NULL DEFAULT 'dusuk' CHECK (band IN ('dusuk', 'dengeli', 'yuksek', 'asiri')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capacity_date)
);

COMMENT ON TABLE public.daily_capacity IS
  'Per-day snapshot of the Capacity Engine V1 output (frontend/lib/capacity.ts dailyLoad). v1 heuristic values, not a measured psychological quantity -- see that file''s module doc.';

ALTER TABLE public.daily_capacity ENABLE ROW LEVEL SECURITY;

-- Mandatory per plan Rule 3: RLS + auth.uid() = user_id on every new table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'daily_capacity' AND policyname = 'daily_capacity_self'
  ) THEN
    CREATE POLICY "daily_capacity_self" ON public.daily_capacity
      FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS daily_capacity_user_date ON public.daily_capacity (user_id, capacity_date DESC);
