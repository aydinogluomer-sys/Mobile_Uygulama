-- Account deletion has to be possible at all.
--
-- WHAT WAS WRONG
--
-- Both stores require a user who can create an account in-app to be able to
-- delete it in-app. Aderyth registers through Supabase Auth, so that applies.
--
-- 47 tables in `public` carry a foreign key to `auth.users`. 39 of them were
-- declared `ON DELETE CASCADE`. Eight were not:
--
--   habits · habit_logs · habit_deletions · tasks · goals
--   deep_work_sessions · life_area_logs · weekly_reviews
--
-- Those eight are also the tables every real user fills first. So
-- `auth.admin.deleteUser()` would not have partially deleted an account -- it
-- would have failed outright with a foreign-key violation for anyone who had
-- ever created a habit. Account deletion was not merely missing from the UI;
-- it was impossible underneath it.
--
-- WHY CASCADE RATHER THAN DELETING IN THE FUNCTION
--
-- The alternative was to have the delete-account edge function issue eight
-- extra DELETEs in dependency order. That works right up until someone adds a
-- 48th table and forgets, and the failure mode of forgetting is personal data
-- surviving a deletion the user was told had happened. Expressed as a
-- constraint instead, the database enforces it and a new table inherits the
-- rule by being declared like its 46 neighbours.
--
-- WHAT THIS DOES NOT CHANGE
--
-- No column, no policy, no grant, no data. Re-pointing a foreign key at the
-- same parent with a different delete action rewrites no rows; it replaces a
-- trigger definition. Nothing here can delete anything on its own -- it only
-- decides what happens when `auth.users` loses a row, which today nothing does
-- except the new `delete-account` function.
--
-- Verified before writing: `habit_reminders`, `reminders`, `routine_items` and
-- `profile_badges` already cascade through their own parents (habits, events,
-- routines, profiles), and the remaining tables without a `user_id`
-- (challenges, global_bosses, habit_templates, pet_stages, quests, shop_items,
-- skills) are catalogs holding no personal data.
--
-- Forward-only. Nothing here edits an earlier migration.

ALTER TABLE public.habits
  DROP CONSTRAINT IF EXISTS habits_user_id_fkey,
  ADD  CONSTRAINT habits_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.habit_logs
  DROP CONSTRAINT IF EXISTS habit_logs_user_id_fkey,
  ADD  CONSTRAINT habit_logs_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.habit_deletions
  DROP CONSTRAINT IF EXISTS habit_deletions_user_id_fkey,
  ADD  CONSTRAINT habit_deletions_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_user_id_fkey,
  ADD  CONSTRAINT tasks_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.goals
  DROP CONSTRAINT IF EXISTS goals_user_id_fkey,
  ADD  CONSTRAINT goals_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.deep_work_sessions
  DROP CONSTRAINT IF EXISTS deep_work_sessions_user_id_fkey,
  ADD  CONSTRAINT deep_work_sessions_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.life_area_logs
  DROP CONSTRAINT IF EXISTS life_area_logs_user_id_fkey,
  ADD  CONSTRAINT life_area_logs_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.weekly_reviews
  DROP CONSTRAINT IF EXISTS weekly_reviews_user_id_fkey,
  ADD  CONSTRAINT weekly_reviews_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
