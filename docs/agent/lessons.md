# Lessons

Verified, reusable, non-obvious facts. Newest first within each section. Format:

```
### <short title>
- **Problem:** what was observed
- **Root cause:** verified cause
- **Fix:** what works
- **Where:** files / systems
- **Prevent:** guardrail, test, or habit
- **Evidence:** how it was confirmed (date)
```

## Tooling & environment

### Several agent sessions share one checkout
- **Problem:** the working tree mixes uncommitted edits from several sessions. One session committed from its own `git worktree` and pushed, then synced only some files back, so the shared checkout's copies of other files were missing parts of the deployed commit. Committing the checkout as-is would have reverted deployed work.
- **Root cause:** sessions run concurrently in `/workspaces/GreenDogOps` on `main`; a commit made elsewhere doesn't update the shared files.
- **Fix:** to commit some sessions' work while another is still running, never stash, checkout, or reset the working tree. Build the commit in a temporary index (`GIT_INDEX_FILE=/tmp/x.index git read-tree origin/main`, then `git hash-object -w` + `git update-index --cacheinfo`, `git write-tree`, `git commit-tree`). For a file changed both in the shared tree and in `origin/main`, three-way merge it (`git merge-file <working> <old base> <origin version>`). Lint and test the result in `git worktree add --detach /tmp/<dir> <sha>` with `node_modules` symlinked, then push the sha. Afterwards move the branch with `git update-ref` and refresh only the changed index paths (`git reset <sha> -- <paths>`), so other sessions' staged changes survive.
- **Where:** git workflow in this Codespace.
- **Prevent:** check `git status` and `git log origin/main..HEAD` / `HEAD..origin/main` before committing; attribute every changed file to a session before including it. A session's edited files can be listed from `~/.copilot/session-state/<id>/events.jsonl` (`tool.execution_start` events).
- **Evidence:** deploy of `5a3470b` on 2026-10-08: `ats/page.tsx`, `ats/[id]/page.tsx` and `docs/recruiting-ats-workflow.md` in the shared tree lacked `998a1b2`'s changes; merged, Vercel `success`, baseline CI `success`.

### `tsc --noEmit` is OOM-killed in the Codespace
- **Problem:** full type-check exits 143.
- **Root cause:** container memory limit.
- **Fix:** don't run it. Use editor diagnostics → `npx eslint <files>` → `npx vitest run` → Vercel build status (see AGENTS.md "Verification").
- **Where:** local dev container only; Vercel builds are unaffected.
- **Prevent:** follow the verification hierarchy.
- **Evidence:** documented in README "Type-checking in the dev container".

### Agent shell has no GitHub token
- **Problem:** `git push` / `gh` fail with "could not read Username" or "not logged into any GitHub hosts".
- **Root cause:** the agent shell doesn't inherit the token VS Code terminals get.
- **Fix:** `export $(grep -E "^(GITHUB_TOKEN|GITHUB_SERVER_URL)=" /workspaces/.codespaces/shared/.env | xargs)`; use `GH_TOKEN="$GITHUB_TOKEN"` for `gh`.
- **Where:** every agent session.
- **Prevent:** load it before any git/gh network operation.
- **Evidence:** AGENTS.md; `gh api` calls succeeded with it on 2026-10-08.

### Checking whether a push actually deployed
- **Problem:** a successful `git push` says nothing about the Vercel build (the only full type-check).
- **Fix:** `GH_TOKEN="$GITHUB_TOKEN" gh api repos/MarcMercury/GreenDogOps/commits/<sha>/status --jq '.state, (.statuses[] | "\(.context) \(.state) \(.description)")'` — Vercel reports as context `Vercel`. `gh api repos/MarcMercury/GreenDogOps/deployments` lists Production deployments by sha.
- **Evidence:** returned `success` / "Deployment has completed" for `eddc044` on 2026-10-08.

### Test suite baseline
- `npx vitest run` with no config file: 14 files / 186 tests, ~9s, all passing on 2026-10-08 (`eddc044` + uncommitted ATS work). Tests are pure-logic `*.test.ts` files beside their modules in `src/lib/**`.

## Database

### PostgREST silently truncates at 1000 rows
- **Problem:** large reads return exactly 1000 rows with no error.
- **Root cause:** project `max_rows` = 1000.
- **Fix:** page with `fetchAllRows` / `fetchAllRowsConcurrent` from `src/lib/supabase/paginate.ts`.
- **Prevent:** any query that can exceed 1000 rows must paginate; a result length of exactly 1000 is a red flag.
- **Evidence:** README §3; `PAGE_SIZE = 1000` in `paginate.ts`.

### Supabase types to-one embeds as arrays
- **Problem:** `row.person.name` is undefined / a type error on a joined to-one relation.
- **Root cause:** supabase-js infers embeds as arrays.
- **Fix:** normalise with a `T | T[] | null` → `T | null` unwrap. There is **no shared helper** yet (README's "first*() helpers" is stale); see e.g. `one<T>()` in `src/lib/ats/job-hires.ts`.
- **Evidence:** code search 2026-10-08. Tracked in improvements.md.

### Migration history cannot rebuild a database
- **Root cause:** seed migrations hard-code UUIDs that no longer exist.
- **Fix:** rebuild from `supabase/baseline` (`scripts/rebuild_database.sh`); regenerate with `scripts/generate_baseline.sh` after any schema migration.
- **Evidence:** README "The migration history is not replayable".

### Management API hangs on large SQL payloads
- **Problem:** `scripts/supabase-sql.sh -f big.sql` never returns.
- **Fix:** bulk data goes through a service-role client script, not a generated `.sql` file.
- **Evidence:** README "Database migrations".
