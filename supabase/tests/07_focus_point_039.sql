-- 07: Focus Point credit integrity of migration 039 (F07; INT-11, REP-15, DB2-V01, EDG-16).
--
-- implementation.md F07, section 3, in the F01 protocol: every check reports one
-- RESULT|<name>|PASS/FAIL line through aderyth_test (supabase/tests/run.sh), with no psql
-- meta-command (sqlBehaviorTestsWired.test.ts:944). The plan's cases, same fixtures:
--   case 1 -> T07a   a second user message with the same (conversation, request_id) is refused
--   case 2 -> T07b   the assistant answer with that request_id, the same id in another
--                    conversation and NULL request_ids are still allowed
--   case 6 -> T07c-f as user B (authenticated): A's messages are invisible, A's conversation is
--                    not writable, refund_focus_points and the legacy spend_focus_points are not
--                    executable
--   case 7 -> T07g   anon has no EXECUTE on the legacy function
--   case 8 -> T07h   xp_drift() is empty
-- Cases 3-5 of the plan re-run the migration file with `\i` over rows written before it (the
-- dedupe, the one refund, the idempotent second run, the charge older than its claim). A file in
-- this protocol cannot include another one; they are not part of this file.
--
-- Pure SQL (run.sh passes ON_ERROR_STOP). One transaction, ROLLBACK at the end.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0390-4000-8000-0000000000a1', 'f07a@aderyth.test'),
  ('aaaaaaaa-0390-4000-8000-0000000000b2', 'f07b@aderyth.test');

INSERT INTO public.ai_conversations (id, user_id, title) VALUES
  ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'A konusması'),
  ('cccccccc-0390-4000-8000-0000000000c2', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'A ikinci konuşma');

-- Case 1: second user message with the same (conversation, request_id) is refused.
INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id)
VALUES ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'user', 'Bugün çok yorgunum', 'req-0390-0001');
DO $t07a$
DECLARE v_ok boolean := false; v_detail text := 'a second user row with the same (conversation, request_id) was written';
BEGIN
  BEGIN
    INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id)
    VALUES ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'user', 'Bugün çok yorgunum', 'req-0390-0001');
  EXCEPTION
    WHEN unique_violation THEN v_ok := true; v_detail := '23505: ' || SQLERRM;
    WHEN OTHERS THEN v_detail := format('unexpected %s: %s', SQLSTATE, SQLERRM);
  END;
  PERFORM aderyth_test.res('T07a_resent_user_message_refused', v_ok, v_detail);
END $t07a$;

-- Case 2: the assistant answer with the same request_id, the same request_id in another
-- conversation, and NULL request_ids are all still allowed.
SELECT aderyth_test.expect_allowed('T07b_other_rows_still_allowed',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id)
     VALUES ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'assistant', 'Dinlenmek iyi gelir.', 'req-0390-0001'),
            ('cccccccc-0390-4000-8000-0000000000c2', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'user', 'Bugün çok yorgunum', 'req-0390-0001'),
            ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'user', 'kimliksiz bir', NULL),
            ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000a1', 'user', 'kimliksiz iki', NULL)$q$, 4);

-- Case 6: RLS and privilege negatives as the authenticated role (user B).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0390-4000-8000-0000000000b2', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.res('T07c_foreign_messages_invisible',
  (SELECT count(*) FROM public.ai_messages WHERE user_id = 'aaaaaaaa-0390-4000-8000-0000000000a1') = 0,
  format('B sees %s of A''s messages', (SELECT count(*) FROM public.ai_messages WHERE user_id = 'aaaaaaaa-0390-4000-8000-0000000000a1')));

SELECT aderyth_test.expect_denied('T07d_foreign_conversation_write_denied',
  $q$INSERT INTO public.ai_messages (conversation_id, user_id, role, content, request_id)
     VALUES ('cccccccc-0390-4000-8000-0000000000c1', 'aaaaaaaa-0390-4000-8000-0000000000b2', 'user', 'yabanci konusmaya yazma', 'req-0390-x001')$q$);

SELECT aderyth_test.expect_denied('T07e_refund_rpc_closed_to_authenticated',
  $q$SELECT public.refund_focus_points('aaaaaaaa-0390-4000-8000-0000000000b2', 'req-0390-legacy1', 'kendi kendine iade')$q$);

SELECT aderyth_test.expect_denied('T07f_legacy_spend_closed_to_authenticated',
  $q$SELECT public.spend_focus_points(5, 'eski fonksiyon')$q$);

RESET ROLE;

-- Case 7: the anon role has no EXECUTE on the legacy function either.
SELECT aderyth_test.res('T07g_legacy_spend_closed_to_anon',
  NOT has_function_privilege('anon', 'public.spend_focus_points(integer, text)', 'EXECUTE'),
  'has_function_privilege(anon, spend_focus_points(integer, text), EXECUTE)');

-- Case 8: XP bookkeeping is untouched.
SELECT aderyth_test.res('T07h_xp_drift_empty',
  (SELECT count(*) FROM public.xp_drift()) = 0,
  format('%s xp_drift row(s)', (SELECT count(*) FROM public.xp_drift())));

ROLLBACK;
