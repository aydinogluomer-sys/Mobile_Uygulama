-- ============================================================================
-- Migration 039: Focus Point credit integrity
-- STATUS: WRITTEN, NOT APPLIED (DB frozen per STATE.md S1/S2).
-- ============================================================================
--
-- Prerequisites (all live): 023/024 (ai_requests, ai_request_*, refund_focus_points,
-- spend_focus_points_v2), 026 (ai_conversations, ai_messages). Independent of 028-038.
-- 036 already revokes public.spend_focus_points(integer, text); the REVOKE in section 4 is
-- idempotent: a no-op after 036 and the safeguard if 036 is trimmed by the owner.
--
-- Touches NO XP table: habit_logs, profiles, habit_xp_awards and add_xp are not mentioned,
-- so xp_drift() is unchanged. Focus Point AMOUNTS are unchanged; section 3 only credits what
-- a failed AI request already took and never returned.
--
-- Apply AFTER the client release that handles the user-message unique violation
-- (older app builds cannot resend a failed coach message once section 2 exists).

-- ── 1. one user message per (conversation, request_id) ─────────────────────
-- Duplicates created by resends before this migration would make the index
-- impossible to build. Keep the EARLIEST row per (conversation, request_id);
-- the copies carry identical content (the attempt keeper keys on the text).
DO $dedupe$
DECLARE removed integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY conversation_id, request_id ORDER BY created_at, id) AS rn
    FROM public.ai_messages
    WHERE role = 'user' AND request_id IS NOT NULL
  )
  DELETE FROM public.ai_messages m
  USING ranked r
  WHERE m.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE '039: % duplicate user message(s) removed', removed;
END
$dedupe$;

-- ── 2. the index (mirrors ai_messages_assistant_request_uniq, live_schema.sql:3289) ──
CREATE UNIQUE INDEX IF NOT EXISTS ai_messages_user_request_uniq
  ON public.ai_messages (conversation_id, request_id)
  WHERE role = 'user' AND request_id IS NOT NULL;

-- ── 3. one-off heal: failed AI requests whose charge was never refunded ──────
-- Cause: generate-routine swallowed a refund_focus_points error and then marked the
-- row failed; ai_request_reconcile_stale only looks at in_progress rows, so nobody
-- ever came back. refund_focus_points is idempotent (it refuses a second credit and
-- returns ok = false when the key never charged anything), so this loop is safe to
-- re-run. The created_at predicate excludes a charge that PREDATES the claim row
-- (a key from before 023, answered from the ledger only): that money bought a
-- service the user received.
DO $heal$
DECLARE r record; healed integer := 0; fp_returned integer := 0; spent integer;
BEGIN
  FOR r IN
    SELECT a.user_id, a.request_id
    FROM public.ai_requests a
    WHERE a.status = 'failed'
      AND EXISTS (SELECT 1 FROM public.credit_transactions t
                  WHERE t.user_id = a.user_id AND t.request_id = a.request_id
                    AND t.delta < 0 AND t.created_at >= a.created_at)
      AND NOT EXISTS (SELECT 1 FROM public.credit_transactions t2
                      WHERE t2.user_id = a.user_id AND t2.request_id = a.request_id || ':refund')
    ORDER BY a.created_at
  LOOP
    SELECT -t.delta INTO spent FROM public.credit_transactions t
      WHERE t.user_id = r.user_id AND t.request_id = r.request_id AND t.delta < 0 LIMIT 1;
    PERFORM public.refund_focus_points(r.user_id, r.request_id, 'ai_failed_unrefunded');
    healed := healed + 1;
    fp_returned := fp_returned + coalesce(spent, 0);
  END LOOP;
  RAISE NOTICE '039: % failed AI request(s) refunded, % FP returned in total', healed, fp_returned;
END
$heal$;

-- ── 4. the legacy spend function (EDG-16, DB2-V01) ─────────────────────────
-- No client or edge caller exists (grep, 2026-11-01); the AI flow uses spend_focus_points_v2.
-- It has no idempotency key and was executable by anon. Idempotent with 036.
REVOKE EXECUTE ON FUNCTION public.spend_focus_points(integer, text) FROM PUBLIC, anon, authenticated;
