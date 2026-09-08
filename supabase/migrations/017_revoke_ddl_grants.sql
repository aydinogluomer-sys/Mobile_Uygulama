-- ============================================================
-- `anon` and `authenticated` held TRUNCATE, REFERENCES and TRIGGER on every
-- table in `public`. Measured, not assumed — `has_table_privilege` over all
-- 53 tables returned true for both roles on all three, `profiles` included.
--
-- ## How bad is it today
--
-- Not exploitable through the API as it stands, and this is stated that way
-- deliberately rather than dressed up: PostgREST has no TRUNCATE verb and
-- issues no DDL, so there is no request shape that reaches any of the three.
-- The `DELETE` that PostgREST does issue is row-level and subject to RLS.
--
-- ## Why revoke them anyway
--
-- TRUNCATE is the one that matters, because **RLS does not apply to it**.
-- Every row-level protection this project has built — the ownership policies,
-- the child-row checks, the column grants — is bypassed by a single TRUNCATE.
-- The only thing standing between the app's public anon key and an empty
-- table is that no code path currently emits that statement. That is a
-- property of today's call sites, not of the permission system: one
-- SECURITY INVOKER function, one raw-SQL path, one future extension, and the
-- distance closes.
--
-- REFERENCES and TRIGGER are DDL-only and equally unused; a role that can add
-- a trigger to a table can arrange for its own code to run on other people's
-- writes. They go for the same reason.
--
-- Nothing in the app loses anything: supabase-js/PostgREST use SELECT,
-- INSERT, UPDATE and DELETE, all untouched here.
--
-- The default-privileges line covers tables created LATER by the migration
-- role, so the next `create table` does not quietly re-grant them.
-- ============================================================

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
