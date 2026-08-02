# Audit Supabase Security

**Purpose:** Verify a Supabase project's real security posture from the live catalogue, not from migrations.

**Status:** `Created` - not yet validated on a task

## When to use
Any audit touching RLS, RPCs, grants or edge functions.

## When NOT to use
Never against a project outside the engagement's declared scope.

## Inputs
Project ref - read-only SQL access.

## Outputs
Per-table RLS state, per-function privilege state, constraint verification, advisor lints.

## Steps
1. Confirm project status FIRST. A paused or restoring project returns misleading empties - an empty table list may mean "starting up", not "empty". Verify with a direct query.
2. Read `pg_tables.rowsecurity` for every table.
3. Count `pg_policies` per table. **RLS enabled with zero policies is fail-closed and safe; a permissive policy is the risk.**
4. Inspect `qual = 'true'` policies. `USING(true)` on SELECT for a shared catalogue is legitimate; on INSERT/UPDATE it is not.
5. From `pg_proc` read `prosecdef`, `proconfig`, `proacl`, plus `has_function_privilege` for `anon`, `authenticated`, `service_role`, `postgres`.
6. **Flag every SECURITY DEFINER function taking a user id parameter with no `auth.uid()` check.**
7. Check table-level AND column-level grants. RLS restricts rows; grants restrict columns. Both are required.
8. Run the security and performance advisors.
9. Verify each composite unique constraint the client depends on.

## Prohibitions
- **Never invoke a privileged function to test it.** Use privilege introspection.
- Never run a write during an audit.
- Never trust migrations as a description of the live schema.
- Never conclude "RLS is on, therefore safe" - check policies, table grants and column grants.
- **Never operate on an out-of-scope project.**

## Quality criteria
Every claim is a query result. Pre-change state captured verbatim before any change.

## Validation
`select tablename, rowsecurity from pg_tables where schemaname='public';`
`select proname, proacl, prosecdef, proconfig from pg_proc join pg_namespace ...;`
`select * from information_schema.column_privileges where table_name = ...;`

## Definition of done
Every table's RLS documented; every SECURITY DEFINER function's grants captured; advisors run; unverifiable items marked `UNVERIFIED`.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
