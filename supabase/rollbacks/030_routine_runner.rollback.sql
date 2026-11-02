-- ROLLBACK of 030_routine_runner.sql
-- STATUS: WRITTEN, NOT APPLIED. Destructive: drops routine templates, versions and sessions.
--
-- Effect: public.routine_sessions (it points at a template with ON DELETE SET NULL),
-- public.routine_template_versions and public.routine_templates are dropped in that order,
-- with their policies, indexes and constraints.
-- Data loss: every routine template, every immutable template version and every recorded
-- run. Take a backup first (see supabase/rollbacks/README.md); re-applying 030 does not
-- bring rows back.
-- Client: until 030 runs, the runner keeps templates and sessions on the device, per account
-- (store/routineRunnerStore.ts), and the built-in templates ship as data.
--
-- Run (same session): SET aderyth.rollback_confirm = '030'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '030' THEN
    RAISE EXCEPTION 'rollback 030 drops routine_templates, routine_template_versions and routine_sessions rows; take a backup, then run: SET aderyth.rollback_confirm = ''030'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DROP TABLE IF EXISTS public.routine_sessions;
DROP TABLE IF EXISTS public.routine_template_versions;
DROP TABLE IF EXISTS public.routine_templates;

COMMIT;
