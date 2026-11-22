-- 11: profile time zone, local-day log window, and local-week XP / leaderboard (043 / F15).
-- Runs inside a single rolled-back transaction using SAVEPOINTs and RESET ROLE so no test rows outlive the file.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-4000-8000-000000000001', 't11a@aderyth.test'),
  ('a7000000-0000-4000-8000-000000000002', 't11b@aderyth.test'),
  ('a7000000-0000-4000-8000-000000000003', 't11c@aderyth.test'),
  ('a7000000-0000-4000-8000-000000000004', 't11d@aderyth.test'),
  ('a7000000-0000-4000-8000-000000000005', 't11e@aderyth.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, username, time_zone) VALUES
  ('a7000000-0000-4000-8000-000000000001', 't11a@aderyth.test', 't11a', NULL),
  ('a7000000-0000-4000-8000-000000000002', 't11b@aderyth.test', 't11b', 'Pacific/Kiritimati'),
  ('a7000000-0000-4000-8000-000000000003', 't11c@aderyth.test', 't11c', 'Pacific/Pago_Pago'),
  ('a7000000-0000-4000-8000-000000000004', 't11d@aderyth.test', 't11d', 'Not/AZone'),
  ('a7000000-0000-4000-8000-000000000005', 't11e@aderyth.test', 't11e', 'Pacific/Auckland')
ON CONFLICT (id) DO UPDATE SET time_zone = EXCLUDED.time_zone;

INSERT INTO public.habits (id, user_id, name, tracking_type, status, difficulty, impact_level, willpower_cost)
VALUES
  ('a7000000-0000-4000-8000-0000000000b1', 'a7000000-0000-4000-8000-000000000001', 'Yuruyus', 'boolean', 'active', 3, 'medium', 3),
  ('a7000000-0000-4000-8000-0000000000b2', 'a7000000-0000-4000-8000-000000000002', 'Yuruyus', 'boolean', 'active', 3, 'medium', 3),
  ('a7000000-0000-4000-8000-0000000000b3', 'a7000000-0000-4000-8000-000000000003', 'Yuruyus', 'boolean', 'active', 3, 'medium', 3),
  ('a7000000-0000-4000-8000-0000000000b4', 'a7000000-0000-4000-8000-000000000004', 'Yuruyus', 'boolean', 'active', 3, 'medium', 3),
  ('a7000000-0000-4000-8000-0000000000b5', 'a7000000-0000-4000-8000-000000000005', 'Yuruyus', 'boolean', 'active', 3, 'medium', 3)
ON CONFLICT (id) DO NOTHING;

-- structure and ACL (superuser)
SELECT aderyth_test.res('T11a_column_and_check',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'time_zone' AND data_type = 'text')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_time_zone_check'));

SELECT aderyth_test.res('T11q_helper_acl',
  has_function_privilege('authenticated', 'public.local_date_in_zone(text, timestamptz)', 'execute')
  AND NOT has_function_privilege('anon', 'public.local_date_in_zone(text, timestamptz)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.week_start_in_zone(text, timestamptz)', 'execute')
  AND NOT has_function_privilege('anon', 'public.set_profile_time_zone(text)', 'execute')
  AND has_function_privilege('authenticated', 'public.set_profile_time_zone(text)', 'execute'));

-- fixed instants: the DB2-11 scenario and the DST edges
SELECT aderyth_test.res('T11i_local_date_fixed_instants',
  public.local_date_in_zone('Europe/Istanbul', '2026-11-01 21:30:00+00') = DATE '2026-11-02'
  AND public.local_date_in_zone('America/New_York', '2026-11-02 04:30:00+00') = DATE '2026-11-01'
  AND public.local_date_in_zone('America/New_York', '2026-03-08 06:59:00+00') = DATE '2026-03-08'
  AND public.local_date_in_zone('Pacific/Auckland', '2026-11-01 11:30:00+00') = DATE '2026-11-02'
  AND public.local_date_in_zone('UTC', '2026-11-01 23:59:59+00') = DATE '2026-11-01'
  AND public.local_date_in_zone(NULL, '2026-11-01 23:59:59+00') = DATE '2026-11-01'
  AND public.local_date_in_zone('', '2026-11-01 23:59:59+00') = DATE '2026-11-01'
  AND public.local_date_in_zone('Not/AZone', '2026-11-01 23:59:59+00') = DATE '2026-11-01');

SELECT aderyth_test.res('T11j_week_start_fixed_instants',
  public.week_start_in_zone('Europe/Istanbul', '2026-11-01 21:30:00+00') = DATE '2026-11-02'
  AND public.week_start_in_zone('UTC', '2026-11-01 21:30:00+00') = DATE '2026-10-26'
  AND public.week_start_in_zone('America/New_York', '2026-11-02 04:30:00+00') = DATE '2026-10-26'
  AND public.week_start_in_zone('Pacific/Auckland', '2026-11-01 11:30:00+00') = DATE '2026-11-02'
  AND public.week_start_in_zone('Not/AZone', '2026-11-04 12:00:00+00') = DATE '2026-11-02');

-- the RPC (user 1, no zone yet)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.res('T11b_rpc_stores_valid_zone', public.set_profile_time_zone('Europe/Istanbul') IS TRUE);
SELECT aderyth_test.res('T11b2_rpc_is_idempotent', public.set_profile_time_zone('Europe/Istanbul') IS TRUE);
SELECT aderyth_test.expect_error('T11c_rpc_rejects_unknown_zone', $q$SELECT public.set_profile_time_zone('Mars/Phobos')$q$, '22023');
SELECT aderyth_test.expect_error('T11d_rpc_rejects_abbreviation', $q$SELECT public.set_profile_time_zone('PST')$q$, '22023');
SELECT aderyth_test.expect_error('T11e_rpc_rejects_overlong', format($q$SELECT public.set_profile_time_zone(%L)$q$, repeat('A', 65)), '22023');
SELECT aderyth_test.expect_error('T11e2_rpc_rejects_empty', $q$SELECT public.set_profile_time_zone('   ')$q$, '22023');
SELECT aderyth_test.expect_denied('T11g_direct_update_denied',
  $q$UPDATE public.profiles SET time_zone = 'UTC' WHERE id = 'a7000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_allowed('T11g2_control_username_update_allowed',
  $q$UPDATE public.profiles SET username = 't11a2' WHERE id = 'a7000000-0000-4000-8000-000000000001'$q$);
RESET ROLE;

SELECT aderyth_test.res('T11b3_zone_persisted',
  (SELECT time_zone = 'Europe/Istanbul' FROM public.profiles WHERE id = 'a7000000-0000-4000-8000-000000000001'));

-- cross-user isolation and anon
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.res('T11h_second_user_sets_own_zone', public.set_profile_time_zone('Pacific/Pago_Pago') IS TRUE);
SELECT aderyth_test.res('T11h2_first_users_row_is_invisible',
  (SELECT count(*) = 0 FROM public.profiles WHERE id = 'a7000000-0000-4000-8000-000000000001'));
RESET ROLE;

SELECT aderyth_test.res('T11h3_first_users_zone_unchanged',
  (SELECT time_zone = 'Europe/Istanbul' FROM public.profiles WHERE id = 'a7000000-0000-4000-8000-000000000001'));

SAVEPOINT sp_anon;
SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T11f_anon_cannot_execute', $q$SELECT public.set_profile_time_zone('UTC')$q$);
ROLLBACK TO SAVEPOINT sp_anon;

-- the 038 window is the user's LOCAL day (users 2 and 3 live at the two extremes)
SAVEPOINT sp_w2;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.expect_allowed('T11l_upper_bound_local_plus_one',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state) VALUES ('a7000000-0000-4000-8000-0000000000b2', 'a7000000-0000-4000-8000-000000000002', public.local_date_in_zone('Pacific/Kiritimati') + 1, 'done')$q$);
SELECT aderyth_test.expect_error('T11l2_local_plus_two_refused',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state) VALUES ('a7000000-0000-4000-8000-0000000000b2', 'a7000000-0000-4000-8000-000000000002', public.local_date_in_zone('Pacific/Kiritimati') + 2, 'done')$q$, '22023');
ROLLBACK TO SAVEPOINT sp_w2;

SAVEPOINT sp_w3;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.expect_allowed('T11m_lower_bound_local_minus_fifteen',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state) VALUES ('a7000000-0000-4000-8000-0000000000b3', 'a7000000-0000-4000-8000-000000000003', public.local_date_in_zone('Pacific/Pago_Pago') - 15, 'done')$q$);
SELECT aderyth_test.expect_error('T11m2_local_minus_sixteen_refused',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state) VALUES ('a7000000-0000-4000-8000-0000000000b3', 'a7000000-0000-4000-8000-000000000003', public.local_date_in_zone('Pacific/Pago_Pago') - 16, 'done')$q$, '22023');
ROLLBACK TO SAVEPOINT sp_w3;

-- an invalid stored zone never blocks logging (user 4 has 'Not/AZone')
SAVEPOINT sp_w4;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.expect_allowed('T11k_invalid_stored_zone_falls_back_to_utc',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state) VALUES ('a7000000-0000-4000-8000-0000000000b4', 'a7000000-0000-4000-8000-000000000004', current_date, 'done')$q$);
ROLLBACK TO SAVEPOINT sp_w4;

-- weekly xp: the bucket is each user's own local week; the leaderboard reads the same key (superuser seeds)
SELECT public.track_weekly_xp('a7000000-0000-4000-8000-000000000002', 5);
SELECT public.track_weekly_xp('a7000000-0000-4000-8000-000000000003', 5);
SELECT public.track_weekly_xp('a7000000-0000-4000-8000-000000000004', 5);

SELECT aderyth_test.res('T11n_weekly_bucket_matches_each_zone',
  (SELECT week_start = public.week_start_in_zone('Pacific/Kiritimati') FROM public.weekly_xp WHERE user_id = 'a7000000-0000-4000-8000-000000000002')
  AND (SELECT week_start = public.week_start_in_zone('Pacific/Pago_Pago') FROM public.weekly_xp WHERE user_id = 'a7000000-0000-4000-8000-000000000003')
  AND (SELECT week_start = public.week_start_in_zone('UTC') FROM public.weekly_xp WHERE user_id = 'a7000000-0000-4000-8000-000000000004'));

INSERT INTO public.weekly_xp (user_id, week_start, xp_earned) VALUES
  ('a7000000-0000-4000-8000-000000000005', public.week_start_in_zone('Pacific/Auckland') - 7, 50)
ON CONFLICT (user_id, week_start) DO NOTHING;

SAVEPOINT sp_lb;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.res('T11o_leaderboard_uses_each_users_week',
  (SELECT count(*) = 3 FROM public.get_weekly_leaderboard(100)
    WHERE user_id IN ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000004'))
  AND NOT EXISTS (SELECT 1 FROM public.get_weekly_leaderboard(100) WHERE user_id = 'a7000000-0000-4000-8000-000000000005'));
ROLLBACK TO SAVEPOINT sp_lb;

SELECT aderyth_test.res('T11p_xp_drift_zero', (SELECT count(*) = 0 FROM public.xp_drift()));

ROLLBACK;
