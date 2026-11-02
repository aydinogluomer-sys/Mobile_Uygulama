-- ROLLBACK of 032_coach_actions_v2.sql
-- STATUS: WRITTEN, NOT APPLIED. Restores the 3-type CHECK of the live schema (live_schema.sql, ai_actions_type_check).
--
-- Effect: ai_conversation_actions.action_type goes back to propose_habit, propose_habit_plan,
-- log_habit. No data is lost: a row written with a newer type is kept, never deleted. The
-- CHECK is added NOT VALID (it then only guards new writes) and validated only when no such
-- row exists, so the script cannot fail on user data and never needs a DELETE.
-- Client: COACH_ACTIONS_V2_ENABLED = false (frontend/lib/featureGates.ts) keeps the new types
-- from being written. If the gate was ever turned on, turn it off before running this.
-- Order: run 035 and 034 first (newest to oldest); whichever of 035, 034, 032 ran last wins.
--
-- Run (same session): SET aderyth.rollback_confirm = '032'; then this file.
-- A second run leaves the same constraint behind.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '032' THEN
    RAISE EXCEPTION 'rollback 032 narrows ai_conversation_actions.action_type; set COACH_ACTIONS_V2_ENABLED=false first, then run: SET aderyth.rollback_confirm = ''032'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ALTER TABLE public.ai_conversation_actions DROP CONSTRAINT IF EXISTS ai_actions_type_check;
-- NOT VALID: rows already written with a newer type are kept, only new writes are checked
ALTER TABLE public.ai_conversation_actions
  ADD CONSTRAINT ai_actions_type_check CHECK (action_type IN (
    'propose_habit', 'propose_habit_plan', 'log_habit'
  )) NOT VALID;

DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_conversation_actions
     WHERE action_type NOT IN ('propose_habit', 'propose_habit_plan', 'log_habit')
  ) THEN
    ALTER TABLE public.ai_conversation_actions VALIDATE CONSTRAINT ai_actions_type_check;
  ELSE
    RAISE NOTICE 'ai_actions_type_check left NOT VALID: rows with a newer action_type exist (kept, not deleted)';
  END IF;
END $validate$;

COMMIT;
