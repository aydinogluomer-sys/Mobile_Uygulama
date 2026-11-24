-- ROLLBACK of 041_rls_initplan_and_indexes.sql
-- STATUS: WRITTEN, NOT APPLIED. No row is touched: this restores policies, one
-- foreign key rule and one index, and drops 26 indexes. Rolling back brings
-- the per-row auth.uid() evaluation back (a performance change only).
--
-- NOT restored on purpose: the weekly_xp policy "System can manage weekly xp"
-- (it let any signed-in user write any weekly_xp row; 036 drops it and 041
-- only repeats the drop). Run this file in descending order: after the
-- rollbacks of every later migration, before the rollback of 040.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '041' THEN
    RAISE EXCEPTION 'rollback 041 restores per-row auth.uid() policies and the old tasks FK rule; take a backup, then run: SET aderyth.rollback_confirm = ''041'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- 6 reversed: the duplicate index comes back with its original definition.
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date
  ON public.habit_logs USING btree (habit_id, completed_at);

-- 5 and 5b reversed: drop the 26 indexes.
DROP INDEX IF EXISTS public.ai_conversation_actions_conversation_idx;
DROP INDEX IF EXISTS public.ai_conversation_actions_assistant_message_idx;
DROP INDEX IF EXISTS public.ai_conversations_project_idx;
DROP INDEX IF EXISTS public.deep_work_sessions_user_idx;
DROP INDEX IF EXISTS public.focus_sessions_task_idx;
DROP INDEX IF EXISTS public.focus_tasks_user_idx;
DROP INDEX IF EXISTS public.goals_user_idx;
DROP INDEX IF EXISTS public.habit_deletions_user_idx;
DROP INDEX IF EXISTS public.habit_reminders_habit_idx;
DROP INDEX IF EXISTS public.habits_cue_habit_idx;
DROP INDEX IF EXISTS public.key_results_user_idx;
DROP INDEX IF EXISTS public.okrs_user_idx;
DROP INDEX IF EXISTS public.projects_user_idx;
DROP INDEX IF EXISTS public.recovery_plans_source_log_idx;
DROP INDEX IF EXISTS public.routine_items_routine_idx;
DROP INDEX IF EXISTS public.routines_user_idx;
DROP INDEX IF EXISTS public.tasks_parent_task_idx;
DROP INDEX IF EXISTS public.tasks_project_idx;
DROP INDEX IF EXISTS public.habit_checklist_items_user_idx;
DROP INDEX IF EXISTS public.habit_checklist_checks_habit_idx;
DROP INDEX IF EXISTS public.routine_templates_user_idx;
DROP INDEX IF EXISTS public.routine_template_versions_user_idx;
DROP INDEX IF EXISTS public.routine_sessions_template_idx;
DROP INDEX IF EXISTS public.mood_definitions_user_idx;
DROP INDEX IF EXISTS public.review_next_actions_habit_idx;
DROP INDEX IF EXISTS public.habit_xp_awards_user_idx;

-- 4 reversed: the old rule (no ON DELETE action, that is NO ACTION).
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey,
  ADD CONSTRAINT tasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id);

-- 3 reversed: tables 036 / 040 may have changed or moved. Looked up first.
DO $f10$
DECLARE
  r record;
  v_schema text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('weekly_xp', 'Users can read all weekly xp', $e$auth.role() = 'authenticated'::text$e$, NULL),
      ('notion_integrations', 'Users manage own notion integration', $e$auth.uid() = user_id$e$, NULL),
      ('user_gamification', 'Users can insert own gamification stats', NULL, $e$auth.uid() = user_id$e$),
      ('user_gamification', 'Users can update own gamification stats', $e$auth.uid() = user_id$e$, NULL),
      ('user_gamification', 'Users can view own gamification stats', $e$auth.uid() = user_id$e$, NULL),
      ('ai_calls', 'ai_calls_self', $e$user_id = auth.uid()$e$, $e$user_id = auth.uid()$e$),
      ('user_challenges', 'Users can manage own challenge enrollments', $e$auth.uid() = user_id$e$, $e$auth.uid() = user_id$e$),
      ('user_quests', 'Users insert own quests', NULL, $e$auth.uid() = user_id$e$),
      ('user_quests', 'Users update own quests', $e$auth.uid() = user_id$e$, NULL),
      ('user_quests', 'Users view own quests', $e$auth.uid() = user_id$e$, NULL),
      ('user_pets', 'Users update own pet', $e$auth.uid() = user_id$e$, NULL),
      ('user_pets', 'Users view own pet', $e$auth.uid() = user_id$e$, NULL),
      ('user_skills', 'Users update own skills', $e$auth.uid() = user_id$e$, NULL),
      ('user_skills', 'Users view own skills', $e$auth.uid() = user_id$e$, NULL),
      ('user_inventory', 'Users view own inventory', $e$auth.uid() = user_id$e$, NULL)
    ) AS t(tbl, pol, using_expr, check_expr)
  LOOP
    SELECT n.nspname INTO v_schema
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = r.tbl
       AND c.relkind IN ('r', 'p')
       AND n.nspname IN ('public', 'archive_f13')
     ORDER BY (n.nspname = 'public') DESC
     LIMIT 1;
    IF v_schema IS NULL OR NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = v_schema AND p.tablename = r.tbl AND p.policyname = r.pol) THEN
      RAISE NOTICE 'rollback 041: % / % not present, skipped', r.tbl, r.pol;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER POLICY %I ON %I.%I', r.pol, v_schema, r.tbl)
      || CASE WHEN r.using_expr IS NOT NULL THEN ' USING (' || r.using_expr || ')' ELSE '' END
      || CASE WHEN r.check_expr IS NOT NULL THEN ' WITH CHECK (' || r.check_expr || ')' ELSE '' END;
  END LOOP;

  -- the user_challenges twin that 041 dropped (only where the table still exists)
  SELECT n.nspname INTO v_schema
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'user_challenges'
     AND c.relkind IN ('r', 'p')
     AND n.nspname IN ('public', 'archive_f13')
   ORDER BY (n.nspname = 'public') DESC
   LIMIT 1;
  IF v_schema IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_policies p
       WHERE p.schemaname = v_schema AND p.tablename = 'user_challenges'
         AND p.policyname = 'Users can manage their challenges') THEN
    EXECUTE format('CREATE POLICY %I ON %I.%I USING (auth.uid() = user_id)',
                   'Users can manage their challenges', v_schema, 'user_challenges');
  END IF;
END $f10$;

-- 2 reversed: the 30 core policies go back to the per-row form.
ALTER POLICY "Users can delete own logs" ON public.habit_logs
  USING (user_id = auth.uid());

ALTER POLICY "Users can insert own logs" ON public.habit_logs
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = auth.uid()));

ALTER POLICY "Users can update own logs" ON public.habit_logs
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = auth.uid()));

ALTER POLICY "Users can view own logs" ON public.habit_logs
  USING (user_id = auth.uid());

ALTER POLICY "Users can delete their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = auth.uid()));

ALTER POLICY "Users can insert their own habit reminders" ON public.habit_reminders
  WITH CHECK (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = auth.uid()));

ALTER POLICY "Users can update their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = auth.uid()));

ALTER POLICY "Users can view their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = auth.uid()));

ALTER POLICY "insights_delete_own" ON public.journal_insights
  USING (auth.uid() = user_id);

ALTER POLICY "insights_insert_own" ON public.journal_insights
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "insights_select_own" ON public.journal_insights
  USING (auth.uid() = user_id);

ALTER POLICY "insights_update_own" ON public.journal_insights
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "journal_own" ON public.journal_entries
  USING (user_id = auth.uid());

ALTER POLICY "notes_own" ON public.notes
  USING (user_id = auth.uid());

ALTER POLICY "projects_own" ON public.projects
  USING (user_id = auth.uid());

ALTER POLICY "reading_list_delete" ON public.reading_list
  USING (user_id = auth.uid());

ALTER POLICY "reading_list_insert" ON public.reading_list
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "reading_list_select" ON public.reading_list
  USING (user_id = auth.uid());

ALTER POLICY "reading_list_update" ON public.reading_list
  USING (user_id = auth.uid());

ALTER POLICY "routine_items_self" ON public.routine_items
  USING (routine_id IN (SELECT routines.id FROM public.routines WHERE routines.user_id = auth.uid()))
  WITH CHECK (routine_id IN (SELECT routines.id FROM public.routines WHERE routines.user_id = auth.uid()));

ALTER POLICY "routines_self" ON public.routines
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "user_onboarding_owner" ON public.user_onboarding
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "willpower_self" ON public.willpower_state
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "focus_sessions_own" ON public.focus_sessions
  USING (user_id = auth.uid());

ALTER POLICY "focus_tasks_own" ON public.focus_tasks
  USING (user_id = auth.uid());

ALTER POLICY "daily_capacity_self" ON public.daily_capacity
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "ai_requests_owner_select" ON public.ai_requests
  USING (auth.uid() = user_id);

ALTER POLICY "Users can read own badges" ON public.profile_badges
  USING (auth.uid() = user_id);

ALTER POLICY "Anyone can read challenges" ON public.challenges
  USING (auth.role() = 'authenticated'::text);

ALTER POLICY "Anyone can read templates" ON public.habit_templates
  USING (auth.role() = 'authenticated'::text);

-- 1 reversed: the four twins return exactly as live_schema.sql had them.
-- Preceded by DROP POLICY IF EXISTS so a second rollback pass is a clean no-op.
DROP POLICY IF EXISTS "Users can manage own tasks" ON public.tasks;
CREATE POLICY "Users can manage own tasks" ON public.tasks
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS tasks_own ON public.tasks;
CREATE POLICY tasks_own ON public.tasks
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Challenges imply public read" ON public.challenges;
CREATE POLICY "Challenges imply public read" ON public.challenges
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Everyone can read patterns" ON public.habit_templates;
CREATE POLICY "Everyone can read patterns" ON public.habit_templates
  FOR SELECT USING (true);

COMMIT;
