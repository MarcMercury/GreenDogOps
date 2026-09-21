#!/usr/bin/env bash
#
# Run SQL against the Supabase project via the Management API.
# The dashboard SQL Editor uses this same endpoint.
#
# Credentials are read from .secrets/supabase.env (gitignored), so the access
# token never lives in the repo or in source code.
#
# Usage:
#   scripts/supabase-sql.sh -f supabase/migrations/0001_init_schema.sql
#   scripts/supabase-sql.sh -q "select now();"
#   echo "select 1;" | scripts/supabase-sql.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.secrets/supabase.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "Create it from .secrets/supabase.env.example and add your token." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in .secrets/supabase.env}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF in .secrets/supabase.env}"

# Keep the SQL in a FILE the whole way through. Reading a large migration into
# a bash variable ("$(cat …)") is quadratic and stalls for minutes on the
# multi-hundred-KB bulk-import files.
BODY_TMP="$(mktemp)"
SQL_TMP=""
trap 'rm -f "$BODY_TMP" ${SQL_TMP:+"$SQL_TMP"}' EXIT

case "${1:-}" in
  -f) SQL_FILE="$2" ;;
  -q) SQL_TMP="$(mktemp)"; printf '%s' "$2" > "$SQL_TMP"; SQL_FILE="$SQL_TMP" ;;
  "") SQL_TMP="$(mktemp)"; cat > "$SQL_TMP"; SQL_FILE="$SQL_TMP" ;;  # stdin
  *)  echo "Usage: $0 [-f file.sql | -q \"SQL\"] (or pipe SQL via stdin)" >&2; exit 2 ;;
esac

if [[ ! -s "$SQL_FILE" ]] || ! grep -q '[^[:space:]]' "$SQL_FILE"; then
  echo "ERROR: no SQL provided." >&2
  exit 2
fi

# Build the JSON body with python (handles escaping/newlines) straight from the
# file, so the SQL never passes through the shell or the argument list.
python3 -c 'import json,sys; open(sys.argv[2],"w").write(json.dumps({"query":open(sys.argv[1]).read()}))' "$SQL_FILE" "$BODY_TMP"

HTTP_RESPONSE="$(curl -sS -w $'\n%{http_code}' \
  -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${BODY_TMP}")"

STATUS="$(printf '%s' "$HTTP_RESPONSE" | tail -n1)"
PAYLOAD="$(printf '%s' "$HTTP_RESPONSE" | sed '$d')"

if [[ "$STATUS" -lt 200 || "$STATUS" -ge 300 ]]; then
  echo "ERROR: Supabase API returned HTTP $STATUS" >&2
  echo "$PAYLOAD" >&2
  exit 1
fi

# Pretty-print JSON result if possible.
printf '%s' "$PAYLOAD" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$PAYLOAD"
