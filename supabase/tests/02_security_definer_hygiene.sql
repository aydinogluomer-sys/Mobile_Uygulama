-- 02: SECURITY DEFINER hygiene on the public schema (TST-01, DB1-07, DB2-13).
--
-- Pure SQL, no privilege or policy changes (this file lives outside supabase/migrations on purpose).
-- It emits one result PER FUNCTION for the two dynamic families, so a later fix is removed from
-- expected_failures.txt one line at a time:
--   T02a_anon_execute.<name>/<nargs>   anon may not EXECUTE any public SECURITY DEFINER function
--   T02b_search_path.<name>/<nargs>    every public SECURITY DEFINER function pins search_path
-- Extension-owned functions are skipped (they are not ours to pin).

-- T02a: anon has no EXECUTE on any public SECURITY DEFINER function (PUBLIC grants count:
-- has_function_privilege resolves them).
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.pronargs, p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1, 2
  LOOP
    n := n + 1;
    PERFORM aderyth_test.res(format('T02a_anon_execute.%s/%s', r.proname, r.pronargs), false, r.sig);
  END LOOP;
  IF n = 0 THEN PERFORM aderyth_test.res('T02a_anon_execute.all', true, 'no SECURITY DEFINER function is anon-executable'); END IF;
END $$;

-- T02b: every public SECURITY DEFINER function pins search_path (reachable_by shows the blast radius).
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.pronargs, p.oid::regprocedure::text AS sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1, 2
  LOOP
    n := n + 1;
    PERFORM aderyth_test.res(format('T02b_search_path.%s/%s', r.proname, r.pronargs), false,
                             format('%s reachable_by_authenticated=%s', r.sig, r.auth_exec));
  END LOOP;
  IF n = 0 THEN PERFORM aderyth_test.res('T02b_search_path.all', true, 'all SECURITY DEFINER functions pin search_path'); END IF;
END $$;

-- T02c: service-only functions are closed to client roles (the live dump removes PUBLIC execute from each
-- of them and opens it to service_role only).
SELECT aderyth_test.res('T02c_service_only_closed_to_clients',
  NOT (has_function_privilege('authenticated', 'public.xp_drift()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.xp_drift()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.add_xp(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.add_xp(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.track_weekly_xp(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.track_weekly_xp(uuid,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.spend_focus_points_v2(uuid,integer,text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.spend_focus_points_v2(uuid,integer,text,text)', 'EXECUTE')),
  'xp_drift / add_xp / track_weekly_xp / spend_focus_points_v2 must be service_role only');

-- T02d: positive control for the harness
SELECT aderyth_test.res('T02d_control_service_role_can_execute_xp_drift',
  has_function_privilege('service_role', 'public.xp_drift()', 'EXECUTE'), 'service_role EXECUTE on xp_drift()');

-- T02e: the 037 read RPC is authenticated-only (migration 037 removes PUBLIC and anon execute and opens it to authenticated)
SELECT aderyth_test.res('T02e_get_today_bootstrap_authenticated_only',
  has_function_privilege('authenticated', 'public.get_today_bootstrap(date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_today_bootstrap(date)', 'EXECUTE'),
  'migration 037 grants');
