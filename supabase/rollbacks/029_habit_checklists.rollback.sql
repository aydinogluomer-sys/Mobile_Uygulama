-- ROLLBACK of 029_habit_checklists.sql
-- STATUS: WRITTEN, NOT APPLIED. Destructive: drops checklist items and daily checks.
--
-- Effect: public.habit_checklist_checks (child) and then public.habit_checklist_items are
-- dropped, with their policies, indexes and constraints.
-- Data loss: every checklist step a user wrote and every daily tick. Take a backup first
-- (see supabase/rollbacks/README.md); re-applying 029 does not bring rows back.
-- Client: both tables are read fail-open (isMissingTable in frontend/lib/pgErrors.ts); no habit
-- has a checklist afterwards and the editor says the server update is pending.
-- 037 checks both tables with to_regclass, so it works whether or not this rollback ran.
--
-- Run (same session): SET aderyth.rollback_confirm = '029'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '029' THEN
    RAISE EXCEPTION 'rollback 029 drops habit_checklist_items and habit_checklist_checks rows; take a backup, then run: SET aderyth.rollback_confirm = ''029'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DROP TABLE IF EXISTS public.habit_checklist_checks;   -- references habit_checklist_items
DROP TABLE IF EXISTS public.habit_checklist_items;

COMMIT;
