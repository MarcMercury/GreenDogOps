#!/usr/bin/env bash
#
# Apply every supabase/migrations/*.sql file, in filename order, to one project.
#
# Progress is recorded in .secrets/applied-<ref>.log so an interrupted or failed
# run can be resumed: files already listed there are skipped. Stops at the first
# failure so a broken migration never cascades into the ones after it.
#
# Usage:
#   SUPABASE_PROJECT_REF=<ref> scripts/apply_migrations.sh
#   SUPABASE_PROJECT_REF=<ref> scripts/apply_migrations.sh --from 0042
#   SUPABASE_PROJECT_REF=<ref> scripts/apply_migrations.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${SUPABASE_PROJECT_REF:?Export SUPABASE_PROJECT_REF for the TARGET project}"

FROM=""
DRY_RUN=0
SKIP_FK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    # Skip (don't abort on) data-seed migrations that fail with a foreign-key
    # violation because they hard-code UUIDs that no longer exist. Schema
    # migrations fail on other error codes and still stop the run.
    --skip-fk-failures) SKIP_FK=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

APPLIED_LOG="$ROOT/.secrets/applied-${SUPABASE_PROJECT_REF}.log"
mkdir -p "$ROOT/.secrets"
touch "$APPLIED_LOG"

# Guard against pointing this at production by accident.
PROD_REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$ROOT/.secrets/supabase.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
if [[ -n "$PROD_REF" && "$SUPABASE_PROJECT_REF" == "$PROD_REF" ]]; then
  echo "REFUSING: $SUPABASE_PROJECT_REF is the production project." >&2
  echo "Re-run with ALLOW_PROD=1 if that is genuinely what you want." >&2
  [[ "${ALLOW_PROD:-0}" == "1" ]] || exit 1
fi

total=0
applied=0
skipped=0
fk_skipped=()

for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  total=$((total + 1))

  if [[ -n "$FROM" && "${name%%_*}" < "$FROM" ]]; then
    skipped=$((skipped + 1)); continue
  fi
  if grep -qxF "$name" "$APPLIED_LOG"; then
    skipped=$((skipped + 1)); continue
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "would apply: $name"; continue
  fi

  printf '%-58s' "$name"
  if out="$("$ROOT/scripts/supabase-sql.sh" -f "$f" 2>&1)"; then
    echo "$name" >> "$APPLIED_LOG"
    applied=$((applied + 1))
    echo "ok"
  elif [[ "$SKIP_FK" == "1" ]] && grep -q '23503' <<<"$out"; then
    echo "$name" >> "$APPLIED_LOG"
    fk_skipped+=("$name")
    echo "SKIPPED (stale FK in data seed)"
  else
    echo "FAILED"
    echo "--------------------------------------------------------------"
    echo "$out" | head -40
    echo "--------------------------------------------------------------"
    echo "Applied $applied of $total before failing on $name." >&2
    echo "Fix it, then re-run to resume (already-applied files are skipped)." >&2
    exit 1
  fi
done

echo
echo "Done. applied=$applied skipped=$skipped total=$total  target=$SUPABASE_PROJECT_REF"
if [[ ${#fk_skipped[@]} -gt 0 ]]; then
  echo
  echo "Skipped ${#fk_skipped[@]} data-seed migration(s) with stale foreign keys:"
  printf '  %s\n' "${fk_skipped[@]}"
  echo "Their data must be copied from production with scripts/copy_reference_data.py."
fi
