-- ============================================================
-- `habit_xp_value` never read `target_direction`, so a CEILING habit was
-- scored as if its goal were a floor.
--
-- ## What that did
--
-- "En fazla 2" (`target_direction = 'at_most'`, `daily_goal = 2`). The client
-- classifies 3 as `partial` — the day is half spoiled — and the trigger then
-- awarded:
--
--     least(base_xp, round(base_xp * (value / daily_goal)))
--     = least(30, round(30 * 3/2)) = least(30, 45) = 30
--
-- Full marks for exceeding the limit. Measured against the live function
-- before this migration, every value from 0 to 6 on that habit paid the same
-- 30 XP; the ceiling was invisible to the scorer. The overshoot only stops
-- paying at 2x the limit, and only because `deriveState` calls that a `miss`
-- and `miss` pays nothing — not because the XP formula noticed.
--
-- `lib/habitEngine.ts` has said the opposite in writing since §25: "for a
-- ceiling, an at_least ratio clamps any overshoot to 1 and would award FULL
-- XP for exceeding the limit". That fix landed on the client. XP is decided
-- HERE — `fn_habit_log_set_xp` overwrites whatever the client sends — so the
-- rule the app actually pays out by was still the floor rule.
--
-- ## What it does now
--
-- The ceiling branch mirrors `ceilingRatio` in `lib/habitEngine.ts` exactly,
-- so one rule is stated in two languages rather than two rules disagreeing:
--
--     value <= target          -> full
--     target = 0, value > 0    -> nothing (zero tolerance, exceeded)
--     value >  target          -> decays with the overshoot, 0 at 2x target
--     value is null            -> nothing. An absent number is not evidence
--                                 of having stayed under a limit.
--
-- The `at_least` branch is untouched, as is everything else in the function:
-- the cost model, the streak multiplier in `fn_habit_log_set_xp`, and its
-- high-water-mark rule.
--
-- Compatible with `main`: this only ever lowers an award that was too high
-- for a habit whose own configuration said so, and `main` writes
-- `target_direction` the same way this branch does.
-- ============================================================

create or replace function public.habit_xp_value(p_habit_id uuid, p_state text, p_value integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- ── ceiling ────────────────────────────────────────────────────────
    if h.target_direction = 'at_most' then
      -- Nothing recorded says nothing about the day; it is not a quiet win.
      if p_value is null then return 0; end if;
      if h.daily_goal is null or h.daily_goal < 0 then
        return round(v_base_xp * 0.5)::int;  -- no usable limit; same fallback as below
      end if;
      if p_value <= h.daily_goal then return v_base_xp; end if;
      if h.daily_goal = 0 then return 0; end if;   -- zero tolerance, exceeded
      v_ratio := 1 - (p_value - h.daily_goal)::numeric / h.daily_goal;
      return greatest(0, least(v_base_xp, round(v_base_xp * v_ratio)::int));
    end if;

    -- ── floor (unchanged) ──────────────────────────────────────────────
    if coalesce(h.daily_goal, 0) > 0 and coalesce(p_value, 0) > 0 then
      return greatest(0, least(v_base_xp, round(v_base_xp * (p_value::numeric / h.daily_goal))::int));
    end if;
    return round(v_base_xp * 0.5)::int;

  else
    return 0;
  end if;
end;
$function$;
