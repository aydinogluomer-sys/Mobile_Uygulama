#!/usr/bin/env bash
# 05: real concurrency against spend_focus_points_v2 and ai_request_begin (TST-07).
#
# The in-memory fakes in the jest and Deno suites run "check and set" inside one JavaScript
# turn, so they can never lose a race. The race window lives in SQL, so this script fires
# WORKERS separate psql sessions that all sleep until the same barrier instant and then run the
# same statement. It asserts deterministic invariants only (one winner, no negative balance,
# one debit, one claim), never an ordering.
#
# Output contract with run.sh: one line per result, RESULT|<name>|PASS|FAIL|INFO|<detail>.
# Each result name is declared exactly once, through report / info below.
set -euo pipefail

# SAFETY: never run against anything but a throwaway local database.
case "${PGHOST:-}" in
  127.0.0.1|localhost|::1) ;;
  *) echo "REFUSED: PGHOST must be 127.0.0.1/localhost (got '${PGHOST:-unset}'). This script writes test rows." >&2; exit 2 ;;
esac
case "${PGHOSTADDR:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *) echo "REFUSED: PGHOSTADDR must be unset or local (got '${PGHOSTADDR}')." >&2; exit 2 ;;
esac
if [ -n "${PGSERVICE:-}" ]; then
  echo "REFUSED: PGSERVICE must be unset; connection settings come only from the PG* variables." >&2
  exit 2
fi
# Second layer, identical to run.sh (this script can also be started on its own): the target must
# look like the throwaway CI database, because a local address proves nothing about what answers
# behind it (a tunnel to a hosted database, a local Supabase CLI stack). Read-only, and it runs
# before the cleanup trap and the fixture below, both of which write.
FINGERPRINT_SQL="SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND a.attname = 'encrypted_password' AND NOT a.attisdropped) AND current_setting('is_superuser') = 'on'"
if ! fingerprint="$(psql -X -q -At -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL" 2>&1)"; then
  echo "HARNESS ERROR: the database could not be queried (is it reachable?): $fingerprint" >&2
  exit 3
fi
if [ "$fingerprint" != "t" ]; then
  echo "REFUSED: the target does not look like the throwaway CI database (auth.users must lack encrypted_password and the user must be a superuser). Point the PG* variables at a database bootstrapped like the db-migrations-verify job." >&2
  exit 2
fi

PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
WORKERS=8
# The barrier keeps every session's connect and SET ROLE cost outside the race window. If a slow
# runner needs more than 3 seconds, raise this (5 is the documented next step) instead of retrying
# a flaky test.
BARRIER_SECONDS="${RACE_BARRIER_SECONDS:-3}"
case "$BARRIER_SECONDS" in ''|*[!0-9]*) echo "RACE_BARRIER_SECONDS must be a whole number of seconds" >&2; exit 2 ;; esac

UA='a5000000-0000-4000-8000-00000000000a'   # spend race (balance 25, cost 25)
UB='a5000000-0000-4000-8000-00000000000b'   # same request id claim
UC='a5000000-0000-4000-8000-00000000000c'   # same request id spend replay
UD='a5000000-0000-4000-8000-00000000000d'   # cold start (no subscription row)

sql() { "${PSQL[@]}" -c "$1"; }
# report <name> <1|0> <detail>: the only way a PASS or FAIL leaves this script
report() {
  local verdict=FAIL
  [ "$2" = 1 ] && verdict=PASS
  echo "RESULT|$1|$verdict|${3//|//}"
}
# info <name> <detail>: an observation, never a verdict
info() { echo "RESULT|$1|INFO|${2//|//}"; }

out="$(mktemp -d)"
cleanup() {
  # best effort on a throwaway database: remove everything this script created
  for u in "$UA" "$UB" "$UC" "$UD"; do
    sql "DELETE FROM public.credit_transactions WHERE user_id = '$u'; DELETE FROM public.ai_requests WHERE user_id = '$u'; DELETE FROM public.user_subscriptions WHERE user_id = '$u'; DELETE FROM auth.users WHERE id = '$u'" >/dev/null 2>&1 || true
  done
  rm -rf "$out"
}
trap cleanup EXIT

# fixture (superuser, committed; throwaway database). Idempotent. No profile and no habit_logs
# rows are created, so nothing here can make xp_drift() non-empty for 03.
for u in "$UA" "$UB" "$UC" "$UD"; do
  sql "INSERT INTO auth.users (id, email) VALUES ('$u', '$u@aderyth.test') ON CONFLICT (id) DO NOTHING"
  sql "DELETE FROM public.credit_transactions WHERE user_id = '$u'; DELETE FROM public.ai_requests WHERE user_id = '$u'; DELETE FROM public.user_subscriptions WHERE user_id = '$u'"
done
sql "INSERT INTO public.user_subscriptions (user_id, focus_points, monthly_grant, credits_period_end) VALUES ('$UA', 25, 30, now() + interval '1 month'), ('$UC', 25, 30, now() + interval '1 month')"

# run_workers <name> <statement>: WORKERS sessions sleep until one barrier timestamp, then run the
# statement (__I__ is replaced by the worker number). Each worker leaves its last output line in
# res.<name>.<i>, or ERR when its session failed.
run_workers() {
  local name="$1" stmt="$2" barrier i
  barrier="$("${PSQL[@]}" -c "SELECT (clock_timestamp() + interval '$BARRIER_SECONDS seconds')::text")"
  for i in $(seq 1 "$WORKERS"); do
    (
      body="${stmt//__I__/$i}"
      printf 'SET ROLE service_role;\nSELECT pg_sleep(greatest(0, extract(epoch FROM (%s::timestamptz - clock_timestamp()))));\n%s\n' "'$barrier'" "$body" \
        | "${PSQL[@]}" 2>"$out/err.$name.$i" | sed '/^$/d' | tail -n 1 >"$out/res.$name.$i" \
        || echo ERR >"$out/res.$name.$i"
      [ -s "$out/res.$name.$i" ] || echo ERR >"$out/res.$name.$i"
    ) &
  done
  wait
}
# count <name> <value>: how many workers printed exactly <value>
count() {
  local n
  n="$(cat "$out"/res."$1".* 2>/dev/null | grep -cxF -- "$2" || true)"
  echo "${n:-0}"
}
# first_error <name>: the first server error text of a run, '|' and newlines flattened
first_error() { cat "$out"/err."$1".* 2>/dev/null | grep -m1 'ERROR' | tr '|\n' '/ ' || true; }

# A) spend race: balance 25, 8 sessions each try to spend 25 with a DIFFERENT request id -> exactly one winner
run_workers A "SELECT ok FROM public.spend_focus_points_v2('$UA'::uuid, 25, 'concurrency', 'req-A-__I__');"
winA="$(count A t)"; errA="$(count A ERR)"
balA="$(sql "SELECT focus_points FROM public.user_subscriptions WHERE user_id = '$UA'")"
debA="$(sql "SELECT count(*) FROM public.credit_transactions WHERE user_id = '$UA' AND delta < 0")"
minA="$(sql "SELECT coalesce(min(balance_after), 0) FROM public.credit_transactions WHERE user_id = '$UA'")"
ok=0; if [ "$winA" = 1 ] && [ "$errA" = 0 ]; then ok=1; fi
report T05a_spend_race_single_winner "$ok" "winners=$winA errors=$errA"
ok=0; if [ "$balA" = 0 ] && [ "$debA" = 1 ] && [ "$minA" -ge 0 ]; then ok=1; fi
report T05b_spend_race_balance_never_negative "$ok" "balance=$balA debits=$debA min_balance_after=$minA"

# B) same request id begin: exactly one claimed, the rest in_progress, one ai_requests row
run_workers B "SELECT outcome FROM public.ai_request_begin('$UB'::uuid, 'req-B-same', 'coach', 'fp-1');"
clB="$(count B claimed)"; ipB="$(count B in_progress)"; errB="$(count B ERR)"
rowsB="$(sql "SELECT count(*) FROM public.ai_requests WHERE user_id = '$UB' AND request_id = 'req-B-same'")"
ok=0; if [ "$clB" = 1 ] && [ "$ipB" = $((WORKERS - 1)) ] && [ "$errB" = 0 ] && [ "$rowsB" = 1 ]; then ok=1; fi
report T05c_ai_request_begin_single_claim "$ok" "claimed=$clB in_progress=$ipB errors=$errB rows=$rowsB"

# C) same request id spend: one debit, the rest replayed
# ok::int and replayed::int print 1/0 (a boolean cast to text would print true/false, not t/f)
run_workers C "SELECT ok::int || ':' || replayed::int FROM public.spend_focus_points_v2('$UC'::uuid, 5, 'concurrency', 'req-C-same');"
newC="$(count C 1:0)"; repC="$(count C 1:1)"; errC="$(count C ERR)"
debC="$(sql "SELECT count(*) FROM public.credit_transactions WHERE user_id = '$UC' AND delta < 0 AND request_id = 'req-C-same'")"
balC="$(sql "SELECT focus_points FROM public.user_subscriptions WHERE user_id = '$UC'")"
ok=0; if [ "$newC" = 1 ] && [ "$repC" = $((WORKERS - 1)) ] && [ "$errC" = 0 ] && [ "$debC" = 1 ] && [ "$balC" = 20 ]; then ok=1; fi
report T05d_spend_same_request_single_debit "$ok" "new=$newC replayed=$repC errors=$errC debits=$debC balance=$balC"

# D) cold start (no subscription row): invariants only; unique_violation errors are OBSERVED, not asserted
run_workers D "SELECT ok FROM public.spend_focus_points_v2('$UD'::uuid, 5, 'concurrency', 'req-D-__I__');"
okD="$(count D t)"; errD="$(count D ERR)"
balD="$(sql "SELECT coalesce((SELECT focus_points FROM public.user_subscriptions WHERE user_id = '$UD'), -1)")"
debD="$(sql "SELECT coalesce(-sum(delta), 0) FROM public.credit_transactions WHERE user_id = '$UD' AND delta < 0")"
ok=0; if [ "$balD" -ge 0 ] && [ "$debD" = $((okD * 5)) ] && [ $((balD + debD)) -le 30 ]; then ok=1; fi
report T05e_cold_start_invariants "$ok" "successes=$okD debited=$debD balance=$balD"
info T05f_cold_start_errors_observed "worker_errors=$errD first_error=$(first_error D) (get_or_init_subscription_for inserts without ON CONFLICT)"
