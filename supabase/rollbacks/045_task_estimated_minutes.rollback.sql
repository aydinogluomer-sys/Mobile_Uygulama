-- ROLLBACK of 045_task_estimated_minutes.sql
-- Destructive: drops public.tasks.estimated_minutes and estimate_source columns.
-- STATUS: WRITTEN, NOT APPLIED.
--
-- Effect: restores `public.get_today_bootstrap(date)` (when present) to its 037
-- body without altering function ACLs (preserving 040's acl_snapshot), then drops
-- `tasks_estimate_source_check`, `tasks_estimated_minutes_check`,
-- `public.tasks.estimate_source`, and `public.tasks.estimated_minutes`.
-- Data loss: stored task duration estimates and estimate provenance labels are lost;
-- task titles, completion states, and XP books are untouched.
--
-- Run (same session): SET aderyth.rollback_confirm = '045'; then this file.
-- A second run is a no-op (to_regprocedure guard + IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '045' THEN
    RAISE EXCEPTION 'rollback 045 drops public.tasks.estimated_minutes and estimate_source; take a backup, then run: SET aderyth.rollback_confirm = ''045'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DO $rb045$
BEGIN
  IF to_regprocedure('public.get_today_bootstrap(date)') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_today_bootstrap(p_today date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_week_start date;
  v_month_start date;
  v_period_start date;
  v_check_since date := p_today - 35;
  v_time_off_available boolean := false;
  v_checklist_available boolean := false;
  v_habits jsonb := '[]'::jsonb;
  v_today_logs jsonb := '[]'::jsonb;
  v_period_logs jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_willpower jsonb := 'null'::jsonb;
  v_recovery_plans jsonb := '[]'::jsonb;
  v_pauses jsonb := '[]'::jsonb;
  v_goal_versions jsonb := '[]'::jsonb;
  v_checklist_items jsonb := '[]'::jsonb;
  v_checklist_checks jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Monday-anchored ISO week start vs 1st of month (whichever is earlier),
  -- matching `periodWindowStart` in `frontend/app/tabs/today.tsx`.
  v_week_start := date_trunc('week', p_today::timestamp)::date;
  v_month_start := date_trunc('month', p_today::timestamp)::date;
  v_period_start := LEAST(v_week_start, v_month_start);

  -- 1. Active & paused habits (excluding archived), bounded to 500
  SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
    INTO v_habits
    FROM (
      SELECT *
        FROM public.habits
       WHERE user_id = v_uid
         AND (status IS NULL OR status <> 'archived')
       ORDER BY created_at ASC, id ASC
       LIMIT 500
    ) h;

  -- 2. Today's habit_logs, bounded to 500
  SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    INTO v_today_logs
    FROM (
      SELECT *
        FROM public.habit_logs
       WHERE user_id = v_uid
         AND completed_at = p_today
       ORDER BY created_at ASC, id ASC
       LIMIT 500
    ) l;

  -- 3. Current week/month period logs (`ReviewLogRow` projection), bounded to 2000
  SELECT COALESCE(jsonb_agg(to_jsonb(pl)), '[]'::jsonb)
    INTO v_period_logs
    FROM (
      SELECT habit_id, completed_at, state, value
        FROM public.habit_logs
       WHERE user_id = v_uid
         AND completed_at >= v_period_start
         AND completed_at <= p_today
         AND state IN ('done', 'partial', 'miss', 'skip')
       ORDER BY completed_at ASC, id ASC
       LIMIT 2000
    ) pl;

  -- 4. First keyset page of non-cancelled tasks (`PAGE_SIZE + 1 = 31`)
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_tasks
    FROM (
      SELECT id, user_id, title, description, category, due_date,
             time_block_start, time_block_end, completed, completed_at,
             is_subtask, parent_task_id, created_at, updated_at, list_name,
             status, priority, list_type, project_id, notes_text, quadrant
        FROM public.tasks
       WHERE user_id = v_uid
         AND (status IS NULL OR status <> 'cancelled')
       ORDER BY created_at DESC, id DESC
       LIMIT 31
    ) t;

  -- 5. Today's willpower_state: READ ONLY. A missing row stays `null` in the
  --    payload; the client (fetchOrCreateWillpowerState) creates it with its own
  --    budget constants. No client-supplied date ever produces a row here (DB1-20).
  SELECT COALESCE(to_jsonb(w), 'null'::jsonb)
    INTO v_willpower
    FROM public.willpower_state w
   WHERE w.user_id = v_uid
     AND w.state_date = p_today
   LIMIT 1;

  -- 6. Planned recovery plans, bounded to 100
  SELECT COALESCE(jsonb_agg(to_jsonb(rp)), '[]'::jsonb)
    INTO v_recovery_plans
    FROM (
      SELECT id, user_id, habit_id, source_log_id, source_date, target_date,
             deficit_type, deficit_value, strategy, distributed_days, note,
             reminder_time, status, completed_at, created_at
        FROM public.recovery_plans
       WHERE user_id = v_uid
         AND status = 'planned'
       ORDER BY target_date ASC, id ASC
       LIMIT 100
    ) rp;

  -- 7. Optional 028 tables: habit_pauses & habit_goal_versions
  IF to_regclass('public.habit_pauses') IS NOT NULL
     AND to_regclass('public.habit_goal_versions') IS NOT NULL THEN
    v_time_off_available := true;
    EXECUTE $sql$
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
        FROM (
          SELECT id, habit_id, kind, start_date, end_date
            FROM public.habit_pauses
           WHERE user_id = $1
           ORDER BY start_date ASC
           LIMIT 1000
        ) p
    $sql$ INTO v_pauses USING v_uid;

    EXECUTE $sql$
      SELECT COALESCE(jsonb_agg(to_jsonb(gv)), '[]'::jsonb)
        FROM (
          SELECT habit_id, effective_from, frequency_config, daily_goal, target_direction
            FROM public.habit_goal_versions
           WHERE user_id = $1
           ORDER BY effective_from ASC
           LIMIT 5000
        ) gv
    $sql$ INTO v_goal_versions USING v_uid;
  END IF;

  -- 8. Optional 029 tables: habit_checklist_items & habit_checklist_checks
  IF to_regclass('public.habit_checklist_items') IS NOT NULL
     AND to_regclass('public.habit_checklist_checks') IS NOT NULL THEN
    v_checklist_available := true;
    EXECUTE $sql$
      SELECT COALESCE(jsonb_agg(to_jsonb(ci)), '[]'::jsonb)
        FROM (
          SELECT id, habit_id, title, required, position, created_at, archived_at
            FROM public.habit_checklist_items
           WHERE user_id = $1
           ORDER BY position ASC
           LIMIT 2000
        ) ci
    $sql$ INTO v_checklist_items USING v_uid;

    EXECUTE $sql$
      SELECT COALESCE(jsonb_agg(to_jsonb(cc)), '[]'::jsonb)
        FROM (
          SELECT item_id, habit_id, day
            FROM public.habit_checklist_checks
           WHERE user_id = $1
             AND day >= $2
           LIMIT 5000
        ) cc
    $sql$ INTO v_checklist_checks USING v_uid, v_check_since;
  END IF;

  RETURN jsonb_build_object(
    'today', p_today,
    'habits', v_habits,
    'today_logs', v_today_logs,
    'period_logs', v_period_logs,
    'tasks', v_tasks,
    'willpower', v_willpower,
    'recovery_plans', v_recovery_plans,
    'time_off_available', v_time_off_available,
    'pauses', v_pauses,
    'goal_versions', v_goal_versions,
    'checklist_available', v_checklist_available,
    'checklist_items', v_checklist_items,
    'checklist_checks', v_checklist_checks
  );
END;
$function$;
    $fn$;
  END IF;
END $rb045$;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_estimate_source_check;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_estimated_minutes_check;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS estimate_source;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS estimated_minutes;

COMMIT;
