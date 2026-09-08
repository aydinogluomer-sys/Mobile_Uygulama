-- Emergency Gate 0 - P0 payment bypass.
-- mock_activate_subscription is SECURITY DEFINER with EXECUTE granted to
-- PUBLIC/anon/authenticated. Any signed-up user could call
--   select mock_activate_subscription('pro','yearly')
-- and self-grant tier='pro', status='active', 1000 focus points, valid 1 year.
--
-- The definition is retained for local/dev use; only the client-reachable
-- EXECUTE grants are removed.
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.mock_activate_subscription(text, text)
--     TO authenticated, anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mock_activate_subscription(text, text) FROM authenticated;
