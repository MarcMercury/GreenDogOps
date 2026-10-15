# Improvement backlog

Work discovered but deliberately not done. Highest value first. Each entry:
**why it matters**, **scope**, **risk**. Remove entries when done (mention the commit).

## P1 — Safety net

### PTO annual cycle (Jan 1 grant, tenure step-up, year-end payout)
- **Why:** since 0246 Ops keeps the PTO balance current from approvals, but nothing yet resets it on Jan 1, adds the +2-day tenure step-up, prorates a new hire's first year or computes the Dec 31 / separation payout (plan §H, D8a–D8e).
- **Scope:** pure rules in `src/lib/pto/**` + an idempotent Jan 1 job (agent_run) writing through `person_employment` so `pto_ledger` records it; `pto_eligible` flag; the 5-day sick-leave floor warning. Must land before 2027-01-01.
- **Risk:** medium (pay-affecting).

### The schedule grid approves PTO without asking how many days
- **Why:** since 0246 an approval deducts `coalesce(pto_days, end_date − start_date + 1)` for kind `pto`/`vacation`. `/schedule/time-off` (`reviewPtoRequest`) lets the approver set `pto_days`, kind and a note, and only decides `requested` rows; the grid's Approve/Deny (`setTimeOffStatus` in `schedule/actions.ts`, moved to `scheduling-grid/actions/time-off-actions.ts` on the scheduling refactor branch) sets only `status`, so a grid approval deducts every calendar day, weekends included. Reversals refund correctly (the trigger applies deltas). Verified 2026-10-14: 0246 is live in production.
- **Scope:** one shared approval function (owned by the PTO feature) that both paths call; the grid either asks for days or sends the approver to `/schedule/time-off`. Do it after the scheduling refactor merges, in its structure (`docs/agent/contributing-scheduling.md`).
- **Risk:** medium (pay-affecting balance).

### Architectural contract tests
- **Why:** catch violations of the invariants in architecture.md that ordinary unit tests miss.
- **Done:** every exported Server Action starts with a permission gate — `src/lib/security/server-action-gates.test.ts` (2026-10-14).
- **Scope (remaining):** static vitest checks over the source tree — e.g. no `createClient(` outside `src/lib/supabase`; no `createAdminClient` / service-role import in `"use client"` files; every `src/app/api/**/route.ts` listed in `vercel.json` calls `isAuthorizedCronRequest` (that each one passes the proxy is already tested in `src/lib/supabase/public-paths.test.ts`); migrations reference no schema but `greendogops`; no `grant execute ... to authenticated`.
- **Risk:** low; may surface existing violations that need triage.

### Security follow-ups from the ASVS L2 pass (0227)
- **Why:** items deliberately left out of the 0227 security commit; see `docs/security.md` §11 for owner-only actions.
- **Scope:**
  - Smart Report: unqualified names still resolve through `smart_query()`'s `search_path` (`greendogops, public, pg_temp`), so a query naming an EmployeeGM table without `public.` reaches it. Schema-qualified names are rejected in `smart-scope.ts` (`fefe355`). Fix in the database: drop `public` from the `search_path` of `smart_query` and `smart_value_hints` (production DDL — needs authorization), or run the query as a role that can read only greendogops.
  - `recordAudit()` swallows failures; consider surfacing audit-write errors for security events.
  - Decide whether to enforce `security.session_timeout_minutes` (would sign out always-on board displays).
  - Consider whether `person.date_of_birth` is needed at all (data minimisation).
- **Risk:** low each.

### Ask Ziggy — next phases
- **Why:** the first increment (rename, nav, Staff `general` tier, own shifts/PTO) shipped without a migration. The rest of the owner's "unified AI" spec needs data or decisions.
- **Scope:**
  - **Done (0233/0234):** `product_catalog`, `staff_directory`, `schedule_roster` and the bounded `client_summary` / `client_visits` / `patient_visits` lookups. Possible next: per-visit *payments* (`ezyvet_payment`, `ezyvet_invoice_summary.amount_due`) for "did they pay / what do they owe", via the same bounded-function pattern.
  - **Whole-row leak for the `hr` tier:** managers can read `person_employment` with compensation columns blocked, but `to_jsonb(pe)` / `pe::text` returns them anyway. Managers can see all compensation in the HR app, so impact is limited; fix by removing person_employment from the hr tier in favour of a no-pay view, or deep-scrub nested keys.
  - **Harden `smart_query()` in the database:** mirror the TS unsafe-function guard (xml/ts_stat/regclass/pg_*) in the keyword check, alongside the `search_path` item above.
  - **Clinical notes:** probe the ezyVet Records dashboard for a clinical-record export (note text, prescriptions, allergies). Export cap is 10,000 records.
  - **Reach:** 95 of 110 active staff have logins (2026-10-14, after d070054). A Slack slash command is still an option for people who live in Slack (no `*:history` scopes needed).
  - **Search-quality follow-ups (2026-10-12):**
    - Two *verified* examples (`smart_question_log` 781a7086…, 4df788f5…) match raw `contact_tags` and read invoice lines from 2024-09-01. They are now skipped at prompt time by `sqlProblem()`/`coverageGaps()`, but un-verify them (production write — needs owner OK) so the admin view stops treating them as correct.
    - Review and activate/edit the four glossary drafts (`code 101`, `lapsed client`, `ap required`, `active client`). "active client" needs a business decision (ezyVet flag ≈ 32k vs seen-in-12-months ≈ 8.2k).
    - The "advanced procedures" glossary entry aliases `ap`, so any "AP Required" question also injects AP-department revenue guidance. Drop that alias, or rely on the `ap required` entry once active.
    - `smart_value_hints()` skips views (`relkind in ('r','p','m')`), so any view-only vocabulary is invisible to the model. Tags and master problems are now loaded in `smart.ts`; a general fix is a DB function that samples distinct values from allow-listed view columns.
  - **Links in answers:** link patients to `/ezyvet/patients` and employees to `/hr/[id]` from result rows.
- **Risk:** medium — every item widens what the model can see; keep each behind the allow-list tests.

## P2 — Reliability

### Database performance follow-ups after 0252 (RLS once-per-query)
- **Why:** 0252 removed the per-row RLS cost (lessons.md). Measured on production 2026-10-15, these remain: 58 foreign keys with no supporting index; `report_patients_by_species`, `report_species_by_recency` and `report_clients_by_recency_location` average 1–1.7 s per call (`pg_stat_statements`); three leftover backup tables (`ats_hr_merge_backup_0032`, `person_recruiting_cleanup_0220`, `person_recruiting_score_backup_0225`).
- **Scope:** re-check `pg_stat_statements` after a week of 0252 traffic (`select pg_stat_statements_reset()` needs owner OK); add indexes only where a hot query filters or joins on the column; profile the three views; drop the backups (the first is excluded in `rls_audit()` — remove it there too).
- **Risk:** low (indexes, views); dropping tables needs owner authorization.

### Rehired employees keep their deactivated login
- **Why:** since 2026-10-15 an active employee/contractor gets a Staff login automatically (`ensureAuthUserForPerson` + daily `roster-sync`), but insert-only: the `former` trigger deactivates `app_user`, and a rehire (former → employee) leaves that row inactive because an admin may also have deactivated it on purpose.
- **Scope:** decide whether a former → employee transition should reactivate the login (e.g. only when the last `user.updated`/deactivation came from the trigger, not an admin), then do it in `person_after_change` or the backstop.
- **Risk:** low; owner decision.

### Stored annual wages drift from current rate (Ask Ziggy + HR profile)
- **Why:** `person_employment.annual_wages` / `biweekly_wage` are not recalculated when HR changes `current_rate` (4 active employees disagree as of 2026-10-14). Emp Reporting now reads `current_rate`, but Ask Ziggy's prompt (`src/lib/reporting/smart.ts`) still says `annual_wages` is the only pay column to rank on, and the HR profile summary (`hr/[id]/employee-summary.tsx`) shows `offer_title` before `adp_job_title` as "Job title".
- **Scope:** either recompute `annual_wages`/`biweekly_wage` when `current_rate` changes (needs HR to confirm hours for part-timers) or point Ziggy at the same rule as `annualizeSalary`; align the profile's title order with the roster grid.
- **Risk:** medium (touches compensation records; the owner decides any backfill).

### Reliability v2 and attendance overrides from Time & Attendance
- **Why:** automatic attendance (item 16) maps grades onto the existing statuses and the old weight table (late = 0.6 regardless of minutes). The plan's v2 deducts by severity (late 1–10 min = −1 … no-call/no-show = −15, reduced when excused) over a rolling window. Managers also override only from the grid's attendance menu, not from the dashboard row.
- **Scope:** a pure `reliabilityV2(grades, window)` with tests, used by the attendance page and HR profile once `timeclock.attendance_from` is set; an "Excuse / mark" action on Time & Attendance rows that writes the same `markAttendance` path.
- **Risk:** medium (changes everyone's score — agree the deductions with HR first).

### Time clock: scheduled clinic health check with alerts
- **Why:** Admin ▸ Locations shows each clinic's health (no network match in 24 h with punches → IP changed; off-site spike), but only when someone opens the page. An ISP IP change would silently send a clinic's punches to off-site approval.
- **Scope:** a daily cron (agent + `agent_run`, `cron-run.ts`) that runs `clinicHealth` for every clinic and emits a notification event (e.g. `timeclock.clinic_health`) to Owners/Admins when a clinic turns amber/red. Reuse `getTimeClockAdminData`.
- **Risk:** low.

### Applicant intake creates a second person for someone already on the roster
- **Why:** `findRecentDuplicate` in `src/lib/ats/applicant-intake.ts` only matches `status = 'applicant'`, so an employee or former employee who applies (or is re-imported) becomes a duplicate ATS candidate. 2026-10-13: 14 such duplicates were merged with `scripts/merge_ats_roster_duplicates.sql` (incl. one Indeed application that arrived the same day for an employee hired 09-22). The Indeed CSV importer already matches roster people (`update_roster`); the Gmail/website path does not.
- **Scope:** in intake, when the email (or, with no email, the exact full name **and** the Indeed relay/job) matches an employee/former, attach the application to that person (`application_history` + notes) instead of creating an applicant — owner decision on whether a former employee reapplying should re-enter the ATS as a rehire. Until then, run the script's FIND query periodically.
- **Risk:** medium — name-only matches can be a different person with a common name.

### 35 ATS applicants sit at stage "Hired" without being hired
- **Why:** the stage dropdown offers "Hired", but only **Hire → Employee** (`hireCandidate`) flips `person.status`, so those people stay in the ATS and never reach HR. 2026-10-13: 41 such applicants, all from the 2026-06-16 legacy import; 6 turned out to be roster duplicates (matched by phone) and were merged the same day, leaving 35 with no roster match by email, phone or name.
- **Scope:** owner decision per person (hire → creates a login, mark former, or re-stage) — production data change, needs authorization. Then either drop "Hired" from the hand-picked stage options or have picking it prompt for Hire → Employee.
- **Risk:** low for the UI guard; the cleanup touches production records.

### Slack notifications — remaining work (0229 linking, 0230 DM pipeline, 0236 notification engine)
- **Done in 0236:** person-keyed recipients (employees without a login get DMs), the event registry + rules engine (`src/lib/notify/registry.ts`, `engine.ts`), role/editor/department/person/location routing with permission checks at fan-out and again at send time, channel posts, batching/coalescing, escalation, Block Kit cards with Approve/Deny/Acknowledge/Mark complete (`/api/slack/interactions`), card updates in place, Admin ▸ Notifications (rules, preview, test, delivery log, Slack action log), and events for schedule published / shift changed / coverage / missed shift / PTO requested–decided–modified / marketing created–updated–staffed–canceled–reminder.
- **Still to do:**
  - Turn DMs on: test with `SLACK_DM_TEST_USER_IDS=<your Slack id>`, then set `SLACK_DM_LIVE=true`.
  - Turn on Slack app ▸ Interactivity (Request URL `/api/slack/interactions`) with **Socket Mode off** (an `xapp-` token exists in Vercel; if Socket Mode is on, Slack sends clicks over the socket and never calls the URL). The Vercel `SLACK_SIGNING_SECRET` is a well-formed 32-hex secret and production accepts a request signed with it (2026-10-14 probe: signed no-op click → 200, unsigned → 401); whether it matches the app's secret is only proven by a real click (a 401 in the Vercel logs means it doesn't).
  - 18 active staff have no Slack match (`not_found`) — fix in Admin ▸ Slack; all 21 people who can approve PTO are connected.
  - No `marketing_admin` logins exist yet (2026-10-12), so marketing team notifications reach nobody until someone has that role or Admin ▸ Notifications adds people.
  - Time clock (0240+) now exists: `timeclock.missing_clock_out`, `attendance.late` and the punch/correction events cover clock-out and late clock-in. With time-clock attendance on (Admin ▸ Settings), a shift with no clock-in by the missed window also raises `attendance.missed_shift` automatically (producers.ts).
  - Coverage requests: "Eligible staff" is off by default; turn it on per rule once the team wants open-shift pings. There's no "claim this shift" button yet.
  - More modules (HR onboarding, CE, maintenance, inventory, approvals): add an `EventDefinition` and call `emitEvent()` — see `registry.ts` header.
- **Phase 3:** per-user preferences (mute kinds, DM vs in-app), email/SMS fallback, push, schedule acknowledgement, Slack slash command to query Ops.
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

### Drop the leftover rest-break schema (rule removed 2026-10-14)
- **Why:** the app no longer asks the rest-break question or pays rest premiums (see architecture.md 2026-10-14), but production still has `time_punch.rest_breaks_ok` + its check constraint, `record_time_punch(p_rest_breaks_ok …)`, `'rest_premium'` in the `payroll_override.field` check (0247), and the unused `payroll.adp.code.rest_premium` setting, which still shows in Admin ▸ Settings ▸ Payroll. Verified 2026-10-14: 0 punches answered, 0 `rest_premium` overrides.
- **Scope:** one migration (needs explicit production authorization): delete the setting row, tighten the `field` check, recreate `record_time_punch` without the parameter, drop the column and constraint; then regenerate the baseline and re-run `rls_audit()`.
- **Risk:** low; `record_time_punch` is a single writer called only from `src/app/(app)/me/actions.ts`.

## P3 — Code quality

### Two divergent `fetchAllRows` implementations
- `src/lib/supabase/paginate.ts` (used by ~18 files, also exports concurrent variant) and `src/lib/supabase/fetch-all.ts` (2 files, structurally typed builder). Consolidate into one.
- **Risk:** low; check call-site signatures.

### Shared to-one embed helper
- README says "use the existing first*() helpers" but none exist; files unwrap ad hoc (e.g. `one<T>()` in `src/lib/ats/job-hires.ts`). Add one helper in `src/lib/supabase/` and fix the README.
- **Risk:** low.

### Policy documents — follow-ups to 0235
- **Why:** native policies with access, versions and signatures shipped (0235); these were left out to keep the first release small.
- **Scope:**
  - Work Center: a "Documents to sign" work-list item projected from `resource_document` (today the in-app notification and the Resources banner carry it).
  - Reminders for people who have not signed after N days (a cron + `publishNotification` with a new dedupe key) — needs the owner's cadence.
  - Archived documents: a manager view to list and restore `is_active = false` rows (today only reachable by URL; converted PDF/link copies live there too).
  - Printable acknowledgement (document version + initials + timestamp) for an employee's file, if HR needs paper/PDF evidence.
  - Retire `resource_document.staff_only` (a badge only) now that access control exists.
  - Inline images are data URLs inside every version; move them to storage if documents get image-heavy (Roles & Responsibilities is ~1.4 MB per version).
- **Risk:** low each.

### Vitest config
- No `vitest.config.*`; works today on defaults. Add one if path aliases or `server-only` imports start breaking tests.

### Baseline config seed has drifted from staging
- **Found:** 2026-10-12 while regenerating the baseline for 0232. `scripts/generate_baseline.sh` wanted to rewrite `0003_config_seed.sql` (sched_department `show_in_planning` flags, 3 extra sched_role rows, a planning_capacity_rule row, ezyvet_appt_type_dept_map rows). These are staging data edits unrelated to 0232, so only `0001_schema.sql` was committed.
- **Scope:** confirm whether staging's config matches production; regenerate `0003` deliberately (or fix staging first).
- **Risk:** low.

### `format_phone()` is executable by `authenticated`
- **Found:** the regenerated baseline shows `GRANT ALL ON FUNCTION greendogops.format_phone(text) TO authenticated` (Supabase default privileges; created in 0162/0213). It is an IMMUTABLE pure formatter with no table access, so exposure is nil, but it breaks the "no RPC EXECUTE for authenticated" rule. Revoke in a migration if nothing client-side calls it.
- **Risk:** low.
