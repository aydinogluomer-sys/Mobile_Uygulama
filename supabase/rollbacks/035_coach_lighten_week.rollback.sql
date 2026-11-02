-- ROLLBACK of 035_coach_lighten_week.sql
-- STATUS: WRITTEN, NOT APPLIED. Restores the 9-type CHECK written by 034.
--
-- Effect: lighten_week leaves ai_actions_type_check; the list is the nine types 034 wrote (the
-- eight of 032 plus edit_reminder_time). No data is lost: a row that already holds lighten_week
-- is kept, never deleted. The CHECK is added NOT VALID (new writes only) and validated only
-- when no such row exists.
-- Target state: 034 applied, 035 not. 035 itself restates the whole list ("independent of
-- 032 and 034"), so it is correct without them; this rollback assumes 034, because that is the
-- order they are applied in. Roll 034 and 032 back after this one to reach the 3-type list.
-- Client: COACH_ACTIONS_V2_ENABLED = false (frontend/lib/featureGates.ts); turn it off first if
-- it was ever turned on.
--
-- Run (same session): SET aderyth.rollback_confirm = '035'; then this file.
-- A second run leaves the same constraint behind.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '035' THEN
    RAISE EXCEPTION 'rollback 035 removes lighten_week from ai_actions_type_check; set COACH_ACTIONS_V2_ENABLED=false first, then run: SET aderyth.rollback_confirm = ''035'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ALTER TABLE public.ai_conversation_actions DROP CONSTRAINT IF EXISTS ai_actions_type_check;
ALTER TABLE public.ai_conversation_actions
  ADD CONSTRAINT ai_actions_type_check CHECK (action_type IN (
    'propose_habit', 'propose_habit_plan', 'log_habit',
    'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today', 'edit_reminder_time'
  )) NOT VALID;

DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_conversation_actions
     WHERE action_type NOT IN (
       'propose_habit', 'propose_habit_plan', 'log_habit',
       'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today', 'edit_reminder_time'
     )
  ) THEN
    ALTER TABLE public.ai_conversation_actions VALIDATE CONSTRAINT ai_actions_type_check;
  ELSE
    RAISE NOTICE 'ai_actions_type_check left NOT VALID: rows with lighten_week exist (kept, not deleted)';
  END IF;
END $validate$;

COMMIT;
