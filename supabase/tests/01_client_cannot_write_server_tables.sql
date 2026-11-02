-- 01: a client role can never write the tables the SERVER owns (TST-V01, TST-01).
--
-- Pure SQL (no psql meta-commands) so it runs unchanged under CI psql and in the local
-- harness. run.sh passes -v ON_ERROR_STOP=1, so an error here aborts the whole run as a
-- HARNESS ERROR instead of being counted as a failed expectation.
--
-- Every guarded write runs as `authenticated` or `anon` and must be refused with 42501
-- (privilege denied, or a row-level-security WITH CHECK violation). The positive controls at
-- the end prove the roles are not simply denied everything for the wrong reason.
--
-- Some guarantees are not a revoked privilege but row-level security with a SELECT policy only
-- (the table privileges stay granted): there the statement may run, and the guarantee is that it
-- changes no row (expect_no_effect). Those probes need a row that exists and is visible to its
-- owner, or "0 rows" would prove nothing: the seed provides one per table and the T01z3-z5
-- controls prove it is visible.
--
-- The seed below is committed (the database is throwaway) and never touches
-- profiles.total_xp or habit_logs, so it cannot create xp_drift() rows for 03.

-- Seed as superuser: fixed UUIDs, idempotent.
INSERT INTO auth.users (id, email) VALUES
  ('a1000000-0000-4000-8000-000000000001', 't01a@aderyth.test'),
  ('a1000000-0000-4000-8000-000000000002', 't01b@aderyth.test')
ON CONFLICT (id) DO NOTHING;

-- Inserting a profile fires the dormant scope-addendum F13 trigger on_profile_created_pet, which writes
-- user_pets and trips a foreign key on the unseeded pet_stages table. That trigger is not
-- under test here, so the seed insert runs with ordinary triggers off (replica role) inside
-- its own transaction; it needs superuser, which the throwaway database user is.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (id, email, username)
VALUES ('a1000000-0000-4000-8000-000000000001', 't01a@aderyth.test', 't01a')
ON CONFLICT (id) DO NOTHING;
COMMIT;

INSERT INTO public.user_subscriptions (user_id)
VALUES ('a1000000-0000-4000-8000-000000000001') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.weekly_xp (user_id, week_start, xp_earned)
SELECT 'a1000000-0000-4000-8000-000000000001', date_trunc('week', CURRENT_DATE)::date, 5
WHERE NOT EXISTS (SELECT 1 FROM public.weekly_xp WHERE user_id = 'a1000000-0000-4000-8000-000000000001');
-- one ledger row and one AI request row, so the T01n-q "no row changes" probes are not vacuous
INSERT INTO public.credit_transactions (user_id, delta, reason, balance_after, request_id)
SELECT 'a1000000-0000-4000-8000-000000000001', -5, 't01 seed', 25, 't01-seed'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_transactions
                  WHERE user_id = 'a1000000-0000-4000-8000-000000000001' AND request_id = 't01-seed');
INSERT INTO public.ai_requests (user_id, request_id, mode, input_fingerprint)
VALUES ('a1000000-0000-4000-8000-000000000001', 't01-seed', 'coach', 'fp-t01')
ON CONFLICT (user_id, request_id) DO NOTHING;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- TST-V01: weekly_xp is server-written only
SELECT aderyth_test.expect_denied('T01a_weekly_xp_insert_denied',
  $q$INSERT INTO public.weekly_xp (user_id, week_start, xp_earned) VALUES ('a1000000-0000-4000-8000-000000000001', date_trunc('week', CURRENT_DATE)::date - 7, 999999)$q$);
SELECT aderyth_test.expect_denied('T01b_weekly_xp_update_denied',
  $q$UPDATE public.weekly_xp SET xp_earned = 999999 WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_denied('T01c_weekly_xp_delete_denied',
  $q$DELETE FROM public.weekly_xp WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
-- profiles: server-owned columns
SELECT aderyth_test.expect_denied('T01d_profiles_total_xp_update_denied',
  $q$UPDATE public.profiles SET total_xp = 999999 WHERE id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_denied('T01e_profiles_level_update_denied',
  $q$UPDATE public.profiles SET level = 99 WHERE id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_denied('T01f_profiles_coins_update_denied',
  $q$UPDATE public.profiles SET coins = 999999 WHERE id = 'a1000000-0000-4000-8000-000000000001'$q$);
-- profiles INSERT may only carry id / email / username (the second user has no profile row)
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
SELECT aderyth_test.expect_denied('T01g_profiles_insert_with_xp_denied',
  $q$INSERT INTO public.profiles (id, email, username, total_xp) VALUES ('a1000000-0000-4000-8000-000000000002', 't01b@aderyth.test', 't01b', 5000)$q$);
-- user_subscriptions: the balance is server-owned (user 2 has no row: insert path; user 1: update path)
SELECT aderyth_test.expect_denied('T01h_user_subscriptions_insert_denied',
  $q$INSERT INTO public.user_subscriptions (user_id, focus_points) VALUES ('a1000000-0000-4000-8000-000000000002', 100000)$q$);
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT aderyth_test.expect_denied('T01i_user_subscriptions_update_denied',
  $q$UPDATE public.user_subscriptions SET focus_points = 100000, tier = 'pro' WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
-- the credit ledger is append-only server-side (row-level security has a SELECT policy only)
SELECT aderyth_test.expect_denied('T01j_credit_transactions_insert_denied',
  $q$INSERT INTO public.credit_transactions (user_id, delta, reason, balance_after) VALUES ('a1000000-0000-4000-8000-000000000001', 100000, 'forged', 100000)$q$);
-- the owner cannot delete the balance row or rewrite the ledger / the AI request book either. The
-- table privileges are still granted here, so what holds the line is row-level security (SELECT
-- policy only): the guarantee is that no row changes. The controls come first and prove the
-- targeted rows exist and are visible to their owner.
SELECT aderyth_test.expect_allowed('T01z3_control_user_subscriptions_select_allowed',
  $q$SELECT * FROM public.user_subscriptions WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT aderyth_test.expect_allowed('T01z4_control_credit_transactions_select_allowed',
  $q$SELECT * FROM public.credit_transactions WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT aderyth_test.expect_allowed('T01z5_control_ai_requests_select_allowed',
  $q$SELECT * FROM public.ai_requests WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT aderyth_test.expect_no_effect('T01m_user_subscriptions_delete_no_effect',
  $q$DELETE FROM public.user_subscriptions WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_no_effect('T01n_credit_transactions_update_no_effect',
  $q$UPDATE public.credit_transactions SET delta = 100000 WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_no_effect('T01o_credit_transactions_delete_no_effect',
  $q$DELETE FROM public.credit_transactions WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_no_effect('T01p_ai_requests_update_no_effect',
  $q$UPDATE public.ai_requests SET status = 'failed' WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_no_effect('T01q_ai_requests_delete_no_effect',
  $q$DELETE FROM public.ai_requests WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
-- positive controls: the harness is not denying everything for the wrong reason
SELECT aderyth_test.expect_allowed('T01z1_control_profiles_username_update_allowed',
  $q$UPDATE public.profiles SET username = 't01a2' WHERE id = 'a1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT aderyth_test.expect_allowed('T01z2_control_weekly_xp_select_allowed',
  $q$SELECT * FROM public.weekly_xp WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$, 1);
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T01k_anon_weekly_xp_insert_denied',
  $q$INSERT INTO public.weekly_xp (user_id, week_start, xp_earned) VALUES ('a1000000-0000-4000-8000-000000000001', date_trunc('week', CURRENT_DATE)::date - 14, 1)$q$);
SELECT aderyth_test.expect_denied('T01l_anon_user_subscriptions_update_denied',
  $q$UPDATE public.user_subscriptions SET focus_points = 100000 WHERE user_id = 'a1000000-0000-4000-8000-000000000001'$q$);
ROLLBACK;
