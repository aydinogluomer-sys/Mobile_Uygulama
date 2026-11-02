-- ROLLBACK of 034_coach_reminder_action.sql
-- STATUS: WRITTEN, NOT APPLIED. Restores the 8-type CHECK written by 032.
--
-- Effect: edit_reminder_time leaves ai_actions_type_check; the list is the eight types 032
-- wrote (propose_habit, propose_habit_plan, log_habit, edit_habit_schedule, pause_habit,
-- move_task, suggest_small_step, lighten_today). No data is lost: a row that already holds
-- edit_reminder_time is kept, never deleted. The CHECK is added NOT VALID (new writes only)
-- and validated only when no such row exists.
-- Target state: 032 applied, 034 not. 034 itself restates the whole list ("independent of 032"),
-- so it is correct without 032; this rollback assumes 032, because that is the order it is
-- applied in. Roll 032 back after this one to reach the 3-type list.
-- Client: COACH_ACTIONS_V2_ENABLED = false (frontend/lib/featureGates.ts); turn it off first if
-- it was ever turned on.
--
-- Run (same session): SET aderyth.rollback_confirm = '034'; then this file.
-- A second run leaves the same constraint behind.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '034' THEN
    RAISE EXCEPTION 'rollback 034 removes edit_reminder_time from ai_actions_type_check; set COACH_ACTIONS_V2_ENABLED=false first, then run: SET aderyth.rollback_confirm = ''034'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ALTER TABLE public.ai_conversation_actions DROP CONSTRAINT IF EXISTS ai_actions_type_check;
ALTER TABLE public.ai_conversation_actions
  ADD CONSTRAINT ai_actions_type_check CHECK (action_type IN (
    'propose_habit', 'propose_habit_plan', 'log_habit',
    'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today'
  )) NOT VALID;

DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_conversation_actions
     WHERE action_type NOT IN (
       'propose_habit', 'propose_habit_plan', 'log_habit',
       'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today'
     )
  ) THEN
    ALTER TABLE public.ai_conversation_actions VALIDATE CONSTRAINT ai_actions_type_check;
  ELSE
    RAISE NOTICE 'ai_actions_type_check left NOT VALID: rows with edit_reminder_time exist (kept, not deleted)';
  END IF;
END $validate$;

COMMIT;
