#!/usr/bin/env bash
# Shared Supabase connection helpers. Source this; do not execute it.
#
# The pooler hostname is NOT predictable from the project's region. Two projects
# both in us-east-2 sit behind aws-0- and aws-1- respectively, so hardcoding a
# prefix works until it silently does not ("FATAL: tenant/user ... not found").
# Always ask the Management API.

# resolve_pooler_host <project_ref> [access_token]
# Prints the pooler hostname for a project. Honours a POOLER_HOST override.
resolve_pooler_host() {
  local ref="$1" token="${2:-${SUPABASE_ACCESS_TOKEN:-}}"

  if [[ -n "${POOLER_HOST:-}" ]]; then
    printf '%s' "$POOLER_HOST"
    return 0
  fi

  # CI has the database password but no Management API token, so callers there
  # pass POOLER_HOST. Locally the token usually lives in the secrets file.
  if [[ -z "$token" ]]; then
    local env_file
    env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.secrets/supabase.env"
    if [[ -f "$env_file" ]]; then
      token="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$env_file" | cut -d= -f2- | tr -d '"'"'"' \r')"
    fi
  fi
  if [[ -z "$token" ]]; then
    echo "resolve_pooler_host: no SUPABASE_ACCESS_TOKEN; set POOLER_HOST instead." >&2
    return 1
  fi

  local host
  host="$(curl -fsS -H "Authorization: Bearer $token" \
    "https://api.supabase.com/v1/projects/${ref}/config/database/pooler" \
    | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else [d]
for r in rows:
    if r.get("database_type") == "PRIMARY" and r.get("db_host"):
        print(r["db_host"]); break
else:
    sys.exit(1)
' 2>/dev/null)" || {
    echo "resolve_pooler_host: could not resolve pooler host for $ref." >&2
    return 1
  }

  printf '%s' "$host"
}

# pooler_uri <project_ref> [port]
# Session mode (5432) by default: transaction mode (6543) cannot run pg_dump.
pooler_uri() {
  local ref="$1" port="${2:-5432}" host
  host="$(resolve_pooler_host "$ref")" || return 1
  printf 'postgresql://postgres.%s@%s:%s/postgres?sslmode=require' "$ref" "$host" "$port"
}
