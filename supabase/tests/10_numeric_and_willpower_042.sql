-- 10: numeric(12,2) measurable values, private numeric scorer, and atomic spend_willpower (042 / F14).
-- Runs inside a single rolled-back transaction using SAVEPOINTs so no test rows outlive the file.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a6000000-0000-4000-8000-000000000001', 't10a@aderyth.test'),
  ('a6000000-0000-4000-8000-000000000002', 't10b@aderyth.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, username) VALUES
  ('a6000000-0000-4000-8000-000000000001', 't10a@aderyth.test', 't10a'),
  ('a6000000-0000-4000-8000-000000000002', 't10b@aderyth.test', 't10b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.habits (id, user_id, name, tracking_type, unit, daily_goal, target_direction, status, difficulty, impact_level, estimated_minutes, willpower_cost)
VALUES
  ('a6000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000001', 'Su', 'numeric', 'L', 2.5, 'at_least', 'active', 3, 'medium', 0, 3),
  ('a6000000-0000-4000-8000-0000000000a2', 'a6000000-0000-4000-8000-000000000001', 'Kahve', 'numeric', 'fincan', 0, 'at_most', 'active', 3, 'medium', 0, 3)
ON CONFLICT (id) DO NOTHING;

-- structure and ACL (superuser)
SELECT aderyth_test.res('T10a_columns_are_numeric_12_2',
  (SELECT count(*) = 2 FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'numeric' AND numeric_precision = 12 AND numeric_scale = 2
      AND ((table_name = 'habit_logs' AND column_name = 'value') OR (table_name = 'habits' AND column_name = 'daily_goal'))));

SELECT aderyth_test.res('T10b_scorer_swapped_and_private',
  to_regprocedure('public.habit_xp_value(uuid, text, integer)') IS NULL
  AND to_regprocedure('public.habit_xp_value(uuid, text, numeric)') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'public.habit_xp_value(uuid, text, numeric)', 'execute')
  AND NOT has_function_privilege('anon', 'public.habit_xp_value(uuid, text, numeric)', 'execute'));

SELECT aderyth_test.res('T10j_dormant_functions_stay_closed',
  NOT has_function_privilege('authenticated', 'public.get_monthly_habits(date, date)', 'execute')
  AND NOT has_function_privilege('anon', 'public.get_monthly_habits(date, date)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.log_makeup_completion(uuid, date, boolean, text, integer)', 'execute'));

SELECT aderyth_test.res('T10h_goal_keeps_decimals',
  (SELECT daily_goal = 2.5 FROM public.habits WHERE id = 'a6000000-0000-4000-8000-0000000000a1'));

SAVEPOINT sp_logs;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- decimal values are accepted and rounded to two places
SELECT aderyth_test.expect_allowed('T10c_decimal_value_accepted',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state, value) VALUES ('a6000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000001', current_date, 'partial', 1.5)$q$);

SELECT aderyth_test.expect_allowed('T10e_third_decimal_is_rounded',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state, value) VALUES ('a6000000-0000-4000-8000-0000000000a2', 'a6000000-0000-4000-8000-000000000001', current_date, 'done', 0.005)$q$);

SELECT aderyth_test.res('T10e2_rounded_value_is_0_01',
  (SELECT value = 0.01 FROM public.habit_logs WHERE habit_id = 'a6000000-0000-4000-8000-0000000000a2' AND completed_at = current_date));

SELECT aderyth_test.expect_error('T10f_out_of_range_refused',
  $q$INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state, value) VALUES ('a6000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000001', current_date - 1, 'partial', 100000000000)$q$, '22003');

-- the bootstrap RPC carries the decimal as a JSON number
SELECT aderyth_test.res('T10i_bootstrap_json_number',
  (SELECT jsonb_typeof(b->'habits'->0->'daily_goal') = 'number'
     FROM (SELECT public.get_today_bootstrap(current_date) AS b) s));

ROLLBACK TO SAVEPOINT sp_logs;

-- the numeric scorer, pinned with fixture arithmetic (superuser).
-- Fixture a1: difficulty 3, impact medium, tracking numeric, 0 minutes -> raw 4.0 -> cost 4 -> base XP 40; floor goal 2.5.
-- Fixture a2: same base XP 40; ceiling goal 0 (zero tolerance).
SELECT aderyth_test.res('T10d_decimal_scored_by_numeric_scorer',
  public.habit_xp_value('a6000000-0000-4000-8000-0000000000a1', 'partial', 1.25) = 20
  AND public.habit_xp_value('a6000000-0000-4000-8000-0000000000a1', 'partial', 1.5) = 24
  AND public.habit_xp_value('a6000000-0000-4000-8000-0000000000a1', 'done', NULL) = 40
  AND public.habit_xp_value('a6000000-0000-4000-8000-0000000000a2', 'partial', 0) = 40
  AND public.habit_xp_value('a6000000-0000-4000-8000-0000000000a2', 'partial', 0.01) = 0);

SELECT aderyth_test.res('T10k_xp_drift_zero', (SELECT count(*) = 0 FROM public.xp_drift()));

-- spend_willpower under user 1, then nested user 2 (while user 1's row exists!)
SAVEPOINT sp_wp1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.res('T10m_spend_creates_row_and_charges',
  (SELECT used = 3 AND active_count = 1 AND daily_budget = 15 FROM public.spend_willpower(current_date, 3)));
SELECT aderyth_test.res('T10n_spend_accumulates',
  (SELECT used = 7 AND active_count = 2 FROM public.spend_willpower(current_date, 4)));
SELECT aderyth_test.expect_error('T10o_over_budget_refused', $q$SELECT public.spend_willpower(current_date, 9)$q$, 'P0001');
SELECT aderyth_test.res('T10o2_refused_spend_leaves_row_unchanged',
  (SELECT used = 7 AND active_count = 2 FROM public.willpower_state WHERE user_id = 'a6000000-0000-4000-8000-000000000001' AND state_date = current_date));
SELECT aderyth_test.res('T10p_clamp_records_up_to_budget',
  (SELECT used = 15 AND active_count = 5 FROM public.spend_willpower(current_date, 20, 3, true)));
SELECT aderyth_test.res('T10p2_clamp_never_lowers_used',
  (SELECT used = 15 FROM public.spend_willpower(current_date, 5, 1, true)));
SELECT aderyth_test.res('T10q_refund_floors_at_zero',
  (SELECT used = 0 AND active_count >= 0 FROM public.spend_willpower(current_date, -100, -100)));
SELECT aderyth_test.expect_error('T10r_fraction_refused', $q$SELECT public.spend_willpower(current_date, 2.5)$q$, '22023');
SELECT aderyth_test.expect_error('T10s_nan_refused', $q$SELECT public.spend_willpower(current_date, 'NaN'::numeric)$q$, '22023');
SELECT aderyth_test.expect_error('T10t_far_day_refused', $q$SELECT public.spend_willpower(current_date + 30, 1)$q$, '22023');
SELECT aderyth_test.expect_error('T10t2_huge_amount_refused', $q$SELECT public.spend_willpower(current_date, 1001)$q$, '22023');

SAVEPOINT sp_wp2;
SELECT set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.res('T10u_second_user_has_own_row', (SELECT used = 3 FROM public.spend_willpower(current_date, 3)));
SELECT aderyth_test.res('T10u2_second_user_cannot_see_first_users_row',
  (SELECT count(*) = 0 FROM public.willpower_state WHERE user_id = 'a6000000-0000-4000-8000-000000000001'));
ROLLBACK TO SAVEPOINT sp_wp2;
ROLLBACK TO SAVEPOINT sp_wp1;

SAVEPOINT sp_anon;
SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T10v_anon_cannot_execute', $q$SELECT public.spend_willpower(current_date, 1)$q$);
ROLLBACK TO SAVEPOINT sp_anon;

SAVEPOINT sp_nojwt;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT aderyth_test.expect_denied('T10w_unauthenticated_authenticated_role_refused', $q$SELECT public.spend_willpower(current_date, 1)$q$);
ROLLBACK TO SAVEPOINT sp_nojwt;

ROLLBACK;
