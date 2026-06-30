#!/usr/bin/env bash
# Apply a seed SQL file produced by import_ezyvet_*.py one statement at a time.
# The Supabase Management API query endpoint stalls on very large multi-row
# inserts, so we split the file on statement terminators and send each batch as
# its own request. Idempotent: re-running is safe (on conflict ...).
#
# Usage: scripts/apply_ezyvet.sh /tmp/jan.sql
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:?Usage: apply_ezyvet.sh <file.sql>}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

awk -v dir="$TMPDIR" '
  /^insert into/ { buf = "set search_path = greendogops, public;\n" }
  buf != "" { buf = buf $0 "\n" }
  /;[[:space:]]*$/ && buf ~ /^set search_path/ {
    fn = sprintf("%s/seg_%05d.sql", dir, ++n)
    printf "%s", buf > fn
    close(fn)
    buf = ""
  }
' "$SRC"

total=$(find "$TMPDIR" -name 'seg_*.sql' | wc -l | tr -d ' ')
i=0
for f in "$TMPDIR"/seg_*.sql; do
  i=$((i + 1))
  if ! "$ROOT/scripts/supabase-sql.sh" -f "$f" >/dev/null 2>"$TMPDIR/err"; then
    echo "FAILED batch $i/$total:" >&2
    cat "$TMPDIR/err" >&2
    exit 1
  fi
  printf '\rapplied %d/%d batches' "$i" "$total" >&2
done
echo >&2
echo "Done: $total batches from $SRC" >&2
