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

### Vercel production env values can't be read back to verify them
- **Problem:** after `vercel env add X production < file`, `vercel env pull --environment=production` returned `X=""`, so a hash comparison "failed" even though the value was stored.
- **Root cause:** production vars are encrypted and `env pull` returns `""` for every one of them (long-working vars like `GOOGLE_CALENDAR_ID` also pull as `""`).
- **Fix:** verify the secret itself instead. For a Google OAuth client, POST a bogus code to `https://oauth2.googleapis.com/token` with the ID/secret: `invalid_grant` = credentials valid, `invalid_client` = wrong ID/secret. Add with a stdin file redirect (piping has stored empty values, see `scripts/gmail_oauth_setup.mjs`), then `vercel redeploy <current prod url> --target production` so new env loads without shipping the working tree.
- **Where:** Vercel project `green-dog-ops`; per-recruiter Google Calendar connect (`GOOGLE_CALENDAR_OAUTH_CLIENT_ID/_SECRET`, `src/lib/ats/google-calendar.ts`).
- **Prevent:** don't treat an `env pull` mismatch on production as a failed write; confirm in the app after redeploy.
- **Evidence:** 2026-10-09 — both vars listed by `vercel env ls production`, Google token endpoint returned `invalid_grant`, redeploy Ready and aliased to greendogops.com.

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

### Editor diagnostics (`problems`) may not type-check — use a scoped `tsc`
- **Problem:** the `problems` tool reported "No errors" for a file with a deliberate type error (`const x: number = <array>`).
- **Root cause:** not confirmed — probably the editor's TS server doesn't analyse files that aren't open.
- **Fix:** run `tsc` over only the changed files. Write a temp tsconfig that `extends` the repo's, with `noEmit`, `incremental: false`, `skipLibCheck`, and `include` = `next-env.d.ts` + the changed files (match `[id]` folders with `?id?`). Then run `NODE_OPTIONS=--max-old-space-size=2560 npx tsc -p <that file>`. This follows imports, so their types are checked too. A full-project `tsc` still OOMs.
- **Evidence:** 2026-10-09: the planted error was caught as TS2322 by the scoped run and missed by `problems`. The scoped run over the Slack-linking files finished with exit 0.

### A new cron route must also be added to the proxy allow-list
- **Problem:** the new `/api/admin/slack/sync` cron returned `307 → /login` in production, while the existing crons returned `401`. The nightly job would have been redirected and never run, with no error anywhere.
- **Root cause:** `src/lib/supabase/proxy.ts` sends every session-less request to /login unless the path is on its public list. Cron routes authenticate themselves with `CRON_SECRET`, so each one must be listed.
- **Fix:** the list now lives in `src/lib/supabase/public-paths.ts` (`isPublicPath`). `public-paths.test.ts` fails if any `vercel.json` cron path isn't on it.
- **Evidence:** 2026-10-09: `curl` on the deployed route returned 307 before the fix; the test fails for that path without the fix and passes with it.

### Baseline CI can fail on Docker Hub, and the Codespace token can't re-run it
- **Problem:** `verify-baseline.yml` failed in "Initialize containers": the `docker pull postgres:17` from Docker Hub timed out, so no SQL ran. `gh run rerun` answered `Resource not accessible by integration` (the Codespace `GITHUB_TOKEN` has no Actions write permission).
- **Fix:** run the same check locally with `scripts/verify_baseline.sh` (Docker works in this Codespace, ~1 min). Report CI as Failed/infra, quoting the local result. A new push touching `supabase/**` re-triggers CI.
- **Evidence:** run 37995203668 on 2026-10-09; the local run printed `BASELINE OK`.

### Baseline seed from production must null `planning_guide.source_week_id`
- **Problem:** a baseline regenerated from production failed to rebuild: `0003_config_seed.sql` hit the `planning_guide_source_week_id_fkey` violation.
- **Root cause:** production guides reference `sched_week` rows, and schedules are never seeded. Staging data happened to have nulls there.
- **Fix:** `generate_baseline.sh` now runs the data dump through `null_unseeded_refs`. Add any other config→unseeded-data column to its `NULL_COLS`.
- **Evidence:** 2026-10-09: the local `verify_baseline.sh` failed with that error before the fix and printed `BASELINE OK` after.

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

### `permission denied for column` on person_employment
- **Problem:** a user-scoped query (`createClient()`) that selects or embeds `person_employment(*)` or any pay/benefit column fails with `42501 permission denied for column current_rate`.
- **Root cause:** migration 0227 grants `authenticated` only the non-compensation columns (column-level grants); compensation is service-role only.
- **Fix:** list non-compensation columns explicitly in the user query; load compensation with `loadCompensation()` / write with `upsertCompensation()` from `src/lib/hr/compensation.ts` after the app-level check.
- **Prevent:** `src/lib/hr/types.test.ts` pins `COMPENSATION_FIELDS` to the revoked set.
- **Evidence:** `scripts/security_rls_matrix.sql` on staging 2026-10-08 (`read_comp: denied`, `read_hire_date` allowed for every role).

### supabase-js `.select()` needs a literal string
- **Problem:** interpolating a column list (`` `person_employment ( ${COLS} )` ``) into `.select()` makes the query type a `ParserError`, failing `tsc` ("Spread types may only be created from object types", "not assignable to PageResult").
- **Fix:** write the select as one string literal (duplicate the column list if needed), or cast the query when the string is genuinely dynamic.
- **Evidence:** scoped `tsc` on `hr/page.tsx` 2026-10-08.

### Verifying a commit in a worktree: tsc and next build do work
- **Problem:** the shared checkout mixes sessions' edits, and `tsc` OOMs there.
- **Fix:** `git worktree add --detach /workspaces/<dir> <sha>` (same filesystem), copy in only the files being committed, then `cp -al /workspaces/GreenDogOps/node_modules node_modules` (hard links — instant, no extra disk). There, `NODE_OPTIONS=--max-old-space-size=2300 npx tsc --noEmit` and `npx next build` both complete. A **symlinked** `node_modules` breaks `next build` (Turbopack: "Symlink node_modules could not be resolved… leaves the filesystem root"), though lint/vitest are fine with it.
- **Evidence:** full `tsc` rc=0 and `next build` success on 2026-10-08 for the 0227 security commit.

### Testing RLS as each role without real users
- **Fix:** in one `do $$ … $$` block: create fixtures, `update app_user set role = …`, `perform set_config('request.jwt.claims', '{"sub":…,"role":"authenticated","aal":"aal1"}', true)`, `execute 'set local role authenticated'`, probe, `execute 'reset role'`, repeat — then `raise exception` with the results so everything rolls back. Template: `scripts/security_rls_matrix.sql` (staging only).
- **Evidence:** `RLS_MATRIX PASS` on staging 2026-10-08; fixture rows absent afterwards.


### Service-role actions silently bypass new RLS
- **Problem:** after 0227 locked employee documents to HR roles, `getCandidateDocuments` (ATS) still let any signed-in user fetch an employee's HR documents, and `deleteCandidateDocument` deleted any client-supplied storage path — both use `createAdminClient()`, so RLS never ran.
- **Fix:** service-role paths must apply the same rule in TypeScript (`personDocumentAccess()` in `permissions.ts`, mirroring the `person_document` policy) and look up storage paths server-side.
- **Prevent:** when tightening a policy, grep for `admin.from("<table>")` and `.storage.from(` on the same data — not just user-scoped queries.
- **Evidence:** code review of the 0227 commit, 2026-10-08; regression test in `src/lib/auth/permissions.test.ts`.

### `@types/node` must match the Vercel Node runtime (24.x)
- **Problem:** Dependabot PR "Bump vitest to 5.0.3" failed its Vercel preview with `npm error ERESOLVE … peerOptional @types/node@"^22.0.0 || >=24.0.0" from vitest@5.0.3` because `package.json` pinned `@types/node` `^20`.
- **Root cause:** `@types/node` lagged the runtime — Vercel project `nodeVersion` is `24.x` (Vercel API `/v9/projects/<id>`), Codespace is Node 24.
- **Fix:** `@types/node@^24` (commit `7ed3e8b` on the vitest PR); `.github/dependabot.yml` ignores `@types/node` majors so it isn't bumped past the runtime. Change both when Vercel's Node version changes.
- **Note:** Vercel previews only prove `npm install` + `next build`; they do not run lint or vitest, so a green Dependabot preview is not proof the tests pass (see improvements.md "CI for lint + unit tests").
- **Evidence:** 2026-10-09 — with the fix: vitest 225/225, full `tsc` rc=0, lint 0 errors, `npm audit --omit=dev` 0.
