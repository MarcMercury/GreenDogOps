# Improvement backlog

Work discovered but deliberately not done. Highest value first. Each entry:
**why it matters**, **scope**, **risk**. Remove entries when done (mention the commit).

## P1 — Safety net

### Architectural contract tests
- **Why:** catch violations of the invariants in architecture.md that ordinary unit tests miss.
- **Scope:** static vitest checks over the source tree — e.g. no `createClient(` outside `src/lib/supabase`; no `createAdminClient` / service-role import in `"use client"` files; every `actions.ts` export calls a permission helper; every `src/app/api/**/route.ts` listed in `vercel.json` calls `isAuthorizedCronRequest` (that each one passes the proxy is already tested in `src/lib/supabase/public-paths.test.ts`); migrations reference no schema but `greendogops`; no `grant execute ... to authenticated`.
- **Risk:** low; may surface existing violations that need triage.

### Security follow-ups from the ASVS L2 pass (0227)
- **Why:** items deliberately left out of the 0227 security commit; see `docs/security.md` §11 for owner-only actions.
- **Scope:**
  - Smart Report: unqualified names still resolve through `smart_query()`'s `search_path` (`greendogops, public, pg_temp`), so a query naming an EmployeeGM table without `public.` reaches it. Schema-qualified names are rejected in `smart-scope.ts` (`fefe355`). Fix in the database: drop `public` from the `search_path` of `smart_query` and `smart_value_hints` (production DDL — needs authorization), or run the query as a role that can read only greendogops.
  - `recordAudit()` swallows failures; consider surfacing audit-write errors for security events.
  - Indeed webhook has HMAC but no replay window (Indeed sends no timestamp) — confirm ingest is idempotent per application id.
  - Decide whether to enforce `security.session_timeout_minutes` (would sign out always-on board displays).
  - Consider whether `person.date_of_birth` is needed at all (data minimisation).
- **Risk:** low each.

## P2 — Reliability

### Slack notifications — remaining work (Phase 1 linking: 0229; notification + DM pipeline: 0230)
- **Done in 0230:** `user_notification` + `notification_delivery`, `publishNotification()`, the `/api/notify/dispatch` cron (gated by `SLACK_DM_LIVE` / `SLACK_DM_TEST_USER_IDS`), the in-app inbox on the dashboard, and the "interview booked" notification to the host.
- **Still to do:**
  - Turn DMs on: test with `SLACK_DM_TEST_USER_IDS=<your Slack id>`, then set `SLACK_DM_LIVE=true`.
  - Notify people who have **no login** (most employees). Recipients are `app_user` today. Add a person-keyed recipient, or a DM-only path for `person_slack_link`.
  - Events: PTO approved/denied (`reviewTimeOff` and `setTimeOffStatus`), schedule published/changed (`sched_change_log`, debounced), interviews assigned by staff (the candidate self-booking path is done).
- **Open decisions:** who receives `PTO_REQUESTED` (no manager relationship exists in the data model); whether `TIMECARD_EXCEPTION` maps to `sched_assignment.attendance_status` (there is no timecard/punch data).
- **Phase 3:** per-user preferences (mute kinds, DM vs in-app), email/SMS fallback, push, schedule acknowledgement.
- **Risk:** medium — sends are externally visible. Never include compensation, HR notes or other sensitive data.

### Dashboard work center follow-ups (0230)
- **Slack message summaries:** needs per-user "Connect Slack" OAuth with user scopes (`search:read` / `im:history`), encrypted token storage, and LLM summaries of personal messages. That reverses the documented "app must not read messages" rule, so it needs the owner's explicit approval first. The dashboard has a placeholder.
- **More work sources:** HR onboarding, but limited to recent hires — 84 employees have legacy incomplete items, so listing all of them would flood the list. CRM follow-ups (`crm_contact.needs_followup` / `next_followup_date`) need an owner column first. CEbroker submissions.
- **Task history page:** completed and dismissed tasks only disappear today. Add a `/tasks` view with filters.
- **Starter reminders aren't in the baseline:** `reminder_rule` holds personal rows (FK to `app_user`), so it can't be in `CONFIG_TABLES`. A rebuilt database gets no starter set until 0230's seed block is re-run.
- **Risk:** low each.

### Unused `calendar_notification` table
- **Why:** it exists in the schema but nothing in `src` reads or writes it (checked 2026-10-09). The Phase 2 delivery log supersedes it.
- **Scope:** confirm no external consumer, then drop it in a migration.
- **Risk:** low.

### Integration health — remaining work (0231 built the view)
- **Done in 0231:** every Vercel cron is registered in `agent` and records runs through `src/lib/admin/cron-run.ts`; the `agent_run_rollup` trigger keeps `last_success_at` / `last_error` / `consecutive_failures`; Admin ▸ Agents has a health table; failing / stale / stuck jobs show on admins' dashboards. `cron-registry.test.ts` fails if a `vercel.json` cron isn't registered.
- **Still to do:** a Slack or email alert for failing jobs (today it is the dashboard only); the GitHub Actions jobs (database backup, baseline verify) are not tracked; `agent` rows are not in the baseline seed (`CONFIG_TABLES`), so a rebuilt database has no registered jobs until the migrations' insert blocks are re-run.
- **Risk:** low.

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

### Baseline config seed has drifted from staging
- **Found:** 2026-10-12 while regenerating the baseline for 0232. `scripts/generate_baseline.sh` wanted to rewrite `0003_config_seed.sql` (sched_department `show_in_planning` flags, 3 extra sched_role rows, a planning_capacity_rule row, ezyvet_appt_type_dept_map rows). These are staging data edits unrelated to 0232, so only `0001_schema.sql` was committed.
- **Scope:** confirm whether staging's config matches production; regenerate `0003` deliberately (or fix staging first).
- **Risk:** low.

### `format_phone()` is executable by `authenticated`
- **Found:** the regenerated baseline shows `GRANT ALL ON FUNCTION greendogops.format_phone(text) TO authenticated` (Supabase default privileges; created in 0162/0213). It is an IMMUTABLE pure formatter with no table access, so exposure is nil, but it breaks the "no RPC EXECUTE for authenticated" rule. Revoke in a migration if nothing client-side calls it.
- **Risk:** low.
