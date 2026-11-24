-- 08: privilege, search_path, sensitive-column and stale-claim hygiene of migration 040
-- (F09 + F07-R3; DB2-13, DB1-07, DB1-08, DB2-18, DB1-06, DB1-04, DB2-05, REP-03, DB1-12,
-- DB2-16, DB1-11, GEM-02, EDG-08, DB1-09, DB2-15, DB2-08, DB2-12, DB1-10, DB1-20).
--
-- Pure SQL in the F01 protocol: zero psql meta-commands, zero privilege/policy DDL,
-- every check emits one static RESULT|<name>|PASS|FAIL line through aderyth_test, and
-- the entire file runs in one transaction ending in ROLLBACK.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Global anon / PUBLIC / search_path hygiene (DB2-13, DB1-07, DB1-08, DB2-18, DB1-06)
-- ---------------------------------------------------------------------------
DO $t08a$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  PERFORM aderyth_test.res('T08a1_anon_no_secdef_execute', v_bad IS NULL,
    coalesce(v_bad, 'anon has zero EXECUTE on public SECURITY DEFINER functions'));

  SELECT string_agg(c.oid::regclass::text, ', ') INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND (has_table_privilege('anon', c.oid, 'INSERT')
       OR has_table_privilege('anon', c.oid, 'UPDATE')
       OR has_table_privilege('anon', c.oid, 'DELETE')
       OR has_table_privilege('anon', c.oid, 'TRUNCATE')
       OR has_table_privilege('anon', c.oid, 'MAINTAIN')
       OR has_table_privilege('authenticated', c.oid, 'MAINTAIN'));
  PERFORM aderyth_test.res('T08a2_anon_no_table_write_or_maintain', v_bad IS NULL,
    coalesce(v_bad, 'zero anon write/maintain and zero authenticated maintain on public tables'));

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
     );
  PERFORM aderyth_test.res('T08a3_all_secdef_pin_search_path', v_bad IS NULL,
    coalesce(v_bad, 'every public SECURITY DEFINER function pins search_path'));
END $t08a$;

SAVEPOINT sp_probe_fn;
CREATE FUNCTION public._f09_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SELECT aderyth_test.res('T08a4_new_function_closed_to_anon_by_default',
  NOT has_function_privilege('anon', 'public._f09_probe()', 'EXECUTE'),
  'default function privileges no longer open EXECUTE to anon');
ROLLBACK TO SAVEPOINT sp_probe_fn;

-- ---------------------------------------------------------------------------
-- B. Leaderboard & rank (DB1-04, DB2-05, REP-03): auth required, clamped 1..100, own rank only
--    Seed 105 users via real habit + habit_logs trigger chain so total_xp and weekly_xp
--    are both > 0 and xp_drift() remains 0 throughout.
-- ---------------------------------------------------------------------------
DO $seed_lb$
DECLARE
  v_i integer;
  v_u uuid;
  v_h uuid;
BEGIN
  FOR v_i IN 1..105 LOOP
    v_u := ('08000000-0000-4000-8000-' || lpad(to_hex(v_i), 12, '0'))::uuid;
    v_h := ('08100000-0000-4000-8000-' || lpad(to_hex(v_i), 12, '0'))::uuid;
    INSERT INTO auth.users (id, email)
    VALUES (v_u, 'lb' || v_i || '@aderyth.test');
    INSERT INTO public.profiles (id, email, username)
    VALUES (v_u, 'lb' || v_i || '@aderyth.test', 'lb_' || lpad(v_i::text, 3, '0'));
    INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty, status)
    VALUES (v_h, v_u, 'LB Habit ' || v_i, 'boolean', least(10, greatest(1, (v_i % 10) + 1)), 'active');
    INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state, is_completed)
    VALUES (v_h, v_u, CURRENT_DATE, 'done', true);
  END LOOP;
END $seed_lb$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.res('T08b1_global_leaderboard_clamped_100',
  (SELECT count(*) FROM public.get_global_leaderboard(100000)) = 100
  AND (SELECT count(*) FROM public.get_global_leaderboard(0)) = 1,
  'get_global_leaderboard clamps limit_val into 1..100');

SELECT aderyth_test.res('T08b2_weekly_leaderboard_clamped_100',
  (SELECT count(*) FROM public.get_weekly_leaderboard(100000)) = 100
  AND (SELECT count(*) FROM public.get_weekly_leaderboard(0)) = 1,
  'get_weekly_leaderboard clamps limit_val into 1..100');

SELECT aderyth_test.res('T08b4_rank_other_user_returns_empty',
  (SELECT count(*) FROM public.get_user_rank('08000000-0000-4000-8000-000000000002')) = 0,
  'get_user_rank returns 0 rows for another user id');

SELECT aderyth_test.res('T08b5_rank_own_user_returns_exact_standing',
  r.cnt = 1
  AND r.rk = 1 + (
    SELECT count(*) FROM public.profiles o
     WHERE coalesce(o.total_xp, 0) > (SELECT coalesce(total_xp, 0) FROM public.profiles WHERE id = '08000000-0000-4000-8000-000000000001')
  ),
  format('rows=%s rank=%s', r.cnt, r.rk))
  FROM (
    SELECT count(*) AS cnt, max(rank) AS rk
      FROM public.get_user_rank('08000000-0000-4000-8000-000000000001')
  ) r;

SELECT set_config('request.jwt.claim.sub', '', true);
DO $t08b6$
DECLARE
  v_bad text := '';
BEGIN
  BEGIN
    PERFORM public.get_global_leaderboard(10);
    v_bad := v_bad || 'global ran without sub; ';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'authentication required' THEN v_bad := v_bad || 'global wrong msg: ' || SQLERRM || '; '; END IF;
  END;
  BEGIN
    PERFORM public.get_weekly_leaderboard(10);
    v_bad := v_bad || 'weekly ran without sub; ';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'authentication required' THEN v_bad := v_bad || 'weekly wrong msg: ' || SQLERRM || '; '; END IF;
  END;
  BEGIN
    PERFORM public.get_user_rank('08000000-0000-4000-8000-000000000001');
    v_bad := v_bad || 'rank ran without sub; ';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'authentication required' THEN v_bad := v_bad || 'rank wrong msg: ' || SQLERRM || '; '; END IF;
  END;
  PERFORM aderyth_test.res('T08b6_no_jwt_subject_raises_42501', v_bad = '',
    coalesce(nullif(v_bad, ''), '42501 authentication required on all 3 RPCs'));
END $t08b6$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $t08b3$
DECLARE
  v_bad text := '';
BEGIN
  BEGIN
    PERFORM public.get_global_leaderboard(10);
    v_bad := v_bad || 'anon global ran; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_weekly_leaderboard(10);
    v_bad := v_bad || 'anon weekly ran; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_user_rank('08000000-0000-4000-8000-000000000001');
    v_bad := v_bad || 'anon rank ran; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM aderyth_test.res('T08b3_anon_leaderboards_and_rank_denied', v_bad = '',
    coalesce(nullif(v_bad, ''), 'anon denied 42501 on global, weekly and rank'));
END $t08b3$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- C. profiles INSERT columns (DB1-12, DB2-16), username shape CHECK & handle_new_user (DB1-11)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('08200000-0000-4000-8000-000000000001', 'prof1@aderyth.test'),
  ('08200000-0000-4000-8000-000000000002', 'prof2@aderyth.test');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08200000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.expect_allowed('T08c1_profiles_insert_allowed_columns',
  $q$INSERT INTO public.profiles (id, email, username) VALUES ('08200000-0000-4000-8000-000000000001', 'prof1@aderyth.test', 'Ayşe_01')$q$, 1);

SELECT set_config('request.jwt.claim.sub', '08200000-0000-4000-8000-000000000002', true);
SELECT aderyth_test.expect_denied('T08c2_profiles_insert_xp_or_coins_denied',
  $q$INSERT INTO public.profiles (id, total_xp) VALUES ('08200000-0000-4000-8000-000000000002', 5)$q$);

SELECT set_config('request.jwt.claim.sub', '08200000-0000-4000-8000-000000000001', true);
DO $t08c3$
DECLARE
  v_cand text;
  v_bad text := '';
BEGIN
  FOREACH v_cand IN ARRAY ARRAY['ab', repeat('x', 33), 'a' || chr(1) || 'bc', '<b>x', ' leading'] LOOP
    BEGIN
      EXECUTE $q$UPDATE public.profiles SET username = $1 WHERE id = '08200000-0000-4000-8000-000000000001'$q$ USING v_cand;
      v_bad := v_bad || format('accepted invalid username [%s]; ', v_cand);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  PERFORM aderyth_test.res('T08c3_profiles_username_invalid_shapes_refused', v_bad = '',
    coalesce(nullif(v_bad, ''), 'short, >32, control, angle-bracket and untrimmed usernames rejected with 23514'));
END $t08c3$;

SELECT aderyth_test.expect_allowed('T08c4_profiles_username_turkish_and_null_allowed',
  $q$UPDATE public.profiles SET username = CASE WHEN username = 'Ayşe_K' THEN NULL ELSE 'Ayşe_K' END WHERE id = '08200000-0000-4000-8000-000000000001'$q$, 1);

RESET ROLE;
SAVEPOINT sp_signup_trigger;
CREATE TRIGGER f09_probe_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('08200000-0000-4000-8000-000000000003', 'short@aderyth.test', '{"username":"  x  "}'::jsonb),
  ('08200000-0000-4000-8000-000000000004', 'clean@aderyth.test', '{"username":"  <b>Çağrı</b>  "}'::jsonb);
SELECT aderyth_test.res('T08c5_handle_new_user_sanitizes_signup_metadata',
  (SELECT username IS NULL FROM public.profiles WHERE id = '08200000-0000-4000-8000-000000000003')
  AND (SELECT username = 'bÇağrı/b' FROM public.profiles WHERE id = '08200000-0000-4000-8000-000000000004'),
  'handle_new_user maps <3 cleaned username to NULL and strips <> / trim');
ROLLBACK TO SAVEPOINT sp_signup_trigger;

-- ---------------------------------------------------------------------------
-- D. 028..031 ten tables (GEM-02): narrow privileges and RLS isolation
-- ---------------------------------------------------------------------------
DO $t08d1$
DECLARE
  v_t text;
  v_bad text := '';
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'habit_pauses', 'habit_goal_versions', 'habit_checklist_items',
    'habit_checklist_checks', 'routine_templates', 'routine_template_versions',
    'routine_sessions', 'mood_definitions', 'mood_checkins', 'review_next_actions'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT') THEN
      v_bad := v_bad || v_t || ':anon_select; ';
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_t, 'MAINTAIN') THEN
      v_bad := v_bad || v_t || ':auth_maintain; ';
    END IF;
    IF NOT (has_table_privilege('authenticated', 'public.' || v_t, 'SELECT')
        AND has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
        AND has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
        AND has_table_privilege('authenticated', 'public.' || v_t, 'DELETE')) THEN
      v_bad := v_bad || v_t || ':auth_crud_missing; ';
    END IF;
  END LOOP;
  PERFORM aderyth_test.res('T08d1_028_031_anon_closed_auth_narrow', v_bad = '',
    coalesce(nullif(v_bad, ''), 'all 10 tables closed to anon and narrow CRUD for authenticated'));
END $t08d1$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.habit_pauses (user_id, habit_id, kind, start_date, end_date)
VALUES ('08000000-0000-4000-8000-000000000001', '08100000-0000-4000-8000-000000000001', 'pause', CURRENT_DATE, CURRENT_DATE + 1);

SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000002', true);
SELECT aderyth_test.res('T08d2_028_031_rls_owner_isolation',
  (SELECT count(*) FROM public.habit_pauses WHERE user_id = '08000000-0000-4000-8000-000000000001') = 0,
  'other user sees 0 habit_pauses rows');

SELECT aderyth_test.expect_denied('T08d3_028_031_cross_tenant_write_denied',
  $q$INSERT INTO public.habit_pauses (user_id, habit_id, kind, start_date, end_date)
     VALUES ('08000000-0000-4000-8000-000000000001', '08100000-0000-4000-8000-000000000001', 'pause', CURRENT_DATE + 3, CURRENT_DATE + 4)$q$);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- E. OAuth token tables (EDG-08, DB1-09)
-- ---------------------------------------------------------------------------
INSERT INTO public.notion_integrations (user_id, access_token, workspace_id, workspace_name)
VALUES ('08000000-0000-4000-8000-000000000001', 'secret-notion-tok', 'ws-1', 'Aderyth Notion');
INSERT INTO public.google_calendar_integrations (user_id, access_token, refresh_token, expires_at)
VALUES ('08000000-0000-4000-8000-000000000001', 'secret-gcal-tok', 'secret-gcal-ref', now() + interval '1 hour');
INSERT INTO public.spotify_accounts (user_id, spotify_user_id, access_token, refresh_token, expires_at)
VALUES ('08000000-0000-4000-8000-000000000001', 'sp-u1', 'secret-sp-tok', 'secret-sp-ref', now() + interval '1 hour');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.expect_denied('T08e1_notion_access_token_denied',
  $q$SELECT access_token FROM public.notion_integrations WHERE user_id = '08000000-0000-4000-8000-000000000001'$q$);

DO $t08e2$
DECLARE
  v_own integer;
  v_other integer;
BEGIN
  SELECT count(*) INTO v_own FROM public.notion_integrations WHERE workspace_name = 'Aderyth Notion';
  PERFORM set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_other FROM public.notion_integrations WHERE workspace_name = 'Aderyth Notion';
  PERFORM set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
  PERFORM aderyth_test.res('T08e2_notion_safe_columns_owner_only',
    v_own = 1 AND v_other = 0,
    format('owner=%s other=%s', v_own, v_other));
END $t08e2$;

SELECT aderyth_test.expect_denied('T08e3_notion_client_insert_denied',
  $q$INSERT INTO public.notion_integrations (user_id, access_token) VALUES ('08000000-0000-4000-8000-000000000001', 'x')$q$);

SELECT aderyth_test.expect_denied('T08e4_google_tokens_client_denied',
  $q$SELECT * FROM public.google_calendar_integrations$q$);

SELECT aderyth_test.expect_denied('T08e5_spotify_tokens_client_denied',
  $q$SELECT * FROM public.spotify_accounts$q$);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT aderyth_test.res('T08e6_service_role_reads_all_token_tables',
  (SELECT count(*) FROM public.notion_integrations WHERE access_token = 'secret-notion-tok') = 1
  AND (SELECT count(*) FROM public.google_calendar_integrations WHERE access_token = 'secret-gcal-tok') = 1
  AND (SELECT count(*) FROM public.spotify_accounts WHERE access_token = 'secret-sp-tok') = 1,
  'service_role reads access_token on all three OAuth integration tables');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F. Cancelled F13 tables & functions (DB2-12, DB1-10)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $t08f1$
DECLARE
  v_bad text := '';
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'user_gamification', 'ai_calls', 'calendars', 'event_templates',
    'global_bosses', 'pet_stages', 'quests', 'shop_items',
    'skills', 'challenges', 'habit_templates'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_t, 'DELETE') THEN
      v_bad := v_bad || v_t || ' still writable; ';
    END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.user_gamification (user_id, makeup_credits) VALUES ('08000000-0000-4000-8000-000000000001', 999);
    v_bad := v_bad || 'user_gamification insert succeeded; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_calls SET called_at = now();
    v_bad := v_bad || 'ai_calls update succeeded; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.calendars (user_id, name) VALUES ('08000000-0000-4000-8000-000000000001', 'c');
    v_bad := v_bad || 'calendars insert succeeded; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.habit_templates;
    v_bad := v_bad || 'habit_templates delete succeeded; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM aderyth_test.res('T08f1_f13_11_public_tables_write_denied', v_bad = '',
    coalesce(nullif(v_bad, ''), 'all 11 remaining dormant tables refuse authenticated writes with 42501'));
END $t08f1$;
RESET ROLE;

DO $t08f2$
DECLARE
  v_t text;
  v_bad text := '';
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'user_pets', 'user_inventory', 'user_quests',
    'user_skills', 'boss_contributors', 'user_challenges'
  ] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      v_bad := v_bad || 'public.' || v_t || ' still exists; ';
    END IF;
    IF to_regclass('archive_f13.' || v_t) IS NULL THEN
      v_bad := v_bad || 'archive_f13.' || v_t || ' missing; ';
    END IF;
  END LOOP;
  IF has_schema_privilege('authenticated', 'archive_f13', 'USAGE')
     OR has_schema_privilege('anon', 'archive_f13', 'USAGE') THEN
    v_bad := v_bad || 'archive_f13 USAGE open; ';
  END IF;
  PERFORM aderyth_test.res('T08f2_f13_6_tables_moved_to_archive_f13', v_bad = '',
    coalesce(nullif(v_bad, ''), '6 F13 user tables moved to unexposed archive_f13 schema'));
END $t08f2$;

SELECT aderyth_test.res('T08f3_f13_zombie_triggers_dropped',
  NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname IN ('on_profile_created_pet', 'on_habit_completed_damage_boss')
       AND NOT tgisinternal
  ),
  'on_profile_created_pet and on_habit_completed_damage_boss dropped');

DO $t08f4$
DECLARE
  v_sig text;
  v_bad text := '';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.buy_shop_item(uuid)',
    'public.check_level_up_and_grant_skills()',
    'public.claim_quest_reward(uuid)',
    'public.deal_damage_to_active_boss(uuid, integer)',
    'public.get_active_boss_status()',
    'public.get_daily_quests()',
    'public.get_user_pet_status()',
    'public.get_user_skill_tree()',
    'public.initialize_user_pet()',
    'public.interact_with_pet(character varying)',
    'public.trigger_damage_on_habit_log()',
    'public.upgrade_skill(character varying)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NOT NULL
       AND (has_function_privilege('anon', v_sig, 'EXECUTE')
         OR has_function_privilege('authenticated', v_sig, 'EXECUTE')) THEN
      v_bad := v_bad || v_sig || '; ';
    END IF;
  END LOOP;
  PERFORM aderyth_test.res('T08f4_f13_rpcs_closed_to_clients', v_bad = '',
    coalesce(nullif(v_bad, ''), 'all 12 F13 functions closed to anon and authenticated'));
END $t08f4$;

-- ---------------------------------------------------------------------------
-- G. add_xp locking, profile-less account bootstrap & P0002 guard (DB2-15)
--    Run inside a SAVEPOINT so un-logged direct add_xp XP is rolled back before T08z.
-- ---------------------------------------------------------------------------
SAVEPOINT sp_add_xp;
INSERT INTO auth.users (id, email)
VALUES ('08700000-0000-4000-8000-000000000001', 'addxp@aderyth.test');

SELECT public.add_xp('08700000-0000-4000-8000-000000000001', 40);
SELECT public.add_xp('08700000-0000-4000-8000-000000000001', 70);

SELECT aderyth_test.res('T08g1_add_xp_creates_missing_profile_and_levels_up',
  p.total_xp = 110 AND p.level = 2 AND p.current_level_xp = 10 AND p.next_level_xp = 115,
  format('total_xp=%s level=%s current=%s next=%s', p.total_xp, p.level, p.current_level_xp, p.next_level_xp))
  FROM public.profiles p
 WHERE p.id = '08700000-0000-4000-8000-000000000001';

DO $t08g2$
DECLARE
  v_ok boolean := false;
  v_detail text := 'add_xp succeeded for non-existent auth.users id';
BEGIN
  BEGIN
    PERFORM public.add_xp('08700000-0000-4000-8000-999999999999', 10);
  EXCEPTION WHEN no_data_found THEN
    v_ok := true;
    v_detail := 'P0002: ' || SQLERRM;
  END;
  PERFORM aderyth_test.res('T08g2_add_xp_unknown_user_raises_p0002', v_ok, v_detail);
END $t08g2$;
ROLLBACK TO SAVEPOINT sp_add_xp;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT aderyth_test.expect_denied('T08g3_add_xp_closed_to_authenticated',
  $q$SELECT public.add_xp('08000000-0000-4000-8000-000000000001', 10)$q$);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- H. Subscription renewal locking (DB2-08) & F07-R3 mode-aware ai_request_reconcile_stale
-- ---------------------------------------------------------------------------
INSERT INTO public.user_subscriptions (user_id, focus_points, monthly_grant, credits_period_end)
VALUES ('08000000-0000-4000-8000-000000000001', 3, 30, now() - interval '1 minute')
ON CONFLICT (user_id) DO UPDATE
  SET focus_points = 3, monthly_grant = 30, credits_period_end = now() - interval '1 minute';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT public.get_or_init_subscription();
SELECT public.get_or_init_subscription();
RESET ROLE;
SELECT public.get_or_init_subscription_for('08000000-0000-4000-8000-000000000001');

SELECT aderyth_test.res('T08h1_subscription_renewal_single_ledger_row',
  (SELECT count(*) FROM public.credit_transactions
    WHERE user_id = '08000000-0000-4000-8000-000000000001' AND reason = 'monthly_renewal') = 1
  AND (SELECT focus_points FROM public.user_subscriptions
        WHERE user_id = '08000000-0000-4000-8000-000000000001') = 30,
  'single monthly_renewal row across repeated calls');

SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T08h2_subscription_anon_denied',
  $q$SELECT public.get_or_init_subscription()$q$);
RESET ROLE;

-- F07-R3: mode-aware stale claim error text ('routine' keeps onboarding copy; coach/summarize/insights use generic copy)
INSERT INTO public.ai_requests (user_id, request_id, mode, input_fingerprint, status, lease_expires_at) VALUES
  ('08000000-0000-4000-8000-000000000002', 'f07r3-routine', 'routine', 'fp-r', 'in_progress', now() - interval '2 minutes'),
  ('08000000-0000-4000-8000-000000000002', 'f07r3-coach', 'coach', 'fp-c', 'in_progress', now() - interval '2 minutes'),
  ('08000000-0000-4000-8000-000000000002', 'f07r3-summarize', 'summarize', 'fp-s', 'in_progress', now() - interval '2 minutes'),
  ('08000000-0000-4000-8000-000000000002', 'f07r3-insights', 'insights', 'fp-i', 'in_progress', now() - interval '2 minutes');

SET LOCAL ROLE service_role;
SELECT public.spend_focus_points_v2('08000000-0000-4000-8000-000000000002', 5, 'ai_coach', 'f07r3-coach');
SELECT public.ai_request_reconcile_stale('08000000-0000-4000-8000-000000000002', 10);
RESET ROLE;

SELECT aderyth_test.res('T08h3_reconcile_stale_mode_aware_messages',
  (SELECT status = 'failed' AND error = 'Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.'
     FROM public.ai_requests WHERE user_id = '08000000-0000-4000-8000-000000000002' AND request_id = 'f07r3-routine')
  AND (SELECT bool_and(status = 'failed' AND error = 'İstek yarıda kaldı: istek süresi doldu ve ücreti iade edildi.')
         FROM public.ai_requests
        WHERE user_id = '08000000-0000-4000-8000-000000000002'
          AND request_id IN ('f07r3-coach', 'f07r3-summarize', 'f07r3-insights'))
  AND EXISTS (
    SELECT 1 FROM public.credit_transactions
     WHERE user_id = '08000000-0000-4000-8000-000000000002' AND request_id = 'f07r3-coach:refund'
  ),
  'routine uses onboarding message; coach/summarize/insights use generic Turkish message and refund');

SELECT aderyth_test.res('T08h4_reconcile_stale_privileges',
  NOT has_function_privilege('anon', 'public.ai_request_reconcile_stale(uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ai_request_reconcile_stale(uuid, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ai_request_reconcile_stale(uuid, integer)', 'EXECUTE'),
  'ai_request_reconcile_stale is service_role only');

-- ---------------------------------------------------------------------------
-- I. 037 get_today_bootstrap is strictly read-only (DB1-20) & xp_drift() = 0
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '08000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $t08i1$
DECLARE
  v_now jsonb;
  v_future jsonb;
  v_rows bigint;
BEGIN
  v_now := public.get_today_bootstrap(CURRENT_DATE);
  v_future := public.get_today_bootstrap(CURRENT_DATE + 1825);
  SELECT count(*) INTO v_rows
    FROM public.willpower_state
   WHERE user_id = '08000000-0000-4000-8000-000000000003';
  PERFORM aderyth_test.res('T08i1_today_bootstrap_read_only_no_willpower_insert',
    (v_now -> 'willpower') = 'null'::jsonb
    AND (v_future -> 'willpower') = 'null'::jsonb
    AND v_rows = 0
    AND (SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.get_today_bootstrap(date)'::regprocedure),
    format('willpower=%s rows=%s', v_now -> 'willpower', v_rows));
END $t08i1$;
RESET ROLE;

SELECT aderyth_test.res('T08z_xp_drift_zero',
  (SELECT count(*) FROM public.xp_drift()) = 0,
  format('%s xp_drift row(s)', (SELECT count(*) FROM public.xp_drift())));

ROLLBACK;
