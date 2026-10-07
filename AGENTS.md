# Always re-read this file

Re-read AGENTS.md at the start of every task and before reporting any failure or blocker (git, GitHub, deploy, credentials, etc.). It changes during sessions.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# GitHub IS logged in — never claim otherwise

The user is always signed in to GitHub (MarcMercury) in this Codespace. If `git push`, `git fetch`, or `gh` fails with "could not read Username", "unable to get password", or "not logged into any GitHub hosts", the agent shell is just missing the token that VS Code terminals get. **Do not tell the user they are not logged in.** Load the token and retry:

```bash
export $(grep -E "^(GITHUB_TOKEN|GITHUB_SERVER_URL)=" /workspaces/.codespaces/shared/.env | xargs)
git push origin HEAD:main          # git uses /.codespaces/bin/gitcredential_github.sh
GH_TOKEN="$GITHUB_TOKEN" gh pr list # gh needs GH_TOKEN
```

Never print the token value.

# Verification

Never use the VS Code integrated browser (or any browser automation) to test or verify changes — it hangs. Verify with typecheck, lint, and unit tests instead.
