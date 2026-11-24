-- 13: Task duration persistence, CHECK bounds, and get_today_bootstrap tenant isolation (045 / E19 / Y10).
-- Runs inside a single rolled-back transaction so no test users or tasks outlive the file.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a9000000-0000-4000-8000-000000000001', 't13a@aderyth.test'),
  ('a9000000-0000-4000-8000-000000000002', 't13b@aderyth.test')
ON CONFLICT (id) DO NOTHING;

-- 1. Catalog verification (nullable columns, no default, both CHECK constraints present)
SELECT aderyth_test.res('T13a_columns_and_checks_present',
  (SELECT count(*) = 2
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND is_nullable = 'YES'
      AND column_default IS NULL
      AND ((column_name = 'estimated_minutes' AND data_type = 'integer')
        OR (column_name = 'estimate_source' AND data_type = 'text')))
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_estimated_minutes_check')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_estimate_source_check'));

-- 2. Authenticated owner A: default NULL, valid bounds/sources, and 23514 CHECK rejections
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT aderyth_test.expect_allowed('T13b_omitted_columns_insert_allowed',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type) VALUES ('a9bbbbbb-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Suresiz gorev', 'pending', 'medium', 'inbox')$q$, 1);

SELECT aderyth_test.res('T13b2_omitted_columns_stay_null',
  (SELECT estimated_minutes IS NULL AND estimate_source IS NULL
     FROM public.tasks
    WHERE id = 'a9bbbbbb-0000-4000-8000-000000000001'));

SELECT aderyth_test.expect_allowed('T13c_min_1_and_user_source_accepted',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'Kisa adim', 'pending', 'low', 'inbox', 1, 'user')$q$, 1);

SELECT aderyth_test.expect_allowed('T13d_nominal_25_and_ai_source_accepted',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000001', 'Odak blogu', 'pending', 'high', 'this_week', 25, 'ai')$q$, 1);

SELECT aderyth_test.expect_allowed('T13e_max_1440_and_block_source_accepted',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000004', 'a9000000-0000-4000-8000-000000000001', 'Tam gun blok', 'pending', 'medium', 'this_week', 1440, 'block')$q$, 1);

SELECT aderyth_test.expect_allowed('T13f_default_source_accepted',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000005', 'a9000000-0000-4000-8000-000000000001', 'Varsayilan etiketli', 'pending', 'none', 'someday', 15, 'default')$q$, 1);

SELECT aderyth_test.expect_error('T13g_zero_minutes_rejected_23514',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000010', 'a9000000-0000-4000-8000-000000000001', 'Sifir dakika', 'pending', 'none', 'inbox', 0, 'user')$q$, '23514');

SELECT aderyth_test.expect_error('T13h_negative_minutes_rejected_23514',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000001', 'Eksi dakika', 'pending', 'none', 'inbox', -5, 'user')$q$, '23514');

SELECT aderyth_test.expect_error('T13i_above_1440_minutes_rejected_23514',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000012', 'a9000000-0000-4000-8000-000000000001', 'Sinir ustu dakika', 'pending', 'none', 'inbox', 1441, 'user')$q$, '23514');

SELECT aderyth_test.expect_error('T13j_invalid_source_rejected_23514',
  $q$INSERT INTO public.tasks (id, user_id, title, status, priority, list_type, estimated_minutes, estimate_source) VALUES ('a9bbbbbb-0000-4000-8000-000000000013', 'a9000000-0000-4000-8000-000000000001', 'Gecersiz kaynak', 'pending', 'none', 'inbox', 25, 'invalid_src')$q$, '23514');

-- 3. get_today_bootstrap returns new duration columns for owner A
SELECT aderyth_test.res('T13k_bootstrap_returns_duration_fields_for_owner',
  jsonb_array_length(b -> 'tasks') = 5
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(b -> 'tasks') elem
     WHERE elem ->> 'id' = 'a9bbbbbb-0000-4000-8000-000000000001'
       AND elem -> 'estimated_minutes' = 'null'::jsonb
       AND elem -> 'estimate_source' = 'null'::jsonb
  )
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(b -> 'tasks') elem
     WHERE elem ->> 'id' = 'a9bbbbbb-0000-4000-8000-000000000003'
       AND (elem ->> 'estimated_minutes')::int = 25
       AND elem ->> 'estimate_source' = 'ai'
  )
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(b -> 'tasks') elem
     WHERE elem ->> 'id' = 'a9bbbbbb-0000-4000-8000-000000000004'
       AND (elem ->> 'estimated_minutes')::int = 1440
       AND elem ->> 'estimate_source' = 'block'
  ),
  b::text)
FROM (SELECT public.get_today_bootstrap(CURRENT_DATE) AS b) s;

-- Positive control before cross-tenant expect_no_effect: owner A can update own task duration
SELECT aderyth_test.expect_allowed('T13l_owner_can_update_own_estimate',
  $q$UPDATE public.tasks SET estimated_minutes = 45, estimate_source = 'user' WHERE id = 'a9bbbbbb-0000-4000-8000-000000000001'$q$, 1);

-- 4. Tenant B isolation: get_today_bootstrap leaks zero tasks and cross-tenant UPDATE has no effect
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000002', true);

SELECT aderyth_test.res('T13m_bootstrap_isolates_other_user_tasks',
  jsonb_array_length(b -> 'tasks') = 0
  AND (SELECT count(*) FROM public.tasks WHERE user_id = 'a9000000-0000-4000-8000-000000000001') = 0,
  b::text)
FROM (SELECT public.get_today_bootstrap(CURRENT_DATE) AS b) s;

SELECT aderyth_test.expect_no_effect('T13n_other_user_cannot_update_owner_estimate',
  $q$UPDATE public.tasks SET estimated_minutes = 90, estimate_source = 'user' WHERE id = 'a9bbbbbb-0000-4000-8000-000000000001'$q$);

RESET ROLE;

-- 5. XP ledger invariant remains 0
SELECT aderyth_test.res('T13o_xp_drift_zero',
  (SELECT count(*) = 0 FROM public.xp_drift()));

ROLLBACK;
