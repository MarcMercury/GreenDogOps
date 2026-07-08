#!/usr/bin/env bash
# Sync Google Maps / CSE keys to Vercel (production, preview, development) and redeploy.
#
# Usage:
#   bash scripts/fix_vercel_maps_env.sh
# You will be prompted to paste your Vercel token (input hidden, not stored in
# shell history). Get one at https://vercel.com/account/tokens
#
set -euo pipefail

PROJECT="green-dog-ops"
SCOPE="marc-mercurys-projects"

# --- Keys to set (values are project config, not secrets per the owner) --------
declare -A KEYS=(
  [GOOGLE_MAPS_PUBLIC_KEY]="AIzaSyAZoLa3u5OspmT0NmhMdZi8fmtL0Mg_2no"
  [GOOGLE_MAPS_API_KEY]="AIzaSyB3iH7279vO4VzF649rpUDJvU2XZ4RtiTY"
  [GOOGLE_CSE_API_KEY]="AIzaSyCn0PqBneZd28EP-YYRj5F3B_1hY7crNN0"
)
ENVIRONMENTS=(production preview development)

# --- Read token securely -------------------------------------------------------
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  read -rs -p "Paste Vercel token (input hidden): " VERCEL_TOKEN
  echo
fi
export VERCEL_TOKEN
[[ -n "$VERCEL_TOKEN" ]] || { echo "No token provided. Aborting."; exit 1; }

V() { npx --yes vercel "$@" --token "$VERCEL_TOKEN" --scope "$SCOPE"; }

echo "==> Authenticating as: $(V whoami 2>/dev/null || echo 'FAILED')"

# --- Link project non-interactively --------------------------------------------
if [[ ! -f .vercel/project.json ]]; then
  echo "==> Linking project $PROJECT ..."
  V link --yes --project "$PROJECT" >/dev/null
fi

# --- Replace each key in each environment --------------------------------------
for name in "${!KEYS[@]}"; do
  for target in "${ENVIRONMENTS[@]}"; do
    # Remove existing value if present (ignore "not found")
    V env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    # Add new value (read from stdin)
    printf '%s' "${KEYS[$name]}" | V env add "$name" "$target" >/dev/null
    echo "    set $name [$target]"
  done
done

echo "==> Env vars updated. Triggering a production redeploy ..."
V redeploy "$(V ls "$PROJECT" --prod 2>/dev/null | awk '/https:\/\// {print $2; exit}')" 2>/dev/null \
  || { echo "    Auto-redeploy skipped — run 'vercel --prod' or click Redeploy in the dashboard."; }

echo "==> Done. Hard-refresh https://www.greendogops.com/crm/referral after the deploy finishes."
