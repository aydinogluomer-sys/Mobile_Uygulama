-- ROLLBACK of 033_habit_log_timezone.sql
-- STATUS: WRITTEN, NOT APPLIED. Destructive: drops habit_logs.tz (the IANA zone each log was written in).
--
-- Effect: the habit_logs_tz_check constraint and the habit_logs.tz column are dropped.
-- Data loss: the zone recorded with each log. completed_at (the local day the user meant) is
-- untouched and nothing reads tz to decide a day, so no streak, XP or report changes.
-- Client: while LOG_TIMEZONE_ENABLED is false (frontend/lib/featureGates.ts) the tz field is
-- dropped before the write (wirePatch in frontend/services/habitLogService.ts). If the gate was
-- ever turned on, turn it off first: with the column gone every log write that names tz is
-- refused with PGRST204 (unknown column).
-- 037 reads logs with to_jsonb(l), so it does not depend on the column.
--
-- Run (same session): SET aderyth.rollback_confirm = '033'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '033' THEN
    RAISE EXCEPTION 'rollback 033 drops habit_logs.tz; set LOG_TIMEZONE_ENABLED=false first, take a backup, then run: SET aderyth.rollback_confirm = ''033'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ALTER TABLE public.habit_logs DROP CONSTRAINT IF EXISTS habit_logs_tz_check;
ALTER TABLE public.habit_logs DROP COLUMN IF EXISTS tz;

COMMIT;
