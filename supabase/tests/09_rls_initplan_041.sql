-- 09: migration 041 (RLS initplan wrapping, de-duplicated permissive policies,
-- foreign-key leading indexes, duplicate habit_logs index removal, tasks sub-step
-- ON DELETE CASCADE).
-- (Implementation F10; findings DB1-14, DB1-16, DB2-10, DB2-19, GEM-03, GEM-04)
--
-- Pure SQL in the F01 protocol: zero psql meta-commands (\set, \i), zero privilege
-- or policy DDL (sqlBehaviorTestsWired.test.ts:944-954). Runs under
-- supabase/tests/run.sh after live_schema.sql + 028..041 against the local
-- throwaway Postgres 17 only. Entire file runs inside one transaction ending in
-- ROLLBACK. Idempotent re-apply of 041 and the real ALTER POLICY negative control
-- run in .github/workflows/ci.yml ("Migration 041 enforces InitPlan post-condition
-- and re-applies idempotently (F10)").

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers (installed inside aderyth_test for this transaction only)
-- ---------------------------------------------------------------------------
-- Bare auth.uid() / auth.role() call = one outside a (SELECT ...) wrapper.
-- pg_policies prints the wrapper as "( SELECT auth.uid() AS uid)".
CREATE OR REPLACE FUNCTION aderyth_test.t09_bare_policies() RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT string_agg(p.schemaname || '.' || p.tablename || '/' || p.policyname, '; '
                    ORDER BY p.schemaname, p.tablename, p.policyname)
    FROM pg_policies p
   WHERE p.schemaname IN ('public', 'archive_f13')
     AND regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                        '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi')
         ~* 'auth\.(uid|role)\(\)'
$f$;

-- Foreign-key columns of public tables without an index that starts with them
-- (a partial index "col IS NOT NULL" counts). The seven F13 columns 041
-- deliberately leaves unindexed (moved to archive_f13 by 040) are excluded.
CREATE OR REPLACE FUNCTION aderyth_test.t09_unindexed_fks() RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT string_agg(c.conrelid::regclass::text || '.' || a.attname, ', '
                    ORDER BY c.conrelid::regclass::text, a.attname)
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f'
     AND c.connamespace = 'public'::regnamespace
     AND NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid
              AND i.indkey[0] = c.conkey[1]
              AND i.indisvalid
              AND (i.indpred IS NULL
                   OR pg_get_expr(i.indpred, i.indrelid) = '(' || a.attname || ' IS NOT NULL)'))
     AND (c.conrelid::regclass::text, a.attname) NOT IN (
           VALUES ('boss_contributors', 'user_id'), ('user_challenges', 'challenge_id'),
                  ('user_challenges', 'habit_id'), ('user_inventory', 'item_id'),
                  ('user_pets', 'current_stage_id'), ('user_quests', 'quest_id'),
                  ('user_skills', 'skill_id'))
$f$;

-- Two or more PERMISSIVE policies covering the same command on one table.
CREATE OR REPLACE FUNCTION aderyth_test.t09_overlaps() RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT string_agg(x.schemaname || '.' || x.tablename || ':' || x.cmd || '=' || x.n, ', '
                    ORDER BY x.schemaname, x.tablename, x.cmd)
    FROM (
      SELECT p.schemaname, p.tablename, c.cmd, count(*) AS n
        FROM pg_policies p
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS c(cmd)
       WHERE p.permissive = 'PERMISSIVE'
         AND p.tablename IN ('tasks', 'challenges', 'habit_templates', 'weekly_xp', 'user_challenges')
         AND p.schemaname IN ('public', 'archive_f13')
         AND (p.cmd = c.cmd OR p.cmd = 'ALL')
       GROUP BY p.schemaname, p.tablename, c.cmd
      HAVING count(*) > 1
    ) x
$f$;

-- ---------------------------------------------------------------------------
-- Seed fixtures (rolled back at the end of the file)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('a9000000-0000-4000-8000-000000000001', 't09a@aderyth.test'),
  ('a9000000-0000-4000-8000-000000000002', 't09b@aderyth.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tasks (id, user_id, title) VALUES
  ('a9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-000000000001', 't09 task A'),
  ('a9000000-0000-4000-8000-0000000000b1', 'a9000000-0000-4000-8000-000000000002', 't09 task B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.habit_templates (name, habits)
SELECT 't09 template', '[]'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.habit_templates WHERE name = 't09 template');

INSERT INTO public.challenges (title)
SELECT 't09 challenge'
 WHERE NOT EXISTS (SELECT 1 FROM public.challenges WHERE title = 't09 challenge');

-- ---------------------------------------------------------------------------
-- T09a: No policy calls auth.uid()/auth.role() per row; detector self-test
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09a1_no_bare_auth_call_in_any_policy',
  aderyth_test.t09_bare_policies() IS NULL,
  coalesce(aderyth_test.t09_bare_policies(), 'none'));

SELECT aderyth_test.res('T09a2_detector_flags_bare_and_passes_wrapped',
  (regexp_replace('(user_id = auth.uid())',
       '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)')
  AND NOT (regexp_replace('(user_id = ( SELECT auth.uid() AS uid))',
       '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)'),
  'bare form flagged, wrapped form not flagged');

SELECT aderyth_test.res('T09a3_wrapped_policies_exist_non_vacuous',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND (qual ~ 'SELECT auth\.(uid|role)' OR with_check ~ 'SELECT auth\.(uid|role)')) >= 40,
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND (qual ~ 'SELECT auth\.(uid|role)' OR with_check ~ 'SELECT auth\.(uid|role)')));

-- ---------------------------------------------------------------------------
-- T09b: Duplicate permissive policies removed; weekly_xp client writer stays gone
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09b1_no_overlapping_permissive_policies',
  aderyth_test.t09_overlaps() IS NULL, coalesce(aderyth_test.t09_overlaps(), 'none'));

SELECT aderyth_test.res('T09b2_tasks_has_exactly_one_policy',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks') = 1,
  (SELECT string_agg(policyname, ' / ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks'));

SELECT aderyth_test.res('T09b3_weekly_xp_has_no_client_writer',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'weekly_xp'
                 AND policyname = 'System can manage weekly xp'),
  'System can manage weekly xp must stay dropped (036 / 041)');

-- ---------------------------------------------------------------------------
-- T09c: tasks survivor policy still isolates users (A cannot touch B; anon sees 0)
-- ---------------------------------------------------------------------------
SAVEPOINT sp_t09c_auth;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.res('T09c1_user_a_sees_only_own_task',
  (SELECT count(*) FROM public.tasks WHERE id IN
     ('a9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000b1')) = 1,
  'A sees A, not B');

SELECT aderyth_test.expect_denied('T09c2_user_a_cannot_insert_task_for_b',
  $q$ INSERT INTO public.tasks (user_id, title) VALUES ('a9000000-0000-4000-8000-000000000002', 't09 forged') $q$);

DO $t09c$
DECLARE n bigint;
BEGIN
  UPDATE public.tasks SET title = 't09 hijack' WHERE id = 'a9000000-0000-4000-8000-0000000000b1';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM aderyth_test.res('T09c3_user_a_update_of_b_row_hits_nothing', n = 0, 'rows=' || n);
  DELETE FROM public.tasks WHERE id = 'a9000000-0000-4000-8000-0000000000b1';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM aderyth_test.res('T09c4_user_a_delete_of_b_row_hits_nothing', n = 0, 'rows=' || n);
  UPDATE public.tasks SET title = 't09 task A edited' WHERE id = 'a9000000-0000-4000-8000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM aderyth_test.res('T09c5_user_a_can_update_own_task', n = 1, 'rows=' || n);
END $t09c$;
ROLLBACK TO SAVEPOINT sp_t09c_auth;

SAVEPOINT sp_t09c_anon;
SET LOCAL ROLE anon;
DO $t09c6$
DECLARE
  n bigint;
  v_ok boolean := false;
  v_detail text := '';
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.tasks;
    v_ok := (n = 0);
    v_detail := 'rows=' || n;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
    v_detail := 'no SELECT privilege (42501)';
  END;
  PERFORM aderyth_test.res('T09c6_anon_sees_no_task', v_ok, v_detail);
END $t09c6$;
ROLLBACK TO SAVEPOINT sp_t09c_anon;

-- ---------------------------------------------------------------------------
-- T09d: Catalog tables readable by signed-in users only (USING(true) twins gone)
-- ---------------------------------------------------------------------------
SAVEPOINT sp_t09d_auth;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.res('T09d1_authenticated_reads_habit_templates',
  (SELECT count(*) FROM public.habit_templates WHERE name = 't09 template') = 1, 'catalog visible');
SELECT aderyth_test.res('T09d2_authenticated_reads_challenges',
  (SELECT count(*) FROM public.challenges WHERE title = 't09 challenge') = 1, 'catalog visible');
ROLLBACK TO SAVEPOINT sp_t09d_auth;

SAVEPOINT sp_t09d_anon;
SET LOCAL ROLE anon;
SELECT aderyth_test.res('T09d3_anon_cannot_read_habit_templates',
  (SELECT count(*) FROM public.habit_templates) = 0, 'anon sees 0 rows');
SELECT aderyth_test.res('T09d4_anon_cannot_read_challenges',
  (SELECT count(*) FROM public.challenges) = 0, 'anon sees 0 rows');
ROLLBACK TO SAVEPOINT sp_t09d_anon;

-- ---------------------------------------------------------------------------
-- T09e: Plan shape — every readable public table whose SELECT policy calls
--       auth.uid()/auth.role() plans it once via an InitPlan
-- ---------------------------------------------------------------------------
SAVEPOINT sp_t09e;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $t09e$
DECLARE
  r record;
  line text;
  plan text;
  checked integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.schemaname, p.tablename
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.cmd IN ('SELECT', 'ALL')
       AND (p.qual ~* 'auth\.(uid|role)\(\)')
       AND has_table_privilege('authenticated', format('%I.%I', p.schemaname, p.tablename), 'SELECT')
     ORDER BY p.schemaname, p.tablename
  LOOP
    plan := '';
    FOR line IN EXECUTE format('EXPLAIN (COSTS OFF) SELECT * FROM %I.%I', r.schemaname, r.tablename) LOOP
      plan := plan || line || E'\n';
    END LOOP;
    PERFORM aderyth_test.res(format('T09e_initplan.%s', r.tablename), plan ~ 'InitPlan', replace(plan, E'\n', ' / '));
    checked := checked + 1;
  END LOOP;
  PERFORM aderyth_test.res('T09e_tables_checked_non_vacuous', checked >= 12, 'checked=' || checked);
END $t09e$;
ROLLBACK TO SAVEPOINT sp_t09e;

-- ---------------------------------------------------------------------------
-- T09f: Negative controls for EXPLAIN InitPlan probe and mixed-expression detector
-- ---------------------------------------------------------------------------
SAVEPOINT sp_t09f;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $t09f$
DECLARE
  line text;
  bare_plan text := '';
  wrapped_plan text := '';
BEGIN
  FOR line IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT id FROM auth.users WHERE email = auth.role()' LOOP
    bare_plan := bare_plan || line || E'\n';
  END LOOP;
  FOR line IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT id FROM auth.users WHERE email = (SELECT auth.role())' LOOP
    wrapped_plan := wrapped_plan || line || E'\n';
  END LOOP;
  PERFORM aderyth_test.res('T09f1_negative_control_bare_policy_shows_no_initplan',
    bare_plan !~ 'InitPlan' AND wrapped_plan ~ 'InitPlan',
    replace(bare_plan, E'\n', ' / '));
END $t09f$;
ROLLBACK TO SAVEPOINT sp_t09f;

SELECT aderyth_test.res('T09f2_negative_control_detector_names_the_policy',
  (regexp_replace('(auth.role() = ''authenticated''::text)',
       '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)')
  AND (regexp_replace('((user_id = ( SELECT auth.uid() AS uid)) AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = auth.uid()))',
       '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)')
  AND NOT (regexp_replace('((user_id = ( SELECT auth.uid() AS uid)) AND EXISTS (SELECT 1 FROM public.habits h WHERE h.id = habit_logs.habit_id AND h.user_id = ( SELECT auth.uid() AS uid)))',
       '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)'),
  'bare role and half-wrapped EXISTS flagged; fully wrapped EXISTS passes');

-- ---------------------------------------------------------------------------
-- T09g: Foreign-key leading-column indexes (DB2-10, GEM-03)
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09g1_every_fk_column_has_a_leading_index',
  aderyth_test.t09_unindexed_fks() IS NULL, coalesce(aderyth_test.t09_unindexed_fks(), 'none'));

SELECT aderyth_test.res('T09g2_named_indexes_exist',
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
     'ai_conversation_actions_conversation_idx', 'ai_conversation_actions_assistant_message_idx',
     'ai_conversations_project_idx',
     'deep_work_sessions_user_idx', 'focus_sessions_task_idx', 'focus_tasks_user_idx',
     'goals_user_idx', 'habit_deletions_user_idx', 'habit_reminders_habit_idx',
     'habits_cue_habit_idx', 'key_results_user_idx', 'okrs_user_idx', 'projects_user_idx',
     'recovery_plans_source_log_idx', 'routine_items_routine_idx', 'routines_user_idx',
     'tasks_parent_task_idx', 'tasks_project_idx')) = 18
  AND (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
     'habit_checklist_items_user_idx', 'habit_checklist_checks_habit_idx',
     'routine_templates_user_idx', 'routine_template_versions_user_idx',
     'routine_sessions_template_idx', 'mood_definitions_user_idx',
     'review_next_actions_habit_idx', 'habit_xp_awards_user_idx')) = 8,
  'all 26 FK indexes (18 live + 8 from 028..036) exist in public');

SAVEPOINT sp_t09g3;
DROP INDEX IF EXISTS public.projects_user_idx;
SELECT aderyth_test.res('T09g3_negative_control_missing_index_is_reported',
  aderyth_test.t09_unindexed_fks() LIKE '%projects.user_id%',
  coalesce(aderyth_test.t09_unindexed_fks(), 'none'));
ROLLBACK TO SAVEPOINT sp_t09g3;

-- ---------------------------------------------------------------------------
-- T09h: Duplicate habit_logs index dropped; UNIQUE constraint preserved (DB2-19)
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09h1_duplicate_habit_logs_index_is_gone',
  NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_habit_logs_habit_date'),
  'idx_habit_logs_habit_date dropped');

SELECT aderyth_test.res('T09h2_unique_constraint_still_indexes_habit_id_completed_at',
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'habit_logs_habit_id_completed_at_key' AND contype = 'u'),
  'habit_logs_habit_id_completed_at_key present');

SELECT aderyth_test.res('T09h3_habit_logs_has_no_two_identical_indexes',
  NOT EXISTS (SELECT 1 FROM pg_index a JOIN pg_index b
                ON a.indrelid = b.indrelid AND a.indexrelid < b.indexrelid
               AND a.indkey = b.indkey AND a.indclass = b.indclass
               AND coalesce(pg_get_expr(a.indpred, a.indrelid), '') = coalesce(pg_get_expr(b.indpred, b.indrelid), '')
             WHERE a.indrelid = 'public.habit_logs'::regclass),
  'no duplicate index on habit_logs');

-- ---------------------------------------------------------------------------
-- T09i: tasks_parent_task_id_fkey ON DELETE CASCADE & splitter flat payload (GEM-04)
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09i1_tasks_parent_fk_is_on_delete_cascade',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_parent_task_id_fkey' AND confdeltype = 'c'),
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tasks_parent_task_id_fkey'));

SAVEPOINT sp_t09i;
INSERT INTO public.tasks (id, user_id, title) VALUES
  ('a9000000-0000-4000-8000-0000000000c1', 'a9000000-0000-4000-8000-000000000001', 't09 parent');
INSERT INTO public.tasks (id, user_id, title, is_subtask, parent_task_id) VALUES
  ('a9000000-0000-4000-8000-0000000000c2', 'a9000000-0000-4000-8000-000000000001', 't09 child 1', true,
   'a9000000-0000-4000-8000-0000000000c1'),
  ('a9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-000000000001', 't09 child 2', true,
   'a9000000-0000-4000-8000-0000000000c1');
DELETE FROM public.tasks WHERE id = 'a9000000-0000-4000-8000-0000000000c2';
SELECT aderyth_test.res('T09i2_deleting_a_child_keeps_parent_and_sibling',
  (SELECT count(*) FROM public.tasks WHERE id IN
     ('a9000000-0000-4000-8000-0000000000c1', 'a9000000-0000-4000-8000-0000000000c3')) = 2, 'parent+sibling stay');

DO $t09i3$
DECLARE
  v_ok boolean := false;
  v_detail text := '';
BEGIN
  BEGIN
    DELETE FROM public.tasks WHERE id = 'a9000000-0000-4000-8000-0000000000c1';
    v_ok := NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = 'a9000000-0000-4000-8000-0000000000c3');
    v_detail := CASE WHEN v_ok THEN 'child gone' ELSE 'child survived parent delete' END;
  EXCEPTION WHEN foreign_key_violation THEN
    v_ok := false;
    v_detail := 'FK violation: ' || SQLERRM;
  END;
  PERFORM aderyth_test.res('T09i3_deleting_the_parent_removes_its_children', v_ok, v_detail);
END $t09i3$;
ROLLBACK TO SAVEPOINT sp_t09i;

SAVEPOINT sp_t09i4;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.expect_allowed('T09i4_splitter_payload_still_inserts',
  $q$ INSERT INTO public.tasks (user_id, title, description, status, priority, due_date, project_id, list_type, completed)
      VALUES ('a9000000-0000-4000-8000-000000000001', 't09 split step', '', 'pending', 'none', NULL, NULL, 'inbox', false) $q$, 1);
ROLLBACK TO SAVEPOINT sp_t09i4;

-- ---------------------------------------------------------------------------
-- T09j & T09k: RLS remains enabled everywhere a policy exists; xp_drift() = 0
-- ---------------------------------------------------------------------------
SELECT aderyth_test.res('T09j1_every_table_with_a_policy_still_has_rls_on',
  NOT EXISTS (SELECT 1 FROM pg_policies p
                JOIN pg_class c ON c.relname = p.tablename
                JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
               WHERE NOT c.relrowsecurity),
  'RLS enabled everywhere a policy exists');

SELECT aderyth_test.res('T09k1_xp_drift_stays_empty',
  (SELECT count(*) FROM public.xp_drift()) = 0, 'xp_drift() returned no row');

ROLLBACK;
