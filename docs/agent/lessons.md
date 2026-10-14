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

### Adding a field to a shared type: type-check every file that builds it, tests included
- **Problem:** 2026-10-13, `c85ebbc` (ADP RUN ID) failed the Vercel build: `src/lib/hr/types.test.ts` builds a full `PersonEmployment` literal that lacked the new required field. Vitest passed (it doesn't type-check) and the scoped `tsc` only covered the changed app files.
- **Fix:** when a required property is added to a shared interface, put every file that references the type into the scoped tsconfig (`grep -rln "TypeName" src` → include list), or make the property optional if older literals are legitimately partial.
- **Evidence:** the failing deployment's log (`npx vercel inspect <dpl> --logs --token $VERCEL_TOKEN`) showed TS2352 in the test file; the fix built.

### Merging two `person` rows: re-point by foreign key, and mind the email trigger
- **Problem:** the same human existed twice (an ATS applicant and a roster employee); 36 tables reference `person`, several 1:1.
- **Fix:** `scripts/merge_ats_roster_duplicates.sql` — one `DO` block that discovers the FKs to `person` from `pg_constraint`, re-points the many-side rows, merges `person_recruiting` field by field, fills blanks on the survivor, logs `merged_duplicate`, deletes the applicant. It refuses pairs that aren't applicant → employee/former or where the applicant has roster-only 1:1 rows.
- **Gotchas (verified):** `person_after_change` copies `person.email` onto `app_user.email`, so never fill an email on someone with a login; `time_punch*` are append-only (row triggers), so only `UPDATE` tables that actually hold rows; `person_recruiting.application_history` is NOT NULL and `application` defaults to `{}` (treat `{}` as blank); in PL/pgSQL `text[] || 'literal'` fails with "malformed array literal" — use `array_append`. Storage objects stay under the old person-id prefix, which is fine (read only via signed URLs).
- **Prevent:** back up first (full JSON of the applicant and every child row), rehearse on staging with synthetic rows, then re-run the FIND query (expect 0).
- **Evidence:** 2026-10-13 — staging rehearsal incl. a forced failure on pair 2 that rolled back pair 1; production: 14 applicants merged into 12 roster people, 0 orphans, 0 remaining matches.

### `scripts/supabase-sql.sh` runs a multi-statement payload as one transaction
- **Fact:** a batch of statements sent in one `-q`/`-f` call commits or rolls back together — a NOT NULL failure in the third `insert` left none of the earlier inserts behind.
- **Evidence:** 2026-10-13 on staging (`yzxcuiwklrmxarzjzukr`).

### Two agent sessions at once: memory runs out and `generate_baseline.sh` runs collide
- **Problem:** 2026-10-13: scoped `tsc` and `eslint` were killed (exit 143) and a baseline regeneration was cut off, leaving `supabase/baseline/0001_schema.sql` at 15 lines; another session's `generate_baseline.sh` then rewrote both baseline files (including `0003` seed drift) while this session's tests were reading them.
- **Root cause:** a second VS Code server + agent started at 19:50 (`free -m`: ~850 MB available of 8 GB). The baseline script writes its output files in place.
- **Fix:** check `ps aux | grep generate_baseline` before regenerating, never kill another session's run, wait for it, then `wc -l` the baseline before running tests. If it is truncated, `git checkout -- supabase/baseline/` and regenerate. When `tsc` cannot run, use the `problems` tool on every file touching a changed exhaustive type (e.g. `Record<ModuleKey, …>` in `module-icons.ts`) and rely on the Vercel build.

### Vitest does not resolve the `@/` alias — pure modules under test need relative imports
- **Problem:** new tests failed with `Cannot find package '@/lib/worklist/dates'` / `'@/lib/auth/permissions'`.
- **Root cause:** there is no vitest config with the tsconfig `paths` alias, so a runtime (value) `import … from "@/…"` can't be resolved. `import type` from `@/…` is erased and works.
- **Fix:** in modules that tests import, use relative paths for value imports (`../auth/permissions`). Server-only modules that tests never import can keep `@/`.
- **Prevent:** keep business rules in small pure files (`src/lib/notify/audience.ts`, `plan.ts`, `rule-config.ts`) with relative imports, and keep DB/Slack calls in separate `server-only` files.
- **Evidence:** 2026-10-12, 0236 notification engine: 5 test files failed to load, all passed after switching the imports.

### OpenRouter retires `:free` model ids — default to the `openrouter/free` router
- **Problem:** the OpenRouter fallback (LLM chain + ATS resume parse) defaulted to `google/gemini-2.0-flash-exp:free`, which no longer exists, so every OpenRouter call would fail even with a valid key.
- **Root cause:** individual free model ids are removed from OpenRouter without notice.
- **Fix:** default `OPENROUTER_MODEL` to `openrouter/free` (OpenRouter's router over whatever free models are current; supports text + image and `response_format`). Pin a specific id via `OPENROUTER_MODEL` only if needed, and re-check it exists.
- **Where:** `src/lib/ai/llm.ts`, `src/lib/ats/import.ts`.
- **Prevent:** before relying on a model id, check `curl -s https://openrouter.ai/api/v1/models` for it. The key is free tier (`GET /api/v1/key` → `is_free_tier: true`), so free-model daily rate limits apply.
- **Evidence:** 2026-10-12 — model list lacked the old id; a live `openrouter/free` JSON completion returned 200.

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
- **Staged files leak too:** `git add <mine> && git commit` also commits anything another session has already *staged*. Use `git commit -m … -- <paths>` (commits only those paths) or the temp-index recipe above. Evidence: 2026-10-12, notes commit `3598072` swept in another session's staged route renames and broke `/reporting/smart`; undone in `18a3632` (built in a temp index, so that session's staged renames were left intact).
- **Same file, too:** `git commit -- <path>` commits the *whole working-tree file*, including another session's uncommitted edits to it (2026-10-12: `be21fe2` swept notification-engine notes into a one-line Twilio update; undone in the next commit). For a shared file (docs/agent/*, README), build the commit from `git show HEAD:<path>` plus only your change, in a temp index.
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
- **When the GitHub status stays `pending` with zero statuses:** Vercel stopped posting commit statuses around 2026-10-12 (every commit from `3cf2ed2` on showed `pending`, `statuses: []`, and the `deployments` API returned nothing). Ask Vercel directly with the token in `.secrets/vercel.env` (never print it): `curl -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?projectId=prj_liV87s49GVryA4keKoHQ1eJJzEFJ&teamId=team_oPBOpXX27n3U1EECJx94wfY4&limit=5"` and read `meta.githubCommitSha` / `state` (`READY` = built and type-checked). The `vercel` CLI in the Codespace has no stored login. Evidence: `35060f1` READY in production, and the new `/reporting/smart` → `/ask-ziggy` 308 was live.

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

### A new `runner: inline` agent falls through to the Sheets sync
- **Problem:** Admin ▸ Agents ▸ "Run now" on a new inline agent would run the Google Sheets sync instead.
- **Root cause:** `runAgentNow` (`src/app/(app)/admin/agents/actions.ts`) special-cases `slack_user_sync`, then treats *every other* `config.runner = 'inline'` agent as the Sheets sync.
- **Fix:** add an explicit `agent.key === …` branch before the generic inline branch. `notification_dispatch` has one (0230).
- **Prevent:** when registering an inline agent in a migration, add its branch in the same change.
- **Evidence:** code read on 2026-10-09 while adding `notification_dispatch`.

### Staging can fall behind production on migrations
- **Problem:** on 2026-10-09 staging lacked 0215–0227 (applied only to production), so staging dashboard sources failed with "Could not find the table 'greendogops.recruiting_task'" and "column person_interview.start_time does not exist".
- **Fix:** `SUPABASE_PROJECT_REF=yzxcuiwklrmxarzjzukr scripts/apply_migrations.sh --dry-run`, then without `--dry-run`. It tracks progress in `.secrets/applied-<ref>.log`, so files applied out of order (0228–0230 went in first) are skipped. Before replaying older files after newer ones, check that the two sets define no common function/view (a replay would revert the newer body).
- **Verify:** `rls_audit()` returns 0 rows on staging, and a diff of greendogops columns, function bodies (md5 of `pg_get_functiondef`), view bodies, policies and triggers between the two projects is empty. The one expected difference is `format_phone(text)`, which exists only on staging (see 0213).
- **Evidence:** 2026-10-10 — 0215–0227 applied to staging, all ok; `rls_audit` 0 rows; 3,379 production objects all match staging, with `format_phone` the only extra.

### The HR workbook's "Former Employees" tab mixes column layouts
- **Problem:** rows on that tab were pasted from the 2026, 2025 and 2022 profile tabs without realigning, so a fixed column index reads different fields per row. `scripts/import_roster.py` (former employees: cols 23/24 → `pto_used`/`pto_available`) loaded CE budgets (250/500/1000) and benefits $/month and $/year (123.66/1483.92) as PTO days for 29 people.
- **Fix:** identify each row's layout before reading: 2026 = CE at cols 23–25 (compliance booleans from 26); 2025 = benefits Y/N at 23, CE at 24–26; 2022 = benefits Y/N at col b (20–22), $/month b+1, $/year b+2, CE b+3..b+5. Sanity-check each row (CE remaining = budget − used). Header-pattern matching (`src/lib/sheets/hr-roster.ts`) is only safe on the 2026 tab.
- **Evidence:** 2026-10-14 — all 29 rows matched one of the three layouts; corrected in production (owner decision), then 0249 added whole-day CHECKs on the balances.

### Production's applied-log is incomplete — always pass `--from`
- **Problem:** `.secrets/applied-uekumyupkhnpjpdcjfxb.log` lists only ~30 files, so `ALLOW_PROD=1 … apply_migrations.sh` without `--from` would replay ~225 already-applied migrations against production.
- **Fix:** `ALLOW_PROD=1 SUPABASE_PROJECT_REF=<prod> scripts/apply_migrations.sh --from 0NNN --dry-run`, check it lists only the new file(s), then run without `--dry-run`.
- **Evidence:** 2026-10-14 dry run for 0248 reported `skipped=30 total=256`; with `--from 0248` it listed only 0248.

### Running server-only lib code from a script
- **Fix:** stub `server-only` (`/tmp/stub/node_modules/server-only` exporting `{}`) and run with `NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 <script>.mts`. Load env by parsing `.env.local` in the script: `source .env.local` breaks on `RESEND_FROM_EMAIL=Name <addr>`. `after()` from `next/server` throws outside a request, so guard it. Examples: `scripts/ask_smart.mts`, `scripts/e2e_work_center.mts`.
- **Evidence:** 2026-10-09: a read-only dashboard probe against production and the staging e2e both ran this way.

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

### `now()` inside a locking function is the transaction start, not the moment the lock is acquired
- **Problem:** in `record_time_punch()` (0240), a staging probe of four punches in one transaction stored them all at the same instant, and a call that waited on the per-person advisory lock could be stamped earlier than the punch it waited for — so "last punch" ordering and the double-tap check were unreliable.
- **Root cause:** `now()` is fixed at transaction start. `clock_timestamp()` is the real time.
- **Fix:** take the advisory lock first, then `v_now := clock_timestamp()`.
- **Prevent:** any function that orders, deduplicates or rate-limits by time after taking a lock uses `clock_timestamp()` after the lock.
- **Evidence:** 2026-10-13 staging probe: sequence `clock_in>lunch_start>lunch_end>clock_out` only came back in order after the change.

### `SECURITY DEFINER` functions granted to `authenticated` bypass the whole RLS floor
- **Problem:** 28 definer functions (appointment review, Med Ops board seed/patch, referral upload undo, refresh helpers) were callable through `/rest/v1/rpc/*` by any signed-in Supabase user, including EmployeeGMGDD-only logins, with no `is_gdo_user()` check. `rls_audit()` returned 0 rows.
- **Root cause:** a definer function runs as its owner and never consults RLS. 0211 only revoked PUBLIC/anon; the `authenticated` grants were kept because pages called the functions with the user client. `rls_audit()` only checked anon EXECUTE.
- **Fix:** 0238 revokes `authenticated` on every non-trigger definer function except the policy helpers `is_gdo_user` / `is_gdo_admin`; the app calls them with `createAdminClient()` after its module check. `rls_audit()` now reports "SECURITY DEFINER executable by authenticated".
- **Prevent:** a new RPC is service-role only (the event trigger already does this). `src/lib/security/baseline-grants.test.ts` fails CI if the baseline grants one. Before revoking, check that no *invoker* function, policy or view calls the function (all nested callers here were definer).
- **Evidence:** 2026-10-13, read-only production probe listed the 28; staging after 0238: `rls_audit()` `[]`, RLS matrix PASS with `definer_fns_open_to_authenticated: 0`.

### Layouts and pages render in parallel — a redirect target must not depend on its own group's layout
- **Problem:** while designing a separate self-service login state (0238, since retired), redirecting it from `requireUser()` to `/` would have looped: the `(app)` dashboard page calls `requireUser()` while its layout is still deciding.
- **Root cause:** Next 16 renders layouts and pages in parallel (`node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`, "layouts and pages are rendered in parallel"), so a page's `redirect()` fires even when the layout would not render it.
- **Fix:** a redirect target for a state that `(app)` refuses must live outside the `(app)` group and check auth itself.
- **Evidence:** 2026-10-13, Next 16.4.0 docs; design only (not reproduced in a browser — AGENTS.md bans browser verification).

### A new table silently gets a permissive `gdo_members_all` policy
- **Problem:** after 0235 created `resource_document_signature` with a narrow read policy (own rows or HR roles), the staging RLS matrix showed Staff reading other people's signatures (`staff doc_signatures=2`).
- **Root cause:** the `greendogops_protect_new_objects` event trigger runs `protect_new_objects()` on every `CREATE TABLE` and adds `gdo_members_all` (FOR ALL, any active user). Policies are OR-ed, so it overrides any narrower policy the migration adds. `rls_audit()` does not flag it — the table has RLS and a policy.
- **Fix:** in the migration, right after creating the table and before the narrow policies: `drop policy if exists gdo_members_all on greendogops.<table>;` (0230 and 0235 do this). Writes stayed blocked here only because the migration also revoked INSERT/UPDATE/DELETE from `authenticated`.
- **Prevent:** add the new boundary to `scripts/security_rls_matrix.sql` and run it on staging; check `pg_policies` for the new table.
- **Evidence:** 2026-10-12, matrix FAIL → added the drops → fresh apply and re-apply both leave only the intended policies; matrix PASS.

### Rehearse a data import on staging by copying only the metadata rows it needs
- **Problem:** `import_google_docs_native.mjs` could not be dry-run against production before 0235 existed there, and staging had none of the Google-linked rows.
- **Fix:** generate idempotent `insert … where not exists` statements from production with `format()`/`string_agg` (titles, ids, paths — no personal data), apply them to staging, then run the script with `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` exported from `.secrets/supabase-staging.env`. Compare a hash of the affected rows before/after to prove a second tool leaves them alone.
- **Evidence:** 2026-10-12: 22 documents imported on staging, re-run skipped all 22; `ingest_google_docs.mjs` re-run left the md5 of all native rows unchanged.

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

### Under memory pressure, any agent process over ~150 MB is SIGTERM'd
- **Problem:** with the Codespace near its 8 GB limit (several VS Code/Copilot sessions, no swap, <1 GB available), `npm ci` died with 137, and `npm run lint`, `npx vitest run` and even `npm install <pkg>` died with 143 within seconds. A bare `node` allocating 150 MB was killed too; 100 MB survived.
- **Fix:** copy (`cp -a`, or `cp -al` per the worktree lesson) the shared `node_modules` instead of `npm ci`; run npm with `NODE_OPTIONS="--max-old-space-size=120 --max-semi-space-size=1"` (installs/updates then complete). Lint and vitest can't fit — push to a branch and let `ci.yml` run them (the Codespaces token can't `workflow_dispatch`, HTTP 403, so open a draft PR to trigger `pull_request`, then close it).
- **Evidence:** 2026-10-10 Dependabot batch (#4/#5/#7/#8): local probes above; CI on draft PR #9 ran lint + 357 tests.

### eslint 10 with eslint-config-next 16.4.0
- `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 and `eslint-plugin-jsx-a11y` 6.10.2 (latest as of 2026-10-10) don't list eslint 10 as a peer, so npm prints `ERESOLVE overriding peer dependency` warnings. They still work: the react plugin falls back to `context.sourceCode`, and the only import rule enabled (`no-anonymous-default-export`) doesn't use the removed `context.parserOptions`. If a future config enables `import/no-default-export`/`no-named-export`/`unambiguous`, it will crash on eslint 10 (`'sourceType' in context.parserOptions`).
- **Evidence:** CI lint on eslint 10.12.0: 0 errors, same 2 warnings as main (run 38009712712).

### A non-function export in a `"use server"` file breaks the production build
- **Problem:** Vercel build failed with "Export optInToTexts doesn't exist in target module … The module has no exports at all", although the function was exported.
- **Root cause:** `src/app/texts/actions.ts` (`"use server"`) also had `export const OPT_IN_SOURCE`. Next allows only async function exports there; with any other export Turbopack drops the module's exports entirely. Editor diagnostics and vitest don't catch it — only `next build` does.
- **Fix:** keep constants non-exported or in a separate module. `src/lib/shared/use-server-exports.test.ts` now fails on `export const/let/var/class/enum/function` (non-async) in any `"use server"` file.
- **Evidence:** 2026-10-12, `8e7b35a` failed `BUILD_UTILS_SPAWN_1`; production stayed on the previous READY deployment.

### Smart Report / Ask Ziggy: SQL can hide inside string literals
- **Problem:** both guards (`blockedIdentifier` in `smart-scope.ts` and `smart_query()`'s keyword check) strip string literals before matching, so `query_to_xml('select * from person_employment', true, false, '')`, `table_to_xml('person_employment'::regclass, ...)` and `ts_stat('select ...')` named a blocked table only inside a literal and passed both checks — for every tier.
- **Fix:** `unsafeFunction()` in `smart-scope.ts` rejects `*_to_xml*`, `ts_stat`, `ts_rewrite`, `reg*` casts / `to_reg*`, `pg_*` and `lo_*` identifiers for every tier (still to mirror in the database — see improvements.md). Separately: column blocking never protects a table, because `to_jsonb(t)` and `t::text` return whole rows — anything on the General allow-list must be safe in full.
- **Evidence:** 2026-10-12 — unit tests in `smart-scope.test.ts`; live run as the `general` tier refused the injection prompt and revenue questions while the owner tier still answered revenue.


### Ask Ziggy: a guessed literal in an exclusion fails silently
- **Problem:** "remove any 101 and 501 clients" returned clients carrying those tags. The SQL used `tag_norm IN ('code_101', 'code_501')` (other runs: `'code 101'`); the real values are `'code *101*'` / `'code *501*'`. Inside `NOT EXISTS` a non-matching literal excludes nobody, so the query still returns rows and the empty-result retry never fires.
- **Root cause:** `smart_value_hints()` reads planner stats for tables/matviews only (`relkind in ('r','p','m')`); `report_contact_tag` is a plain view, so the model never saw a tag spelling. Any other view-only vocabulary has the same blind spot.
- **Fix:** `smart.ts` loads `report_contact_tag_summary.tag_norm` with the cached catalog, lists it under "Common column values", and `unmatchedFilters()` (`smart-sql-checks.ts`) rejects SQL whose `tag`/`tag_norm` `=`/`IN`/`<>`/`LIKE` literal matches no real tag, sending the real spellings back for the retry. The same check now covers `ezyvet_animal.master_problems` items.
- **Evidence:** 2026-10-12 — `smart_question_log` 1569694c… (2026-10-07) ran the bad SQL; the guessed spellings match 0 active clients vs 69 for the real ones. After the fix a live `ask_smart.mts` run used `'code *101*', 'code *501*'` and returned 31,954 = 32,023 active − 69 tagged.

### Ask Ziggy: why follow-ups and "correct" declines went wrong
- **Follow-ups never saw the previous query.** The prompt said "take the previous turn's query", but the chat only sent each answer's first 600 characters. "Now remove the 101s" rebuilt the list from scratch (2,686 → 3 → 0 rows on 2026-09-17). Fix: the client sends the answer's `logId`; `askSmartQuestion` loads that SQL from the user's own `smart_question_log` row, and `historyBlock` shows it. Live check: a 5,511-row list → 5,491 with the tag exclusion added and every other filter kept (20 tagged clients, confirmed by direct count).
- **An honest "not in our data" was retried as a refusal.** "Industry average one-time-visit %" failed after 3 attempts because `REFUSAL_RETRY` rejected every decline. Fix: `source: 'external'` returns the answer directly.
- **Verified examples can teach a bug back.** Two verified queries matched raw `contact_tags` and read invoice lines from 2024-09-01. `askSmartReport` now drops examples that fail `sqlProblem()` / `coverageGaps()`.
- **Appointment-record coverage was stale in the prompt.** It said 2026-01-01; `ezyvet_appointment_record` is complete from 2024-11 (≈1,800–3,000 rows/month, near-daily) plus ~3.5k scattered 2015–2016 rows. Prompt and `COVERAGE` now say 2024-11-01. Re-check with a monthly `count(*)` before changing it again.
- **Evidence:** 2026-10-12, live read-only eval with `askSmartReport` (owner scope) for each case; unit tests in `smart-sql-checks.test.ts`.

### `smart_query()` cannot write, even through a volatile function
- **Question:** `greendogops` has volatile SECURITY DEFINER routines (`merge_person`, `medical_board_rollover`, `rate_limit_hit`, …) that are not in the Smart Report catalog, so the identifier guard does not block them by name. Could `select merge_person(...)` through Ask Ziggy modify data?
- **Answer:** no. PostgREST runs `STABLE` functions in a read-only transaction. A staging probe — `POST /rest/v1/rpc/smart_query` with `select greendogops.rate_limit_hit('ziggy-readonly-probe', 5, 60)` — returned `25006 cannot execute INSERT in a read-only transaction`. Keep `smart_query` `STABLE` and called only through PostgREST; if it is ever made `VOLATILE` or called over a direct connection, this protection disappears.
- **Evidence:** 2026-10-12, staging `yzxcuiwklrmxarzjzukr`.

### Testing SQL functions on staging without leaving data behind
- **Fix:** put inserts and assertions in one `DO` block that always ends with `raise exception 'PASS ...'`, so the whole block rolls back; any other error text names the failing check. Example: `scripts/ziggy_lookup_test.sql` (run with `SUPABASE_PROJECT_REF=yzxcuiwklrmxarzjzukr scripts/supabase-sql.sh -f ...`). Staging has no ezyVet rows, so synthetic data is the only way to exercise ezyVet functions there.
- **Baseline seed drift:** `scripts/generate_baseline.sh` (staging by default) also rewrites `0003_config_seed.sql` from staging's config rows, which differ from production's (departments IM/AP/Exotic, `show_in_planning`). For a schema-only migration, keep `0001_schema.sql` and restore `0003_config_seed.sql`. Evidence: 2026-10-12, 0233/0234 regeneration.


### Verifying staff emails: use the live Slack directory, not the Merit Increase spreadsheet
- **Fact:** `public/Merit Increase Calculator (1).xlsx` contains no email addresses in any sheet (no `@` in cells, formulas, hyperlinks, or `sharedStrings.xml`). It is useful only as a list of current employees ("2026 EMP PROFILE DATA").
- **Best source:** Slack `users.list` (with `SLACK_BOT_TOKEN`, read-only). Compare `person.email` with the live member, and flag cases where the HR address belongs to a **deleted** Slack member while an active member with the same name uses another address. Work emails follow `greendog<name>@gmail.com` (older ones: `mypet<name>@gmail.com`). Some doctors and contractors keep practice or personal addresses by design.
- **Before changing `person.email`:** it is used to auto-provision logins (`ensureAuthUserForPerson`), match users in `user-roster-sync`, match Slack accounts, and send ATS forms and bookings. Check `app_user` and other `person` rows for collisions first.
- **Evidence:** 2026-10-12. Of 93 scheduler-active people, 82 Slack links were live and matched exactly. 3 stale HR emails were fixed with user approval. 2 people had no email in any source.

### "Minified React error #441" in a client = a Server Action threw
- **Fact:** in production, React replaces a thrown Server Action's message with error #441 ("An error occurred in the Server Components render… message omitted"), so `catch (e) { e.message }` in the client shows that text instead of ours. Return failures as data (`{ ok: false, answer }`), never `throw` a user-facing message.
- **Common trigger:** "View as". `requireUser()` / `getCurrentUser()` refuse every Server Action POST during a preview unless called with `{ allowPreview: true }`. Pure reads (Ask Ziggy, reporting, schedule search) must opt in; any write inside them (e.g. `smart_question_log`) must be skipped when `current.viewAs` is set.
- **Evidence:** 2026-10-13. Owner previewing a STAFF user got #441 for every Ask Ziggy question; fixed in `ask-ziggy/actions.ts`, pinned by `ask-ziggy/actions.test.ts`.

### `person_employment.annual_wages` is not recalculated when pay changes — read `current_rate`
- **Fact:** HR raises go through `current_rate` (profile form and roster grid both stamp `previous_rate` + `latest_wage_change_date`). `annual_wages` and `biweekly_wage` are separate stored fields that nothing recomputes, so they lag after a raise. `current_rate` is also sometimes an annual figure on a row marked `hourly`.
- **Rule:** for current pay, annualize `current_rate` (≥ 1,000 → annual as-is; otherwise × 2,080), skip `day_rate`/`contract`, and fall back to `annual_wages` / `biweekly_wage` only when there is no rate. Current title is `adp_job_title` first; `offer_title` is the title at hire. Implemented in `src/lib/hr/emp-reporting.ts` (`annualizeSalary`, `currentTitle`), pinned by `emp-reporting.test.ts`.
- **Still open:** Ask Ziggy's prompt (`src/lib/reporting/smart.ts`) still tells the model `annual_wages` is the only column to rank pay on — see `improvements.md`.
- **Evidence:** 2026-10-14, read-only aggregate query on production: 5 of 93 active employees had `annual_wages` disagreeing with `current_rate` (e.g. salary rate raised, annual unchanged); 42 had `offer_title` ≠ `adp_job_title`.
