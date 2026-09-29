#!/usr/bin/env bash
#
# Rebuild the greendogops schema into an EMPTY Supabase project.
#
# This is the disaster-recovery path and the answer to "can we stand this up
# again if we lose the database". It applies the baseline snapshot rather than
# replaying supabase/migrations/, because the migration history is not
# replayable: several data-seed migrations hard-code UUIDs that were generated
# at runtime and have since been deleted, so a from-scratch replay aborts.
#
# What this restores: structure, security (RLS, policies, grants, the event
# trigger) and configuration data. It does NOT restore operational data --
# people, schedules, attendance, patients, candidates. Those come from a
# Supabase backup restore, which is a separate mechanism.
#
# Usage:
#   scripts/rebuild_database.sh --to <empty_project_ref>
#   scripts/rebuild_database.sh --to <ref> --verify-against <ref>
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/supabase/baseline"

TARGET=""
VERIFY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TARGET="$2"; shift 2 ;;
    --verify-against) VERIFY="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TARGET" ]] || { echo "usage: $0 --to <project_ref> [--verify-against <ref>]" >&2; exit 2; }

PROD_REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$ROOT/.secrets/supabase.env" | cut -d= -f2- | tr -d '"'"'"' \r')"
if [[ "$TARGET" == "$PROD_REF" && "${ALLOW_PROD:-0}" != "1" ]]; then
  echo "REFUSING: $TARGET is production. Set ALLOW_PROD=1 only if you are certain." >&2
  exit 1
fi

# An existing greendogops schema means this is not an empty project, and the
# baseline would half-apply over the top of it.
EXISTING="$(SUPABASE_PROJECT_REF="$TARGET" "$ROOT/scripts/supabase-sql.sh" \
  -q "select count(*) n from information_schema.schemata where schema_name='greendogops';" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["n"])')"
if [[ "$EXISTING" != "0" ]]; then
  echo "REFUSING: $TARGET already has a greendogops schema." >&2
  echo "Rebuild into an empty project, or drop the schema first." >&2
  exit 1
fi

for f in 0000_prerequisites.sql 0001_schema.sql 0002_global_objects.sql 0003_config_seed.sql; do
  printf '%-34s' "$f"
  if SUPABASE_PROJECT_REF="$TARGET" "$ROOT/scripts/supabase-sql.sh" -f "$BASE/$f" >/dev/null 2>/tmp/rebuild_err.txt; then
    echo "ok"
  else
    echo "FAILED"; head -30 /tmp/rebuild_err.txt >&2; exit 1
  fi
done

echo
echo "PostgREST must expose the schema or every request 404s/406s."
SUPABASE_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$ROOT/.secrets/supabase.env" | cut -d= -f2- | tr -d '"'"'"' \r')"
curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_TOKEN" -H "Content-Type: application/json" \
  -d '{"db_schema":"public,graphql_public,greendogops","db_extra_search_path":"public, extensions","max_rows":1000}' \
  "https://api.supabase.com/v1/projects/$TARGET/postgrest" >/dev/null
echo "  exposed public,graphql_public,greendogops"

if [[ -n "$VERIFY" ]]; then
  echo
  echo "Comparing rebuilt schema against $VERIFY ..."
  python3 "$ROOT/scripts/compare_schemas.py" --a "$VERIFY" --b "$TARGET"
fi
