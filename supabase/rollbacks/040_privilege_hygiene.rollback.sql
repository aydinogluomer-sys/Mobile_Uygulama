-- ============================================================================
-- Rollback for 040_privilege_hygiene.sql
-- STATUS: WRITTEN, NOT APPLIED (DB frozen per STATE.md S1/S2).
-- ============================================================================
-- REOPENS the holes 040 closed (anon write/MAINTAIN rights, PUBLIC EXECUTE on SECURITY
-- DEFINER functions, unbounded anonymous-capable leaderboards, unpinned search_path,
-- client-readable OAuth tokens, writable F13 tables). Use only when 040 itself breaks
-- something on a branch, and apply 040 again once that is fixed.
--
-- Run (same session): SET aderyth.rollback_confirm = '040'; then this file (F02 contract).
-- Refuses when 040 is not applied (archive_040.acl_snapshot is missing): its ACL restore
-- needs the snapshot 040 took, so a second run refuses instead of guessing.
--
-- Returns to the state after 039 exactly, which the CI catalog fingerprint checks:
--   8d  the six F13 tables move back from archive_f13 to public (data, RLS, policies,
--       indexes and triggers travel with them);
--   8a  the zombie triggers 040 dropped come back, and only those that existed then;
--   7   add_xp, get_or_init_subscription, get_or_init_subscription_for and (F07-R3)
--       ai_request_reconcile_stale get their post-039 bodies back, byte for byte as the
--       live dump has them (no migration from 028 to 039 replaced them);
--   6   notion_integrations gets its live FOR ALL policy back;
--   4   the username CHECK goes, repaired usernames come back from the backup table,
--       handle_new_user gets its live body back;
--   3   the three leaderboard/rank functions get their live bodies back;
--   1   search_path is unpinned again on the 20 functions 040 pinned;
--   2+5+6+8c  every table, column and function ACL of the public schema and every
--       default privilege of role postgres is restored from archive_040.acl_snapshot
--       (taken by 040 before its first change); the last block proves the result equals
--       the snapshot.
-- Not reverted: the empty schemas archive_040 and archive_f13 stay (DROP SCHEMA is outside
-- the rollback contract; they hold no object and grant nothing to any client role).
-- 037's in-place DB1-20 edit is not part of 040; to undo it restore 037 from git history.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '040' THEN
    RAISE EXCEPTION 'rollback 040 reopens client write, EXECUTE and token access; run: SET aderyth.rollback_confirm = ''040'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DO $applied$
BEGIN
  IF to_regclass('archive_040.acl_snapshot') IS NULL THEN
    RAISE EXCEPTION 'rollback 040 refused: 040 is not applied (archive_040.acl_snapshot is missing)'
      USING ERRCODE = 'P0001';
  END IF;
END $applied$;

-- ---------------------------------------------------------------------------
-- 8d. the six F13 tables come back to public
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_pets', 'user_inventory', 'user_quests',
    'user_skills', 'boss_contributors', 'user_challenges'
  ] LOOP
    IF to_regclass('archive_f13.' || t) IS NOT NULL AND to_regclass('public.' || t) IS NULL THEN
      EXECUTE format('ALTER TABLE archive_f13.%I SET SCHEMA public', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8a. the zombie triggers 040 dropped (the live definitions, only where they existed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM archive_040.dropped_triggers WHERE tgname = 'on_profile_created_pet') THEN
    CREATE OR REPLACE TRIGGER "on_profile_created_pet" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."initialize_user_pet"();
  END IF;
  IF EXISTS (SELECT 1 FROM archive_040.dropped_triggers WHERE tgname = 'on_habit_completed_damage_boss') THEN
    CREATE OR REPLACE TRIGGER "on_habit_completed_damage_boss" AFTER INSERT ON "public"."habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_damage_on_habit_log"();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. post-039 bodies (supabase/live_schema.sql:84-125, :846-873, :878-907, :210-235)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_xp(p_user_id uuid, p_xp_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_xp integer;
  v_next_level_xp integer;
  v_level integer;
  v_new_xp integer;
  v_level_up boolean := false;
  v_initial_level integer;
begin
  -- Get current user stats
  select current_level_xp, next_level_xp, level
  into v_current_xp, v_next_level_xp, v_level
  from profiles
  where id = p_user_id;

  v_initial_level := v_level;
  v_new_xp := v_current_xp + p_xp_amount;

  -- Level Up Logic (While loop allows multiple level ups at once)
  while v_new_xp >= v_next_level_xp loop
    v_level_up := true;
    v_new_xp := v_new_xp - v_next_level_xp;
    v_level := v_level + 1;
    -- Increase next level requirement by 10% each level roughly
    v_next_level_xp := floor(v_next_level_xp * 1.15)::integer;
  end loop;

  -- Update Profile
  update profiles
  set
    total_xp = total_xp + p_xp_amount,
    current_level_xp = v_new_xp,
    level = v_level,
    next_level_xp = v_next_level_xp,
    willpower_rank = public.get_rank_for_level(v_level)
  where id = p_user_id;

end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_init_subscription()
 RETURNS public.user_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); sub public.user_subscriptions;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = uid;
  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions(user_id) VALUES (uid) RETURNING * INTO sub;
  END IF;
  -- Abonelik süresi bittiyse Free'ye düşür (grant'i de free yap)
  IF sub.tier <> 'free' AND sub.sub_period_end IS NOT NULL AND sub.sub_period_end <= now() THEN
    UPDATE public.user_subscriptions
      SET tier='free', billing_period=NULL, status='expired', monthly_grant=30, updated_at=now()
      WHERE user_id = uid RETURNING * INTO sub;
  END IF;
  -- Kredi periyodu dolduysa yenile (reset, devretmez)
  IF sub.credits_period_end <= now() THEN
    UPDATE public.user_subscriptions
      SET focus_points = monthly_grant, credits_period_end = now() + interval '1 month', updated_at=now()
      WHERE user_id = uid RETURNING * INTO sub;
    INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after)
      VALUES (uid, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
  END IF;
  RETURN sub;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_or_init_subscription_for(p_user_id uuid)
 RETURNS public.user_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sub public.user_subscriptions;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  select * into sub from public.user_subscriptions where user_id = p_user_id;
  if not found then
    insert into public.user_subscriptions(user_id) values (p_user_id) returning * into sub;
  end if;
  if sub.tier <> 'free' and sub.sub_period_end is not null and sub.sub_period_end <= pg_catalog.now() then
    update public.user_subscriptions
      set tier = 'free', billing_period = null, status = 'expired',
          monthly_grant = 30, updated_at = pg_catalog.now()
      where user_id = p_user_id returning * into sub;
  end if;
  if sub.credits_period_end <= pg_catalog.now() then
    update public.user_subscriptions
      set focus_points = monthly_grant,
          credits_period_end = pg_catalog.now() + interval '1 month',
          updated_at = pg_catalog.now()
      where user_id = p_user_id returning * into sub;
    insert into public.credit_transactions(user_id, delta, reason, balance_after)
      values (p_user_id, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
  end if;
  return sub;
end;
$function$;

-- F07-R3 reverted: one message for every mode again
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
          error = 'Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.',
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

-- ---------------------------------------------------------------------------
-- 6. notion_integrations: the live FOR ALL owner policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notion_integrations_select_own ON public.notion_integrations;
DROP POLICY IF EXISTS "Users manage own notion integration" ON public.notion_integrations;
CREATE POLICY "Users manage own notion integration" ON public.notion_integrations USING ((auth.uid() = user_id));

-- ---------------------------------------------------------------------------
-- 4. profiles: username shape, repaired names, live handle_new_user
--    (the INSERT column right comes from 036 and is restored by the ACL block below)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_shape;

DO $$
BEGIN
  IF to_regclass('archive_040.profiles_username_backup') IS NOT NULL THEN
    UPDATE public.profiles p
       SET username = b.old_username
      FROM archive_040.profiles_username_backup b
     WHERE p.id = b.id;
  END IF;
END $$;
DROP TABLE IF EXISTS archive_040.profiles_username_backup;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN
INSERT INTO public.profiles (id, email, username)
VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username'
  );
RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. live leaderboard bodies (supabase/live_schema.sql:764-781, :1019-1038, :1084-1107)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(limit_val integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, username text, level integer, total_xp integer, willpower_rank text, rank bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
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
  LIMIT limit_val;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(limit_val integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, username text, level integer, total_xp integer, weekly_xp integer, willpower_rank text, rank bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_week_start DATE;
BEGIN v_week_start := date_trunc('week', CURRENT_DATE)::date;
RETURN QUERY
SELECT p.id as user_id,
    COALESCE(p.username, 'Gizli Savaşçı') as username,
    COALESCE(p.level, 1) as level,
    COALESCE(p.total_xp, 0) as total_xp,
    COALESCE(w.xp_earned, 0) as weekly_xp,
    COALESCE(p.willpower_rank, 'Acemi') as willpower_rank,
    RANK() OVER (
        ORDER BY COALESCE(w.xp_earned, 0) DESC
    ) as rank
FROM public.profiles p
    LEFT JOIN public.weekly_xp w ON p.id = w.user_id
    AND w.week_start = v_week_start
WHERE COALESCE(w.xp_earned, 0) > 0
ORDER BY COALESCE(w.xp_earned, 0) DESC
LIMIT limit_val;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_rank(target_user_id uuid)
 RETURNS TABLE(rank bigint, total_xp integer, level integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ BEGIN RETURN QUERY WITH RankedProfiles AS (
        SELECT p.id,
            p.total_xp,
            p.level,
            RANK() OVER (
                ORDER BY p.total_xp DESC
            ) as current_rank
        FROM public.profiles p
        WHERE p.total_xp > 0
    )
SELECT r.current_rank as rank,
    r.total_xp,
    r.level
FROM RankedProfiles r
WHERE r.id = target_user_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. search_path back to unpinned (the 20 functions)
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
      EXECUTE format('ALTER FUNCTION %s RESET search_path', sig);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. the notion column right 040 added (also covered by the ACL block below)
-- ---------------------------------------------------------------------------
REVOKE SELECT (id, user_id, workspace_id, workspace_name, workspace_icon, bot_id, habits_database_id, tasks_database_id, habits_url, tasks_url, created_at, updated_at) ON public.notion_integrations FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2 + 5 + 6 + 8c. every ACL back to the snapshot 040 took before its first change.
-- Per object and per grantee: when the privilege set differs, REVOKE ALL from that
-- grantee and GRANT back exactly what the snapshot holds. Tables first (a table-level
-- REVOKE also clears column rights), then columns, functions, default privileges.
-- ---------------------------------------------------------------------------
DO $acl$
DECLARE
  s record;
  g record;
  p record;
  v_now aclitem[];
  v_old aclitem[];
  v_role text;
  v_nsp text;
  v_type "char";
  v_kw text;
  v_in text;
  v_found boolean;
BEGIN
  -- tables, views (relation level)
  FOR s IN SELECT obj, acl FROM archive_040.acl_snapshot WHERE kind = 'rel' ORDER BY obj LOOP
    SELECT coalesce(c.relacl, acldefault('r', c.relowner)) INTO v_now
      FROM pg_class c WHERE c.oid = to_regclass(s.obj);
    CONTINUE WHEN NOT FOUND;
    FOR g IN
      SELECT e.grantee FROM aclexplode(s.acl) e
      UNION
      SELECT e.grantee FROM aclexplode(v_now) e
    LOOP
      IF ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(s.acl) e WHERE e.grantee = g.grantee ORDER BY 1)
         IS DISTINCT FROM
         ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(v_now) e WHERE e.grantee = g.grantee ORDER BY 1) THEN
        v_role := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END;
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %s', s.obj, v_role);
        FOR p IN SELECT e.privilege_type, e.is_grantable FROM aclexplode(s.acl) e WHERE e.grantee = g.grantee LOOP
          EXECUTE format('GRANT %s ON TABLE %s TO %s%s', p.privilege_type, s.obj, v_role,
                         CASE WHEN p.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- columns (every column that holds a right now or held one in the snapshot)
  FOR s IN
    SELECT format('%I.%I', n.nspname, c.relname) AS rel, a.attname,
           coalesce(a.attacl, '{}'::aclitem[]) AS now_acl,
           coalesce((SELECT x.acl FROM archive_040.acl_snapshot x
                      WHERE x.kind = 'col' AND x.obj = format('%I.%I.%I', n.nspname, c.relname, a.attname)),
                    '{}'::aclitem[]) AS old_acl
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attacl IS NOT NULL
            OR EXISTS (SELECT 1 FROM archive_040.acl_snapshot x
                        WHERE x.kind = 'col' AND x.obj = format('%I.%I.%I', n.nspname, c.relname, a.attname)))
     ORDER BY 1, 2
  LOOP
    FOR g IN
      SELECT e.grantee FROM aclexplode(s.old_acl) e
      UNION
      SELECT e.grantee FROM aclexplode(s.now_acl) e
    LOOP
      IF ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(s.old_acl) e WHERE e.grantee = g.grantee ORDER BY 1)
         IS DISTINCT FROM
         ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(s.now_acl) e WHERE e.grantee = g.grantee ORDER BY 1) THEN
        v_role := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END;
        EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM %s', s.attname, s.rel, v_role);
        FOR p IN SELECT e.privilege_type, e.is_grantable FROM aclexplode(s.old_acl) e WHERE e.grantee = g.grantee LOOP
          EXECUTE format('GRANT %s (%I) ON TABLE %s TO %s%s', p.privilege_type, s.attname, s.rel, v_role,
                         CASE WHEN p.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- functions
  FOR s IN SELECT obj, acl FROM archive_040.acl_snapshot WHERE kind = 'fn' ORDER BY obj LOOP
    SELECT coalesce(f.proacl, acldefault('f', f.proowner)) INTO v_now
      FROM pg_proc f WHERE f.oid = to_regprocedure(s.obj);
    CONTINUE WHEN NOT FOUND;
    FOR g IN
      SELECT e.grantee FROM aclexplode(s.acl) e
      UNION
      SELECT e.grantee FROM aclexplode(v_now) e
    LOOP
      IF ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(s.acl) e WHERE e.grantee = g.grantee ORDER BY 1)
         IS DISTINCT FROM
         ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(v_now) e WHERE e.grantee = g.grantee ORDER BY 1) THEN
        v_role := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END;
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', s.obj, v_role);
        FOR p IN SELECT e.privilege_type, e.is_grantable FROM aclexplode(s.acl) e WHERE e.grantee = g.grantee LOOP
          EXECUTE format('GRANT %s ON FUNCTION %s TO %s%s', p.privilege_type, s.obj, v_role,
                         CASE WHEN p.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- default privileges of role postgres (a missing global entry means the built-in
  -- default, a missing per-schema entry means nothing extra)
  FOR s IN
    WITH old AS (
      SELECT obj, acl FROM archive_040.acl_snapshot WHERE kind = 'defacl'
    ), cur AS (
      SELECT format('%s|%s|%s', d.defaclrole::regrole::text, coalesce(n.nspname, ''), d.defaclobjtype) AS obj,
             d.defaclacl AS acl
        FROM pg_default_acl d
        LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE d.defaclrole = 'postgres'::regrole
    )
    SELECT coalesce(o.obj, c.obj) AS obj, o.acl AS old_acl, c.acl AS now_acl, (o.obj IS NOT NULL) AS in_old,
           (c.obj IS NOT NULL) AS in_now
      FROM old o FULL JOIN cur c ON c.obj = o.obj
     ORDER BY 1
  LOOP
    v_nsp := split_part(s.obj, '|', 2);
    v_type := split_part(s.obj, '|', 3)::"char";
    v_kw := CASE v_type WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
                        WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END;
    v_in := CASE WHEN v_nsp = '' THEN '' ELSE format(' IN SCHEMA %I', v_nsp) END;
    v_old := CASE WHEN s.in_old THEN s.old_acl
                  WHEN v_nsp = '' THEN acldefault(CASE v_type WHEN 'S' THEN 's'::"char" ELSE v_type END, 'postgres'::regrole)
                  ELSE '{}'::aclitem[] END;
    v_now := CASE WHEN s.in_now THEN s.now_acl
                  WHEN v_nsp = '' THEN acldefault(CASE v_type WHEN 'S' THEN 's'::"char" ELSE v_type END, 'postgres'::regrole)
                  ELSE '{}'::aclitem[] END;
    FOR g IN
      SELECT e.grantee FROM aclexplode(v_old) e
      UNION
      SELECT e.grantee FROM aclexplode(v_now) e
    LOOP
      IF ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(v_old) e WHERE e.grantee = g.grantee ORDER BY 1)
         IS DISTINCT FROM
         ARRAY(SELECT e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                 FROM aclexplode(v_now) e WHERE e.grantee = g.grantee ORDER BY 1) THEN
        v_role := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END;
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s REVOKE ALL ON %s FROM %s', v_in, v_kw, v_role);
        FOR p IN SELECT e.privilege_type, e.is_grantable FROM aclexplode(v_old) e WHERE e.grantee = g.grantee LOOP
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s GRANT %s ON %s TO %s%s', v_in, p.privilege_type, v_kw, v_role,
                         CASE WHEN p.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- proof: every table, column and function ACL now equals the snapshot
  SELECT EXISTS (
    SELECT 1 FROM archive_040.acl_snapshot x
      JOIN pg_class c ON c.oid = to_regclass(x.obj)
     WHERE x.kind = 'rel'
       AND ARRAY(SELECT y::text FROM unnest(x.acl) y ORDER BY 1)
           IS DISTINCT FROM ARRAY(SELECT y::text FROM unnest(coalesce(c.relacl, acldefault('r', c.relowner))) y ORDER BY 1)
    UNION ALL
    SELECT 1 FROM archive_040.acl_snapshot x
      JOIN pg_proc f ON f.oid = to_regprocedure(x.obj)
     WHERE x.kind = 'fn'
       AND ARRAY(SELECT y::text FROM unnest(x.acl) y ORDER BY 1)
           IS DISTINCT FROM ARRAY(SELECT y::text FROM unnest(coalesce(f.proacl, acldefault('f', f.proowner))) y ORDER BY 1)
  ) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'rollback 040: a table or function ACL differs from the snapshot after the restore';
  END IF;
END $acl$;

DROP TABLE IF EXISTS archive_040.dropped_triggers;
DROP TABLE IF EXISTS archive_040.acl_snapshot;

COMMIT;
