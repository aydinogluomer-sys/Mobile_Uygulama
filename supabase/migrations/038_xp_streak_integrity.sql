-- 038: XP and streak integrity (P0 XP forgery closed).
--
-- STATUS: WRITTEN, NOT APPLIED. Proposal only: not applied, not tried on a
-- live database. Try it on a Supabase branch first (docs/implementation-v3/
-- SQL_FOR_OWNER.md). Order: 036 -> 037 -> 038. Rollback:
-- supabase/rollbacks/038_xp_streak_integrity.rollback.sql (run it BEFORE 036's).
--
-- Closes, with 036 (ledger + weekly_xp writes):
--   1. a log day outside [CURRENT_DATE - 15, CURRENT_DATE + 1] is refused for
--      client roles (the client allows today and the previous 14 days);
--   2. the client's xp value is ignored: the server computes it, and a day's
--      XP is bounded per user (c_daily_cap) across all of the user's habits;
--   3. delete-and-rewrite, and delete-and-recreate-under-the-same-name, no
--      longer pay a day twice (ledger rows now outlive their habit);
--   4. the streak is the run of counted days with no gap larger than the
--      habit's frequency allows; the multiplier reads that run, not the
--      client-writable habits.streak_current;
--   5. deleting a log moves its xp into profiles.purged_xp, so
--      total_xp = sum(habit_logs.xp) + purged_xp (xp_drift() stays empty);
--   6. habits.streak_current / streak_best cannot be written by the client;
--   7. the F13 boss trigger on habit_logs is dropped (tables stay);
--   8. an update that changes neither state nor value is not scored again: raising a
--      habit's difficulty and then touching old logs (a note, a mood) pays nothing.
-- Parameters (OD-04, change here only): c_days_back = 15, c_days_ahead = 1,
-- c_daily_cap = 2000, multiplier steps 10 -> 1.2 and 30 -> 1.5.

-- ---------------------------------------------------------------------------
-- 0. Precondition: 036 (the ledger) must be applied
-- ---------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regclass('public.habit_xp_awards') IS NULL THEN
    RAISE EXCEPTION '038 requires 036 (public.habit_xp_awards is missing)' USING ERRCODE = 'P0001';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Ledger outlives its habit; fingerprint of the habit name
-- ---------------------------------------------------------------------------
ALTER TABLE public.habit_xp_awards ADD COLUMN IF NOT EXISTS habit_fp text;

-- 036 declared habit_id REFERENCES public.habits(id) ON DELETE CASCADE. Drop that
-- foreign key so a deleted habit keeps its ledger rows (name-independent lookup).
DO $fk$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
    FROM pg_constraint
   WHERE conrelid = 'public.habit_xp_awards'::regclass
     AND contype = 'f'
     AND confrelid = 'public.habits'::regclass;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.habit_xp_awards DROP CONSTRAINT %I', v_con);
  END IF;
END $fk$;

-- Normalised name: trimmed, single spaces, lower case, Turkish I / i / dotless i folded.
UPDATE public.habit_xp_awards a
   SET habit_fp = lower(translate(regexp_replace(btrim(h.name), '\s+', ' ', 'g'), 'İIı', 'iii'))
  FROM public.habits h
 WHERE h.id = a.habit_id AND a.habit_fp IS NULL;

CREATE INDEX IF NOT EXISTS habit_xp_awards_user_day_fp_idx
  ON public.habit_xp_awards (user_id, day, habit_fp);

-- ---------------------------------------------------------------------------
-- 2. weekly_xp sanity bound (writes are already server-only after 036-B)
-- ---------------------------------------------------------------------------
DO $wk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.weekly_xp'::regclass AND conname = 'weekly_xp_xp_earned_sane'
  ) THEN
    ALTER TABLE public.weekly_xp
      ADD CONSTRAINT weekly_xp_xp_earned_sane CHECK (xp_earned >= 0 AND xp_earned <= 1000000) NOT VALID;
  END IF;
END $wk$;

-- ---------------------------------------------------------------------------
-- 3. BEFORE guard (invoker): window, key immutability, client xp ignored
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

-- ---------------------------------------------------------------------------
-- 4. BEFORE xp (definer): server-side award, ledger write, daily cap, fingerprint
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_habit_log_set_xp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_daily_cap constant integer := 2000;
  v_old integer;
  v_name text;
  v_cfg jsonb;
  v_fp text;
  v_paid integer;
  v_sib integer;
  v_others integer;
  v_ext integer;
  v_gap integer;
  v_run integer;
  v_prev_day date;
  v_prospective integer;
  v_mult numeric;
  v_base integer;
  v_award integer;
  v_room integer;
  r record;
begin
  v_old := case when TG_OP = 'UPDATE' then coalesce(OLD.xp, 0) else 0 end;

  -- only a new log, or a change of state or value, is scored: an edit of a note or a mood
  -- (allowed on any day) never re-scores a log under rules that changed since (difficulty)
  if TG_OP = 'UPDATE'
     and NEW.state is not distinct from OLD.state
     and NEW.value is not distinct from OLD.value then
    NEW.xp := v_old;
    return NEW;
  end if;

  select h.name, coalesce(h.frequency_config, '{"kind": "daily"}'::jsonb)
    into v_name, v_cfg
    from public.habits h
   where h.id = NEW.habit_id;
  if not found then
    NEW.xp := v_old;   -- the foreign key refuses the row right after this trigger
    return NEW;
  end if;

  v_fp := lower(translate(regexp_replace(btrim(v_name), '\s+', ' ', 'g'), 'İIı', 'iii'));

  -- one writer per (user, day): the cap below reads the whole day's ledger
  perform pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.completed_at::text, 0));

  select a.xp_awarded into v_paid
    from public.habit_xp_awards a
   where a.habit_id = NEW.habit_id and a.day = NEW.completed_at;

  -- a habit deleted and recreated under the same name: its orphaned ledger row for the same day
  select coalesce(max(a.xp_awarded), 0) into v_sib
    from public.habit_xp_awards a
   where a.user_id = NEW.user_id and a.day = NEW.completed_at
     and a.habit_fp = v_fp and a.habit_id <> NEW.habit_id
     and not exists (select 1 from public.habits x where x.id = a.habit_id);

  -- everything else already paid that day to this user (the cap's other side)
  select coalesce(sum(a.xp_awarded), 0) into v_others
    from public.habit_xp_awards a
   where a.user_id = NEW.user_id and a.day = NEW.completed_at
     and a.habit_id <> NEW.habit_id
     and not (coalesce(a.habit_fp = v_fp, false)
              and not exists (select 1 from public.habits x where x.id = a.habit_id));

  -- already credited for this habit-day but not carried by this row (deleted log, recreated habit)
  v_ext := greatest(coalesce(v_paid, 0) - v_old, v_sib, 0);

  -- largest allowed gap (days) between two counted days, by schedule kind
  v_gap := case coalesce(v_cfg->>'kind', 'daily')
             when 'weekly' then 13
             when 'monthly' then 62
             when 'yearly' then 731
             else case when (v_cfg->>'interval_days') ~ '^[0-9]{1,3}$'
                       then greatest(1, (v_cfg->>'interval_days')::integer) else 1 end
           end;

  -- run of counted days that ends just before this day
  v_run := 0;
  v_prev_day := NEW.completed_at;
  for r in
    select a.day
      from public.habit_xp_awards a
     where a.habit_id = NEW.habit_id and a.streak_counted and a.day < NEW.completed_at
     order by a.day desc
     limit 40
  loop
    exit when v_prev_day - r.day > v_gap;
    v_run := v_run + 1;
    v_prev_day := r.day;
  end loop;

  v_prospective := v_run + (case when NEW.state = 'done' then 1 else 0 end);
  v_mult := case
              when v_prospective >= 30 then 1.5
              when v_prospective >= 10 then 1.2
              else 1.0
            end;

  v_base := public.habit_xp_value(NEW.habit_id, NEW.state, NEW.value);
  v_award := round(v_base * v_mult)::integer;

  v_room := greatest(c_daily_cap - v_others, 0);
  v_award := least(v_award, v_room);

  -- high-water mark per day: never below what this row already carries, never pay twice
  NEW.xp := greatest(v_award - v_ext, v_old);

  insert into public.habit_xp_awards (user_id, habit_id, day, xp_awarded, streak_counted, habit_fp)
  values (NEW.user_id, NEW.habit_id, NEW.completed_at, v_ext + NEW.xp, false, v_fp)
  on conflict (habit_id, day) do update
    set xp_awarded = greatest(public.habit_xp_awards.xp_awarded, excluded.xp_awarded),
        habit_fp = excluded.habit_fp,
        updated_at = now();

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. AFTER award (definer): total_xp, weekly_xp, streak step once per habit-day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_habit_log_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_delta integer;
  v_counted boolean;
  v_fp text;
  v_sib_counted boolean;
  v_cfg jsonb;
  v_gap integer;
  v_run integer;
  v_prev_day date;
  r record;
begin
  -- total_xp moves by exactly what this row's xp grew: sum(habit_logs.xp) + purged_xp stays equal to total_xp
  v_delta := coalesce(NEW.xp, 0) - case when TG_OP = 'UPDATE' then coalesce(OLD.xp, 0) else 0 end;

  select a.streak_counted, a.habit_fp into v_counted, v_fp
    from public.habit_xp_awards a
   where a.habit_id = NEW.habit_id and a.day = NEW.completed_at
   for update;

  if NEW.state = 'done' and not coalesce(v_counted, false) then
    v_sib_counted := exists (
      select 1 from public.habit_xp_awards a
       where a.user_id = NEW.user_id and a.day = NEW.completed_at
         and a.habit_fp = v_fp and a.habit_id <> NEW.habit_id and a.streak_counted
         and not exists (select 1 from public.habits x where x.id = a.habit_id)
    );

    if not v_sib_counted then
      update public.habit_xp_awards
         set streak_counted = true, updated_at = now()
       where habit_id = NEW.habit_id and day = NEW.completed_at;

      select coalesce(h.frequency_config, '{"kind": "daily"}'::jsonb) into v_cfg
        from public.habits h where h.id = NEW.habit_id;

      v_gap := case coalesce(v_cfg->>'kind', 'daily')
                 when 'weekly' then 13
                 when 'monthly' then 62
                 when 'yearly' then 731
                 else case when (v_cfg->>'interval_days') ~ '^[0-9]{1,3}$'
                           then greatest(1, (v_cfg->>'interval_days')::integer) else 1 end
               end;

      -- the run that ends at the newest counted day
      v_run := 0;
      v_prev_day := null;
      for r in
        select a.day from public.habit_xp_awards a
         where a.habit_id = NEW.habit_id and a.streak_counted
         order by a.day desc
         limit 1000
      loop
        if v_prev_day is null then
          v_run := 1;
          v_prev_day := r.day;
        elsif v_prev_day - r.day <= v_gap then
          v_run := v_run + 1;
          v_prev_day := r.day;
        else
          exit;
        end if;
      end loop;

      update public.habits
         set streak_current = v_run,
             streak_best = greatest(coalesce(streak_best, 0), v_run)
       where id = NEW.habit_id;
    end if;
  end if;

  if v_delta > 0 then
    perform public.add_xp(NEW.user_id, v_delta);
    perform public.track_weekly_xp(NEW.user_id, v_delta);
  end if;

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. AFTER DELETE (definer): a deleted log moves its xp to purged_xp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_habit_log_purge_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- When the habit itself is being deleted, fn_habits_record_purged_xp (BEFORE DELETE on habits)
  -- already moved the logs' sum, and the cascade fires after the habit row is gone: skip then.
  if coalesce(OLD.xp, 0) > 0
     and exists (select 1 from public.habits h where h.id = OLD.habit_id) then
    update public.profiles
       set purged_xp = coalesce(purged_xp, 0) + OLD.xp
     where id = OLD.user_id;
  end if;
  return OLD;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. habits: streak columns are not client-writable (invoker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_habits_protect_streak()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- depth 1 = a statement from outside any trigger; the award trigger's own UPDATE is depth 2
  if pg_trigger_depth() = 1 and current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' then
      NEW.streak_current := 0;
      NEW.streak_best := 0;
    else
      NEW.streak_current := OLD.streak_current;
      NEW.streak_best := OLD.streak_best;
    end if;
  end if;
  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_habit_log_00_guard ON public.habit_logs;
CREATE TRIGGER trg_habit_log_00_guard
  BEFORE INSERT OR UPDATE ON public.habit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_habit_log_guard();

DROP TRIGGER IF EXISTS trg_habit_log_purge_on_delete ON public.habit_logs;
CREATE TRIGGER trg_habit_log_purge_on_delete
  AFTER DELETE ON public.habit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_habit_log_purge_on_delete();

DROP TRIGGER IF EXISTS trg_habits_protect_streak ON public.habits;
CREATE TRIGGER trg_habits_protect_streak
  BEFORE INSERT OR UPDATE ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.fn_habits_protect_streak();

-- F13 (RPG / boss) is permanently cancelled: the log path no longer feeds it, and the boss
-- reward path that skipped add_xp (DB2-09) is closed. Tables and data stay (F09 neutralises them).
DROP TRIGGER IF EXISTS on_habit_completed_damage_boss ON public.habit_logs;

-- ---------------------------------------------------------------------------
-- 9. One-time streak recomputation from the ledger (the old counter was a lifetime tally)
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  h record;
  r record;
  v_gap integer;
  v_run integer;
  v_best integer;
  v_prev date;
BEGIN
  FOR h IN
    SELECT hb.id, coalesce(hb.frequency_config, '{"kind": "daily"}'::jsonb) AS cfg
      FROM public.habits hb
     WHERE EXISTS (SELECT 1 FROM public.habit_xp_awards a WHERE a.habit_id = hb.id AND a.streak_counted)
  LOOP
    v_gap := CASE coalesce(h.cfg->>'kind', 'daily')
               WHEN 'weekly' THEN 13
               WHEN 'monthly' THEN 62
               WHEN 'yearly' THEN 731
               ELSE CASE WHEN (h.cfg->>'interval_days') ~ '^[0-9]{1,3}$'
                         THEN greatest(1, (h.cfg->>'interval_days')::integer) ELSE 1 END
             END;
    v_run := 0;
    v_best := 0;
    v_prev := NULL;
    FOR r IN
      SELECT a.day FROM public.habit_xp_awards a
       WHERE a.habit_id = h.id AND a.streak_counted ORDER BY a.day ASC
    LOOP
      IF v_prev IS NOT NULL AND r.day - v_prev <= v_gap THEN
        v_run := v_run + 1;
      ELSE
        v_run := 1;
      END IF;
      v_best := greatest(v_best, v_run);
      v_prev := r.day;
    END LOOP;
    UPDATE public.habits SET streak_current = v_run, streak_best = v_best WHERE id = h.id;
  END LOOP;

  -- a habit with no counted day at all has no run either (its old counter counted transitions)
  UPDATE public.habits hb
     SET streak_current = 0, streak_best = 0
   WHERE (coalesce(hb.streak_current, 0) <> 0 OR coalesce(hb.streak_best, 0) <> 0)
     AND NOT EXISTS (SELECT 1 FROM public.habit_xp_awards a WHERE a.habit_id = hb.id AND a.streak_counted);
END $backfill$;

-- ---------------------------------------------------------------------------
-- 10. EXECUTE: triggers never need it; nothing here is callable by a client
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_set_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_award() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habit_log_purge_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_habits_protect_streak() FROM PUBLIC, anon, authenticated;
