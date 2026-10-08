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

# --- Keys to set ---------------------------------------------------------------
# Values come from the environment or .env.local — never hard-code keys here
# (this repository has been public). Rotate a key in Google Cloud first, put the
# new value in .env.local, then run this script.
ENV_FILE="${ENV_FILE:-.env.local}"
read_key() {
  local name="$1" val="${!1:-}"
  if [[ -z "$val" && -f "$ENV_FILE" ]]; then
    val="$(grep -m1 "^${name}=" "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'\r')"
  fi
  [[ -n "$val" ]] || { echo "Missing $name (set it in the environment or $ENV_FILE)." >&2; exit 1; }
  printf '%s' "$val"
}
declare -A KEYS=(
  [GOOGLE_MAPS_PUBLIC_KEY]="$(read_key GOOGLE_MAPS_PUBLIC_KEY)"
  [GOOGLE_MAPS_API_KEY]="$(read_key GOOGLE_MAPS_API_KEY)"
  [GOOGLE_CSE_API_KEY]="$(read_key GOOGLE_CSE_API_KEY)"
)
for name in "${!KEYS[@]}"; do
  [[ -n "${KEYS[$name]}" ]] || { echo "Aborting: $name is empty." >&2; exit 1; }
done
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
