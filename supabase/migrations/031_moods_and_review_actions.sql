-- Named moods, mood check-ins, and the weekly review's next action.
-- (Implementation v3, R07.02 / R07.06)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). Until this
-- runs the client keeps moods, check-ins and review actions on the device,
-- per account (store/moodStore.ts, components/NextActionPicker.tsx), and the
-- journal's single daily mood keeps working unchanged.
--
-- WHAT WAS WRONG
--
-- journal_entries.mood is a number 1..5 whose meaning is its POSITION in a
-- fixed list in the app: renaming or reordering that list would silently
-- change what every past entry says, and there was one mood per day.
--
--   mood_definitions   a user's own mood: stable id, name, icon, valence
--                      (1..5, what analysis reads). Archived, never deleted.
--   mood_checkins      one moment: mood id + a SNAPSHOT of its name and
--                      valence when recorded, intensity 1..3, optional note.
--                      Many per day. Built-in moods are ids 'builtin-1'..'5'
--                      (the old scale, pinned), so mood_id is text.
--   review_next_actions  the action chosen in a weekly review, kept with its
--                      week (one per week): a task it created or a habit it
--                      pointed at.
--
-- Forward-only. Nothing here edits an earlier migration, and journal_entries
-- (whose definition is not in this repository -- STATE.md S12) is untouched.

CREATE TABLE IF NOT EXISTS public.mood_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  icon        text NOT NULL,
  valence     smallint NOT NULL,
  archived_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mood_definitions_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 24),
  CONSTRAINT mood_definitions_valence CHECK (valence BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS public.mood_checkins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  day         date NOT NULL,
  mood_id     text NOT NULL,
  label       text NOT NULL,
  valence     smallint NOT NULL,
  intensity   smallint NOT NULL,
  note        text NULL,
  CONSTRAINT mood_checkins_valence CHECK (valence BETWEEN 1 AND 5),
  CONSTRAINT mood_checkins_intensity CHECK (intensity BETWEEN 1 AND 3),
  CONSTRAINT mood_checkins_note_len CHECK (note IS NULL OR char_length(note) <= 280)
);
CREATE INDEX IF NOT EXISTS mood_checkins_user_day_idx ON public.mood_checkins (user_id, day);

CREATE TABLE IF NOT EXISTS public.review_next_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key    date NOT NULL,
  kind        text NOT NULL,
  task_id     uuid NULL,
  habit_id    uuid NULL REFERENCES public.habits(id) ON DELETE SET NULL,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_next_actions_kind CHECK (kind IN ('task', 'habit_edit')),
  CONSTRAINT review_next_actions_one_per_week UNIQUE (user_id, week_key)
);

ALTER TABLE public.mood_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_checkins       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_next_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mood_definitions_own ON public.mood_definitions;
CREATE POLICY mood_definitions_own ON public.mood_definitions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS mood_checkins_own ON public.mood_checkins;
CREATE POLICY mood_checkins_own ON public.mood_checkins
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS review_next_actions_own ON public.review_next_actions;
CREATE POLICY review_next_actions_own ON public.review_next_actions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (habit_id IS NULL OR EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid())))
  );
