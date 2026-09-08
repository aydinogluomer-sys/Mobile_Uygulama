-- ============================================================
-- `xp_drift()` reported healthy users as drifted, and `rebuild_profile_xp()`
-- would have taken their XP away.
--
-- ## The interaction
--
-- `xp_drift` states its premise plainly: "`habit_logs.xp` is the canonical
-- source ... a non-zero `drift` therefore means the total did not come from
-- the logs." That premise stops being true the moment a habit is deleted.
-- `habit_logs.habit_id` is `ON DELETE CASCADE`, and deleting a habit is an
-- ordinary user action reachable from two tabs (`app/tabs/habits.tsx`,
-- `app/tabs/timeline.tsx` -> `purgeHabit`). The logs go; the XP they awarded
-- stays on the profile, because nothing subtracts it.
--
-- Reproduced from zero on an untouched account:
--
--     total_xp 0 -> log one `done` habit -> total_xp 10
--     delete the habit (log cascades away) -> total_xp 10, sum(logs) 0
--     xp_drift() -> drift 10
--
-- So the detector fires for every user who has ever deleted a habit, and the
-- repair it points at, `rebuild_profile_xp`, replays only the surviving logs
-- — confiscating XP that was legitimately earned. A monitor that cries wolf
-- gets ignored; a repair that destroys is worse than no repair.
--
-- ## The fix: remember what was purged, rather than narrow the claim
--
-- The alternative was to make `xp_drift` skip users with deletions, which
-- would blind it exactly where a real drift is hardest to notice. Instead the
-- purged XP is recorded, so the invariant becomes true again and stays
-- checkable:
--
--     profiles.total_xp = sum(habit_logs.xp) + profiles.purged_xp
--
-- `purged_xp` is written only by the trigger below (`authenticated` has no
-- UPDATE privilege on `profiles` at all, and the column-level grant covers
-- `username` only), so it is not something a client can move.
--
-- Backfill is deliberately NOT attempted: the XP of already-deleted logs is
-- gone and cannot be recovered, and inventing a number to make the invariant
-- look satisfied would be the same dishonesty in the other direction. The
-- existing gap is instead absorbed once, explicitly, below.
-- ============================================================

alter table public.profiles
  add column if not exists purged_xp integer not null default 0;

comment on column public.profiles.purged_xp is
  'XP earned by habit_logs that were removed when their habit was deleted. Server-written only (see trg_habits_record_purged_xp). Exists so total_xp stays reconstructible after a purge: total_xp = sum(habit_logs.xp) + purged_xp.';

-- ── record the XP a purge is about to destroy ──────────────────────────
--
-- BEFORE DELETE on `habits`: the child rows still exist at this point, so
-- their XP is still readable. AFTER would be too late — the cascade has
-- already run.
create or replace function public.fn_habits_record_purged_xp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_xp bigint;
begin
  select coalesce(sum(coalesce(xp, 0)), 0) into v_xp
  from public.habit_logs
  where habit_id = OLD.id;

  if v_xp > 0 then
    update public.profiles
       set purged_xp = coalesce(purged_xp, 0) + v_xp::int
     where id = OLD.user_id;
  end if;

  return OLD;
end;
$function$;

drop trigger if exists trg_habits_record_purged_xp on public.habits;
create trigger trg_habits_record_purged_xp
  before delete on public.habits
  for each row execute function public.fn_habits_record_purged_xp();

-- ── the detector, told the whole truth ─────────────────────────────────
create or replace function public.xp_drift()
returns table(user_id uuid, recorded_total integer, logged_total bigint, drift bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id,
         coalesce(p.total_xp, 0) as recorded_total,
         coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0) as logged_total,
         coalesce(p.total_xp, 0) - (coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0)) as drift
  from public.profiles p
  left join (
    select hl.user_id, sum(coalesce(hl.xp, 0)) as sum_xp
    from public.habit_logs hl
    group by hl.user_id
  ) l on l.user_id = p.id
  where coalesce(p.total_xp, 0) <> coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0);
$function$;

comment on function public.xp_drift() is
  'Users whose profiles.total_xp disagrees with sum(habit_logs.xp) + profiles.purged_xp. Empty is the healthy state. Deleting a habit cascades its logs away, so purged_xp is what keeps the comparison honest for anyone who has ever deleted one. Service-role only: it reads every profile.';

-- ── the repair, likewise ───────────────────────────────────────────────
create or replace function public.rebuild_profile_xp(p_user_id uuid)
returns table(before_total integer, after_total integer, logged_total bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_before integer;
  v_logged bigint;
  v_purged integer;
BEGIN
  select coalesce(total_xp, 0), coalesce(purged_xp, 0)
    into v_before, v_purged
  from public.profiles where id = p_user_id;
  if not found then raise exception 'no such profile: %', p_user_id; end if;

  select coalesce(sum(coalesce(xp, 0)), 0) into v_logged
  from public.habit_logs where user_id = p_user_id;

  -- Purged XP is part of what the user earned; rebuilding without it would
  -- turn a repair into a confiscation.
  v_logged := v_logged + v_purged;

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
  'Recomputes profiles.total_xp/level/rank for one user from habit_logs.xp + profiles.purged_xp by replaying add_xp from a clean slate. Service-role only.';

revoke all on function public.xp_drift() from public;
revoke all on function public.rebuild_profile_xp(uuid) from public;
grant execute on function public.xp_drift() to service_role;
grant execute on function public.rebuild_profile_xp(uuid) to service_role;

-- ── absorb the pre-existing gap, once, visibly ─────────────────────────
--
-- Every profile that is ALREADY ahead of its logs got there the same way, on
-- a database with no ledger to record it. Those logs are gone. Seeding
-- `purged_xp` with the existing difference states the fact ("this much came
-- from logs that no longer exist") instead of leaving a permanent false
-- positive that trains everyone to ignore the detector. It cannot overstate:
-- only positive differences are absorbed, so a profile that is BEHIND its
-- logs — the direction that would mean a real award failure — still reports.
update public.profiles p
   set purged_xp = coalesce(p.purged_xp, 0) + (coalesce(p.total_xp, 0) - coalesce(l.sum_xp, 0))
  from (
    select u.id,
           coalesce((select sum(coalesce(hl.xp, 0)) from public.habit_logs hl where hl.user_id = u.id), 0) as sum_xp
    from public.profiles u
  ) l
 where l.id = p.id
   and coalesce(p.total_xp, 0) - coalesce(l.sum_xp, 0) > 0;
