-- ROLLBACK of 028_habit_pauses_and_goal_versions.sql
-- STATUS: WRITTEN, NOT APPLIED. Destructive: drops user pause / holiday / goal-version rows.
--
-- Effect: public.habit_goal_versions and public.habit_pauses are dropped, with their
-- policies, indexes and constraints. Nothing else references them.
-- Data loss: every pause, holiday and effective-dated goal version a user saved. Take a
-- backup first (see supabase/rollbacks/README.md); re-applying 028 does not bring rows back.
-- Client: both tables are read fail-open (isMissingTable in frontend/lib/pgErrors.ts), so the
-- app keeps working; the pause and holiday controls say the server update is pending.
-- 037 checks both tables with to_regclass, so it works whether or not this rollback ran.
--
-- Run (same session): SET aderyth.rollback_confirm = '028'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '028' THEN
    RAISE EXCEPTION 'rollback 028 drops habit_pauses and habit_goal_versions rows; take a backup, then run: SET aderyth.rollback_confirm = ''028'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- child first; policies, indexes and constraints go with the tables
DROP TABLE IF EXISTS public.habit_goal_versions;
DROP TABLE IF EXISTS public.habit_pauses;

COMMIT;
