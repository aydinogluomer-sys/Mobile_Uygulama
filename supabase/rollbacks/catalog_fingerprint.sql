-- Deterministic fingerprint of the PUBLIC schema catalog. Read-only.
-- Usage: psql -X -At -v ON_ERROR_STOP=1 -f supabase/rollbacks/catalog_fingerprint.sql
--
-- One line per catalog fact, sorted with the C collation so the output does not depend on the
-- server locale. CI prints it for the baseline (live_schema.sql only), for the forward state
-- (028 and later) and again after rolling back, and compares the files with diff -u.
SELECT line FROM (
  -- tables: RLS flags + table ACL
  SELECT 'T|' || c.relname || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
         || '|acl=' || coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(coalesce(c.relacl, acldefault('r', c.relowner))) x), '') AS line
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  -- columns
  SELECT 'C|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable
         || '|' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  -- ACLs are sorted before printing: GRANT order must not change the fingerprint.
  -- A NULL relacl/proacl (never touched) is expanded with acldefault(): an object that was
  -- REVOKEd and then GRANTed back stores an explicit default ACL, and must print the same
  -- line as the untouched baseline object (QA fix: without this the rollback diff is red).
  -- column-level ACL (the column-level INSERT grant on profiles)
  SELECT 'A|' || c.relname || '|' || a.attname || '|' || (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(a.attacl) x)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped
  UNION ALL
  -- constraints (pg_get_constraintdef prints NOT VALID, so an unvalidated CHECK differs)
  SELECT 'K|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'I|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'P|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text
         || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  -- triggers on public tables (internal RI triggers excluded)
  SELECT 'G|' || t.tgrelid::regclass::text || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  UNION ALL
  -- functions: signature, definer flag, pinned config, ACL, body hash
  SELECT 'F|' || p.oid::regprocedure::text || '|secdef=' || p.prosecdef
         || '|cfg=' || coalesce(p.proconfig::text, '') || '|acl=' || coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x), '')
         || '|md5=' || md5(p.prosrc)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
) q
ORDER BY line COLLATE "C";
