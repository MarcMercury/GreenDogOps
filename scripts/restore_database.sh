#!/usr/bin/env bash
#
# Restore an encrypted backup produced by scripts/backup_database.sh.
#
# This is the half of a backup strategy that usually goes untested. Run it
# against staging every so often: a backup nobody has ever restored is a
# hypothesis, not a safety net.
#
# Typical disaster recovery:
#   1. Create an empty Supabase project.
#   2. scripts/rebuild_database.sh --to <ref>      # structure + config
#   3. scripts/restore_database.sh --file <f> --to <ref> --data-only
#
# Or restore everything straight from the dump, which carries structure too:
#   scripts/restore_database.sh --file <f> --to <ref>
#
# Usage:
#   scripts/restore_database.sh --file .backups/gdo-critical-<stamp>.dump.age \
#       --to <project_ref> [--data-only] [--list]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${AGE_KEY_FILE:-$ROOT/.secrets/backup-age-key.txt}"

FILE=""; TARGET=""; DATA_ONLY=0; LIST_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --to) TARGET="$2"; shift 2 ;;
    --data-only) DATA_ONLY=1; shift ;;
    --list) LIST_ONLY=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$FILE" ]] || { echo "usage: $0 --file <dump.age> --to <ref> [--data-only] [--list]" >&2; exit 2; }
[[ -f "$FILE" ]] || { echo "ERROR: $FILE not found." >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "ERROR: private key $KEY not found." >&2; exit 1; }

# Verify integrity before trusting the contents.
if [[ -f "$FILE.sha256" ]]; then
  echo -n "checksum: "
  if [[ "$(sha256sum "$FILE" | cut -d' ' -f1)" == "$(cat "$FILE.sha256")" ]]; then
    echo "ok"
  else
    echo "MISMATCH — refusing to restore a corrupt file." >&2; exit 1
  fi
fi

PLAIN="$(mktemp)"
trap 'rm -f "$PLAIN"' EXIT
age --decrypt --identity "$KEY" --output "$PLAIN" "$FILE"
echo "decrypted: $(du -h "$PLAIN" | cut -f1)"

if [[ "$LIST_ONLY" == "1" ]]; then
  pg_restore --list "$PLAIN" | head -60
  echo "..."
  echo "tables in dump: $(pg_restore --list "$PLAIN" | grep -c 'TABLE DATA' || true)"
  exit 0
fi

[[ -n "$TARGET" ]] || { echo "ERROR: --to <project_ref> required to restore." >&2; exit 1; }

PROD_REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$ROOT/.secrets/supabase.env" | cut -d= -f2- | tr -d '"'"'"' \r')"
if [[ "$TARGET" == "$PROD_REF" && "${ALLOW_PROD:-0}" != "1" ]]; then
  echo "REFUSING: $TARGET is production." >&2
  echo "Restoring over live data is almost never what you want. Set ALLOW_PROD=1 if it is." >&2
  exit 1
fi

: "${DB_PASS:?Set DB_PASS for the TARGET project}"
REGION="${REGION:-aws-0-us-east-2}"
CONN="postgresql://postgres.${TARGET}@${REGION}.pooler.supabase.com:5432/postgres?sslmode=require"
export PGPASSWORD="$DB_PASS"

# --disable-triggers is deliberately NOT used: it needs superuser, which
# Supabase does not grant, so it only produces hundreds of permission errors
# that bury real ones. pg_restore orders the tables by dependency anyway.
ARGS=(--no-owner --no-privileges)
[[ "$DATA_ONLY" == "1" ]] && ARGS+=(--data-only)

echo "Restoring into $TARGET ..."
# Errors are reported but do not stop the run: a data-only restore over an
# existing schema always hits some conflicts, and stopping at the first one
# would leave the database half populated.
pg_restore "${ARGS[@]}" --dbname "$CONN" "$PLAIN" 2>/tmp/restore_err.txt || true
ERRS=$(grep -c '^pg_restore: error' /tmp/restore_err.txt || true)
if [[ "$ERRS" -gt 0 ]]; then
  echo "  $ERRS error line(s) — first few:"
  grep '^pg_restore: error' /tmp/restore_err.txt | head -5 | sed 's/^/    /'
else
  echo "  no errors"
fi
echo "done — verify with scripts/compare_schemas.py"
