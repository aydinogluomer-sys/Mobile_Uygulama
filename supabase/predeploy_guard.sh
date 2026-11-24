#!/usr/bin/env bash
# Wrong-project deploy guard  (task 1D-009)
#
# Refuses any deploy that is not aimed at the canonical Supabase project.
#
# It compares strings and exits. It makes NO network call and connects to NO
# project - least of all to the denied one. "Verifying" a foreign project by
# contacting it would itself be the operation this guard exists to prevent.
#
# Fail-closed: an ABSENT ref is a failure, not a pass. A guard that fails open
# is worse than no guard, because it is trusted.
#
# Usage:  supabase/predeploy_guard.sh            # resolve the ref, then check
#         SUPABASE_PROJECT_REF=xxx  …/guard.sh   # explicit override (tests)
set -euo pipefail

CANONICAL="kbcuolhjjnmhjaarxxmu"   # Alışkanlık Uygulaması
DENIED="zdqiujpeewtyhtcqhdcj"      # Mas Technic Site - separate, unrelated

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"

die() { echo "DEPLOY BLOCKED: $*" >&2; exit 1; }

# --- resolve the ref the CLI would actually use ------------------------------
# Precedence mirrors the CLI: explicit env, then the linked-project file, then
# config.toml's project_id.
ref="${SUPABASE_PROJECT_REF:-}"

if [ -z "$ref" ] && [ -f "$here/.temp/project-ref" ]; then
  ref="$(tr -d ' \t\r\n' < "$here/.temp/project-ref")"
fi

if [ -z "$ref" ] && [ -f "$here/.temp/linked-project.json" ]; then
  ref="$(grep -oE '"(project_)?ref"[[:space:]]*:[[:space:]]*"[^"]+"' \
         "$here/.temp/linked-project.json" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"
fi

if [ -z "$ref" ] && [ -f "$here/config.toml" ]; then
  ref="$(grep -m1 -E '^[[:space:]]*project_id[[:space:]]*=' "$here/config.toml" \
         | sed -E 's/.*"([^"]*)".*/\1/')"
fi

# --- decide -------------------------------------------------------------------
[ -n "$ref" ] || die "no project ref could be resolved (env, .temp, config.toml all empty).
  Refusing to deploy against an unknown target. This is fail-closed by design."

if [ "$ref" = "$DENIED" ]; then
  die "target is $ref - Mas Technic Site.
  That is a SEPARATE, UNRELATED project. This repository must never deploy,
  migrate, or change anything there. Expected $CANONICAL."
fi

if [ "$ref" != "$CANONICAL" ]; then
  die "target is $ref, expected $CANONICAL.
  Only the canonical project may be deployed to from this repository."
fi

# A stale foreign link elsewhere in the tree is a live footgun even when the
# resolved ref is correct - report it, but do not touch it. Every
# linked-project.json is scanned (node_modules skipped); the old fixed
# backend/supabase/.temp path no longer exists (F08, BLD-23). An empty `find`
# result is normal, hence `|| true` under `set -euo pipefail`.
while IFS= read -r linked; do
  [ -n "$linked" ] || continue
  if grep -q "$DENIED" "$linked" 2>/dev/null; then
    echo "WARNING: ${linked#"$repo"/} still links to $DENIED." >&2
    echo "         Deploying from that directory would hit Mas Technic." >&2
    echo "         Retiring it is task OPS-0B-001 / Phase 2C - not this guard's job." >&2
  fi
done < <(find "$repo" -path '*/node_modules' -prune -o -name linked-project.json -print 2>/dev/null || true)

echo "deploy target OK: $ref"
