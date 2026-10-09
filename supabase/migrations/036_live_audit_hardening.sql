-- Hardening proposed by the read-only live schema audit. (2026-10-09)
--
-- STATUS: WRITTEN, NOT APPLIED. Proposal only: written from the LIVE
-- definitions read on 2026-10-09 (docs/implementation-v3/LIVE_SCHEMA_AUDIT.md),
-- not applied, not tried. Try it on a Supabase branch before production.
-- Order: after 028..035 (independent of them).
--
-- Three parts, each safe to run again:
--   A. XP and streak keyed by (habit, day), not by row (S11). Live today a log
--      can be DELETEd by its owner and written again: fn_habit_log_set_xp
--      awards it afresh (OLD is NULL on INSERT) and fn_habit_log_award adds the
--      XP and the streak again -- XP/streak farming through the API, with or
--      without an undo button. After A, a day's XP is only ever raised to its
--      highest value and its streak step counted once; undo becomes safe.
--   B. weekly_xp is written only by the server: today an authenticated user
--      may INSERT/UPDATE their own xp_earned (owner ALL policy + column
--      grants) and so set their own weekly leaderboard score.
--   C. EXECUTE on SECURITY DEFINER functions: trigger functions and functions
--      the app never calls (the cancelled F13 RPG set, the old non-idempotent
--      spend_focus_points, the broken log_makeup_completion) lose EXECUTE for
--      clients; the leaderboard/rank/subscription functions the app does call
--      keep it for authenticated only. Triggers fire regardless of EXECUTE.
--   D. Grant hygiene: user_subscriptions has no client write policy (RLS
--      already refuses), so the table grants go; profiles INSERT is narrowed
--      to the columns the app writes (id, email, username).

-- ---------------------------------------------------------------------------
-- A. XP award ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.habit_xp_awards (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id        uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  day             date NOT NULL,
  xp_awarded      integer NOT NULL DEFAULT 0,
  streak_counted  boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT habit_xp_awards_pkey PRIMARY KEY (habit_id, day),
  CONSTRAINT habit_xp_awards_nonneg CHECK (xp_awarded >= 0)
);

ALTER TABLE public.habit_xp_awards ENABLE ROW LEVEL SECURITY;

-- Readable by its owner; written only by the trigger (SECURITY DEFINER).
DROP POLICY IF EXISTS habit_xp_awards_select_own ON public.habit_xp_awards;
CREATE POLICY habit_xp_awards_select_own ON public.habit_xp_awards
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.habit_xp_awards FROM anon, authenticated;

-- What has already been paid: one row per existing log (unique per habit/day live).
INSERT INTO public.habit_xp_awards (user_id, habit_id, day, xp_awarded, streak_counted)
SELECT l.user_id, l.habit_id, l.completed_at, greatest(coalesce(l.xp, 0), 0), l.state = 'done'
FROM public.habit_logs l
ON CONFLICT (habit_id, day) DO NOTHING;

-- Same body as live, except where the previous award comes from.
CREATE OR REPLACE FUNCTION public.fn_habit_log_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paid integer;
  v_counted boolean;
  v_prev integer;
  v_delta integer;
  v_entering_done boolean;
begin
  select xp_awarded, streak_counted into v_paid, v_counted
    from public.habit_xp_awards
   where habit_id = NEW.habit_id and day = NEW.completed_at
   for update;

  -- The day's highest award so far, whether or not its row still exists.
  v_prev := greatest(coalesce(v_paid, 0),
                     case when TG_OP = 'UPDATE' then coalesce(OLD.xp, 0) else 0 end);
  v_delta := coalesce(NEW.xp, 0) - v_prev;

  -- The streak steps once per habit-day, not once per transition into 'done'.
  v_entering_done := (NEW.state = 'done')
    and (TG_OP = 'INSERT' or coalesce(OLD.state, '') <> 'done')
    and not coalesce(v_counted, false);

  if v_entering_done then
    update public.habits
    set streak_current = coalesce(streak_current, 0) + 1,
        streak_best = greatest(coalesce(streak_best, 0), coalesce(streak_current, 0) + 1)
    where id = NEW.habit_id;
  end if;

  if v_delta > 0 then
    perform public.add_xp(NEW.user_id, v_delta);
    perform public.track_weekly_xp(NEW.user_id, v_delta);
  end if;

  insert into public.habit_xp_awards (user_id, habit_id, day, xp_awarded, streak_counted)
  values (NEW.user_id, NEW.habit_id, NEW.completed_at,
          greatest(v_prev, coalesce(NEW.xp, 0)),
          coalesce(v_counted, false) or v_entering_done)
  on conflict (habit_id, day) do update
    set xp_awarded = excluded.xp_awarded,
        streak_counted = excluded.streak_counted,
        updated_at = now();

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- B. weekly_xp: server-written only (track_weekly_xp is SECURITY DEFINER)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can manage weekly xp" ON public.weekly_xp;
REVOKE INSERT, UPDATE, DELETE ON public.weekly_xp FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. EXECUTE on SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Trigger functions: never called directly.
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_award() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_set_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habits_record_purged_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_and_award_badges() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_level_up_and_grant_skills() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.initialize_user_pet() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_damage_on_habit_log() FROM PUBLIC, anon, authenticated;

-- Not called by the app or any edge function (grep, 2026-10-09).
REVOKE EXECUTE ON FUNCTION public.habit_xp_value(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_focus_points(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_makeup_completion(uuid, date, boolean, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_and_reset_makeup_credits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_monthly_habits(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_willpower_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_gamification() FROM PUBLIC, anon, authenticated;
-- F13 (RPG / pet / shop / boss) is permanently cancelled (scope addendum).
REVOKE EXECUTE ON FUNCTION public.buy_shop_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_quest_reward(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_daily_quests() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.interact_with_pet(character varying) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_pet_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upgrade_skill(character varying) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_skill_tree() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_boss_status() FROM PUBLIC, anon, authenticated;

-- Called by the app, signed in only: not anonymous.
REVOKE EXECUTE ON FUNCTION public.get_user_rank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_global_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_init_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_init_subscription() TO authenticated;

-- ---------------------------------------------------------------------------
-- D. Grant hygiene
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.user_subscriptions FROM anon, authenticated;
REVOKE INSERT ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, email, username) ON public.profiles TO authenticated;
