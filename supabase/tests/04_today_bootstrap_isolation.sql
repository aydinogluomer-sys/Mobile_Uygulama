-- 04: get_today_bootstrap tenant isolation and its negative paths (TST-01).
--
-- The CI job already proves the happy path for two users (ci.yml, "Apply forward migrations 028+").
-- This file adds what that step cannot: the direct-table isolation, the cross-tenant write, the
-- missing JWT subject and the anonymous role. Everything is one transaction that ends in ROLLBACK.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('a4000000-0000-4000-8000-000000000003', 't04c@aderyth.test'),
  ('a4000000-0000-4000-8000-000000000004', 't04d@aderyth.test');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.habits (id, user_id, name, tracking_type, status)
VALUES ('a4aaaaaa-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000003', 'Sabah Yürüyüşü', 'boolean', 'active');
INSERT INTO public.tasks (id, user_id, title, status, priority, list_type)
VALUES ('a4bbbbbb-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000003', 'Rapor hazırla', 'pending', 'high', 'inbox');
INSERT INTO public.habit_pauses (user_id, habit_id, kind, start_date, end_date)
VALUES ('a4000000-0000-4000-8000-000000000003', 'a4aaaaaa-0000-4000-8000-000000000003', 'pause', CURRENT_DATE, CURRENT_DATE + 2);

SELECT aderyth_test.res('T04a_owner_sees_own_rows',
  jsonb_array_length(b -> 'habits') = 1 AND jsonb_array_length(b -> 'tasks') = 1 AND jsonb_array_length(b -> 'pauses') = 1,
  b::text)
FROM (SELECT public.get_today_bootstrap(CURRENT_DATE) AS b) s;

-- switch identity inside the same transaction: user 4 must see nothing of user 3
SELECT set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000004', true);
SELECT aderyth_test.res('T04b_other_user_sees_zero_rows',
  jsonb_array_length(b -> 'habits') = 0 AND jsonb_array_length(b -> 'tasks') = 0 AND jsonb_array_length(b -> 'pauses') = 0,
  b::text)
FROM (SELECT public.get_today_bootstrap(CURRENT_DATE) AS b) s;
SELECT aderyth_test.res('T04c_other_user_direct_select_sees_zero',
  (SELECT count(*) FROM public.habits WHERE user_id = 'a4000000-0000-4000-8000-000000000003') = 0
  AND (SELECT count(*) FROM public.tasks WHERE user_id = 'a4000000-0000-4000-8000-000000000003') = 0,
  'row-level security owner scoping on habits and tasks');
SELECT aderyth_test.expect_denied('T04d_other_user_cannot_insert_habit_for_owner',
  $q$INSERT INTO public.habits (id, user_id, name, tracking_type, status) VALUES ('a4aaaaaa-0000-4000-8000-000000000099', 'a4000000-0000-4000-8000-000000000003', 'Sızdırma', 'boolean', 'active')$q$);
-- no JWT subject: the function's OWN guard raises 42501 'authentication required' (migration 037).
-- The message is pinned: without the guard the call still fails with a 42501, but it is a
-- row-level-security violation on willpower_state, and a bare 42501 check would accept that.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT aderyth_test.expect_denied('T04e_no_subject_raises_42501', $q$SELECT public.get_today_bootstrap(CURRENT_DATE)$q$, 'authentication required');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT aderyth_test.expect_denied('T04f_anon_cannot_execute_bootstrap', $q$SELECT public.get_today_bootstrap(CURRENT_DATE)$q$);
ROLLBACK;
