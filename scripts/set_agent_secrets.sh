#!/usr/bin/env bash
# Set the 5 GitHub Actions repo secrets the ezyVet agent needs.
#
# The Codespaces token can't write Actions secrets, so this uses a GitHub PAT
# you paste at the prompt (it is NOT echoed, NOT stored, NOT committed). Values
# are read from the gitignored .secrets/ezyvet.env and .env.local at runtime.
#
# PAT scope needed:
#   * Classic PAT: "repo" (covers Actions secrets), and "workflow".
#   * Fine-grained PAT (repo = MarcMercury/GreenDogOps): Repository permissions →
#     "Secrets: Read and write" AND "Actions: Read and write".
#
# Usage:  bash scripts/set_agent_secrets.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="MarcMercury/GreenDogOps"

read -rsp "Paste a GitHub PAT (repo + workflow scope), then press Enter: " GH_PAT
echo
export GH_TOKEN="$GH_PAT"

val() { grep -m1 "^$1=" "$2" | cut -d= -f2-; }

EZY="$ROOT/.secrets/ezyvet.env"
ENVL="$ROOT/.env.local"

echo "Setting secrets on $REPO ..."
gh secret set EZYVET_LOGIN_URL --repo "$REPO" --body "$(val EZYVET_LOGIN_URL "$EZY")"
gh secret set EZYVET_USERNAME  --repo "$REPO" --body "$(val EZYVET_USERNAME  "$EZY")"
gh secret set EZYVET_PASSWORD  --repo "$REPO" --body "$(val EZYVET_PASSWORD  "$EZY")"
gh secret set CRON_SECRET      --repo "$REPO" --body "$(val CRON_SECRET      "$ENVL")"
gh secret set APP_BASE_URL     --repo "$REPO" --body "https://greendogops.com"

unset GH_TOKEN GH_PAT
echo
echo "Done. Current repo secrets:"
GH_TOKEN="" gh secret list --repo "$REPO" 2>/dev/null || true
