-- 03: xp_drift() stays empty through the REAL trigger chain (TST-01; constitution rule A.7).
--
-- Real habit_logs writes as `authenticated` fire fn_habit_log_set_xp (BEFORE),
-- fn_habit_log_award (AFTER), add_xp, track_weekly_xp and, on habit delete,
-- fn_habits_record_purged_xp. Nothing here ever UPDATEs profiles.total_xp, not even the
-- superuser fixture, so a drift can only come from the chain itself. The logs' xp column
-- values below may be overwritten by the BEFORE trigger; the test never asserts an XP value,
-- only that xp_drift() returns no row after each stage.
--
-- xp_drift() scans every user, not just this fixture: that is deliberate (general health) and
-- is why 01 and 05 never write habit_logs or total_xp in their committed rows.
-- Everything is one transaction that ends in ROLLBACK.
BEGIN;
-- fixture as superuser inside the transaction (rolled back)
INSERT INTO auth.users (id, email) VALUES ('a3000000-0000-4000-8000-000000000001', 't03@aderyth.test');
-- on_profile_created_pet (dormant, scope-addendum F13) would trip a foreign key on the unseeded pet_stages table;
-- it is not under test, so only this one insert runs with ordinary triggers off. The XP triggers
-- below must fire, so the role goes straight back to origin.
SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (id, email, username) VALUES ('a3000000-0000-4000-8000-000000000001', 't03@aderyth.test', 't03');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.habits (id, user_id, name, tracking_type, status)
VALUES ('a3aaaaaa-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Test Alışkanlığı', 'boolean', 'active');
INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state, is_completed, xp)
VALUES ('a3aaaaaa-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', CURRENT_DATE, 'done', true, 10),
       ('a3aaaaaa-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', CURRENT_DATE - 1, 'done', true, 10),
       ('a3aaaaaa-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', CURRENT_DATE - 2, 'partial', false, 5);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT aderyth_test.res('T03a_xp_drift_zero_after_log_insert', count(*) = 0,
  coalesce(string_agg(format('%s drift=%s', d.user_id, d.drift), '; '), 'no drift')) FROM public.xp_drift() d;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
UPDATE public.habit_logs SET state = 'partial', is_completed = false, xp = 5
 WHERE habit_id = 'a3aaaaaa-0000-4000-8000-000000000001' AND completed_at = CURRENT_DATE;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT aderyth_test.res('T03b_xp_drift_zero_after_done_to_partial', count(*) = 0,
  coalesce(string_agg(format('%s drift=%s', d.user_id, d.drift), '; '), 'no drift')) FROM public.xp_drift() d;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
DELETE FROM public.habits WHERE id = 'a3aaaaaa-0000-4000-8000-000000000001';   -- cascades the logs; purged_xp keeps the books honest
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT aderyth_test.res('T03c_xp_drift_zero_after_habit_delete', count(*) = 0,
  coalesce(string_agg(format('%s drift=%s', d.user_id, d.drift), '; '), 'no drift')) FROM public.xp_drift() d;
RESET ROLE;
SELECT aderyth_test.res('T03d_xp_drift_closed_to_authenticated',
  NOT has_function_privilege('authenticated', 'public.xp_drift()', 'EXECUTE'), 'xp_drift is service_role only');
ROLLBACK;
