-- 041: RLS initplan wrapping, duplicate permissive policies, foreign-key indexes.
-- (Implementation F10; findings DB1-14, DB1-16, DB2-10, DB2-19, GEM-03, GEM-04)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check and apply order (STATE.md db_state, stop points S1/S2;
-- docs/implementation-v3/SQL_FOR_OWNER.md). Apply AFTER 040. Nothing here
-- depends on 028..040 being present: every object it touches is looked up
-- first, so it also runs straight on top of supabase/live_schema.sql.
--
-- WHAT THIS DOES
--   1. Drops six duplicate permissive policies (tasks x2, challenges,
--      habit_templates, weekly_xp, user_challenges). Permissive policies are
--      OR-ed, so a twin adds a second evaluation per row and hides the intent.
--   2. Rewrites 45 policies in place so auth.uid() / auth.role() is called once
--      per statement ((SELECT auth.uid()), an InitPlan) instead of once per row.
--      Same predicate, same roles, same commands: ALTER POLICY only.
--   3. tasks_parent_task_id_fkey becomes ON DELETE CASCADE (a sub-step goes
--      with its parent task). No client path writes parent_task_id today.
--   4. Adds 26 leading-column indexes for foreign keys that had none, and drops
--      the duplicate idx_habit_logs_habit_date (the UNIQUE constraint
--      habit_logs_habit_id_completed_at_key already indexes the same columns).
--
-- WHAT THIS DOES NOT DO
--   - No data change, no new table, no new function, no privilege change, no
--     CREATE POLICY. The policy set only shrinks or is rewritten in place.
--   - The XP path (habit_logs triggers, add_xp, track_weekly_xp) is untouched:
--     xp_drift() stays empty.
--
-- Safe to run again: policy rewrites are idempotent, drops use IF EXISTS,
-- indexes use IF NOT EXISTS, the FK is dropped and added in one statement.
-- Rollback: supabase/rollbacks/041_rls_initplan_and_indexes.rollback.sql

-- 0. Preconditions: never drop a twin unless the policy that stays is there.
DO $f10$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'tasks'
                    AND policyname = 'Users can CRUD own tasks') THEN
    RAISE EXCEPTION '041: tasks keeps "Users can CRUD own tasks" but it is missing; twins NOT dropped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'challenges'
                    AND policyname = 'Anyone can read challenges') THEN
    RAISE EXCEPTION '041: challenges keeps "Anyone can read challenges" but it is missing; twin NOT dropped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'habit_templates'
                    AND policyname = 'Anyone can read templates') THEN
    RAISE EXCEPTION '041: habit_templates keeps "Anyone can read templates" but it is missing; twin NOT dropped';
  END IF;
END $f10$;

-- 1. Duplicate permissive policies (DB1-16). The survivors are rewritten in
--    section 2. The weekly_xp and user_challenges twins are in section 3
--    because 036 / 040 may already have dropped or moved them.
DROP POLICY IF EXISTS "Users can manage own tasks" ON public.tasks;
DROP POLICY IF EXISTS tasks_own ON public.tasks;
DROP POLICY IF EXISTS "Challenges imply public read" ON public.challenges;
DROP POLICY IF EXISTS "Everyone can read patterns" ON public.habit_templates;

-- 2. InitPlan wrapping, tables the app uses today (DB1-14). 30 policies.
ALTER POLICY "Users can delete own logs" ON public.habit_logs
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "Users can insert own logs" ON public.habit_logs
  WITH CHECK (user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = (SELECT auth.uid())));

ALTER POLICY "Users can update own logs" ON public.habit_logs
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = (SELECT auth.uid())));

ALTER POLICY "Users can view own logs" ON public.habit_logs
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "Users can delete their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = (SELECT auth.uid())));

ALTER POLICY "Users can insert their own habit reminders" ON public.habit_reminders
  WITH CHECK (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = (SELECT auth.uid())));

ALTER POLICY "Users can update their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = (SELECT auth.uid())));

ALTER POLICY "Users can view their own habit reminders" ON public.habit_reminders
  USING (EXISTS (SELECT 1 FROM public.habits WHERE habits.id = habit_reminders.habit_id AND habits.user_id = (SELECT auth.uid())));

ALTER POLICY "insights_delete_own" ON public.journal_insights
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "insights_insert_own" ON public.journal_insights
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY "insights_select_own" ON public.journal_insights
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "insights_update_own" ON public.journal_insights
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY "journal_own" ON public.journal_entries
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "notes_own" ON public.notes
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "projects_own" ON public.projects
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "reading_list_delete" ON public.reading_list
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "reading_list_insert" ON public.reading_list
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER POLICY "reading_list_select" ON public.reading_list
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "reading_list_update" ON public.reading_list
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "routine_items_self" ON public.routine_items
  USING (routine_id IN (SELECT routines.id FROM public.routines WHERE routines.user_id = (SELECT auth.uid())))
  WITH CHECK (routine_id IN (SELECT routines.id FROM public.routines WHERE routines.user_id = (SELECT auth.uid())));

ALTER POLICY "routines_self" ON public.routines
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER POLICY "user_onboarding_owner" ON public.user_onboarding
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY "willpower_self" ON public.willpower_state
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER POLICY "focus_sessions_own" ON public.focus_sessions
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "focus_tasks_own" ON public.focus_tasks
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "daily_capacity_self" ON public.daily_capacity
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER POLICY "ai_requests_owner_select" ON public.ai_requests
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users can read own badges" ON public.profile_badges
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Anyone can read challenges" ON public.challenges
  USING ((SELECT auth.role()) = 'authenticated'::text);

ALTER POLICY "Anyone can read templates" ON public.habit_templates
  USING ((SELECT auth.role()) = 'authenticated'::text);

-- 3. InitPlan wrapping and twin removal, tables that 036 / 040 may have changed
--    or moved to archive_f13 (scope addendum F13 leftovers, notion tokens, the
--    old weekly_xp writer). Each row is looked up first: a missing table or
--    policy is skipped with a NOTICE, never an error. 15 rewrites, 2 drops.
--    weekly_xp "System can manage weekly xp" is the client-writable policy
--    036 drops; dropping it again here is a no-op after 036 and closes it if
--    036 was skipped. The rollback never re-creates it.
DO $f10$
DECLARE
  r record;
  v_schema text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('weekly_xp', 'System can manage weekly xp', 'drop', NULL, NULL),
      ('weekly_xp', 'Users can read all weekly xp', 'alter', $e$(SELECT auth.role()) = 'authenticated'::text$e$, NULL),
      ('notion_integrations', 'Users manage own notion integration', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_gamification', 'Users can insert own gamification stats', 'alter', NULL, $e$(SELECT auth.uid()) = user_id$e$),
      ('user_gamification', 'Users can update own gamification stats', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_gamification', 'Users can view own gamification stats', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('ai_calls', 'ai_calls_self', 'alter', $e$user_id = (SELECT auth.uid())$e$, $e$user_id = (SELECT auth.uid())$e$),
      ('user_challenges', 'Users can manage their challenges', 'drop', NULL, NULL),
      ('user_challenges', 'Users can manage own challenge enrollments', 'alter', $e$(SELECT auth.uid()) = user_id$e$, $e$(SELECT auth.uid()) = user_id$e$),
      ('user_quests', 'Users insert own quests', 'alter', NULL, $e$(SELECT auth.uid()) = user_id$e$),
      ('user_quests', 'Users update own quests', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_quests', 'Users view own quests', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_pets', 'Users update own pet', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_pets', 'Users view own pet', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_skills', 'Users update own skills', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_skills', 'Users view own skills', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL),
      ('user_inventory', 'Users view own inventory', 'alter', $e$(SELECT auth.uid()) = user_id$e$, NULL)
    ) AS t(tbl, pol, act, using_expr, check_expr)
  LOOP
    SELECT n.nspname INTO v_schema
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = r.tbl
       AND c.relkind IN ('r', 'p')
       AND n.nspname IN ('public', 'archive_f13')
     ORDER BY (n.nspname = 'public') DESC
     LIMIT 1;
    IF v_schema IS NULL THEN
      RAISE NOTICE '041: table % not found, skipped', r.tbl;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = v_schema AND p.tablename = r.tbl AND p.policyname = r.pol) THEN
      RAISE NOTICE '041: policy % on %.% not found, skipped', r.pol, v_schema, r.tbl;
      CONTINUE;
    END IF;
    IF r.act = 'drop' THEN
      v_sql := format('DROP POLICY %I ON %I.%I', r.pol, v_schema, r.tbl);
    ELSE
      v_sql := format('ALTER POLICY %I ON %I.%I', r.pol, v_schema, r.tbl);
      IF r.using_expr IS NOT NULL THEN
        v_sql := v_sql || ' USING (' || r.using_expr || ')';
      END IF;
      IF r.check_expr IS NOT NULL THEN
        v_sql := v_sql || ' WITH CHECK (' || r.check_expr || ')';
      END IF;
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $f10$;

-- 4. Sub-step FK (GEM-04): deleting a parent task removes its sub-steps.
--    One statement: the constraint is never absent. Existing rows already
--    satisfy the old rule, so the re-check cannot fail.
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey,
  ADD CONSTRAINT tasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

-- 5. Leading-column indexes for foreign keys (DB2-10). Plain CREATE INDEX on
--    purpose: CONCURRENTLY cannot run inside a transaction or a multi-statement
--    script, and every table here holds a handful of rows. Nullable columns get
--    a partial index (col IS NOT NULL); the FK checks the planner runs are
--    "col = $1", which implies NOT NULL, so the partial index serves them.
--    The seven F13 tables 040 moves to archive_f13 are deliberately NOT
--    indexed (boss_contributors.user_id, user_challenges.challenge_id,
--    user_challenges.habit_id, user_inventory.item_id,
--    user_pets.current_stage_id, user_quests.quest_id, user_skills.skill_id).
-- ai_conversation_actions.conversation_id: the only index that starts with it,
-- ai_actions_conversation_pending_idx, is PARTIAL (status = 'pending') and cannot
-- serve the ON DELETE CASCADE lookup from ai_conversations.
CREATE INDEX IF NOT EXISTS ai_conversation_actions_conversation_idx
  ON public.ai_conversation_actions (conversation_id);
CREATE INDEX IF NOT EXISTS ai_conversation_actions_assistant_message_idx
  ON public.ai_conversation_actions (assistant_message_id) WHERE assistant_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_conversations_project_idx
  ON public.ai_conversations (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deep_work_sessions_user_idx ON public.deep_work_sessions (user_id);
CREATE INDEX IF NOT EXISTS focus_sessions_task_idx
  ON public.focus_sessions (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS focus_tasks_user_idx ON public.focus_tasks (user_id);
CREATE INDEX IF NOT EXISTS goals_user_idx ON public.goals (user_id);
CREATE INDEX IF NOT EXISTS habit_deletions_user_idx ON public.habit_deletions (user_id);
CREATE INDEX IF NOT EXISTS habit_reminders_habit_idx
  ON public.habit_reminders (habit_id) WHERE habit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS habits_cue_habit_idx
  ON public.habits (cue_habit_id) WHERE cue_habit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS key_results_user_idx ON public.key_results (user_id);
CREATE INDEX IF NOT EXISTS okrs_user_idx ON public.okrs (user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id);
CREATE INDEX IF NOT EXISTS recovery_plans_source_log_idx
  ON public.recovery_plans (source_log_id) WHERE source_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS routine_items_routine_idx ON public.routine_items (routine_id);
CREATE INDEX IF NOT EXISTS routines_user_idx ON public.routines (user_id);
CREATE INDEX IF NOT EXISTS tasks_parent_task_idx
  ON public.tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_project_idx
  ON public.tasks (project_id) WHERE project_id IS NOT NULL;

-- 5b. Same defect class on the tables 028..037 create (GEM-03 and seven
--     siblings). Looked up with to_regclass: a table that is not there yet is
--     skipped, so this file also runs before 028..037.
DO $f10$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('habit_checklist_items',     'habit_checklist_items_user_idx',     'user_id',     false),
      ('habit_checklist_checks',    'habit_checklist_checks_habit_idx',   'habit_id',    false),
      ('routine_templates',         'routine_templates_user_idx',         'user_id',     false),
      ('routine_template_versions', 'routine_template_versions_user_idx', 'user_id',     false),
      ('routine_sessions',          'routine_sessions_template_idx',      'template_id', true),
      ('mood_definitions',          'mood_definitions_user_idx',          'user_id',     false),
      ('review_next_actions',       'review_next_actions_habit_idx',      'habit_id',    true),
      ('habit_xp_awards',           'habit_xp_awards_user_idx',           'user_id',     false)
    ) AS t(tbl, idx, col, nullable_col)
  LOOP
    IF to_regclass(format('public.%I', r.tbl)) IS NULL THEN
      RAISE NOTICE '041: table % not found, index % skipped', r.tbl, r.idx;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)%s',
                   r.idx, r.tbl, r.col,
                   CASE WHEN r.nullable_col THEN format(' WHERE %I IS NOT NULL', r.col) ELSE '' END);
  END LOOP;
END $f10$;

-- 6. Duplicate index (DB2-19): habit_logs_habit_id_completed_at_key (UNIQUE)
--    already indexes (habit_id, completed_at).
DROP INDEX IF EXISTS public.idx_habit_logs_habit_date;

-- 7. Post-condition: no policy in public or archive_f13 still calls auth.uid()
--    or auth.role() outside a (SELECT ...) wrapper. Fails the whole script if
--    one was missed, including a policy a later migration adds in the bare form.
DO $f10$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.schemaname || '.' || p.tablename || ' / ' || p.policyname, '; '
                    ORDER BY p.schemaname, p.tablename, p.policyname)
    INTO v_bad
    FROM pg_policies p
   WHERE p.schemaname IN ('public', 'archive_f13')
     AND regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                        '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi')
         ~* 'auth\.(uid|role)\(\)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '041: policies still call auth.uid()/auth.role() per row: %', v_bad;
  END IF;
END $f10$;
