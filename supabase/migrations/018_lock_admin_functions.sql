-- ============================================================
-- `xp_drift()` and `rebuild_profile_xp()` say "Service-role only" in their own
-- COMMENT, and both were callable by `anon`.
--
-- ## Proved, not suspected
--
-- With nothing but the publishable anon key — the one shipped inside the app
-- bundle — and no user session at all:
--
--     POST /rest/v1/rpc/xp_drift            -> 200
--     POST /rest/v1/rpc/rebuild_profile_xp  -> 200
--         { "before_total": 30, "after_total": 30, "logged_total": 30 }
--
-- The second one RAN, against a real account's uuid passed in the body. It
-- happened to recompute the same number, so nothing was damaged — but the
-- write path executed, and `rebuild_profile_xp` resets `total_xp`,
-- `current_level_xp`, `level` and `willpower_rank` from a clean slate. An
-- unauthenticated caller could have rewritten any user's progression, and
-- `xp_drift` returns EVERY profile's id and totals whenever the database is
-- not perfectly balanced.
--
-- ## Why the existing revoke did not work
--
-- `20260831_xp_integrity` ends with
--
--     revoke all on function public.xp_drift() from public;
--     grant execute on function public.xp_drift() to service_role;
--
-- which is the natural thing to write and does not do the job. Supabase's
-- default privileges grant EXECUTE to `anon` and `authenticated` EXPLICITLY at
-- CREATE time; revoking from `PUBLIC` removes the PUBLIC entry and leaves both
-- named grants standing. The ACL said so all along:
--
--     postgres=X/postgres anon=X/postgres authenticated=X/postgres service_role=X/postgres
--
-- `20260831_xp_drift_survives_purge` repeated the same two lines when it
-- replaced the functions, so this pass carried the mistake forward rather than
-- catching it. It is caught now because the question was asked as "who can
-- actually call this" instead of "did we write a revoke".
--
-- ## What else goes
--
-- Every `RETURNS trigger` function in `public`. A trigger function is invoked
-- by the trigger machinery, which does NOT check EXECUTE at fire time — the
-- privilege is checked when the trigger is created — so granting it to a
-- client role buys nothing and hands out a SECURITY DEFINER entry point.
-- (Verified after applying: logging a habit still awards XP.)
--
-- `habit_xp_value` goes too: it is the scorer the trigger calls, never
-- something a client should invoke.
--
-- The default-privileges line stops the next `create function` from handing
-- `anon` EXECUTE again. `authenticated` keeps its default, because the app's
-- own RPCs are called with a user session and revoking that would break them.
--
-- ## Deliberately NOT changed here
--
-- The ~15 app RPCs that scope themselves on `auth.uid()` — `spend_focus_points_v2`,
-- `log_makeup_completion`, `buy_shop_item` and the rest. `anon` can reach them
-- today, but `auth.uid()` is NULL there so they act on nothing or raise.
-- Tightening those is worth doing and deserves its own pass with a live check
-- per function, not a sweep at the end of an unrelated one. Recorded as a gap
-- rather than half-done here.
-- ============================================================

-- ── 1. the two that were always meant to be service-role only ──────────
revoke execute on function public.xp_drift() from anon, authenticated;
revoke execute on function public.rebuild_profile_xp(uuid) from anon, authenticated;
grant execute on function public.xp_drift() to service_role;
grant execute on function public.rebuild_profile_xp(uuid) to service_role;

-- ── 2. the internal scorer ─────────────────────────────────────────────
revoke execute on function public.habit_xp_value(uuid, text, integer) from anon, authenticated;

-- ── 3. every trigger function ──────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and t.typname = 'trigger'
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.sig);
  end loop;
end $$;

-- ── 4. and the next one that gets created ──────────────────────────────
alter default privileges in schema public revoke execute on functions from anon;
