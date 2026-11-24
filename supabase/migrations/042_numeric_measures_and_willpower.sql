-- 042: exact measurable values (numeric) and an atomic willpower budget.
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). Try it on a
-- Supabase branch first (docs/implementation-v3/SQL_FOR_OWNER.md). Order:
-- apply BEFORE the client release that accepts decimals. Rollback:
-- supabase/rollbacks/042_numeric_measures_and_willpower.rollback.sql
--
-- Closes DOM-03 (1,5 L was refused by an integer column), REP-09 / STO-15
-- (the willpower budget was spent by a client read-modify-write).
--   1. habit_logs.value and habits.daily_goal become numeric(12,2); every
--      stored integer is preserved exactly.
--   2. habit_xp_value gets a numeric parameter. It stays server-only: EXECUTE
--      is revoked from PUBLIC, anon and authenticated, as 036 left it.
--   3. spend_willpower(date, numeric, integer, boolean): one UPDATE under
--      the caller's RLS; budget overshoot is refused, refunds never go below
--      zero, a first touch of the day creates the row with table defaults.
-- Not touched on purpose: log_makeup_completion (unused, closed by 036),
-- get_monthly_habits (unused, closed by 036, removal is owner decision OD-15),
-- get_today_bootstrap (returns jsonb built with to_jsonb, no typed column).

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regclass('public.habit_logs') IS NULL
     OR to_regclass('public.habits') IS NULL
     OR to_regclass('public.willpower_state') IS NULL THEN
    RAISE EXCEPTION '042 requires habit_logs, habits and willpower_state' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.habit_xp_value(uuid, text, integer)') IS NULL
     AND to_regprocedure('public.habit_xp_value(uuid, text, numeric)') IS NULL THEN
    RAISE EXCEPTION '042 requires public.habit_xp_value' USING ERRCODE = 'P0001';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. The new scorer first (the BEFORE trigger resolves it by argument types)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.habit_xp_value(p_habit_id uuid, p_state text, p_value numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

REVOKE EXECUTE ON FUNCTION public.habit_xp_value(uuid, text, numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Column types (table rewrite; integers are preserved exactly)
-- ---------------------------------------------------------------------------
ALTER TABLE public.habit_logs ALTER COLUMN "value" TYPE numeric(12,2) USING "value"::numeric(12,2);
ALTER TABLE public.habits ALTER COLUMN daily_goal TYPE numeric(12,2) USING daily_goal::numeric(12,2);

COMMENT ON COLUMN public.habit_logs."value" IS 'Numeric value for measurable habits (pages, litres, km); numeric(12,2) since 042';
COMMENT ON COLUMN public.habits.daily_goal IS 'Daily target value for completion; numeric(12,2) since 042';

-- ---------------------------------------------------------------------------
-- 3. The old scorer goes; trigger functions that read NEW.value are re-registered
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.habit_xp_value(uuid, text, integer);

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

-- ---------------------------------------------------------------------------
-- 4. spend_willpower: one atomic statement under the caller's RLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_willpower(
  p_day date,
  p_amount numeric,
  p_active_delta integer DEFAULT NULL,
  p_clamp boolean DEFAULT false
)
 RETURNS public.willpower_state
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_amount integer;
  v_active integer;
  v_row public.willpower_state;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL
     OR p_amount IS NULL
     OR p_amount = 'NaN'::numeric
     OR p_amount <> trunc(p_amount)
     OR abs(p_amount) > 1000
     OR p_day < current_date - 2
     OR p_day > current_date + 2 THEN
    RAISE EXCEPTION 'willpower_input_invalid' USING ERRCODE = '22023';
  END IF;

  v_amount := p_amount::integer;
  v_active := coalesce(p_active_delta, sign(v_amount)::integer);
  IF abs(v_active) > 100 THEN
    RAISE EXCEPTION 'willpower_input_invalid' USING ERRCODE = '22023';
  END IF;

  -- first touch of the day: the row appears with the table defaults
  INSERT INTO public.willpower_state (user_id, state_date)
  VALUES (v_uid, p_day)
  ON CONFLICT (user_id, state_date) DO NOTHING;

  UPDATE public.willpower_state w
     SET used = CASE
                  WHEN p_clamp AND v_amount > 0
                    THEN greatest(w.used, least(w.daily_budget, w.used + v_amount))
                  ELSE greatest(0, w.used + v_amount)
                END,
         active_count = greatest(0, w.active_count + v_active)
   WHERE w.user_id = v_uid
     AND w.state_date = p_day
     AND (v_amount <= 0 OR p_clamp OR w.used + v_amount <= w.daily_budget)
  RETURNING w.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'willpower_budget_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.spend_willpower(date, numeric, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_willpower(date, numeric, integer, boolean) TO authenticated;

COMMIT;
