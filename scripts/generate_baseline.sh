#!/usr/bin/env bash
#
# Regenerate supabase/baseline/* from a live project.
#
# The baseline is a snapshot of a working database, which is what makes it
# replayable: supabase/migrations/ is not, because several data-seed migrations
# hard-code UUIDs that were generated at runtime and later deleted.
#
# Re-run this after any migration that changes the schema, so the fast rebuild
# path never drifts far behind production.
#
# Usage:
#   scripts/generate_baseline.sh                 # from staging (default)
#   SOURCE_REF=<ref> DB_PASS=<pw> scripts/generate_baseline.sh
#
# Needs pg_dump >= the server's major version:
#   sudo apt-get install -y postgresql-client-17
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/supabase-conn.sh
source "$ROOT/scripts/lib/supabase-conn.sh"
OUT="$ROOT/supabase/baseline"
STAGING_ENV="$ROOT/.secrets/supabase-staging.env"

# Config tables the application cannot start without. Deliberately excludes
# every table holding people, schedules, patients or candidates.
CONFIG_TABLES=(
  location sched_department sched_role sched_shift_template
  planning_guide planning_guide_column planning_guide_slot planning_capacity_rule
  ezyvet_appt_type_dept_map email_template
)

if [[ -z "${SOURCE_REF:-}" ]]; then
  [[ -f "$STAGING_ENV" ]] || { echo "ERROR: $STAGING_ENV not found and SOURCE_REF unset." >&2; exit 1; }
  # shellcheck disable=SC1090
  set -a; source "$STAGING_ENV"; set +a
  SOURCE_REF="$STAGING_PROJECT_REF"
  DB_PASS="${DB_PASS:-$STAGING_DB_PASS}"
fi
: "${DB_PASS:?Set DB_PASS for the source project}"

command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not installed." >&2; exit 1; }

# pg_dump 17.6+ wraps its output in \restrict / \unrestrict psql meta-commands.
# Those are not SQL, and the baseline is applied over the Management API rather
# than piped through psql, so they have to be filtered out.
strip_meta() { grep -vE '^\\(restrict|unrestrict)([[:space:]]|$)'; }

# Config rows may point at data the seed deliberately leaves out. Null those
# columns so the seed applies on an empty database (verify_baseline.sh checks).
#   planning_guide.source_week_id -> sched_week (schedules are never seeded)
null_unseeded_refs() {
  python3 -c '
import re, sys

NULL_COLS = {"planning_guide": {"source_week_id"}}
HEAD = re.compile(r"^INSERT INTO greendogops\.(\w+) \(([^)]*)\) VALUES \((.*)\);$")

def split_values(s):
    out, cur, i, q = [], [], 0, False
    while i < len(s):
        c = s[i]
        if q:
            cur.append(c)
            if c == "\x27":
                if i + 1 < len(s) and s[i + 1] == "\x27":
                    cur.append(s[i + 1]); i += 1
                else:
                    q = False
        elif c == "\x27":
            q = True; cur.append(c)
        elif c == ",":
            out.append("".join(cur).strip()); cur = []
        else:
            cur.append(c)
        i += 1
    out.append("".join(cur).strip())
    return out

for line in sys.stdin:
    m = HEAD.match(line.rstrip("\n"))
    if m and m.group(1) in NULL_COLS:
        cols = [c.strip() for c in m.group(2).split(",")]
        vals = split_values(m.group(3))
        if len(vals) != len(cols):
            sys.exit(f"null_unseeded_refs: could not parse {m.group(1)} insert")
        vals = ["NULL" if c in NULL_COLS[m.group(1)] else v for c, v in zip(cols, vals)]
        line = "INSERT INTO greendogops.%s (%s) VALUES (%s);\n" % (m.group(1), m.group(2), ", ".join(vals))
    sys.stdout.write(line)
'
}

CONN="$(pooler_uri "${SOURCE_REF}")"
export PGPASSWORD="$DB_PASS"
STAMP="$(date -u +%Y-%m-%d)"
mkdir -p "$OUT"

echo "Dumping schema from $SOURCE_REF ..."
{
  sed "s/__STAMP__/$STAMP/" <<'HDR'
-- ============================================================================
-- Green Dog Ops — baseline schema for the greendogops schema
-- Generated __STAMP__ by scripts/generate_baseline.sh. DO NOT HAND-EDIT.
-- ----------------------------------------------------------------------------
-- A single, internally consistent snapshot: every table, view, materialised
-- view, function, trigger, enum, index, grant, revoke and RLS policy.
--
-- This exists because supabase/migrations/ cannot be replayed from scratch.
-- Several data-seed migrations hard-code UUIDs that were generated at runtime
-- and have since been deleted, so a fresh build aborts partway through. A
-- snapshot of a working database has no dangling references by construction.
--
-- Rebuild order is documented in scripts/rebuild_database.sh.
-- ============================================================================

HDR
  # Privileges are NOT excluded: the RLS baseline depends on the grants to
  # authenticated/service_role and the revokes from anon.
  pg_dump "$CONN" --schema=greendogops --schema-only --no-owner | strip_meta
} > "$OUT/0001_schema.sql"

echo "Dumping configuration data ..."
TABLE_ARGS=()
for t in "${CONFIG_TABLES[@]}"; do TABLE_ARGS+=(--table="greendogops.$t"); done
{
  sed "s/__STAMP__/$STAMP/" <<'HDR'
-- ============================================================================
-- Green Dog Ops — baseline configuration data
-- Generated __STAMP__ by scripts/generate_baseline.sh. DO NOT HAND-EDIT.
-- ----------------------------------------------------------------------------
-- Locations, departments, roles, shift templates, planning guides, appointment
-- type mappings and email templates: the rows the application needs in order to
-- function at all. No person, schedule, patient or candidate data.
--
-- planning_guide.source_week_id is null here by design; it points at a
-- sched_week, and a freshly rebuilt database has none.
-- ============================================================================

HDR
  pg_dump "$CONN" --data-only --no-owner --column-inserts "${TABLE_ARGS[@]}" | strip_meta | null_unseeded_refs
} > "$OUT/0003_config_seed.sql"

# 0002_global_objects.sql is hand-maintained: event triggers are cluster-wide
# and pg_dump --schema never emits them.

echo
echo "Wrote:"
wc -l "$OUT"/*.sql
echo
echo "Sanity check — these must all be non-zero:"
for pat in "CREATE TABLE" "CREATE POLICY" "ENABLE ROW LEVEL SECURITY" "^GRANT" "^REVOKE"; do
  printf '  %-28s %s\n' "$pat" "$(grep -cE "$pat" "$OUT/0001_schema.sql")"
done
