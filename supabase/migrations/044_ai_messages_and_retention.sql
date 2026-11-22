-- AI message integrity and AI data retention. STATUS: WRITTEN, NOT APPLIED.
-- After 039 and 040; independent of 041-043; safe before or after the client / Edge release.
-- Scheduling purge_ai_retention() is the owner's pg_cron step (OD-25).
-- Rollback: supabase/rollbacks/044_ai_messages_and_retention.rollback.sql

BEGIN;

DROP POLICY IF EXISTS ai_messages_insert_own ON public.ai_messages;
CREATE POLICY ai_messages_insert_own ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())
    )
    AND (
      role = 'user'
      OR (
        role = 'assistant'
        AND request_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.ai_requests r
          WHERE r.user_id = (SELECT auth.uid())
            AND r.request_id = ai_messages.request_id
            AND r.mode = 'coach'
            AND r.status = 'completed'
            AND left(r.response ->> 'reply', 8000) = ai_messages.content
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.purge_ai_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch constant integer := 5000;
  v_answers integer := 0; v_errors integer := 0; v_calls integer := 0; v_ledger integer := 0; v_records integer := 0;
BEGIN
  WITH victims AS (
    SELECT user_id, request_id FROM public.ai_requests
     WHERE status = 'completed' AND created_at < now() - interval '30 days' AND response <> '{}'::jsonb
     ORDER BY created_at LIMIT v_batch FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_requests r SET response = '{}'::jsonb
    FROM victims v WHERE r.user_id = v.user_id AND r.request_id = v.request_id;
  GET DIAGNOSTICS v_answers = ROW_COUNT;
  WITH victims AS (
    SELECT user_id, request_id FROM public.ai_requests
     WHERE status = 'failed' AND error IS NOT NULL AND created_at < now() - interval '30 days'
     ORDER BY created_at LIMIT v_batch FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_requests r SET error = NULL
    FROM victims v WHERE r.user_id = v.user_id AND r.request_id = v.request_id;
  GET DIAGNOSTICS v_errors = ROW_COUNT;
  DELETE FROM public.ai_calls WHERE called_at < now() - interval '7 days';
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  DELETE FROM public.credit_transactions
   WHERE id IN (SELECT id FROM public.credit_transactions
                 WHERE created_at < now() - interval '400 days' AND request_id IS NOT NULL
                 ORDER BY created_at LIMIT v_batch);
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM public.ai_requests
   WHERE ctid IN (SELECT ctid FROM public.ai_requests
                   WHERE status <> 'in_progress' AND created_at < now() - interval '400 days'
                   ORDER BY created_at LIMIT v_batch);
  GET DIAGNOSTICS v_records = ROW_COUNT;
  RETURN jsonb_build_object('answers_blanked', v_answers, 'errors_cleared', v_errors,
    'ai_calls_deleted', v_calls, 'ledger_rows_deleted', v_ledger, 'request_records_deleted', v_records);
END
$function$;

CREATE INDEX IF NOT EXISTS ai_requests_user_created_idx ON public.ai_requests (user_id, created_at DESC);

REVOKE EXECUTE ON FUNCTION public.purge_ai_retention() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_ai_calls() FROM PUBLIC, anon, authenticated;

COMMIT;
