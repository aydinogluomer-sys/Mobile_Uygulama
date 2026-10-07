-- Dated pauses, holidays, and effective-dated goal versions for habits.
-- (Implementation v3, R01.05)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). The client
-- reads both tables fail-open: until this runs, every habit behaves exactly as
-- it did before R01.05, and the pause / holiday controls say the server
-- update is pending instead of failing.
--
-- WHAT WAS WRONG
--
-- The only pause the schema could express was `habits.status = 'paused'`:
-- undated and whole-habit. The period evaluator therefore treated EVERY
-- period of a paused habit as paused -- including the months before the
-- pause -- so pausing a habit erased its history from reports. There was no
-- holiday at all, and editing a habit's schedule or goal overwrote the one
-- config every report reads, re-scoring the past against the new goal.
--
-- WHAT THIS ADDS
--
--   habit_pauses         a date range during which one habit (habit_id set)
--                        or every habit (habit_id NULL: holiday) is off.
--                        Not due, not in any rate, the streak bridges it, no
--                        reminders. `end_date` NULL = until resumed.
--   habit_goal_versions  the schedule/goal that applies FROM a date. Reports
--                        score each day against the version in force on it.
--                        The first edit of a habit writes a baseline row for
--                        the config that applied until then.
--
-- WHAT THIS DOES NOT CHANGE
--
-- No existing column, policy or row. `habits.status = 'paused'` keeps its
-- meaning for rows that already use it. A skip is still a `habit_logs` row.
--
-- Forward-only. Nothing here edits an earlier migration.

-- ---------------------------------------------------------------------------
-- habit_pauses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.habit_pauses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL = holiday (every habit of this user).
  habit_id    uuid NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT habit_pauses_kind_check CHECK (kind IN ('pause', 'holiday')),
  -- A holiday has no habit; a pause has exactly one.
  CONSTRAINT habit_pauses_kind_target_check CHECK (
    (kind = 'holiday' AND habit_id IS NULL) OR (kind = 'pause' AND habit_id IS NOT NULL)
  ),
  CONSTRAINT habit_pauses_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS habit_pauses_user_idx ON public.habit_pauses (user_id, start_date);
CREATE INDEX IF NOT EXISTS habit_pauses_habit_idx ON public.habit_pauses (habit_id) WHERE habit_id IS NOT NULL;

ALTER TABLE public.habit_pauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS habit_pauses_select_own ON public.habit_pauses;
CREATE POLICY habit_pauses_select_own ON public.habit_pauses
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- The habit check is why this is a policy, not a CHECK: it must see another
-- table. A pause can only point at a habit the same user owns.
DROP POLICY IF EXISTS habit_pauses_insert_own ON public.habit_pauses;
CREATE POLICY habit_pauses_insert_own ON public.habit_pauses
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      habit_id IS NULL
      OR EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS habit_pauses_update_own ON public.habit_pauses;
CREATE POLICY habit_pauses_update_own ON public.habit_pauses
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      habit_id IS NULL
      OR EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS habit_pauses_delete_own ON public.habit_pauses;
CREATE POLICY habit_pauses_delete_own ON public.habit_pauses
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- habit_goal_versions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.habit_goal_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id          uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  effective_from    date NOT NULL,
  frequency_config  jsonb NOT NULL,
  daily_goal        numeric NULL,
  target_direction  text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT habit_goal_versions_direction_check
    CHECK (target_direction IS NULL OR target_direction IN ('at_least', 'at_most')),
  -- One version per habit per day: a second edit the same day replaces it
  -- (the client upserts on this key).
  CONSTRAINT habit_goal_versions_one_per_day UNIQUE (habit_id, effective_from)
);

CREATE INDEX IF NOT EXISTS habit_goal_versions_user_idx ON public.habit_goal_versions (user_id, habit_id);

ALTER TABLE public.habit_goal_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS habit_goal_versions_select_own ON public.habit_goal_versions;
CREATE POLICY habit_goal_versions_select_own ON public.habit_goal_versions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS habit_goal_versions_insert_own ON public.habit_goal_versions;
CREATE POLICY habit_goal_versions_insert_own ON public.habit_goal_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS habit_goal_versions_update_own ON public.habit_goal_versions;
CREATE POLICY habit_goal_versions_update_own ON public.habit_goal_versions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
  );

-- No delete policy: a version is history. Deleting the habit cascades.
