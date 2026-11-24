-- 043 rollback: drops profiles.time_zone (stored zones are lost; the app re-reports on next open).
-- STATUS: WRITTEN, NOT APPLIED.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '043' THEN
    RAISE EXCEPTION 'rollback 043 drops profiles.time_zone and restores the UTC week and window; take a backup, then run: SET aderyth.rollback_confirm = ''043'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DO $applied$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'time_zone'
  ) THEN
    RAISE EXCEPTION '043 is not applied (profiles.time_zone is absent); refusing rollback' USING ERRCODE = 'P0001';
  END IF;
END $applied$;

-- 1. The three functions, each body copied byte for byte from the file that defined it before 043
--    (fn_habit_log_guard: 038; track_weekly_xp: live_schema.sql + 040 search_path; get_weekly_leaderboard: 040)
CREATE OR REPLACE FUNCTION public.fn_habit_log_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_days_back constant integer := 15;
  c_days_ahead constant integer := 1;
  v_today date := current_date;
begin
  if current_user in ('authenticated', 'anon') then
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

CREATE OR REPLACE FUNCTION public.track_weekly_xp(p_user_id uuid, p_xp integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_week_start DATE;
BEGIN -- Calculate current week's Monday
v_week_start := date_trunc('week', CURRENT_DATE)::date;
INSERT INTO public.weekly_xp (user_id, week_start, xp_earned)
VALUES (p_user_id, v_week_start, p_xp) ON CONFLICT (user_id, week_start) DO
UPDATE
SET xp_earned = public.weekly_xp.xp_earned + p_xp;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.track_weekly_xp(uuid, integer) FROM PUBLIC, anon, authenticated;

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

-- 2. New objects out (functions first, column last)
DROP FUNCTION IF EXISTS public.set_profile_time_zone(text);
DROP FUNCTION IF EXISTS public.week_start_in_zone(text, timestamptz);
DROP FUNCTION IF EXISTS public.local_date_in_zone(text, timestamptz);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_time_zone_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS time_zone;

COMMIT;
