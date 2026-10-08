-- The coach's reminder-time action. (Implementation v3, R09.02)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). The client
-- keeps every second-set action behind COACH_ACTIONS_V2_ENABLED = false.
--
-- Restates the WHOLE constraint (all nine types), so it is correct whether
-- or not 032 has run before it. Order of turning it on: apply 032, apply
-- 034, deploy generate-routine (S3), then flip the gate.
--
-- Forward-only: 026 and 032 are not edited; the constraint is replaced here.

ALTER TABLE public.ai_conversation_actions
  DROP CONSTRAINT IF EXISTS ai_actions_type_check;

ALTER TABLE public.ai_conversation_actions
  ADD CONSTRAINT ai_actions_type_check CHECK (action_type IN (
    'propose_habit', 'propose_habit_plan', 'log_habit',
    'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today', 'edit_reminder_time'
  ));
