#!/usr/bin/env bash
# 10: real concurrency against spend_willpower (F14 / 042; REP-09, STO-15).
#
# Fires WORKERS concurrent psql sessions sleeping until a shared barrier timestamp, then
# running spend_willpower under SET ROLE authenticated + request.jwt.claim.sub:
#   A) strict spend race (budget 15, cost 8 -> single winner, 7 refused, used = 8)
#   B) clamp spend race (budget 15, cost 3, 8 workers -> 0 errors, used = 15, active_count = 8)
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
# Second layer, identical to run.sh and 05_concurrency_spend.sh: verify throwaway CI catalog
# BEFORE the cleanup trap and fixture writes.
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
BARRIER_SECONDS="${RACE_BARRIER_SECONDS:-3}"
case "$BARRIER_SECONDS" in ''|*[!0-9]*) echo "RACE_BARRIER_SECONDS must be a whole number of seconds" >&2; exit 2 ;; esac

UA='a6000000-0000-4000-8000-0000000000c1'   # strict spend race: budget 15, cost 8
UB='a6000000-0000-4000-8000-0000000000c2'   # clamp race: budget 15, cost 3, eight workers

sql() { "${PSQL[@]}" -c "$1"; }
report() {
  local verdict=FAIL
  [ "$2" = 1 ] && verdict=PASS
  echo "RESULT|$1|$verdict|${3//|//}"
}

out="$(mktemp -d)"
cleanup() {
  for u in "$UA" "$UB"; do
    sql "DELETE FROM public.willpower_state WHERE user_id = '$u'; DELETE FROM auth.users WHERE id = '$u'" >/dev/null 2>&1 || true
  done
  rm -rf "$out"
}
trap cleanup EXIT

for u in "$UA" "$UB"; do
  sql "INSERT INTO auth.users (id, email) VALUES ('$u', '$u@aderyth.test') ON CONFLICT (id) DO NOTHING"
  sql "DELETE FROM public.willpower_state WHERE user_id = '$u'"
done

run_workers() {
  local name="$1" uid="$2" stmt="$3" barrier i
  barrier="$("${PSQL[@]}" -c "SELECT (clock_timestamp() + interval '$BARRIER_SECONDS seconds')::text")"
  for i in $(seq 1 "$WORKERS"); do
    (
      printf "SET ROLE authenticated;\nSELECT set_config('request.jwt.claim.sub', '%s', false);\nSELECT set_config('request.jwt.claim.role', 'authenticated', false);\nSELECT pg_sleep(greatest(0, extract(epoch FROM (%s::timestamptz - clock_timestamp()))));\n%s\n" "$uid" "'$barrier'" "$stmt" \
        | "${PSQL[@]}" 2>"$out/err.$name.$i" | sed '/^$/d' | tail -n 1 >"$out/res.$name.$i" \
        || echo ERR >"$out/res.$name.$i"
      [ -s "$out/res.$name.$i" ] || echo ERR >"$out/res.$name.$i"
    ) &
  done
  wait
}

count() {
  local n
  n="$(cat "$out"/res."$1".* 2>/dev/null | grep -cxF -- "$2" || true)"
  echo "${n:-0}"
}

# A) strict: 8 workers each spend 8 of a 15 budget -> exactly one winner, used = 8, the other seven refused
run_workers A "$UA" "SELECT used FROM public.spend_willpower(current_date, 8);"
winA="$(count A 8)"; errA="$(count A ERR)"
usedA="$(sql "SELECT used FROM public.willpower_state WHERE user_id = '$UA' AND state_date = current_date")"
ok=0; if [ "$winA" = 1 ] && [ "$errA" = $((WORKERS - 1)) ] && [ "$usedA" = 8 ]; then ok=1; fi
report T10x_strict_spend_single_winner "$ok" "winners=$winA refused=$errA used=$usedA"

# B) clamp: 8 workers each record 3 with clamp -> used never exceeds the budget, no worker errors
run_workers B "$UB" "SELECT used FROM public.spend_willpower(current_date, 3, 1, true);"
errB="$(count B ERR)"
usedB="$(sql "SELECT used FROM public.willpower_state WHERE user_id = '$UB' AND state_date = current_date")"
actB="$(sql "SELECT active_count FROM public.willpower_state WHERE user_id = '$UB' AND state_date = current_date")"
ok=0; if [ "$errB" = 0 ] && [ "$usedB" = 15 ] && [ "$actB" = "$WORKERS" ]; then ok=1; fi
report T10y_clamp_spend_never_exceeds_budget "$ok" "used=$usedB active=$actB errors=$errB"
