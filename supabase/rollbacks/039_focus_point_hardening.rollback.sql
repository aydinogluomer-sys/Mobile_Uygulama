-- ============================================================================
-- Rollback for 039_focus_point_hardening.sql
-- STATUS: WRITTEN, NOT APPLIED (DB frozen per STATE.md S1/S2).
-- ============================================================================
-- Run (same session): SET aderyth.rollback_confirm = '039'; then this file (F02 contract).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '039' THEN
    RAISE EXCEPTION 'rollback 039 drops ai_messages_user_request_uniq; run: SET aderyth.rollback_confirm = ''039'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DROP INDEX IF EXISTS public.ai_messages_user_request_uniq;

-- Deliberately NOT reverted:
--  (a) the duplicate user messages removed by section 1 (identical content, same request_id)
--      cannot be restored and carry no information;
--  (b) credits issued by section 3 are legitimate ledger rows (request_id || ':refund');
--      removing them would take back money the user was owed;
--  (c) the REVOKE on public.spend_focus_points(integer, text) belongs to 036 as well; to reopen
--      the function use the rollback of 036, never this file.

COMMIT;
