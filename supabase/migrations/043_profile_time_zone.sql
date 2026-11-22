-- 043: the user's time zone, and the local day / local week boundaries built on it.
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). Try it on a
-- Supabase branch first (docs/implementation-v3/SQL_FOR_OWNER.md). Requires
-- 038 (fn_habit_log_guard). Rollback:
-- supabase/rollbacks/043_profile_time_zone.rollback.sql
--
-- Closes DB2-11: the server counted "today" and "this week" in UTC, so a
-- Turkish user's Monday 00:00-03:00 XP landed in the previous week.
--   1. profiles.time_zone (IANA name, 1..64 characters), written only through
--      set_profile_time_zone, which accepts names found in pg_timezone_names.
--   2. local_date_in_zone / week_start_in_zone: pure helpers; NULL, empty or
--      unknown zone falls back to UTC (the 038 rule), never raises.
--   3. fn_habit_log_guard anchors its window to the user's local day.
--   4. track_weekly_xp and get_weekly_leaderboard use each user's local week.
-- The setting is a record of where the app was last opened. No ledger,
-- streak or xp value is written, so xp_drift() is untouched.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $pre$
BEGIN
  IF to_regprocedure('public.fn_habit_log_guard()') IS NULL THEN
    RAISE EXCEPTION '043 requires 038 (public.fn_habit_log_guard() is missing)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.track_weekly_xp(uuid, integer)') IS NULL
     OR to_regprocedure('public.get_weekly_leaderboard(integer)') IS NULL THEN
    RAISE EXCEPTION '043 requires the weekly xp functions' USING ERRCODE = 'P0001';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_time_zone_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_time_zone_check CHECK (time_zone IS NULL OR char_length(time_zone) BETWEEN 1 AND 64);
COMMENT ON COLUMN public.profiles.time_zone IS 'IANA zone name last reported by the app (written only by set_profile_time_zone); NULL means UTC rules';

-- ---------------------------------------------------------------------------
-- 2. Pure helpers (no table access)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.local_date_in_zone(p_zone text, p_at timestamptz DEFAULT now())
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_zone IS NULL OR btrim(p_zone) = '' THEN
    RETURN (p_at AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN (p_at AT TIME ZONE p_zone)::date;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN (p_at AT TIME ZONE 'UTC')::date;
END;
$function$;

CREATE OR REPLACE FUNCTION public.week_start_in_zone(p_zone text, p_at timestamptz DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT date_trunc('week', public.local_date_in_zone(p_zone, p_at)::timestamp)::date;
$function$;

REVOKE EXECUTE ON FUNCTION public.local_date_in_zone(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.local_date_in_zone(text, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.week_start_in_zone(text, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The only client write path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_profile_time_zone(p_time_zone text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_zone text := btrim(p_time_zone);
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_zone IS NULL
     OR char_length(v_zone) NOT BETWEEN 1 AND 64
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = v_zone) THEN
    RAISE EXCEPTION 'time_zone_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET time_zone = v_zone
   WHERE id = v_uid
     AND time_zone IS DISTINCT FROM v_zone;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RETURN true;
  END IF;
  -- nothing changed: true when the stored value already is the zone, false when the profile row does not exist yet
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND time_zone = v_zone);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_profile_time_zone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_time_zone(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Weekly xp: each user's own local week (writer and reader change together)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_weekly_xp(p_user_id uuid, p_xp integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_zone text;
  v_week_start date;
BEGIN
  SELECT p.time_zone INTO v_zone FROM public.profiles p WHERE p.id = p_user_id;
  v_week_start := public.week_start_in_zone(v_zone);
  INSERT INTO public.weekly_xp (user_id, week_start, xp_earned)
  VALUES (p_user_id, v_week_start, p_xp)
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET xp_earned = public.weekly_xp.xp_earned + p_xp;
END;
$function$;

-- two statements on purpose: the first is the form the migration guard requires for a function that takes
-- arguments and runs with its owner's rights, the second keeps the function server-only (service_role) as it is today
REVOKE EXECUTE ON FUNCTION public.track_weekly_xp(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.track_weekly_xp(uuid, integer) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(limit_val integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, username text, level integer, total_xp integer, weekly_xp integer, willpower_rank text, rank bigint)
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
         COALESCE(w.xp_earned, 0) AS weekly_xp,
         COALESCE(p.willpower_rank, 'Acemi') AS willpower_rank,
         RANK() OVER (ORDER BY COALESCE(w.xp_earned, 0) DESC) AS rank
    FROM public.profiles p
    JOIN public.weekly_xp w
      ON w.user_id = p.id
     AND w.week_start = public.week_start_in_zone(p.time_zone)
   WHERE COALESCE(w.xp_earned, 0) > 0
   ORDER BY COALESCE(w.xp_earned, 0) DESC
   LIMIT LEAST(GREATEST(COALESCE(limit_val, 30), 1), 100);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The 038 window, anchored to the user's local day (invoker, as in 038)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_habit_log_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_days_back constant integer := 15;
  c_days_ahead constant integer := 1;
  v_today date := current_date;
  v_zone text;
begin
  if current_user in ('authenticated', 'anon') then
    -- 043: the day the user is living in; an unknown or invalid zone is the UTC day (the 038 rule)
    select p.time_zone into v_zone from public.profiles p where p.id = NEW.user_id;
    v_today := public.local_date_in_zone(v_zone);

    if TG_OP = 'UPDATE' then
      if NEW.habit_id is distinct from OLD.habit_id
         or NEW.user_id is distinct from OLD.user_id
         or NEW.completed_at is distinct from OLD.completed_at then
        raise exception 'habit_log_key_immutable'
          using errcode = '22023', hint = 'habit_id, user_id and completed_at of a log cannot change';
      end if;
    end if;

    -- an edit that does not touch state or value (a note, a mood) stays allowed on old days
    if TG_OP = 'INSERT'
       or NEW.state is distinct from OLD.state
       or NEW.value is distinct from OLD.value then
      if NEW.completed_at < v_today - c_days_back or NEW.completed_at > v_today + c_days_ahead then
        raise exception 'habit_log_day_out_of_range'
          using errcode = '22023', hint = 'a log day must be within the allowed window';
      end if;
    end if;
  end if;

  -- the client never decides xp; fn_habit_log_set_xp computes it from the server's rules
  NEW.xp := case when TG_OP = 'INSERT' then 0 else coalesce(OLD.xp, 0) end;
  return NEW;
end;
$function$;

COMMIT;
