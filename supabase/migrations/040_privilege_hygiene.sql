-- ============================================================================
-- Migration 040: privilege, search_path and sensitive-column hygiene
-- STATUS: WRITTEN, NOT APPLIED (DB frozen per STATE.md S1/S2).
-- ============================================================================
-- Requires 028..037 (and 038, 039) applied. Fails closed otherwise.
-- Owner steps: docs/implementation-v3/SQL_FOR_OWNER.md section 1 and section 3.
-- Findings: DB2-13 DB1-07 DB1-08 DB2-18 DB1-06 DB1-04 DB2-05 REP-03 DB1-12
--           DB2-16 DB1-11 GEM-02 EDG-08 DB1-09 DB2-15 DB2-08 DB2-12 DB1-10.
-- F07-R3: ai_request_reconcile_stale writes a mode-aware message (section 7b).
-- DB1-20 (read-only get_today_bootstrap) is fixed in 037 itself while 037 is
-- unapplied; a database that already applied 037 needs a separate owner-approved
-- corrective migration (040 never replaces get_today_bootstrap).
-- DB1-13 (auth.users trigger) is a read-only owner query, not created here.
-- XP path (habit_logs -> fn_habit_log_award -> add_xp) is unchanged:
-- xp_drift() stays 0.
--
-- Rollback (F02): supabase/rollbacks/040_privilege_hygiene.rollback.sql. Section 0b
-- records every ACL of the public schema (tables, columns, functions) and the default
-- privileges of role postgres before anything changes, plus the zombie triggers that
-- section 8a drops, in archive_040 (not exposed by PostgREST, no client rights). The
-- rollback restores exactly that state, so the CI catalog fingerprint after rolling
-- back 040..028 equals the baseline again.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail closed)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.habit_xp_awards') IS NULL THEN
    RAISE EXCEPTION '040 requires 036 (public.habit_xp_awards is missing)' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.get_today_bootstrap(date)') IS NULL THEN
    RAISE EXCEPTION '040 requires 037 (public.get_today_bootstrap(date) is missing)' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fn_habit_log_guard()') IS NULL THEN
    RAISE EXCEPTION '040 requires 038 (public.fn_habit_log_guard() is missing)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.ai_messages_user_request_uniq') IS NULL THEN
    RAISE EXCEPTION '040 requires 039 (public.ai_messages_user_request_uniq is missing)' USING ERRCODE = '55000';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'habit_pauses', 'habit_goal_versions', 'habit_checklist_items',
    'habit_checklist_checks', 'routine_templates', 'routine_template_versions',
    'routine_sessions', 'mood_definitions', 'mood_checkins', 'review_next_actions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '040 requires 028..031 (public.% is missing)', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 0b. Rollback snapshot (F02): every ACL this migration may touch, taken before
--     the first change. A second run keeps the FIRST snapshot (ON CONFLICT DO
--     NOTHING), so the rollback always returns to the state before 040.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS archive_040;
REVOKE ALL ON SCHEMA archive_040 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS archive_040.acl_snapshot (
  kind text NOT NULL CHECK (kind IN ('rel', 'col', 'fn', 'defacl')),
  obj  text NOT NULL,
  acl  aclitem[],
  PRIMARY KEY (kind, obj)
);
REVOKE ALL ON archive_040.acl_snapshot FROM PUBLIC, anon, authenticated;
ALTER TABLE archive_040.acl_snapshot ENABLE ROW LEVEL SECURITY;

INSERT INTO archive_040.acl_snapshot (kind, obj, acl)
SELECT 'rel', format('%I.%I', n.nspname, c.relname), coalesce(c.relacl, acldefault('r', c.relowner))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
UNION ALL
SELECT 'col', format('%I.%I.%I', n.nspname, c.relname, a.attname), a.attacl
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
UNION ALL
SELECT 'fn',
       format('%I.%I(%s)', n.nspname, p.proname,
              (SELECT coalesce(string_agg(format_type(u.t, NULL), ', ' ORDER BY u.ord), '')
                 FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(t, ord))),
       coalesce(p.proacl, acldefault('f', p.proowner))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
UNION ALL
SELECT 'defacl',
       format('%s|%s|%s', d.defaclrole::regrole::text, coalesce(n.nspname, ''), d.defaclobjtype),
       d.defaclacl
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
 WHERE d.defaclrole = 'postgres'::regrole
ON CONFLICT (kind, obj) DO NOTHING;

-- The zombie triggers section 8a drops: the rollback re-creates only the ones that existed.
CREATE TABLE IF NOT EXISTS archive_040.dropped_triggers (
  tgname text PRIMARY KEY
);
REVOKE ALL ON archive_040.dropped_triggers FROM PUBLIC, anon, authenticated;
ALTER TABLE archive_040.dropped_triggers ENABLE ROW LEVEL SECURITY;

INSERT INTO archive_040.dropped_triggers (tgname)
SELECT t.tgname
  FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND (   (t.tgname = 'on_habit_completed_damage_boss' AND t.tgrelid = 'public.habit_logs'::regclass)
        OR (t.tgname = 'on_profile_created_pet' AND t.tgrelid = 'public.profiles'::regclass))
ON CONFLICT (tgname) DO NOTHING;

-- Snapshot of who may EXECUTE which SECURITY DEFINER function before any change;
-- section 9 proves that only the cancelled F13 set lost client access.
CREATE TEMP TABLE _f09_auth_before ON COMMIT DROP AS
SELECT p.oid, p.oid::regprocedure::text AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prokind = 'f'
   AND p.prosecdef
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- 1. DB2-13 / DB1-07: pin search_path on the 20 unpinned SECURITY DEFINER functions
--    (to_regprocedure guard: F03 may already have dropped trigger_damage_on_habit_log)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.buy_shop_item(uuid)',
    'public.check_and_award_badges()',
    'public.check_and_reset_makeup_credits()',
    'public.check_level_up_and_grant_skills()',
    'public.claim_quest_reward(uuid)',
    'public.deal_damage_to_active_boss(uuid, integer)',
    'public.get_active_boss_status()',
    'public.get_daily_quests()',
    'public.get_global_leaderboard(integer)',
    'public.get_user_gamification()',
    'public.get_user_pet_status()',
    'public.get_user_rank(uuid)',
    'public.get_user_skill_tree()',
    'public.get_weekly_leaderboard(integer)',
    'public.initialize_user_pet()',
    'public.interact_with_pet(character varying)',
    'public.log_makeup_completion(uuid, date, boolean, text, integer)',
    'public.track_weekly_xp(uuid, integer)',
    'public.trigger_damage_on_habit_log()',
    'public.upgrade_skill(character varying)'
  ] LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path TO ''public'', ''pg_temp''', sig);
    END IF;
  END LOOP;
END $$;

-- The cancelled F13 RPG set: no client may call it (EXECUTE revoked from everyone
-- but service_role and the owner). Triggers fire regardless of EXECUTE.
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
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
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. DB1-08 / DB2-18 / DB1-06: anon write and maintenance rights; PUBLIC EXECUTE
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Existing SECURITY DEFINER functions only (INVOKER helpers such as
-- jsonb_is_string_map are used inside CHECK constraints and must stay callable).
-- authenticated keeps whatever explicit right it has; section 9 proves nothing
-- was lost by accident.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. DB1-04 / DB2-05 / REP-03: leaderboard and rank
--    sign-in required, limit clamped 1..100, rank only for the caller
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(limit_val integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, username text, level integer, total_xp integer, willpower_rank text, rank bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id AS user_id,
         COALESCE(p.username, 'Gizli Savaşçı') AS username,
         COALESCE(p.level, 1) AS level,
         COALESCE(p.total_xp, 0) AS total_xp,
         COALESCE(p.willpower_rank, 'Acemi') AS willpower_rank,
         RANK() OVER (ORDER BY COALESCE(p.total_xp, 0) DESC) AS rank
    FROM public.profiles p
   WHERE COALESCE(p.total_xp, 0) > 0
   ORDER BY COALESCE(p.total_xp, 0) DESC
   LIMIT LEAST(GREATEST(COALESCE(limit_val, 50), 1), 100);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_global_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(limit_val integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, username text, level integer, total_xp integer, weekly_xp integer, willpower_rank text, rank bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_week_start date;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  v_week_start := date_trunc('week', CURRENT_DATE)::date;
  RETURN QUERY
  SELECT p.id AS user_id,
         COALESCE(p.username, 'Gizli Savaşçı') AS username,
         COALESCE(p.level, 1) AS level,
         COALESCE(p.total_xp, 0) AS total_xp,
         COALESCE(w.xp_earned, 0) AS weekly_xp,
         COALESCE(p.willpower_rank, 'Acemi') AS willpower_rank,
         RANK() OVER (ORDER BY COALESCE(w.xp_earned, 0) DESC) AS rank
    FROM public.profiles p
    LEFT JOIN public.weekly_xp w
           ON p.id = w.user_id AND w.week_start = v_week_start
   WHERE COALESCE(w.xp_earned, 0) > 0
   ORDER BY COALESCE(w.xp_earned, 0) DESC
   LIMIT LEAST(GREATEST(COALESCE(limit_val, 30), 1), 100);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_rank(target_user_id uuid)
 RETURNS TABLE(rank bigint, total_xp integer, level integer)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  -- Only the caller's own standing is ever returned; any other id yields no row.
  IF target_user_id IS DISTINCT FROM v_uid THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 1 + (SELECT count(*) FROM public.profiles o
               WHERE COALESCE(o.total_xp, 0) > COALESCE(p.total_xp, 0)) AS rank,
         COALESCE(p.total_xp, 0) AS total_xp,
         COALESCE(p.level, 1) AS level
    FROM public.profiles p
   WHERE p.id = v_uid
     AND COALESCE(p.total_xp, 0) > 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_rank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. DB1-12 / DB2-16: profiles INSERT only for the columns the app writes
--    DB1-11: username shape (repair first, then NOT VALID check)
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, email, username) ON public.profiles TO authenticated;

CREATE TABLE IF NOT EXISTS archive_040.profiles_username_backup (
  id           uuid PRIMARY KEY,
  old_username text,
  repaired_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON archive_040.profiles_username_backup FROM PUBLIC, anon, authenticated;
ALTER TABLE archive_040.profiles_username_backup ENABLE ROW LEVEL SECURITY;

WITH bad AS (
  SELECT s.id,
         s.username AS old_username,
         CASE WHEN char_length(s.cleaned) >= 3 THEN s.cleaned END AS clean_username
    FROM (
      SELECT id, username,
             left(btrim(regexp_replace(username, '[[:cntrl:]<>]', '', 'g')), 32) AS cleaned
        FROM public.profiles
       WHERE username IS NOT NULL
    ) s
   WHERE s.username <> btrim(s.username)
      OR char_length(s.username) NOT BETWEEN 3 AND 32
      OR s.username ~ '[[:cntrl:]<>]'
), saved AS (
  INSERT INTO archive_040.profiles_username_backup (id, old_username)
  SELECT id, old_username FROM bad
  ON CONFLICT (id) DO NOTHING
)
UPDATE public.profiles p
   SET username = bad.clean_username
  FROM bad
 WHERE p.id = bad.id;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_shape;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_shape CHECK (
    username IS NULL
    OR (username = btrim(username)
        AND char_length(username) BETWEEN 3 AND 32
        AND username !~ '[[:cntrl:]<>]')
  ) NOT VALID;
-- The owner validates after the pre-query in SQL_FOR_OWNER.md section 3:
--   ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_username_shape;

-- The sign-up path copies user-controlled metadata: sanitize so the CHECK can
-- never turn a registration into a 500.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
BEGIN
  v_name := left(btrim(regexp_replace(
              coalesce(new.raw_user_meta_data->>'username', ''),
              '[[:cntrl:]<>]', '', 'g')), 32);
  IF char_length(v_name) < 3 THEN
    v_name := NULL;
  END IF;
  INSERT INTO public.profiles (id, email, username)
  VALUES (new.id, new.email, v_name)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. GEM-02: the ten tables born in 028..031 get explicit, narrow grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.habit_pauses FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_pauses TO authenticated;
REVOKE ALL ON public.habit_goal_versions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_goal_versions TO authenticated;
REVOKE ALL ON public.habit_checklist_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_checklist_items TO authenticated;
REVOKE ALL ON public.habit_checklist_checks FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_checklist_checks TO authenticated;
REVOKE ALL ON public.routine_templates FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_templates TO authenticated;
REVOKE ALL ON public.routine_template_versions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_template_versions TO authenticated;
REVOKE ALL ON public.routine_sessions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_sessions TO authenticated;
REVOKE ALL ON public.mood_definitions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mood_definitions TO authenticated;
REVOKE ALL ON public.mood_checkins FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mood_checkins TO authenticated;
REVOKE ALL ON public.review_next_actions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_next_actions TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. EDG-08 / DB1-09: token tables
--    google_calendar_integrations, spotify_accounts: RLS on, zero policies by
--    design, and now zero client rights. Only service_role (edge) reads tokens.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.google_calendar_integrations FROM anon, PUBLIC, authenticated;
REVOKE ALL ON public.spotify_accounts FROM anon, PUBLIC, authenticated;

--    notion_integrations: owner may SELECT the non-secret columns only.
--    NOTE: supabase/functions/notion-sync/index.ts:93-96 reads access_token with
--    the user JWT and stops working after this section. The gate
--    NOTION_INTEGRATION_ENABLED is false and notion-auth/google-auth are
--    deploy:false in DEPLOYMENT.json; moving notion-sync to the service role is
--    a precondition of re-enabling Notion (OWNER DECISION), tracked in F45.
DROP POLICY IF EXISTS "Users manage own notion integration" ON public.notion_integrations;
DROP POLICY IF EXISTS notion_integrations_select_own ON public.notion_integrations;
CREATE POLICY notion_integrations_select_own ON public.notion_integrations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.notion_integrations FROM anon, PUBLIC, authenticated;
-- One line on purpose: migrationRlsGuard.test.ts checks the column list line by line.
GRANT SELECT (id, user_id, workspace_id, workspace_name, workspace_icon, bot_id, habits_database_id, tasks_database_id, habits_url, tasks_url, created_at, updated_at) ON public.notion_integrations TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. DB2-15 / DB2-08: lock before read-modify-write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_xp(p_user_id uuid, p_xp_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_xp integer;
  v_next_level_xp integer;
  v_level integer;
  v_new_xp integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required' USING ERRCODE = '22004';
  END IF;

  -- A profile-less account (older than the profile trigger) gets its row here
  -- instead of silently losing the XP.
  INSERT INTO public.profiles (id, email)
  SELECT u.id, u.email FROM auth.users u WHERE u.id = p_user_id
  ON CONFLICT (id) DO NOTHING;

  -- Row lock: two concurrent awards serialize and each sees the other's result.
  SELECT COALESCE(current_level_xp, 0), COALESCE(next_level_xp, 100), COALESCE(level, 1)
    INTO v_current_xp, v_next_level_xp, v_level
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no profile for user %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  v_new_xp := v_current_xp + p_xp_amount;

  WHILE v_new_xp >= v_next_level_xp LOOP
    v_new_xp := v_new_xp - v_next_level_xp;
    v_level := v_level + 1;
    v_next_level_xp := floor(v_next_level_xp * 1.15)::integer;
  END LOOP;

  UPDATE public.profiles
     SET total_xp = COALESCE(total_xp, 0) + p_xp_amount,
         current_level_xp = v_new_xp,
         level = v_level,
         next_level_xp = v_next_level_xp,
         willpower_rank = public.get_rank_for_level(v_level)
   WHERE id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.add_xp(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_or_init_subscription()
 RETURNS public.user_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  uid uuid := (SELECT auth.uid());
  sub public.user_subscriptions;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.user_subscriptions (user_id) VALUES (uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = uid FOR UPDATE;
  IF sub.tier <> 'free' AND sub.sub_period_end IS NOT NULL AND sub.sub_period_end <= now() THEN
    UPDATE public.user_subscriptions
       SET tier = 'free', billing_period = NULL, status = 'expired',
           monthly_grant = 30, updated_at = now()
     WHERE user_id = uid
    RETURNING * INTO sub;
  END IF;
  IF sub.credits_period_end <= now() THEN
    UPDATE public.user_subscriptions
       SET focus_points = monthly_grant,
           credits_period_end = now() + interval '1 month',
           updated_at = now()
     WHERE user_id = uid AND credits_period_end <= now()
    RETURNING * INTO sub;
    IF FOUND THEN
      INSERT INTO public.credit_transactions (user_id, delta, reason, balance_after)
      VALUES (uid, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
    ELSE
      SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = uid;
    END IF;
  END IF;
  RETURN sub;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_init_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_init_subscription() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_init_subscription_for(p_user_id uuid)
 RETURNS public.user_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sub public.user_subscriptions;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;
  INSERT INTO public.user_subscriptions (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF sub.tier <> 'free' AND sub.sub_period_end IS NOT NULL AND sub.sub_period_end <= pg_catalog.now() THEN
    UPDATE public.user_subscriptions
       SET tier = 'free', billing_period = NULL, status = 'expired',
           monthly_grant = 30, updated_at = pg_catalog.now()
     WHERE user_id = p_user_id
    RETURNING * INTO sub;
  END IF;
  IF sub.credits_period_end <= pg_catalog.now() THEN
    UPDATE public.user_subscriptions
       SET focus_points = monthly_grant,
           credits_period_end = pg_catalog.now() + interval '1 month',
           updated_at = pg_catalog.now()
     WHERE user_id = p_user_id AND credits_period_end <= pg_catalog.now()
    RETURNING * INTO sub;
    IF FOUND THEN
      INSERT INTO public.credit_transactions (user_id, delta, reason, balance_after)
      VALUES (p_user_id, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
    ELSE
      SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = p_user_id;
    END IF;
  END IF;
  RETURN sub;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_init_subscription_for(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7b. F07-R3: a reclaimed stale claim tells the truth about what it was. Only the
--     onboarding routine keeps its "Kurulum" copy; coach, summarize and insights get
--     the generic one. Same lease logic, same refund, same privileges (service only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_request_reconcile_stale(p_user_id uuid, p_limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; n integer := 0;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  for r in
    update public.ai_requests a
      set status = 'failed',
          error = case when a.mode = 'routine'
                       then 'Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.'
                       else 'İstek yarıda kaldı: istek süresi doldu ve ücreti iade edildi.'
                  end,
          updated_at = pg_catalog.now()
      where a.ctid in (
        select b.ctid from public.ai_requests b
        where b.user_id = p_user_id and b.status = 'in_progress'
          and b.lease_expires_at < pg_catalog.now()
        limit p_limit for update skip locked
      )
      returning a.request_id
  loop
    perform public.refund_focus_points(p_user_id, r.request_id, 'ai_stale_reclaim');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

REVOKE ALL ON FUNCTION public.ai_request_reconcile_stale(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_request_reconcile_stale(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. DB2-12 / DB1-10: cancelled F13 tables (never dropped, never surfaced)
-- ---------------------------------------------------------------------------
-- 8a. zombie triggers (idempotent: F03 may already have dropped the first)
DROP TRIGGER IF EXISTS on_habit_completed_damage_boss ON public.habit_logs;
DROP TRIGGER IF EXISTS on_profile_created_pet ON public.profiles;

-- 8b. no remaining trigger function may touch a table that is about to move
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(DISTINCT t.tgname || ' -> ' || p.proname, ', ')
    INTO bad
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND p.prosrc ~ '\m(user_pets|user_inventory|user_quests|user_skills|boss_contributors|user_challenges)\M';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '040: trigger still references an F13 table: %', bad USING ERRCODE = '55000';
  END IF;
END $$;

-- 8c. clients can no longer write any of the 17 tables
REVOKE INSERT, UPDATE, DELETE ON public.user_gamification FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ai_calls FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.boss_contributors FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.calendars FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.event_templates FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_challenges FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_inventory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_pets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_quests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_skills FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.global_bosses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pet_stages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shop_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.skills FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.challenges FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.habit_templates FROM anon, authenticated;

-- 8d. the six user-data tables move to a schema PostgREST does not expose
--     (data kept; FK to auth.users ON DELETE CASCADE keeps account deletion complete)
CREATE SCHEMA IF NOT EXISTS archive_f13;
REVOKE ALL ON SCHEMA archive_f13 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_pets', 'user_inventory', 'user_quests',
    'user_skills', 'boss_contributors', 'user_challenges'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      RAISE NOTICE '040: moving public.% (% rows) into archive_f13', t, n;
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive_f13', t);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA archive_f13 FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Self-check (any failure rolls the whole migration back)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '040: anon still has EXECUTE on: %', bad;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '040: definer function without search_path: %', bad;
  END IF;

  SELECT string_agg(b.sig, ', ') INTO bad
    FROM _f09_auth_before b
   WHERE NOT has_function_privilege('authenticated', b.oid, 'EXECUTE')
     AND b.sig !~ '(buy_shop_item|check_level_up_and_grant_skills|claim_quest_reward|deal_damage_to_active_boss|get_active_boss_status|get_daily_quests|get_user_pet_status|get_user_skill_tree|initialize_user_pet|interact_with_pet|trigger_damage_on_habit_log|upgrade_skill|add_xp|get_or_init_subscription_for|handle_new_user|ai_request_reconcile_stale)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '040: authenticated lost EXECUTE unintentionally on: %', bad;
  END IF;

  IF has_function_privilege('authenticated', 'public.ai_request_reconcile_stale(uuid, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ai_request_reconcile_stale(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '040: ai_request_reconcile_stale must be callable by service_role only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM archive_040.acl_snapshot WHERE kind = 'rel')
     OR NOT EXISTS (SELECT 1 FROM archive_040.acl_snapshot WHERE kind = 'fn') THEN
    RAISE EXCEPTION '040: the rollback snapshot is empty';
  END IF;
END $$;

COMMIT;
