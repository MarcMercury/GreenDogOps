#!/usr/bin/env bash
#
# Prove supabase/baseline/* still builds a complete database.
#
# Runs against a throwaway PostgreSQL container, so it needs no Supabase
# credentials, no network access and no money. That matters: a check that costs
# something is a check that eventually gets switched off.
#
# It catches the failure mode that actually bites -- a baseline that looks fine
# in a diff but no longer applies, or that quietly lost objects when it was
# regenerated. The counts are taken from the SQL files themselves and compared
# with what really landed in the database, so the test needs no hardcoded
# expectations to drift out of date.
#
# Usage:
#   scripts/verify_baseline.sh                      # manages its own container
#   PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... scripts/verify_baseline.sh --no-docker
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/supabase/baseline"
CONTAINER="gdo-baseline-verify-$$"
USE_DOCKER=1
[[ "${1:-}" == "--no-docker" ]] && USE_DOCKER=0

if [[ "$USE_DOCKER" == "1" ]]; then
  export PGHOST=localhost PGPORT=55433 PGUSER=postgres PGPASSWORD=verify PGDATABASE=postgres
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=verify \
    -p "${PGPORT}:5432" postgres:17 >/dev/null
  cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 2
  done
fi

PSQL=(psql -v ON_ERROR_STOP=1 -q)

# Supabase provides these; a bare Postgres does not. They are stubs purely so
# the DDL resolves -- this verifies structure, not authentication behaviour.
"${PSQL[@]}" <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create extension if not exists pgcrypto;
SQL
echo "prerequisites created"

for f in 0000_prerequisites.sql 0001_schema.sql 0002_global_objects.sql 0003_config_seed.sql; do
  printf '%-34s' "$f"
  if "${PSQL[@]}" -f "$BASE/$f" >/dev/null 2>/tmp/verify_err.txt; then
    echo "applied"
  else
    echo "FAILED"
    head -5 /tmp/verify_err.txt >&2
    exit 1
  fi
done

# Expected counts come from the SQL itself, so regenerating the baseline never
# leaves a stale hardcoded number behind.
expect_tables=$(grep -c '^CREATE TABLE' "$BASE/0001_schema.sql")
expect_policies=$(grep -c '^CREATE POLICY' "$BASE/0001_schema.sql")
expect_rls=$(grep -c 'ENABLE ROW LEVEL SECURITY' "$BASE/0001_schema.sql")

read -r got_tables got_policies got_rls got_trigger seeded <<<"$(
  "${PSQL[@]}" -tAF' ' -c "
    select
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='greendogops' and c.relkind='r'),
      (select count(*) from pg_policies where schemaname='greendogops'),
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='greendogops' and c.relkind='r' and c.relrowsecurity),
      (select count(*) from pg_event_trigger where evtname='greendogops_protect_new_objects'),
      (select count(*) from greendogops.sched_shift_template);")"

fail=0
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then printf '  %-24s %s\n' "$1" "$3"
  else printf '  %-24s %s  EXPECTED %s\n' "$1" "$3" "$2"; fail=1; fi
}
echo "verification:"
check "tables"          "$expect_tables"   "$got_tables"
check "policies"        "$expect_policies" "$got_policies"
check "tables with RLS" "$expect_rls"      "$got_rls"
check "event trigger"   "1"                "$got_trigger"

# The config seed is what makes a restored database usable rather than merely
# present, so an empty one is a failure even though the schema applied.
if [[ "$seeded" -gt 0 ]]; then printf '  %-24s %s\n' "shift templates seeded" "$seeded"
else printf '  %-24s %s  EXPECTED > 0\n' "shift templates seeded" "$seeded"; fail=1; fi

echo
if [[ "$fail" == "0" ]]; then
  echo "BASELINE OK — a database can be rebuilt from supabase/baseline/"
else
  echo "BASELINE INCOMPLETE — regenerate with scripts/generate_baseline.sh" >&2
fi
exit "$fail"
