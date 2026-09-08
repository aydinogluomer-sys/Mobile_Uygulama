-- ============================================================
-- XP is earned, not declared.
--
-- ── 1. The leaderboard was client-writable ─────────────────────────────
--
-- `get_global_leaderboard` ranks every user by `profiles.total_xp` and shows
-- `level` and `willpower_rank` beside it. All three are written by `add_xp`,
-- which is correctly locked down (EXECUTE for postgres and service_role
-- only). But the TABLE was not:
--
--   policy "Users can update own profile"
--     UPDATE USING (id = auth.uid())          -- no WITH CHECK
--   column grants to authenticated: total_xp, level, current_level_xp,
--     next_level_xp, willpower_rank, coins, skill_points, makeup_credits, ...
--
-- So the whole gamification state was reachable with one ordinary PostgREST
-- call:
--
--     PATCH /rest/v1/profiles?id=eq.<self>
--     { "total_xp": 999999999, "level": 99, "willpower_rank": "Efsane" }
--
-- and the caller tops the global leaderboard that every other user sees.
-- Locking `add_xp` was necessary and was not sufficient: the function was
-- never the only way in.
--
-- Note what the earlier hardening DID cover, so this is not read as a
-- regression: `xp` is already ungranted, and `add_xp`/`track_weekly_xp` are
-- already service-role only. The gap is that `add_xp` does not write a column
-- called `xp` — it writes `total_xp`, `level`, `current_level_xp`,
-- `next_level_xp` and `willpower_rank`, and those were all open.
--
-- The client writes exactly one column of this table, `username`
-- (repositories/profileRepository.ts:44). Everything else is server-derived,
-- so the grant is narrowed to that one column. A column grant is the real
-- control here; the WITH CHECK added below is defence in depth for the rows a
-- caller may address at all.
--
-- ── 2. Three trigger functions attached to nothing ─────────────────────
--
--   process_habit_xp             writes profiles, no trigger
--   trigger_xp_habit_completion  calls add_xp, no trigger
--   trigger_xp_task_completion   calls add_xp, no trigger
--
-- Not exploitable — a function returning `trigger` cannot be called
-- directly, and PostgREST does not expose one — so this is dead code, not a
-- hole. It is dangerous dead code: two of them award XP for the same events
-- the live pair (`fn_habit_log_set_xp` + `fn_habit_log_award`) already
-- handles, so attaching one "to be safe" would double every award silently.
--
-- ── 3. Nothing could tell whether the number was right ─────────────────
--
-- `fn_habit_log_award` is the only live path into `profiles.total_xp`, and it
-- adds exactly the positive delta of `habit_logs.xp`. That makes total_xp
-- reconstructible: it should equal `sum(habit_logs.xp)` for the user. Nothing
-- checked, so a drift — from the writable columns above, from a restore, from
-- a deleted log row — was invisible and permanent.
--
-- `xp_drift()` reports it and `rebuild_profile_xp()` repairs it, both from the
-- logs, which are the evidence.
--
-- Scope: grants and one policy on `profiles`; three dead functions dropped;
-- two new read/repair functions. No row is modified by this migration.
-- ============================================================

-- ── 1. Only `username` is the user's to write ──────────────────────────
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;

-- USING says which ROWS may be addressed; without WITH CHECK, the row after
-- the update is unconstrained. Adding it stops an update that would move the
-- row to another owner.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── 2. Retire the unattached award functions ───────────────────────────
drop function if exists public.process_habit_xp();
drop function if exists public.trigger_xp_habit_completion();
drop function if exists public.trigger_xp_task_completion();

-- ── 3. Make the number checkable ───────────────────────────────────────

/**
 * Per-user difference between the recorded total and the sum of its evidence.
 *
 * `habit_logs.xp` is the canonical source: `fn_habit_log_set_xp` computes it
 * and `fn_habit_log_award` adds the positive delta to `profiles.total_xp`.
 * A non-zero `drift` therefore means the total did not come from the logs.
 *
 * Deliberately a read. Repairing on detection would hide how often it happens
 * and would silently rewrite a user's number on a schedule nobody watches.
 */
create or replace function public.xp_drift()
returns table(user_id uuid, recorded_total integer, logged_total bigint, drift bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id,
         coalesce(p.total_xp, 0) as recorded_total,
         coalesce(l.sum_xp, 0)   as logged_total,
         coalesce(p.total_xp, 0) - coalesce(l.sum_xp, 0) as drift
  from public.profiles p
  left join (
    select hl.user_id, sum(coalesce(hl.xp, 0)) as sum_xp
    from public.habit_logs hl
    group by hl.user_id
  ) l on l.user_id = p.id
  where coalesce(p.total_xp, 0) <> coalesce(l.sum_xp, 0);
$function$;

comment on function public.xp_drift() is
  'Users whose profiles.total_xp disagrees with sum(habit_logs.xp). Empty is the healthy state. Service-role only: it reads every profile.';

/**
 * Recomputes one user's XP from their logs.
 *
 * Level and the level thresholds are re-derived by replaying `add_xp` from a
 * clean slate rather than being patched in place — the level curve is
 * `next_level_xp * 1.15` per level, so a total cannot be turned into a level
 * by arithmetic on the current row.
 *
 * Returns the before/after so a caller can record what it changed.
 */
create or replace function public.rebuild_profile_xp(p_user_id uuid)
returns table(before_total integer, after_total integer, logged_total bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_before integer;
  v_logged bigint;
BEGIN
  select coalesce(total_xp, 0) into v_before from public.profiles where id = p_user_id;
  if not found then raise exception 'no such profile: %', p_user_id; end if;

  select coalesce(sum(coalesce(xp, 0)), 0) into v_logged
  from public.habit_logs where user_id = p_user_id;

  update public.profiles
     set total_xp = 0, current_level_xp = 0, level = 1,
         next_level_xp = 100, willpower_rank = public.get_rank_for_level(1)
   where id = p_user_id;

  if v_logged > 0 then
    perform public.add_xp(p_user_id, v_logged::int);
  end if;

  return query
    select v_before,
           (select coalesce(total_xp, 0) from public.profiles where id = p_user_id),
           v_logged;
END;
$function$;

comment on function public.rebuild_profile_xp(uuid) is
  'Recomputes profiles.total_xp/level/rank for one user from habit_logs.xp by replaying add_xp from a clean slate. Service-role only.';

revoke all on function public.xp_drift() from public;
revoke all on function public.rebuild_profile_xp(uuid) from public;
grant execute on function public.xp_drift() to service_role;
grant execute on function public.rebuild_profile_xp(uuid) to service_role;
