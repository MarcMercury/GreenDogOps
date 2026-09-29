#!/usr/bin/env bash
#
# Encrypted logical backup of the greendogops schema.
#
# Supabase's own daily backups live inside the Supabase account. If that account
# is lost, closed or compromised, the backups go with it. These dumps are
# ordinary files encrypted with a key Supabase never sees, so they can be copied
# anywhere -- object storage, a laptop, an external drive.
#
# Two tiers, because the data is not uniform:
#
#   --critical   92 tables, ~47 MB. Schedules, attendance, HR, CRM, ATS,
#                marketing, resources. NONE of it can be regenerated. Cheap
#                enough to run hourly.
#   --full       All 138 tables, ~585 MB. Adds the ezyVet ingest tables, which
#                are ~90% of the volume and CAN be rebuilt by re-running the
#                ezyVet agent. Nightly is plenty.
#
# Read-only work against the primary. The critical dump moves tens of megabytes
# and finishes in seconds, so it does not interfere with people using the app.
#
# Usage:
#   scripts/backup_database.sh --critical
#   scripts/backup_database.sh --full --out /mnt/external-drive/gdo-backups
#   SOURCE_REF=<ref> DB_PASS=<pw> scripts/backup_database.sh --full
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TIER="critical"
OUT_DIR="${BACKUP_DIR:-$ROOT/.backups}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --critical) TIER="critical"; shift ;;
    --full) TIER="full"; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Credentials: explicit env wins, otherwise fall back to the production secrets.
if [[ -z "${SOURCE_REF:-}" ]]; then
  SOURCE_REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$ROOT/.secrets/supabase.env" | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
: "${SOURCE_REF:?Set SOURCE_REF or SUPABASE_PROJECT_REF in .secrets/supabase.env}"
: "${DB_PASS:?Set DB_PASS for $SOURCE_REF (Supabase dashboard > Settings > Database)}"

RECIPIENT="${AGE_RECIPIENT:-}"
if [[ -z "$RECIPIENT" && -f "$ROOT/.secrets/backup-age-recipient.txt" ]]; then
  RECIPIENT="$(cat "$ROOT/.secrets/backup-age-recipient.txt")"
fi
# Refuse to write plaintext: these dumps contain employee and client records.
[[ -n "$RECIPIENT" ]] || { echo "ERROR: no age recipient. Set AGE_RECIPIENT." >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not installed (need >= server major)." >&2; exit 1; }
command -v age >/dev/null || { echo "ERROR: age not installed (apt-get install age)." >&2; exit 1; }

REGION="${REGION:-aws-0-us-east-2}"
CONN="postgresql://postgres.${SOURCE_REF}@${REGION}.pooler.supabase.com:5432/postgres?sslmode=require"
export PGPASSWORD="$DB_PASS"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/gdo-${TIER}-${STAMP}.dump.age"

EXCLUDES=()
if [[ "$TIER" == "critical" ]]; then
  # Everything ezyVet EXCEPT the small curated/config tables, which are hand
  # maintained rather than imported and would be painful to recreate.
  for pat in ezyvet_invoice_line ezyvet_wellness_plan_use ezyvet_agenda_appt_snapshot \
             ezyvet_animal ezyvet_appointment_record ezyvet_soc_overdue ezyvet_contact \
             ezyvet_clinical_note ezyvet_product ezyvet_invoice ezyvet_consult \
             ezyvet_diagnostic ezyvet_prescription ezyvet_reminder; do
    EXCLUDES+=(--exclude-table-data="greendogops.${pat}")
  done
fi

echo "Backing up $SOURCE_REF [$TIER] ..."
# --format=custom so pg_restore can do selective, parallel restores later.
# Structure is always included; --exclude-table-data drops only the rows.
pg_dump "$CONN" \
  --schema=greendogops --format=custom --compress=9 --no-owner \
  "${EXCLUDES[@]}" \
  | age --encrypt --recipient "$RECIPIENT" --output "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
sha256sum "$FILE" | cut -d' ' -f1 > "$FILE.sha256"

echo "  wrote   $FILE"
echo "  size    $SIZE"
echo "  sha256  $(cat "$FILE.sha256")"

# Local retention. Off-site copies are pruned by whatever stores them.
KEEP="${BACKUP_KEEP:-14}"
mapfile -t OLD < <(ls -1t "$OUT_DIR"/gdo-${TIER}-*.dump.age 2>/dev/null | tail -n +$((KEEP + 1)) || true)
for f in "${OLD[@]:-}"; do
  [[ -n "$f" ]] || continue
  rm -f "$f" "$f.sha256"
  echo "  pruned  $(basename "$f")"
done
