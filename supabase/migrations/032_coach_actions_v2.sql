-- The coach's second action set. (Implementation v3, R09.02)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). The client
-- keeps these types behind COACH_ACTIONS_V2_ENABLED = false, so no row of a
-- new type is ever staged against the old constraint.
--
-- An action type must agree in four places: this CHECK, the edge function's
-- tool schema (supabase/functions/generate-routine, deploy = S3), the client
-- validator (lib/coachActions + lib/coachActionsV2) and the gate. Turning the
-- gate on is the LAST step, after this is applied and the function deployed.
--
-- Forward-only: 026 is not edited; its constraint is replaced here.

ALTER TABLE public.ai_conversation_actions
  DROP CONSTRAINT IF EXISTS ai_actions_type_check;

ALTER TABLE public.ai_conversation_actions
  ADD CONSTRAINT ai_actions_type_check CHECK (action_type IN (
    'propose_habit', 'propose_habit_plan', 'log_habit',
    'edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today'
  ));
