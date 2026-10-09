# Improvement backlog

Work discovered but deliberately not done. Highest value first. Each entry:
**why it matters**, **scope**, **risk**. Remove entries when done (mention the commit).

## P1 — Safety net

### CI for lint + unit tests
- **Why:** `.github/workflows/` only verifies the baseline and runs agents/backups. Lint and the vitest suite never run on push, and local `tsc` is impossible — so Vercel's build is the only automated gate.
- **Scope:** one workflow running `npm ci`, `npm run lint`, `npm test` on push/PR.
- **Risk:** low.

### Architectural contract tests
- **Why:** catch violations of the invariants in architecture.md that ordinary unit tests miss.
- **Scope:** static vitest checks over the source tree — e.g. no `createClient(` outside `src/lib/supabase`; no `createAdminClient` / service-role import in `"use client"` files; every `actions.ts` export calls a permission helper; every `src/app/api/**/route.ts` listed in `vercel.json` calls `isAuthorizedCronRequest` (that each one passes the proxy is already tested in `src/lib/supabase/public-paths.test.ts`); migrations reference no schema but `greendogops`; no `grant execute ... to authenticated`.
- **Risk:** low; may surface existing violations that need triage.

### Security follow-ups from the ASVS L2 pass (0227)
- **Why:** items deliberately left out of the 0227 security commit; see `docs/security.md` §11 for owner-only actions.
- **Scope:**
  - Bring staging up to date with production. On 2026-10-09 the staging dry-run listed 0215–0227 as unapplied, though 0228 and 0229 are applied there. `generate_baseline.sh` reads staging by default, so until staging catches up, regenerate the baseline from a read-only production dump: `SOURCE_REF=<prod ref> DB_PASS=… scripts/generate_baseline.sh`. That is how it was regenerated on 2026-10-09, with 0229.
  - ATS Slack announcements post a 7-day signed resume URL (`src/lib/ats/slack-announce.ts`) — link to `/ats/<id>` instead.
  - `recordAudit()` swallows failures; consider surfacing audit-write errors for security events.
  - Indeed webhook has HMAC but no replay window (Indeed sends no timestamp) — confirm ingest is idempotent per application id.
  - Decide whether to enforce `security.session_timeout_minutes` (would sign out always-on board displays).
  - Consider whether `person.date_of_birth` is needed at all (data minimisation).
- **Risk:** low each.

## P2 — Reliability

### Slack notifications — Phase 2/3 (Phase 1 linking shipped with 0229)
- **Why:** staff should get Slack DMs for actionable events. `person_slack_link` now maps people to Slack ids.
- **Scope (Phase 2):**
  - `notification` table (person, event type, payload with no sensitive data, unique dedupe key, read_at) and `notification_delivery` table (channel, slack id, status, attempts, Slack ts, error).
  - `publishNotification()` in `src/lib/notify/`, plus a dispatcher cron that records each delivery before sending, retries a bounded number of times, and debounces schedule edits.
  - DM via `chat.postMessage` with `channel = <slack user id>`. Needs only `chat:write`; never set `username`/`icon_url` on DMs.
  - Gate real sends behind `SLACK_DM_LIVE` plus a test allow-list.
  - Events: PTO approved/denied (both `reviewTimeOff` and `setTimeOffStatus`), interview assigned (`person_interview.host_user_id`), schedule published/changed (`sched_change_log`).
  - In-app inbox for login holders.
- **Open decisions:** who receives `PTO_REQUESTED` (no manager relationship exists in the data model); whether `TIMECARD_EXCEPTION` maps to `sched_assignment.attendance_status` (there is no timecard/punch data).
- **Phase 3:** per-user preferences, email/SMS fallback, push, schedule acknowledgement.
- **Risk:** medium — sends are externally visible; must not include compensation, HR notes or other sensitive data.

### Unused `calendar_notification` table
- **Why:** it exists in the schema but nothing in `src` reads or writes it (checked 2026-10-09). The Phase 2 delivery log supersedes it.
- **Scope:** confirm no external consumer, then drop it in a migration.
- **Risk:** low.

### Unified integration-health view
- **Why:** `/admin/agents` shows browser-agent runs only. Cron jobs (calendar sync, Gmail poller, Sheets sync, Slack digests) have no shared last-success / staleness record, so silent failures go unnoticed.
- **Scope:** record cron runs in `agent_run` (or a sibling table); add last-success, staleness, and error-category to the admin view; alert on repeated failures.
- **Risk:** medium — touches every cron route.

### Recurring-failure improvement report
- **Why:** turn `agent_run` failures + lessons.md into a periodic, prioritised report instead of rediscovering issues.
- **Scope:** depends on the health view above.
- **Risk:** low once data exists.

## P3 — Code quality

### Two divergent `fetchAllRows` implementations
- `src/lib/supabase/paginate.ts` (used by ~18 files, also exports concurrent variant) and `src/lib/supabase/fetch-all.ts` (2 files, structurally typed builder). Consolidate into one.
- **Risk:** low; check call-site signatures.

### Shared to-one embed helper
- README says "use the existing first*() helpers" but none exist; files unwrap ad hoc (e.g. `one<T>()` in `src/lib/ats/job-hires.ts`). Add one helper in `src/lib/supabase/` and fix the README.
- **Risk:** low.

### Vitest config
- No `vitest.config.*`; works today on defaults. Add one if path aliases or `server-only` imports start breaking tests.
