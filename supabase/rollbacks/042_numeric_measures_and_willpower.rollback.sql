-- 042 rollback: numeric -> integer is LOSSY (fractions are rounded away).
-- STATUS: WRITTEN, NOT APPLIED.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '042' THEN
    RAISE EXCEPTION 'rollback 042 narrows habit_logs.value and habits.daily_goal to integer (fractions are rounded and lost); take a backup, then run: SET aderyth.rollback_confirm = ''042'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DO $applied$
BEGIN
  IF to_regprocedure('public.habit_xp_value(uuid, text, numeric)') IS NULL THEN
    RAISE EXCEPTION '042 is not applied (public.habit_xp_value(uuid, text, numeric) is absent); refusing rollback'
      USING ERRCODE = 'P0001';
  END IF;
END $applied$;

-- 1. The integer scorer back, exactly as live_schema.sql:1158-1230, ACL as 036 left it
CREATE OR REPLACE FUNCTION public.habit_xp_value(p_habit_id uuid, p_state text, p_value integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  h record;
  v_freq_factor numeric;
  v_base numeric;
  v_behavior_bonus numeric;
  v_impact_bonus numeric;
  v_tracking_bonus numeric;
  v_time_bonus numeric;
  v_raw numeric;
  v_cost integer;
  v_base_xp integer;
  v_ratio numeric;
begin
  select difficulty, impact_level, behavior_type, tracking_type,
         estimated_minutes, daily_goal, target_direction,
         coalesce(frequency_config->>'kind', 'daily') as freq_kind
  into h
  from public.habits
  where id = p_habit_id;

  if not found then return 0; end if;

  v_freq_factor := case h.freq_kind
                     when 'weekly' then 0.7
                     when 'monthly' then 0.5
                     else 1.0
                   end;
  v_base := coalesce(h.difficulty, 3) * v_freq_factor;
  v_behavior_bonus := case when h.behavior_type = 'negative' then 1.5 else 0 end;
  v_impact_bonus := case h.impact_level
                      when 'critical' then 1.5
                      when 'high' then 1.0
                      when 'medium' then 0.5
                      else 0
                    end;
  v_tracking_bonus := case when h.tracking_type = 'numeric' then 0.5 else 0 end;
  v_time_bonus := least(2, floor(coalesce(h.estimated_minutes, 0) / 30.0) * 0.5);

  v_raw := v_base + v_behavior_bonus + v_impact_bonus + v_tracking_bonus + v_time_bonus;
  v_cost := greatest(1, least(10, round(v_raw)::int));
  v_base_xp := 10 * v_cost;

  if p_state = 'done' then
    return v_base_xp;

  elsif p_state = 'partial' then
    -- ceiling: mirrors ceilingRatio in lib/habitEngine.ts
    if h.target_direction = 'at_most' then
      if p_value is null then return 0; end if;
      if h.daily_goal is null or h.daily_goal < 0 then
        return round(v_base_xp * 0.5)::int;
      end if;
      if p_value <= h.daily_goal then return v_base_xp; end if;
      if h.daily_goal = 0 then return 0; end if;
      v_ratio := 1 - (p_value - h.daily_goal)::numeric / h.daily_goal;
      return greatest(0, least(v_base_xp, round(v_base_xp * v_ratio)::int));
    end if;

    -- floor (unchanged)
    if coalesce(h.daily_goal, 0) > 0 and coalesce(p_value, 0) > 0 then
      return greatest(0, least(v_base_xp, round(v_base_xp * (p_value::numeric / h.daily_goal))::int));
    end if;
    return round(v_base_xp * 0.5)::int;

  else
    return 0;
  end if;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.habit_xp_value(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- 2. Columns back (LOSSY)
ALTER TABLE public.habit_logs ALTER COLUMN "value" TYPE integer USING round("value")::integer;
ALTER TABLE public.habit_logs ALTER COLUMN "value" SET DEFAULT 1;
ALTER TABLE public.habits ALTER COLUMN daily_goal TYPE integer USING round(daily_goal)::integer;
ALTER TABLE public.habits ALTER COLUMN daily_goal SET DEFAULT 1;
COMMENT ON COLUMN public.habit_logs."value" IS 'Numeric value for measurable habits (e.g. pages read)';
COMMENT ON COLUMN public.habits.daily_goal IS 'Daily target value for completion';

-- 3. New objects out
DROP FUNCTION IF EXISTS public.habit_xp_value(uuid, text, numeric);
DROP FUNCTION IF EXISTS public.spend_willpower(date, numeric, integer, boolean);

-- 4. Trigger functions re-registered (plan caches)
DO $touch$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['fn_habit_log_set_xp', 'fn_habit_log_guard', 'fn_habit_log_award']
  LOOP
    IF to_regprocedure('public.' || v_name || '()') IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I() VOLATILE', v_name);
    END IF;
  END LOOP;
END $touch$;

COMMIT;
