-- ROLLBACK of 037_today_bootstrap_rpc.sql
-- STATUS: WRITTEN, NOT APPLIED. The client falls back to table reads when the RPC is missing
-- (todayBootstrapRepository.ts: isMissingRpcError treats PGRST202 / 42883 as "no RPC").
--
-- Effect: public.get_today_bootstrap(date) is dropped; its EXECUTE grant goes with it. It is
-- the only object 037 creates, and it is SECURITY INVOKER, so no data and no other grant is
-- involved. Nothing depends on it in the database.
-- Client: the Today screen reads its tables one by one again (more round trips, same data).
--
-- Run (same session): SET aderyth.rollback_confirm = '037'; then this file.
-- A second run is a no-op (IF EXISTS).
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('aderyth.rollback_confirm', true), '') <> '037' THEN
    RAISE EXCEPTION 'rollback 037 drops get_today_bootstrap(date); run: SET aderyth.rollback_confirm = ''037'';'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS public.get_today_bootstrap(date);

COMMIT;
