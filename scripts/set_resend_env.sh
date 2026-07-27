#!/usr/bin/env bash
# Sync Resend email env vars to Vercel (production, preview, development).
#
# Reads RESEND_API_KEY and RESEND_FROM_EMAIL from the gitignored .env.local so
# the secret is never hardcoded or committed. You paste a Vercel token at the
# prompt (input hidden). Get one at https://vercel.com/account/tokens
#
# Usage:  bash scripts/set_resend_env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="green-dog-ops"
SCOPE="marc-mercurys-projects"
ENVL="$ROOT/.env.local"
ENVIRONMENTS=(production preview development)
VARS=(RESEND_API_KEY RESEND_FROM_EMAIL RESEND_WEBHOOK_SECRET)

val() { grep -m1 "^$1=" "$ENVL" | cut -d= -f2-; }

# --- Read token securely ----------------------------------------------------
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  read -rs -p "Paste Vercel token (input hidden): " VERCEL_TOKEN
  echo
fi
export VERCEL_TOKEN
[[ -n "$VERCEL_TOKEN" ]] || { echo "No token provided. Aborting."; exit 1; }

V() { npx --yes vercel "$@" --token "$VERCEL_TOKEN" --scope "$SCOPE"; }

echo "==> Authenticating as: $(V whoami 2>/dev/null || echo 'FAILED')"

if [[ ! -f "$ROOT/.vercel/project.json" ]]; then
  echo "==> Linking project $PROJECT ..."
  (cd "$ROOT" && V link --yes --project "$PROJECT" >/dev/null)
fi

for name in "${VARS[@]}"; do
  value="$(val "$name")"
  [[ -n "$value" ]] || { echo "    skip $name (empty in .env.local)"; continue; }
  for target in "${ENVIRONMENTS[@]}"; do
    V env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | V env add "$name" "$target" >/dev/null
    echo "    set $name [$target]"
  done
done

echo "==> Done. Redeploy for the new vars to take effect: vercel --prod"
