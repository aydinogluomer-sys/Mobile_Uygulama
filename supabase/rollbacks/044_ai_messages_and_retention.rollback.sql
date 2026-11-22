-- ROLLBACK of 044_ai_messages_and_retention.sql
-- STATUS: WRITTEN, NOT APPLIED. Restores pre-044 ai_messages_insert_own policy,
-- drops purge_ai_retention() and ai_requests_user_created_idx, and restores
-- pre-044 EXECUTE grants on cleanup_old_ai_calls(). Run newest to oldest (044 before 043).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '044' THEN
    RAISE EXCEPTION 'rollback 044 restores pre-044 ai_messages_insert_own and drops purge_ai_retention(); take a backup, then run: SET aderyth.rollback_confirm = ''044'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- 4 reversed: drop server-only retention purge function.
DROP FUNCTION IF EXISTS public.purge_ai_retention();

-- 3 reversed: restore baseline EXECUTE rights on cleanup_old_ai_calls() (if 040 is also rolled back, baseline has PUBLIC/anon/authenticated).
GRANT EXECUTE ON FUNCTION public.cleanup_old_ai_calls() TO PUBLIC, anon, authenticated;

-- 2 reversed: drop per-user admission index on ai_requests.
DROP INDEX IF EXISTS public.ai_requests_user_created_idx;

-- 1 reversed: restore pre-044 ai_messages_insert_own policy from 026_ai_conversations.sql.
DROP POLICY IF EXISTS ai_messages_insert_own ON public.ai_messages;
CREATE POLICY ai_messages_insert_own ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations c
       WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

COMMIT;
