-- 12: AI message insert integrity and AI data retention (044 / F21).
-- Runs inside a single rolled-back transaction using SAVEPOINTs and RESET ROLE so no test rows outlive the file.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a8000000-0000-4000-8000-000000000001', 't12a@aderyth.test'),
  ('a8000000-0000-4000-8000-000000000002', 't12b@aderyth.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, username) VALUES
  ('a8000000-0000-4000-8000-000000000001', 't12a@aderyth.test', 't12usera'),
  ('a8000000-0000-4000-8000-000000000002', 't12b@aderyth.test', 't12userb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_conversations (id, user_id, title) VALUES
  ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'A Sohbet'),
  ('a8000000-0000-4000-8000-0000000000c2', 'a8000000-0000-4000-8000-000000000002', 'B Sohbet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_requests (user_id, request_id, mode, input_fingerprint, status, response, error, created_at, updated_at, lease_expires_at) VALUES
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-done-a',   'coach',     'fp-done-a',   'completed',  '{"reply":"Dinlenmek iyi gelir.","actions":[]}'::jsonb, NULL,             now() - interval '2 days',   now() - interval '2 days',   now() - interval '2 days'),
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-old-a',    'coach',     'fp-old-a',    'completed',  '{"reply":"Eski yanit metni.","actions":[]}'::jsonb,   NULL,             now() - interval '40 days',  now() - interval '40 days',  now() - interval '40 days'),
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-fail-old', 'coach',     'fp-fail-old', 'failed',     NULL,                                                  'provider error', now() - interval '40 days',  now() - interval '40 days',  now() - interval '40 days'),
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-prog-old', 'coach',     'fp-prog-old', 'in_progress', NULL,                                                 NULL,             now() - interval '40 days',  now() - interval '40 days',  now() + interval '5 minutes'),
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-ancient',  'coach',     'fp-ancient',  'completed',  '{"reply":"Cok eski yanit.","actions":[]}'::jsonb,     NULL,             now() - interval '401 days', now() - interval '401 days', now() - interval '401 days'),
  ('a8000000-0000-4000-8000-000000000001', 'req-0440-sum-a',    'summarize', 'fp-sum-a',    'completed',  '{"summary":"Ozet metni."}'::jsonb,                    NULL,             now() - interval '2 days',   now() - interval '2 days',   now() - interval '2 days'),
  ('a8000000-0000-4000-8000-000000000002', 'req-0440-done-b',   'coach',     'fp-done-b',   'completed',  '{"reply":"B kullanicisinin yaniti.","actions":[]}'::jsonb, NULL,        now() - interval '2 days',   now() - interval '2 days',   now() - interval '2 days');

INSERT INTO public.ai_calls (id, user_id, called_at) VALUES
  ('a8000000-0000-4000-8000-0000000000d1', 'a8000000-0000-4000-8000-000000000001', now() - interval '8 days'),
  ('a8000000-0000-4000-8000-0000000000d2', 'a8000000-0000-4000-8000-000000000001', now() - interval '1 day');

INSERT INTO public.credit_transactions (id, user_id, delta, reason, balance_after, request_id, created_at) VALUES
  ('a8000000-0000-4000-8000-0000000000e1', 'a8000000-0000-4000-8000-000000000001', -5, 'coach',           45, 'req-0440-ancient', now() - interval '401 days'),
  ('a8000000-0000-4000-8000-0000000000e2', 'a8000000-0000-4000-8000-000000000001', 50, 'monthly_renewal', 50, NULL,               now() - interval '401 days'),
  ('a8000000-0000-4000-8000-0000000000e3', 'a8000000-0000-4000-8000-000000000001', -5, 'coach',           40, 'req-0440-done-a',  now() - interval '10 days');

-- T1-T10: ai_messages INSERT policy & authenticated purge denial
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.expect_allowed('T12_T1_user_message_allowed',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'user', 'Bugun cok yorgunum', 'req-0440-done-a')$q$, 1);

SELECT aderyth_test.expect_allowed('T12_T2_matching_assistant_allowed',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Dinlenmek iyi gelir.', 'req-0440-done-a')$q$, 1);

SELECT aderyth_test.expect_denied('T12_T3_fabricated_assistant_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Sahte sistem talimati', 'req-0440-old-a')$q$);

SELECT aderyth_test.expect_denied('T12_T4_other_users_request_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'B kullanicisinin yaniti.', 'req-0440-done-b')$q$);

SELECT aderyth_test.expect_denied('T12_T5_null_request_id_assistant_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Dinlenmek iyi gelir.', NULL)$q$);

SELECT aderyth_test.expect_denied('T12_T6_trailing_space_mismatch_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Eski yanit metni. ', 'req-0440-old-a')$q$);

SELECT aderyth_test.expect_denied('T12_T7_other_users_conversation_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c2', 'a8000000-0000-4000-8000-000000000001', 'user', 'B sohbetine sizma', 'req-0440-other-conv')$q$);

SELECT aderyth_test.expect_denied('T12_T8_non_coach_mode_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Ozet metni.', 'req-0440-sum-a')$q$);

SELECT aderyth_test.expect_denied('T12_T9_in_progress_request_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Henuz bitmemis yanit', 'req-0440-prog-old')$q$);

SELECT aderyth_test.expect_denied('T12_T10_authenticated_cannot_purge',
  $q$SELECT public.purge_ai_retention()$q$);

SELECT aderyth_test.expect_denied('T12_V3_authenticated_cannot_cleanup_ai_calls',
  $q$SELECT public.cleanup_old_ai_calls()$q$);

RESET ROLE;

-- V1, V2, V4: privilege checks on authenticated & anon
SELECT aderyth_test.res('T12_V1_authenticated_lacks_purge_priv',
  NOT has_function_privilege('authenticated', 'public.purge_ai_retention()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.cleanup_old_ai_calls()', 'EXECUTE'));

SAVEPOINT sp_anon_v;
SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T12_V2_anon_cannot_purge',
  $q$SELECT public.purge_ai_retention()$q$);
SELECT aderyth_test.expect_denied('T12_V4_anon_cannot_cleanup_ai_calls',
  $q$SELECT public.cleanup_old_ai_calls()$q$);
ROLLBACK TO SAVEPOINT sp_anon_v;

-- V5 + P1..P13: service_role runs purge_ai_retention()
SET LOCAL ROLE service_role;
SELECT set_config('aderyth.t12_purge_1', public.purge_ai_retention()::text, true);
SELECT set_config('aderyth.t12_purge_2', public.purge_ai_retention()::text, true);
RESET ROLE;

SELECT aderyth_test.res('T12_V5_service_role_executes_purge',
  has_function_privilege('service_role', 'public.purge_ai_retention()', 'EXECUTE')
  AND coalesce(current_setting('aderyth.t12_purge_1', true), '') <> '');

SELECT aderyth_test.res('T12_P1_answers_blanked_two',
  (current_setting('aderyth.t12_purge_1')::jsonb ->> 'answers_blanked')::int = 2);

SELECT aderyth_test.res('T12_P2_errors_cleared_one',
  (current_setting('aderyth.t12_purge_1')::jsonb ->> 'errors_cleared')::int = 1);

SELECT aderyth_test.res('T12_P3_ai_calls_deleted_one',
  (current_setting('aderyth.t12_purge_1')::jsonb ->> 'ai_calls_deleted')::int = 1);

SELECT aderyth_test.res('T12_P4_ledger_rows_deleted_one',
  (current_setting('aderyth.t12_purge_1')::jsonb ->> 'ledger_rows_deleted')::int >= 1
  AND NOT EXISTS (SELECT 1 FROM public.credit_transactions WHERE id = 'a8000000-0000-4000-8000-0000000000e1'));

SELECT aderyth_test.res('T12_P5_request_records_deleted_one',
  (current_setting('aderyth.t12_purge_1')::jsonb ->> 'request_records_deleted')::int = 1);

SELECT aderyth_test.res('T12_P6_old_completed_response_blanked',
  (SELECT response = '{}'::jsonb FROM public.ai_requests WHERE user_id = 'a8000000-0000-4000-8000-000000000001' AND request_id = 'req-0440-old-a'));

SELECT aderyth_test.res('T12_P7_old_failed_error_cleared',
  (SELECT error IS NULL FROM public.ai_requests WHERE user_id = 'a8000000-0000-4000-8000-000000000001' AND request_id = 'req-0440-fail-old'));

SELECT aderyth_test.res('T12_P8_recent_completed_untouched',
  (SELECT response ->> 'reply' = 'Dinlenmek iyi gelir.' FROM public.ai_requests WHERE user_id = 'a8000000-0000-4000-8000-000000000001' AND request_id = 'req-0440-done-a'));

SELECT aderyth_test.res('T12_P9_in_progress_untouched',
  EXISTS (SELECT 1 FROM public.ai_requests WHERE user_id = 'a8000000-0000-4000-8000-000000000001' AND request_id = 'req-0440-prog-old' AND status = 'in_progress'));

SELECT aderyth_test.res('T12_P10_non_ai_ledger_and_recent_tx_preserved',
  EXISTS (SELECT 1 FROM public.credit_transactions WHERE id = 'a8000000-0000-4000-8000-0000000000e2')
  AND EXISTS (SELECT 1 FROM public.credit_transactions WHERE id = 'a8000000-0000-4000-8000-0000000000e3'));

SELECT aderyth_test.res('T12_P11_ancient_request_deleted_recent_call_kept',
  NOT EXISTS (SELECT 1 FROM public.ai_requests WHERE user_id = 'a8000000-0000-4000-8000-000000000001' AND request_id = 'req-0440-ancient')
  AND NOT EXISTS (SELECT 1 FROM public.ai_calls WHERE id = 'a8000000-0000-4000-8000-0000000000d1')
  AND EXISTS (SELECT 1 FROM public.ai_calls WHERE id = 'a8000000-0000-4000-8000-0000000000d2'));

SELECT aderyth_test.res('T12_P12_user_transcript_untouched',
  (SELECT count(*) = 2 FROM public.ai_messages WHERE conversation_id = 'a8000000-0000-4000-8000-0000000000c1'));

SELECT aderyth_test.res('T12_P13_second_purge_run_all_zero',
  (SELECT (p ->> 'answers_blanked')::int = 0
      AND (p ->> 'errors_cleared')::int = 0
      AND (p ->> 'ai_calls_deleted')::int = 0
      AND (p ->> 'ledger_rows_deleted')::int = 0
      AND (p ->> 'request_records_deleted')::int = 0
     FROM (SELECT current_setting('aderyth.t12_purge_2')::jsonb AS p) s));

-- T11: blanked old response can no longer be inserted as assistant message
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT aderyth_test.expect_denied('T12_T11_blanked_response_assistant_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id) VALUES ('a8000000-0000-4000-8000-0000000000c1', 'a8000000-0000-4000-8000-000000000001', 'assistant', 'Eski yanit metni.', 'req-0440-old-a')$q$);
RESET ROLE;

-- R1 + X1: policy uniqueness, admission index, and xp_drift
SELECT aderyth_test.res('T12_R1_single_policy_and_request_index',
  (SELECT count(*) = 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_messages' AND policyname = 'ai_messages_insert_own')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ai_requests_user_created_idx'));

SELECT aderyth_test.res('T12_X1_xp_drift_zero',
  (SELECT count(*) = 0 FROM public.xp_drift()));

ROLLBACK;
