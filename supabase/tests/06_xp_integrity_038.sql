-- 06: XP and streak integrity of migration 038 (F03; DB1-01, DB2-01/02/03/04/06/09, DOM-01/02, SYN-13).
--
-- Every exploit runs as `authenticated`, the role PostgREST gives a signed-in client, through the
-- real trigger chain (guard -> set_xp -> award, purge on delete, streak protection on habits).
-- The checks read the result as the superuser. The scenarios of constitution rule A.7 are all
-- here: an old day, a future day, delete-and-rewrite, delete-and-recreate under the same name,
-- done -> partial / miss -> done; and after each one xp_drift() is empty for the user.
--
-- T1-T14 are the plan's numbering (implementation.md F03, section 5); T15-T18 cover what the plan
-- left implicit: a log's key cannot move, an old day accepts a note but not a new state, an update
-- that changes neither state nor value is never scored again, and no user drifts at the end.
--
-- Pure SQL (run.sh passes ON_ERROR_STOP): a trigger or fixture error aborts the whole run as a
-- HARNESS ERROR. Everything is one transaction that ends in ROLLBACK.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'xp1@aderyth.test'),
  ('c0000000-0000-4000-8000-000000000002', 'xp2@aderyth.test');
-- on_profile_created_pet (dormant, scope-addendum F13) would trip a foreign key on the unseeded
-- pet_stages table; only these inserts run with ordinary triggers off.
SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (id, email, username) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'xp1@aderyth.test', 't06a'),
  ('c0000000-0000-4000-8000-000000000002', 'xp2@aderyth.test', 't06b');
SET LOCAL session_replication_role = origin;

-- ===== user 1 acts as the client =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty)
VALUES ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Test Habit', 'boolean', 1);

-- T1: weekly_xp is not client-writable (036-B); INSERT, UPDATE and DELETE are refused with 42501
SELECT aderyth_test.expect_denied('T06_T01a_weekly_xp_insert_denied',
  $q$INSERT INTO public.weekly_xp (user_id, week_start, xp_earned) VALUES ('c0000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, 999999)$q$);
SELECT aderyth_test.expect_denied('T06_T01b_weekly_xp_update_denied',
  $q$UPDATE public.weekly_xp SET xp_earned = 999999 WHERE user_id = 'c0000000-0000-4000-8000-000000000001'$q$);
SELECT aderyth_test.expect_denied('T06_T01c_weekly_xp_delete_denied',
  $q$DELETE FROM public.weekly_xp WHERE user_id = 'c0000000-0000-4000-8000-000000000001'$q$);

-- T2: day window. -16 and +2 are refused with the exact token; -15 and +1 are accepted.
DO $t2$
DECLARE
  v_habit constant uuid := 'c1000000-0000-4000-8000-000000000001';
  v_user constant uuid := 'c0000000-0000-4000-8000-000000000001';
  v_day integer;
  v_bad text := '';
BEGIN
  FOREACH v_day IN ARRAY ARRAY[-16, 2] LOOP
    BEGIN
      INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
      VALUES (v_habit, v_user, current_date + v_day, 'done');
      v_bad := v_bad || format('offset %s was accepted; ', v_day);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'habit_log_day_out_of_range' THEN
        v_bad := v_bad || format('offset %s refused for another reason: %s; ', v_day, SQLERRM);
      END IF;
    END;
  END LOOP;
  PERFORM aderyth_test.res('T06_T02a_day_outside_window_refused', v_bad = '',
    coalesce(nullif(v_bad, ''), '-16 and +2 refused: 22023 habit_log_day_out_of_range'));

  v_bad := '';
  FOREACH v_day IN ARRAY ARRAY[-15, 1] LOOP
    BEGIN
      INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
      VALUES (v_habit, v_user, current_date + v_day, 'miss');
    EXCEPTION WHEN OTHERS THEN
      v_bad := v_bad || format('offset %s refused: %s %s; ', v_day, SQLSTATE, SQLERRM);
    END;
  END LOOP;
  PERFORM aderyth_test.res('T06_T02b_window_edges_accepted', v_bad = '',
    coalesce(nullif(v_bad, ''), '-15 and +1 accepted'));
END $t2$;

-- T3: the client's xp is ignored (99999 sent, the server's 10 stored: difficulty 1 -> cost 1 -> 10 xp)
INSERT INTO public.habit_logs (id, habit_id, user_id, completed_at, state, xp)
VALUES ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001', current_date, 'done', 99999);

RESET ROLE;
SELECT aderyth_test.res('T06_T03_client_xp_ignored', l.xp = 10 AND p.total_xp = 10,
  format('log xp=%s total_xp=%s (10 and 10 expected)', l.xp, p.total_xp))
  FROM public.habit_logs l, public.profiles p
 WHERE l.id = 'c2000000-0000-4000-8000-000000000001' AND p.id = 'c0000000-0000-4000-8000-000000000001';

-- T4: delete and rewrite the same day: not paid twice, the deleted xp is in purged_xp, no drift
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DELETE FROM public.habit_logs WHERE id = 'c2000000-0000-4000-8000-000000000001';
INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
VALUES ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', current_date, 'done');
RESET ROLE;
SELECT aderyth_test.res('T06_T04_delete_rewrite_not_paid_twice',
  p.total_xp = 10 AND p.purged_xp = 10 AND s.logsum = 0
    AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = p.id),
  format('total_xp=%s purged_xp=%s log sum=%s (10 / 10 / 0 expected)', p.total_xp, p.purged_xp, s.logsum))
  FROM public.profiles p,
       (SELECT coalesce(sum(xp), 0) AS logsum FROM public.habit_logs
         WHERE user_id = 'c0000000-0000-4000-8000-000000000001') s
 WHERE p.id = 'c0000000-0000-4000-8000-000000000001';

-- T5: delete the habit, recreate it under the same name (case and spacing differ): the day is not paid twice
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DELETE FROM public.habits WHERE id = 'c1000000-0000-4000-8000-000000000001';
INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty)
VALUES ('c1000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', '  test   HABIT ', 'boolean', 1);
INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
VALUES ('c1000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', current_date, 'done');
RESET ROLE;
SELECT aderyth_test.res('T06_T05_recreate_same_name_not_paid_twice',
  p.total_xp = 10 AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = p.id),
  format('total_xp=%s (10 expected)', p.total_xp))
  FROM public.profiles p WHERE p.id = 'c0000000-0000-4000-8000-000000000001';

-- T7: streak columns are not client-writable (PATCH 29 is ignored; INSERT with 50 becomes 0)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
UPDATE public.habits SET streak_current = 29, streak_best = 29 WHERE id = 'c1000000-0000-4000-8000-000000000009';
INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty, streak_current, streak_best)
VALUES ('c1000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 'Seven', 'boolean', 1, 50, 50);
RESET ROLE;
SELECT aderyth_test.res('T06_T07_streak_columns_not_client_writable',
  a.streak_current <> 29 AND a.streak_best <> 29 AND b.streak_current = 0 AND b.streak_best = 0,
  format('patched habit %s/%s (not 29/29), inserted habit %s/%s (0/0)', a.streak_current, a.streak_best, b.streak_current, b.streak_best))
  FROM public.habits a, public.habits b
 WHERE a.id = 'c1000000-0000-4000-8000-000000000009' AND b.id = 'c1000000-0000-4000-8000-000000000008';

-- T8: done -> miss -> done and done -> partial -> done, five times, step the streak once and pay once
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DO $t8$
DECLARE v_i integer; v_log uuid;
BEGIN
  INSERT INTO public.habit_logs (id, habit_id, user_id, completed_at, state)
  VALUES ('c2000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000008',
          'c0000000-0000-4000-8000-000000000001', current_date, 'done')
  RETURNING id INTO v_log;
  FOR v_i IN 1..5 LOOP
    UPDATE public.habit_logs SET state = CASE WHEN v_i % 2 = 0 THEN 'partial' ELSE 'miss' END WHERE id = v_log;
    UPDATE public.habit_logs SET state = 'done' WHERE id = v_log;
  END LOOP;
END $t8$;
RESET ROLE;
SELECT aderyth_test.res('T06_T08_toggling_steps_streak_once_pays_once',
  h.streak_current = 1 AND l.xp = 10 AND p.total_xp = 20
    AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = p.id),
  format('streak=%s log xp=%s total_xp=%s (1 / 10 / 20 expected)', h.streak_current, l.xp, p.total_xp))
  FROM public.habits h, public.habit_logs l, public.profiles p
 WHERE h.id = 'c1000000-0000-4000-8000-000000000008'
   AND l.habit_id = h.id AND l.completed_at = current_date
   AND p.id = 'c0000000-0000-4000-8000-000000000001';

-- T15: the key of a log (habit, user, day) cannot be moved by the client
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DO $t15$
DECLARE v_detail text;
BEGIN
  BEGIN
    UPDATE public.habit_logs SET completed_at = current_date - 1
     WHERE id = 'c2000000-0000-4000-8000-000000000008';
    v_detail := 'the day of a log was moved';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_detail := CASE WHEN SQLERRM = 'habit_log_key_immutable' THEN NULL ELSE '22023 for another reason: ' || SQLERRM END;
  END;
  PERFORM aderyth_test.res('T06_T15_log_key_immutable', v_detail IS NULL,
    coalesce(v_detail, '22023 habit_log_key_immutable'));
END $t15$;

-- T16: a day outside the window keeps its log editable for a note, but its state cannot change.
-- The old log is written by the superuser (the window binds client roles only).
RESET ROLE;
INSERT INTO public.habit_logs (id, habit_id, user_id, completed_at, state)
VALUES ('c2000000-0000-4000-8000-000000000016', 'c1000000-0000-4000-8000-000000000008',
        'c0000000-0000-4000-8000-000000000001', current_date - 30, 'done');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
SELECT aderyth_test.expect_allowed('T06_T16a_old_day_note_edit_allowed',
  $q$UPDATE public.habit_logs SET notes = 'sonradan not' WHERE id = 'c2000000-0000-4000-8000-000000000016'$q$, 1);
DO $t16$
DECLARE v_detail text;
BEGIN
  BEGIN
    UPDATE public.habit_logs SET state = 'miss' WHERE id = 'c2000000-0000-4000-8000-000000000016';
    v_detail := 'the state of a log 30 days old was changed';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_detail := CASE WHEN SQLERRM = 'habit_log_day_out_of_range' THEN NULL ELSE '22023 for another reason: ' || SQLERRM END;
  END;
  PERFORM aderyth_test.res('T06_T16b_old_day_state_change_refused', v_detail IS NULL,
    coalesce(v_detail, '22023 habit_log_day_out_of_range'));
END $t16$;

-- T17: raising a habit's difficulty and then touching its logs (a note) re-scores nothing,
-- neither the old day nor today: only a new log or a change of state or value is scored.
-- (a) the edits themselves are accepted; (b) neither log earns more.
DO $t17$
DECLARE v_detail text;
BEGIN
  BEGIN
    UPDATE public.habits SET difficulty = 10 WHERE id = 'c1000000-0000-4000-8000-000000000008';
    UPDATE public.habit_logs SET notes = 'yine not' WHERE id = 'c2000000-0000-4000-8000-000000000016';
    UPDATE public.habit_logs SET notes = 'bugün not' WHERE id = 'c2000000-0000-4000-8000-000000000008';
    v_detail := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_detail := format('a difficulty or note edit was refused: %s %s', SQLSTATE, SQLERRM);
  END;
  PERFORM aderyth_test.res('T06_T17a_difficulty_and_note_edits_accepted', v_detail IS NULL,
    coalesce(v_detail, 'difficulty 1 -> 10, two note edits accepted'));
END $t17$;
RESET ROLE;
SELECT aderyth_test.res('T06_T17b_note_edit_never_rescores',
  o.xp = 10 AND t.xp = 10 AND h.difficulty = 10
    AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = o.user_id),
  format('old day xp=%s, today xp=%s (10 and 10 expected), difficulty=%s (10)', o.xp, t.xp, h.difficulty))
  FROM public.habit_logs o, public.habit_logs t, public.habits h
 WHERE o.id = 'c2000000-0000-4000-8000-000000000016'
   AND t.id = 'c2000000-0000-4000-8000-000000000008'
   AND h.id = 'c1000000-0000-4000-8000-000000000008';

-- T9: a gap restarts the run; 14 consecutive days (separate statements) reach the x1.2 step at day 10
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty) VALUES
  ('c1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'Gap', 'boolean', 1),
  ('c1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'Run', 'boolean', 10);
INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
VALUES ('c1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', current_date - 10, 'done');
INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
VALUES ('c1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', current_date - 2, 'done');
DO $t9a$
DECLARE v_i integer;
BEGIN
  FOR v_i IN REVERSE 13..0 LOOP
    INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
    VALUES ('c1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', current_date - v_i, 'done');
  END LOOP;
END $t9a$;
RESET ROLE;
SELECT aderyth_test.res('T06_T09a_gap_restarts_run',
  h.streak_current = 1, format('streak=%s after an 8-day gap (1 expected)', h.streak_current))
  FROM public.habits h WHERE h.id = 'c1000000-0000-4000-8000-000000000007';
SELECT aderyth_test.res('T06_T09b_multiplier_reads_the_ledger_run',
  s.total = 9 * 100 + 5 * 120 AND h.streak_current = 14
    AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = h.user_id),
  format('xp=%s (1500 = 9 x 100 + 5 x 120 expected), streak=%s (14 expected)', s.total, h.streak_current))
  FROM public.habits h,
       (SELECT coalesce(sum(xp), 0) AS total FROM public.habit_logs
         WHERE habit_id = 'c1000000-0000-4000-8000-000000000006') s
 WHERE h.id = 'c1000000-0000-4000-8000-000000000006';

-- T10: a log delete moves its xp to purged_xp once; a habit delete (cascade) moves the rest once, not twice
CREATE TEMP TABLE t06_purged ON COMMIT DROP AS
  SELECT purged_xp AS before_xp FROM public.profiles WHERE id = 'c0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DELETE FROM public.habit_logs
 WHERE habit_id = 'c1000000-0000-4000-8000-000000000006' AND completed_at = current_date;
RESET ROLE;
ALTER TABLE t06_purged ADD COLUMN mid_xp integer, ADD COLUMN remaining integer;
UPDATE t06_purged SET
  mid_xp = (SELECT purged_xp FROM public.profiles WHERE id = 'c0000000-0000-4000-8000-000000000001'),
  remaining = (SELECT coalesce(sum(xp), 0) FROM public.habit_logs WHERE habit_id = 'c1000000-0000-4000-8000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
DELETE FROM public.habits WHERE id = 'c1000000-0000-4000-8000-000000000006';
RESET ROLE;
SELECT aderyth_test.res('T06_T10_deletes_move_xp_once',
  t.mid_xp - t.before_xp = 120 AND p.purged_xp - t.mid_xp = t.remaining
    AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = p.id),
  format('log delete moved %s (120 expected), habit delete moved %s (%s expected)',
         t.mid_xp - t.before_xp, p.purged_xp - t.mid_xp, t.remaining))
  FROM t06_purged t, public.profiles p WHERE p.id = 'c0000000-0000-4000-8000-000000000001';

-- ===== user 2: the daily cap (25 habits x 100 xp on one day -> 2000 at most) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
DO $t6a$
DECLARE v_i integer; v_h uuid;
BEGIN
  FOR v_i IN 1..25 LOOP
    v_h := gen_random_uuid();
    INSERT INTO public.habits (id, user_id, name, tracking_type, difficulty)
    VALUES (v_h, 'c0000000-0000-4000-8000-000000000002', 'Cap ' || v_i, 'boolean', 10);
    INSERT INTO public.habit_logs (habit_id, user_id, completed_at, state)
    VALUES (v_h, 'c0000000-0000-4000-8000-000000000002', current_date, 'done');
  END LOOP;
END $t6a$;
RESET ROLE;
SELECT aderyth_test.res('T06_T06_daily_cap_holds',
  p.total_xp = 2000 AND l.day_total = 2000 AND NOT EXISTS (SELECT 1 FROM public.xp_drift() d WHERE d.user_id = p.id),
  format('total_xp=%s ledger day total=%s (2000 and 2000 expected)', p.total_xp, l.day_total))
  FROM public.profiles p,
       (SELECT sum(xp_awarded) AS day_total FROM public.habit_xp_awards
         WHERE user_id = 'c0000000-0000-4000-8000-000000000002' AND day = current_date) l
 WHERE p.id = 'c0000000-0000-4000-8000-000000000002';

-- T11: the F13 boss trigger is gone from habit_logs
SELECT aderyth_test.res('T06_T11_boss_trigger_dropped',
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_habit_completed_damage_boss' AND NOT tgisinternal),
  'on_habit_completed_damage_boss must not exist');

-- T12: no client role can execute the five trigger functions; the three definers pin search_path
SELECT aderyth_test.res('T06_T12_trigger_functions_closed_and_pinned',
  count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      OR has_function_privilege('anon', p.oid, 'EXECUTE')) = 0
    AND count(*) = 5
    AND count(*) FILTER (WHERE p.proname IN ('fn_habit_log_set_xp', 'fn_habit_log_award', 'fn_habit_log_purge_on_delete')
                           AND p.prosecdef
                           AND coalesce(p.proconfig::text, '') LIKE '%search_path=public, pg_temp%') = 3
    AND count(*) FILTER (WHERE p.proname IN ('fn_habit_log_guard', 'fn_habits_protect_streak') AND NOT p.prosecdef) = 2,
  string_agg(format('%s definer=%s cfg=%s', p.proname, p.prosecdef, p.proconfig), '; '))
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.pronargs = 0
   AND p.proname IN ('fn_habit_log_guard', 'fn_habit_log_set_xp', 'fn_habit_log_award',
                     'fn_habit_log_purge_on_delete', 'fn_habits_protect_streak');

-- T13: the weekly sanity CHECK refuses a negative value even from the server role
DO $t13$
DECLARE v_detail text;
BEGIN
  BEGIN
    INSERT INTO public.weekly_xp (user_id, week_start, xp_earned)
    VALUES ('c0000000-0000-4000-8000-000000000002', date '2000-01-03', -1);
    v_detail := 'a negative weekly xp was accepted';
  EXCEPTION WHEN check_violation THEN
    v_detail := NULL;
  END;
  PERFORM aderyth_test.res('T06_T13_weekly_xp_sanity_check', v_detail IS NULL,
    coalesce(v_detail, 'check_violation (weekly_xp_xp_earned_sane)'));
END $t13$;

-- T14: the weekly board reads server numbers only: weekly_xp equals total_xp for user 2 (all credited this week)
SELECT aderyth_test.res('T06_T14_weekly_xp_is_the_server_total',
  coalesce((SELECT xp_earned FROM public.weekly_xp
             WHERE user_id = 'c0000000-0000-4000-8000-000000000002'
               AND week_start = date_trunc('week', current_date)::date), -1) = 2000,
  format('weekly xp_earned=%s (2000 expected)',
         (SELECT xp_earned FROM public.weekly_xp
           WHERE user_id = 'c0000000-0000-4000-8000-000000000002'
             AND week_start = date_trunc('week', current_date)::date)));

-- T18: after every scenario above, no user at all drifts
SELECT aderyth_test.res('T06_T18_xp_drift_empty_everywhere', count(*) = 0,
  coalesce(string_agg(format('%s drift=%s', d.user_id, d.drift), '; '), 'no drift'))
  FROM public.xp_drift() d;

ROLLBACK;
