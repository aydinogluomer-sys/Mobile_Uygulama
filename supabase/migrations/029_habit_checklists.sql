-- A habit's checklist: template steps and their per-day checks.
-- (Implementation v3, R01.04)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). The client
-- reads both tables fail-open on a missing table: until this runs, no habit
-- has a checklist and every habit behaves exactly as before; the editor says
-- the server update is pending instead of saving.
--
-- WHAT THIS ADDS
--
--   habit_checklist_items   the steps one occurrence of a habit is made of,
--                           required or optional, ordered. ARCHIVED, never
--                           deleted, so a past day is read against the steps
--                           it actually had.
--   habit_checklist_checks  one step ticked on one local day (the day's
--                           instance). Unticking deletes the check row; a
--                           check carries no XP, so deleting one cannot farm
--                           anything (unlike a habit_logs row, R01.03-b).
--
-- NOT task subtasks: a task's breakdown is one-off, a habit's checklist
-- repeats every occurrence and decides that day's log. Separate tables on
-- purpose.
--
-- Forward-only. Nothing here edits an earlier migration.

CREATE TABLE IF NOT EXISTS public.habit_checklist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id     uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  title        text NOT NULL,
  required     boolean NOT NULL DEFAULT true,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz NULL,
  CONSTRAINT habit_checklist_items_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS habit_checklist_items_habit_idx
  ON public.habit_checklist_items (habit_id, position);

CREATE TABLE IF NOT EXISTS public.habit_checklist_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id    uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.habit_checklist_items(id) ON DELETE CASCADE,
  day         date NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  -- A step is ticked at most once a day; a double tap (or a retried request)
  -- lands on the same row.
  CONSTRAINT habit_checklist_checks_once_a_day UNIQUE (item_id, day)
);

CREATE INDEX IF NOT EXISTS habit_checklist_checks_user_day_idx
  ON public.habit_checklist_checks (user_id, day);

ALTER TABLE public.habit_checklist_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_checklist_checks ENABLE ROW LEVEL SECURITY;

-- Items: owner only, and only on the owner's own habit.
DROP POLICY IF EXISTS habit_checklist_items_select_own ON public.habit_checklist_items;
CREATE POLICY habit_checklist_items_select_own ON public.habit_checklist_items
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS habit_checklist_items_insert_own ON public.habit_checklist_items;
CREATE POLICY habit_checklist_items_insert_own ON public.habit_checklist_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS habit_checklist_items_update_own ON public.habit_checklist_items;
CREATE POLICY habit_checklist_items_update_own ON public.habit_checklist_items
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid()))
  );
-- No delete policy on items: archive instead (history).

-- Checks: owner only; the item must be the owner's and belong to the same habit.
DROP POLICY IF EXISTS habit_checklist_checks_select_own ON public.habit_checklist_checks;
CREATE POLICY habit_checklist_checks_select_own ON public.habit_checklist_checks
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS habit_checklist_checks_insert_own ON public.habit_checklist_checks;
CREATE POLICY habit_checklist_checks_insert_own ON public.habit_checklist_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.habit_checklist_items i
       WHERE i.id = item_id AND i.habit_id = habit_checklist_checks.habit_id AND i.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS habit_checklist_checks_delete_own ON public.habit_checklist_checks;
CREATE POLICY habit_checklist_checks_delete_own ON public.habit_checklist_checks
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
