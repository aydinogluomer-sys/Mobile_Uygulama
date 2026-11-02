-- ROLLBACK of 036_live_audit_hardening.sql
-- STATUS: WRITTEN, NOT APPLIED. Emergency only: it REOPENS weekly_xp client writes
-- and the client EXECUTE grants. Run 038's rollback first.
--
-- What it undoes, section by section (see the migration):
--   A  the XP award ledger public.habit_xp_awards is dropped and fn_habit_log_award() gets its
--      live body back. Before the ledger goes, the XP it recorded but habit_logs no longer
--      carries (a day that was deleted and rewritten keeps its highest award in the ledger)
--      is moved to profiles.purged_xp, so total_xp = sum(habit_logs.xp) + purged_xp still
--      holds and xp_drift() does not start reporting that user (DB2-07).
--   B  weekly_xp client writes come back (the "System can manage weekly xp" policy and the
--      INSERT / UPDATE / DELETE grants for anon and authenticated).
--   C  EXECUTE on the 27 functions of section C is granted back as the live dump has it.
--   D  user_subscriptions INSERT / UPDATE and the table-level profiles INSERT come back.
-- Data loss: the ledger rows (per habit and day: the highest award and whether the streak step
-- was counted). After this, a deleted and rewritten day is paid again and counts the streak
-- again (S11); the XP and streak history that existed before stays as it is.
-- Not undone: the profiles.purged_xp transfer. It is bookkeeping that keeps xp_drift() empty.
-- Scope: this restores the live EXECUTE grants of the dormant RPG RPCs (interact_with_pet,
-- upgrade_skill, buy_shop_item, claim_quest_reward, ...) because that is what the live
-- database had before 036. The client has no surface for them and must not get one: they
-- belong to the permanently cancelled scope-addendum F13 family.
--
-- Refuses when: 036 is not applied (public.habit_xp_awards is missing: the TO PUBLIC grants
-- below would open a hardened database), or 038 is still applied (fn_habit_log_guard exists:
-- 038 uses the ledger, roll 038 back first). A second run therefore stops at the "not applied" check.
--
-- Run (same session): SET aderyth.rollback_confirm = '036'; then this file.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '036' THEN
    RAISE EXCEPTION 'rollback 036 reopens weekly_xp writes and client EXECUTE grants and drops the XP ledger; take a backup, then run: SET aderyth.rollback_confirm = ''036'';'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.habit_xp_awards') IS NULL THEN
    RAISE EXCEPTION '036 is not applied (public.habit_xp_awards is missing); refusing to open grants on a hardened database'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_habit_log_guard') THEN
    RAISE EXCEPTION '038 is still applied; run supabase/rollbacks/038_xp_streak_integrity.rollback.sql first'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- (1) how many users drift before we touch anything
CREATE TEMP TABLE _rb036 ON COMMIT DROP AS
  SELECT count(*)::int AS drift_before FROM public.xp_drift();

-- (2) DB2-07: XP the ledger recorded but habit_logs no longer carries (a deleted and
-- rewritten day keeps its highest award in the ledger) becomes purged_xp, so that
-- total_xp = sum(habit_logs.xp) + purged_xp still holds once the ledger is gone.
UPDATE public.profiles p
   SET purged_xp = coalesce(p.purged_xp, 0) + x.excess
  FROM (
    SELECT a.user_id,
           sum(greatest(a.xp_awarded - coalesce(l.xp, 0), 0))::int AS excess
      FROM public.habit_xp_awards a
      LEFT JOIN public.habit_logs l
             ON l.habit_id = a.habit_id AND l.completed_at = a.day
     GROUP BY a.user_id
    HAVING sum(greatest(a.xp_awarded - coalesce(l.xp, 0), 0)) > 0
  ) x
 WHERE p.id = x.user_id;

-- (3) A: the live fn_habit_log_award body (live_schema.sql, byte for byte)
CREATE OR REPLACE FUNCTION public.fn_habit_log_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev integer;
  v_delta integer;
  v_entering_done boolean;
begin
  v_prev := case when TG_OP = 'UPDATE' then COALESCE(OLD.xp, 0) else 0 end;
  v_delta := COALESCE(NEW.xp, 0) - v_prev;

  v_entering_done := (NEW.state = 'done')
    and (TG_OP = 'INSERT' or COALESCE(OLD.state, '') <> 'done');

  -- Seri yalnız "done'a geçişte" artar
  if v_entering_done then
    update public.habits
    set streak_current = COALESCE(streak_current, 0) + 1,
        streak_best = greatest(COALESCE(streak_best, 0), COALESCE(streak_current, 0) + 1)
    where id = NEW.habit_id;
  end if;

  -- Profile + haftalık XP'ye yalnız pozitif fark eklenir (add_xp level/rank/badges zincirini tetikler)
  if v_delta > 0 then
    perform public.add_xp(NEW.user_id, v_delta);
    perform public.track_weekly_xp(NEW.user_id, v_delta);
  end if;

  return NEW;
end;
$function$;

-- (4) the ledger (its policy and PK go with it)
DROP TABLE public.habit_xp_awards;

-- (5) B: weekly_xp client writes (live_schema.sql: policy "System can manage weekly xp" and the table grants)
DROP POLICY IF EXISTS "System can manage weekly xp" ON public.weekly_xp;
CREATE POLICY "System can manage weekly xp" ON public.weekly_xp
  USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
GRANT INSERT, UPDATE, DELETE ON public.weekly_xp TO anon, authenticated;

-- (6) C: EXECUTE as the live dump has it. The dump holds no REVOKE FROM PUBLIC line for these
-- functions, so PUBLIC kept its default EXECUTE; service_role was never touched by 036.
-- trigger functions and habit_xp_value: PUBLIC only
GRANT EXECUTE ON FUNCTION public.fn_habit_log_award() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_habit_log_set_xp() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_habits_record_purged_xp() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_award_badges() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_level_up_and_grant_skills() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_user_pet() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_damage_on_habit_log() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.habit_xp_value(uuid, text, integer) TO PUBLIC;
-- functions with explicit anon + authenticated grants in the dump
GRANT EXECUTE ON FUNCTION public.spend_focus_points(integer, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_makeup_completion(uuid, date, boolean, text, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_willpower_stats() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interact_with_pet(character varying) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_skill(character varying) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_skill_tree() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_init_subscription() TO PUBLIC, anon, authenticated;
-- functions with an explicit authenticated grant in the dump
GRANT EXECUTE ON FUNCTION public.check_and_reset_makeup_credits() TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_habits(date, date) TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_gamification() TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.buy_shop_item(uuid) TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quest_reward(uuid) TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quests() TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_pet_status() TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_boss_status() TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid) TO PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(integer) TO PUBLIC, authenticated;

-- (7) D: grant hygiene as the live dump has it (user_subscriptions INSERT / UPDATE, profiles table-level INSERT)
GRANT INSERT, UPDATE ON public.user_subscriptions TO anon, authenticated;
REVOKE INSERT (id, email, username) ON public.profiles FROM authenticated;
GRANT INSERT ON public.profiles TO anon, authenticated;

-- (8) DB2-07: a database that was clean stays clean. Counting users is enough here: the check
-- fails the whole transaction when the rollback adds a drifting user.
DO $assert$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT drift_before INTO v_before FROM _rb036;
  SELECT count(*)::int INTO v_after FROM public.xp_drift();
  IF v_after > v_before THEN
    RAISE EXCEPTION 'rollback 036 would add xp_drift rows (% users, was %); transaction rolled back', v_after, v_before
      USING ERRCODE = 'P0001';
  END IF;
END $assert$;

COMMIT;
