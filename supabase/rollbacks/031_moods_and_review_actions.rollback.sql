-- ROLLBACK of 031_moods_and_review_actions.sql
-- STATUS: WRITTEN, NOT APPLIED. Destructive: drops mood definitions, mood check-ins and weekly review actions.
--
-- Effect: public.review_next_actions, public.mood_checkins and public.mood_definitions are
-- dropped, with their policies, indexes and constraints. The three tables do not reference
-- each other; review_next_actions.habit_id points at habits, and that link goes with the table.
-- Data loss: every named mood, every mood check-in and every weekly-review next action. Take a
-- backup first (see supabase/rollbacks/README.md); re-applying 031 does not bring rows back.
-- Client: until 031 runs, moods, check-ins and review actions live on the device, per account
-- (store/moodStore.ts, components/NextActionPicker.tsx); journal_entries.mood is untouched.
--
-- Run (same session): SET aderyth.rollback_confirm = '031'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '031' THEN
    RAISE EXCEPTION 'rollback 031 drops mood_definitions, mood_checkins and review_next_actions rows; take a backup, then run: SET aderyth.rollback_confirm = ''031'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DROP TABLE IF EXISTS public.review_next_actions;
DROP TABLE IF EXISTS public.mood_checkins;
DROP TABLE IF EXISTS public.mood_definitions;

COMMIT;
