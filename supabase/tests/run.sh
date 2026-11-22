#!/usr/bin/env bash
# Behavioural SQL gate (F01).
#
# Runs every supabase/tests/NN_<name>.sql and NN_<name>.sh against a THROWAWAY local
# Postgres and reconciles the outcome with expected_failures.txt in BOTH directions:
# a red test that is not listed fails the run, and a listed test that has turned green
# fails the run too (the list can only shrink when a hole is really closed).
#
# Usage (CI sets the PG* variables at job level; locally point them at a throwaway
# database ONLY, this runner creates a schema and inserts rows):
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=<throwaway-db-password> \
#   PGDATABASE=<throwaway-db-name> bash supabase/tests/run.sh
#
# Never aim `supabase test db` (the Supabase CLI's pgTAP runner, which reads supabase/tests/
# by convention; `--linked` would point it at the linked project) at this directory. These
# files are not pgTAP, and 01 and 05 write committed rows. They run only through this script.
#
# Exit codes
#   0  the FAIL set equals the expected_failures.txt set and the result stream is sound
#   1  UNEXPECTED FAILURES (red and not listed) or STALE expected_failures.txt entries
#   2  REFUSED: the connection is not a local, throwaway, CI-shaped database
#   3  HARNESS ERROR: a test file aborted (fixture, trigger or syntax error). That is a
#      finding, never a pass: the fixture is not loosened and no trigger is disabled
#   4  the result stream is unusable (too few, unparseable, duplicated or missing results)
#
# Nothing here ever connects to a Supabase project. There is no supabase CLI call.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- safety first: nothing below runs unless the target is local ---------------------
case "${PGHOST:-}" in
  127.0.0.1|localhost|::1) ;;
  *) echo "REFUSED: PGHOST must be local (got '${PGHOST:-unset}'). SQL tests never touch a remote project." >&2; exit 2 ;;
esac
# libpq lets PGHOSTADDR and a service entry override the host checked above.
case "${PGHOSTADDR:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *) echo "REFUSED: PGHOSTADDR must be unset or local (got '${PGHOSTADDR}')." >&2; exit 2 ;;
esac
if [ -n "${PGSERVICE:-}" ]; then
  echo "REFUSED: PGSERVICE must be unset; connection settings come only from PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE." >&2
  exit 2
fi

# --- second safety layer: the target must LOOK like the throwaway CI database ---------
# A local address proves nothing about what answers behind it (an SSH or pooler tunnel to a
# hosted database, a local Supabase CLI stack). The CI bootstrap stubs auth.users WITHOUT the
# encrypted_password column that GoTrue always creates, and the throwaway database user is a
# superuser, which a hosted Supabase project never hands out. One read-only catalog query,
# run before anything is written and before the cleanup trap below exists (the trap writes).
FINGERPRINT_SQL="SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND a.attname = 'encrypted_password' AND NOT a.attisdropped) AND current_setting('is_superuser') = 'on'"
if ! fingerprint="$(psql -X -q -At -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL" 2>&1)"; then
  echo "HARNESS ERROR: the database could not be queried (is it reachable?): $fingerprint" >&2
  exit 3
fi
if [ "$fingerprint" != "t" ]; then
  echo "REFUSED: the target does not look like the throwaway CI database (auth.users must lack encrypted_password and the user must be a superuser). Point the PG* variables at a database bootstrapped like the db-migrations-verify job." >&2
  exit 2
fi

MIN_RESULTS=220  # sanity floor: a run that emits almost nothing is a broken harness, not a pass (01..12 emit ~264)

work="$(mktemp -d)"
results="$work/results"; : >"$results"
cleanup() {
  # Best effort on a throwaway database: remove the helper schema again (the whole rollback).
  psql -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS aderyth_test CASCADE" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# --- 1) helper schema ----------------------------------------------------------------
# Inline on purpose: the phase ships no separate helper .sql file. Four functions:
#   res            prints one machine-readable line, RESULT|<name>|PASS|FAIL|<detail>
#   expect_denied  the statement must raise 42501 (privilege denied OR a row-level-security
#                  WITH CHECK violation: both mean "the client cannot write"). A statement
#                  that RUNS is a FAIL, even if RLS hid every row, because the privilege is
#                  still open. With p_message the error text must match too, so a call that
#                  is refused for ANOTHER reason (a different 42501) cannot pass for the
#                  one under test.
#   expect_no_effect  for writes that only row-level security keeps harmless (the table
#                  privilege is still granted): 42501 or "ran and touched 0 rows" passes, a
#                  statement that changes a row fails. Pair it with a positive control that
#                  proves the targeted row exists and is visible, or 0 rows proves nothing.
#   expect_allowed positive control: the statement must run and touch >= p_min_rows rows,
#                  so a control cannot pass because RLS hid the fixture.
if ! psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SET client_min_messages = warning;
DROP SCHEMA IF EXISTS aderyth_test CASCADE;
CREATE SCHEMA aderyth_test;
GRANT USAGE ON SCHEMA aderyth_test TO PUBLIC;

CREATE FUNCTION aderyth_test.res(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE NOTICE 'RESULT|%|%|%', p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END,
    left(replace(replace(coalesce(p_detail, ''), E'\n', ' '), '|', '/'), 1500);
END $f$;

-- SECURITY INVOKER: the privileges checked are those of the CURRENT role (authenticated / anon).
CREATE FUNCTION aderyth_test.expect_denied(p_name text, p_sql text, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM aderyth_test.res(p_name, false, format('statement ran (rows=%s); SQLSTATE 42501 expected', n));
EXCEPTION
  WHEN insufficient_privilege THEN
    IF p_message IS NULL OR SQLERRM = p_message THEN
      PERFORM aderyth_test.res(p_name, true, '42501');
    ELSE
      PERFORM aderyth_test.res(p_name, false, format('42501 for another reason: %s', SQLERRM));
    END IF;
  WHEN OTHERS THEN PERFORM aderyth_test.res(p_name, false, format('unexpected %s: %s', SQLSTATE, SQLERRM));
END $f$;

CREATE FUNCTION aderyth_test.expect_no_effect(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM aderyth_test.res(p_name, true, 'rows=0');
  ELSE
    PERFORM aderyth_test.res(p_name, false, format('statement changed %s row(s); none expected', n));
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM aderyth_test.res(p_name, true, '42501');
  WHEN OTHERS THEN PERFORM aderyth_test.res(p_name, false, format('unexpected %s: %s', SQLSTATE, SQLERRM));
END $f$;

CREATE FUNCTION aderyth_test.expect_allowed(p_name text, p_sql text, p_min_rows bigint DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n < p_min_rows THEN
    PERFORM aderyth_test.res(p_name, false, format('control ran but touched %s row(s), expected at least %s (row-level security may be hiding the fixture)', n, p_min_rows));
  ELSE
    PERFORM aderyth_test.res(p_name, true, format('rows=%s', n));
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM aderyth_test.res(p_name, false, format('control failed %s: %s', SQLSTATE, SQLERRM));
END $f$;

CREATE FUNCTION aderyth_test.expect_error(p_name text, p_sql text, p_sqlstate text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  PERFORM aderyth_test.res(p_name, false, 'statement ran; SQLSTATE ' || p_sqlstate || ' expected');
EXCEPTION WHEN OTHERS THEN
  PERFORM aderyth_test.res(p_name, SQLSTATE = p_sqlstate, format('got %s: %s', SQLSTATE, SQLERRM));
END $f$;
SQL
then
  echo "HARNESS ERROR: could not install the aderyth_test helper schema (is the database reachable and bootstrapped?)" >&2
  exit 3
fi

# --- 2) test files, in numeric order -------------------------------------------------
# A file that does not follow NN_<name>.sql|sh would silently never run: refuse it.
shopt -s nullglob
for f in "$here"/*.sql "$here"/*.sh; do
  case "$(basename "$f")" in
    run.sh|[0-9][0-9]_*.sql|[0-9][0-9]_*.sh) ;;
    *) echo "HARNESS ERROR: $(basename "$f") does not follow the NN_<name>.sql|sh convention and would never run" >&2; exit 3 ;;
  esac
done

for f in "$here"/[0-9][0-9]_*; do
  name="$(basename "$f")"
  log="$work/$name.log"
  echo "== $name"
  case "$name" in
    *.sql)
      # psql prints server NOTICEs (our RESULT lines) on stderr; query output goes to /dev/null
      # (so -q, which only hides command tags, is not needed and nothing can hide a NOTICE).
      # The exit status is read directly: psql exits 3 on a SQL error under ON_ERROR_STOP.
      if ! psql -X -o /dev/null -v ON_ERROR_STOP=1 -f "$f" >"$log" 2>&1; then
        grep -vE 'RESULT\|' "$log" >&2 || true
        echo "HARNESS ERROR in $name" >&2
        exit 3
      fi
      ;;
    *.sh)
      if ! bash "$f" >"$log" 2>&1; then
        grep -vE 'RESULT\|' "$log" >&2 || true
        echo "HARNESS ERROR in $name" >&2
        exit 3
      fi
      ;;
    *) echo "HARNESS ERROR: $name is not a .sql or .sh test" >&2; exit 3 ;;
  esac
  grep -E 'RESULT\|' "$log" >>"$results" || true
done

# --- 3) reconcile --------------------------------------------------------------------
parsed="$work/parsed"; fails="$work/fails"; expected="$work/expected"
raw_count="$(grep -cE 'RESULT\|' "$results" || true)"
sed -nE 's/.*RESULT\|([A-Za-z0-9_./-]+)\|(PASS|FAIL|INFO)\|(.*)$/\1 \2 \3/p' "$results" | sort >"$parsed"
total="$(wc -l <"$parsed" | tr -d '[:space:]')"

if [ "$total" != "$raw_count" ]; then
  echo "UNPARSEABLE RESULT LINES ($raw_count emitted, $total parsed):" >&2
  grep -E 'RESULT\|' "$results" | grep -vE 'RESULT\|[A-Za-z0-9_./-]+\|(PASS|FAIL|INFO)\|' >&2 || true
  exit 4
fi
if [ "$total" -lt "$MIN_RESULTS" ]; then
  echo "TOO FEW RESULTS ($total < $MIN_RESULTS)" >&2
  exit 4
fi

# lines of $2 that are not in $1 (exact string match: no sort, no locale, no comm)
only_in_second() { awk 'FILENAME == ARGV[1] { seen[$0] = 1; next } !($0 in seen)' "$1" "$2"; }

awk '{ print $1 }' "$parsed" | sort >"$work/names"
dupes="$(uniq -d <"$work/names")"
if [ -n "$dupes" ]; then
  echo "DUPLICATE RESULT NAMES (a name must be reported once, otherwise the reconciliation is ambiguous):" >&2
  echo "$dupes" >&2
  exit 4
fi

# Every statically declared test name must really have reported. Names that carry a dot are
# dynamic families (T02a / T02b: one result per function) and are checked by the family check
# below. This catches a test that silently stopped reporting, e.g. a SELECT over zero rows.
# The SQL files are flattened to one line first, so a call split over several lines
# (`res(` newline `'T04z_x'`) is still seen: the jest guard reads the files the same way.
declared="$work/declared"
{
  for f in "$here"/[0-9][0-9]_*.sql; do tr '\r\n' '  ' <"$f"; echo; done \
    | grep -oE "(res|expect_denied|expect_allowed|expect_no_effect|expect_error)\([[:space:]]*'T[0-9]{2}[A-Za-z0-9_]*'" \
    | sed -E "s/.*'(T[0-9]{2}[A-Za-z0-9_]*)'$/\1/" || true
  grep -hoE '^[[:space:]]*(report|info)[[:space:]]+T[0-9]{2}[A-Za-z0-9_]*' /dev/null "$here"/[0-9][0-9]_*.sh \
    | sed -E 's/.*[[:space:]](T[0-9]{2}[A-Za-z0-9_]*)$/\1/' || true
} | sort -u >"$declared"
missing="$(only_in_second "$work/names" "$declared")"
if [ -n "$missing" ]; then
  echo "MISSING RESULTS (declared in a test file but never reported):" >&2
  echo "$missing" >&2
  exit 4
fi

# The two dynamic families (one result per function: T02a_anon_execute.<fn>/<n> and
# T02b_search_path.<fn>/<n>) carry a dot, so the check above cannot see them. Each family
# reports at least one line whenever its DO block runs (a failure per function, or `.all`
# when clean), so a family that is absent means its test was deleted or broke silently.
for family in T02a_anon_execute. T02b_search_path.; do
  if ! awk -v p="$family" 'index($1, p) == 1 { found = 1 } END { exit found ? 0 : 1 }' "$parsed"; then
    echo "MISSING RESULT FAMILY: no ${family}* result was reported (02_security_definer_hygiene.sql lost a dynamic block)" >&2
    exit 4
  fi
done

awk '$2 == "FAIL" { print $1 }' "$parsed" | sort -u >"$fails"
# strip comments, blank lines, CR and surrounding blanks from the expected list (the jest
# guard trims each line the same way, so an indented entry means the same to both)
tr -d '\r' <"$here/expected_failures.txt" \
  | grep -vE '^[[:space:]]*(#|$)' \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]*#.*$//; s/[[:space:]]+$//' \
  | sort -u >"$expected" || true
if grep -qvE '^[A-Za-z0-9_./-]+$' "$expected"; then
  echo "MALFORMED expected_failures.txt entries (one test name per line, then an optional # comment):" >&2
  grep -vE '^[A-Za-z0-9_./-]+$' "$expected" >&2
  exit 4
fi

unexpected="$(only_in_second "$expected" "$fails")"   # red and not listed: a real failure
stale="$(only_in_second "$fails" "$expected")"        # listed but green or absent: delete the line

# long details (the two bootstrap payloads) are shortened for the log only; the full text was parsed above
awk '{ line = "  " $0; if (length(line) > 240) line = substr(line, 1, 237) "..."; print line }' "$parsed"
pass_n="$(awk '$2 == "PASS"' "$parsed" | wc -l | tr -d '[:space:]')"
fail_n="$(awk '$2 == "FAIL"' "$parsed" | wc -l | tr -d '[:space:]')"
info_n="$(awk '$2 == "INFO"' "$parsed" | wc -l | tr -d '[:space:]')"
exp_n="$(wc -l <"$expected" | tr -d '[:space:]')"
echo "SUMMARY: results=$total pass=$pass_n fail=$fail_n info=$info_n expected_failures=$exp_n"

status=0
if [ -n "$unexpected" ]; then
  echo "UNEXPECTED FAILURES:" >&2
  echo "$unexpected" >&2
  status=1
fi
if [ -n "$stale" ]; then
  echo "STALE expected_failures.txt entries (now green or missing; delete the line):" >&2
  echo "$stale" >&2
  status=1
fi
if [ "$status" = 0 ]; then
  echo "OK: the failing set equals expected_failures.txt"
fi
exit "$status"
