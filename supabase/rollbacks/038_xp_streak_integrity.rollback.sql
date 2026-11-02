-- ROLLBACK of 038_xp_streak_integrity.sql
-- STATUS: WRITTEN, NOT APPLIED. Emergency only: it REOPENS the day window, the daily XP cap and
-- the client-writable streak columns. Run it BEFORE 036's rollback (036 refuses while 038 is applied).
--
-- What it undoes, section by section (see the migration):
--   1  the ledger gets its foreign key to habits back (ON DELETE CASCADE, as 036 declared it) and
--      loses habit_fp and its index. Ledger rows of habits that no longer exist are deleted first.
--   2  weekly_xp_xp_earned_sane is dropped.
--   3-7 the guard, purge and streak-protection functions and their triggers are dropped;
--      fn_habit_log_set_xp gets its live body back (live_schema.sql, byte for byte) and
--      fn_habit_log_award the body 036 gave it (036_live_audit_hardening.sql, byte for byte).
--   8  the boss trigger on habit_logs is created again exactly as the live dump has it.
-- The books: under 038 a deleted log's xp moves into profiles.purged_xp when the log is deleted,
-- so a ledger row may hold more than its log still carries while total_xp, habit_logs and
-- purged_xp already agree. 036 cannot tell that apart: its own rollback would move every such
-- excess into purged_xp a second time and then refuse. So each ledger row is cut down to what its
-- log carries before 038 goes; total_xp, habit_logs and purged_xp are not touched and xp_drift()
-- stays as it was.
-- Data loss: the habit name fingerprints, the ledger rows of deleted habits, and the high-water
-- mark of every day whose log was deleted or rewritten while 038 was applied. After this (036
-- alone), such a day is paid again when it is written again; the books stay balanced.
-- Not undone: the one-time streak recomputation (038 section 9). The old lifetime counter was wrong.
--
-- Refuses when: 038 is not applied (fn_habit_log_guard is missing). A second run therefore stops
-- there and changes nothing.
--
-- Run (same session): SET aderyth.rollback_confirm = '038'; then this file.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '038' THEN
    RAISE EXCEPTION 'rollback 038 reopens XP farming (day window, daily cap, streak columns); take a backup, then run: SET aderyth.rollback_confirm = ''038'';'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_habit_log_guard()') IS NULL THEN
    RAISE EXCEPTION '038 is not applied (fn_habit_log_guard is missing); nothing to roll back'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- (1) how many users drift before we touch anything
CREATE TEMP TABLE _rb038 ON COMMIT DROP AS
  SELECT count(*)::int AS drift_before FROM public.xp_drift();

-- (2) triggers first, then the functions they call
DROP TRIGGER IF EXISTS trg_habits_protect_streak ON public.habits;
DROP TRIGGER IF EXISTS trg_habit_log_purge_on_delete ON public.habit_logs;
DROP TRIGGER IF EXISTS trg_habit_log_00_guard ON public.habit_logs;

-- (3) the live boss trigger (live_schema.sql, verbatim)
CREATE OR REPLACE TRIGGER "on_habit_completed_damage_boss" AFTER INSERT ON "public"."habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_damage_on_habit_log"();

-- (4) the live fn_habit_log_set_xp (live_schema.sql, byte for byte)
CREATE OR REPLACE FUNCTION public.fn_habit_log_set_xp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type integer;
  v_streak integer;
  v_entering_done boolean;
  v_prospective integer;
  v_mult numeric;
  v_award integer;
begin
  v_type := public.habit_xp_value(NEW.habit_id, NEW.state, NEW.value);

  v_entering_done := (NEW.state = 'done')
    and (TG_OP = 'INSERT' or COALESCE(OLD.state, '') <> 'done');

  v_streak := COALESCE((select streak_current from public.habits where id = NEW.habit_id), 0);
  v_prospective := v_streak + (case when v_entering_done then 1 else 0 end);
  v_mult := case
              when v_prospective >= 30 then 1.5
              when v_prospective >= 10 then 1.2
              else 1.0
            end;

  v_award := round(v_type * v_mult)::int;
  -- Yüksek-su-işareti: mevcut değerin altına inme
  NEW.xp := greatest(v_award, COALESCE(OLD.xp, 0));
  return NEW;
end;
$function$;

-- (5) 036's fn_habit_log_award (036_live_audit_hardening.sql, byte for byte)
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

DROP FUNCTION IF EXISTS public.fn_habit_log_guard();
DROP FUNCTION IF EXISTS public.fn_habit_log_purge_on_delete();
DROP FUNCTION IF EXISTS public.fn_habits_protect_streak();

-- (6) the ledger, back to 036's shape and 036's bookkeeping
-- rows of deleted habits: their xp is already inside purged_xp (fn_habits_record_purged_xp)
DELETE FROM public.habit_xp_awards a
 WHERE NOT EXISTS (SELECT 1 FROM public.habits h WHERE h.id = a.habit_id);
-- the part of a day's award its log no longer carries is already inside purged_xp too (see above)
UPDATE public.habit_xp_awards a
   SET xp_awarded = greatest(coalesce((SELECT l.xp FROM public.habit_logs l
                                        WHERE l.habit_id = a.habit_id AND l.completed_at = a.day), 0), 0),
       updated_at = now()
 WHERE a.xp_awarded > coalesce((SELECT l.xp FROM public.habit_logs l
                                 WHERE l.habit_id = a.habit_id AND l.completed_at = a.day), 0);
ALTER TABLE public.habit_xp_awards
  ADD CONSTRAINT habit_xp_awards_habit_id_fkey
  FOREIGN KEY (habit_id) REFERENCES public.habits(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.habit_xp_awards_user_day_fp_idx;
ALTER TABLE public.habit_xp_awards DROP COLUMN IF EXISTS habit_fp;

-- (7) weekly_xp
ALTER TABLE public.weekly_xp DROP CONSTRAINT IF EXISTS weekly_xp_xp_earned_sane;

-- (8) the books are checked at the end, inside the transaction
DO $assert$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT drift_before INTO v_before FROM _rb038;
  SELECT count(*)::int INTO v_after FROM public.xp_drift();
  IF v_after > v_before THEN
    RAISE EXCEPTION 'rollback 038 would add xp_drift rows (% users, was %); transaction rolled back', v_after, v_before
      USING ERRCODE = 'P0001';
  END IF;
END $assert$;

COMMIT;
