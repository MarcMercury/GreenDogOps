# Improvement backlog

Work discovered but deliberately not done. Highest value first. Each entry:
**why it matters**, **scope**, **risk**. Remove entries when done (mention the commit).

## P1 — Safety net

### Roles added from Set Up between 2026-09-29 and 2026-10-13 may be inactive
- **Why:** `de633bb` replaced `saveRole`'s `formData.has("is_active") ? … : true` with the plain `checkbox` helper, and the Add-role form never sends `is_active`, so every role created there was inserted with `is_active = false`. The eligibility matrix still showed them, but `getPersonEligibility` (HR profile) lists active roles only. Fixed in code on 2026-10-13 (`checkboxDefaultOn`, pinned by `src/features/scheduling/setup/schema/role.schema.test.ts`); the rows already written are not.
- **Scope:** read-only check first — `select id, name, department_id, created_at from greendogops.sched_role where is_active = false order by created_at;` — then, with the owner's go-ahead, `update … set is_active = true` for the ones that were meant to be live (production write: needs explicit authorization; roles the owner deliberately deactivated must stay off).
- **Risk:** low; a role flipped back to active only widens who can be picked for its shifts.

### New hires do not get an Ops login automatically
- **Why:** `ensureAuthUserForPerson()` (HR save, ATS hire) creates only the Supabase Auth user, never the `app_user` row, so anyone hired after the 2026-10-13 bulk provisioning has no login until an admin grants one. `scripts/provision_logins.mts` (idempotent, dry run by default) closes the gap by hand.
- **Scope:** create the `app_user` (role per owner decision) in `ensureAuthUserForPerson` and the daily roster sync; invites stay a separate, explicit step (Gate 1 item 2).
- **Risk:** low.

### Staff self-service: PTO requests (My Time is live for clock, schedule, timecard)
- **Why:** `/me` (0240) covers clock in/out, the published schedule, the timecard and correction requests. PTO self-service is still HR-only (`saveTimeOff` → `ensureCanEdit("hr")`).
- **Scope:** a PTO tab in `/me` (Gate 2 item 23): Server Action writing `person_time_off` with the service role for `appUser.person_id` only. Do **not** reopen the `schedule` module to Staff — it exposes everyone's grid.
- **Risk:** medium (new write path; PTO is the CA sick-leave vehicle).

### Architectural contract tests
- **Why:** catch violations of the invariants in architecture.md that ordinary unit tests miss.
- **Scope:** static vitest checks over the source tree — e.g. no `createClient(` outside `src/lib/supabase`; no `createAdminClient` / service-role import in `"use client"` files; every `actions.ts` / `src/features/**/actions/*.ts` export calls a permission helper, and no `src/features/**/db/*.ts` file is missing `import "server-only"`; every `src/app/api/**/route.ts` listed in `vercel.json` calls `isAuthorizedCronRequest` (that each one passes the proxy is already tested in `src/lib/supabase/public-paths.test.ts`); migrations reference no schema but `greendogops`; no `grant execute ... to authenticated`.
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
  - **Reach:** only ~22 of ~94 employees have logins. Either provision Staff logins or add a Slack slash command (no `*:history` scopes needed).
  - **Search-quality follow-ups (2026-10-12):**
    - Two *verified* examples (`smart_question_log` 781a7086…, 4df788f5…) match raw `contact_tags` and read invoice lines from 2024-09-01. They are now skipped at prompt time by `sqlProblem()`/`coverageGaps()`, but un-verify them (production write — needs owner OK) so the admin view stops treating them as correct.
    - Review and activate/edit the four glossary drafts (`code 101`, `lapsed client`, `ap required`, `active client`). "active client" needs a business decision (ezyVet flag ≈ 32k vs seen-in-12-months ≈ 8.2k).
    - The "advanced procedures" glossary entry aliases `ap`, so any "AP Required" question also injects AP-department revenue guidance. Drop that alias, or rely on the `ap required` entry once active.
    - `smart_value_hints()` skips views (`relkind in ('r','p','m')`), so any view-only vocabulary is invisible to the model. Tags and master problems are now loaded in `smart.ts`; a general fix is a DB function that samples distinct values from allow-listed view columns.
  - **Links in answers:** link patients to `/ezyvet/patients` and employees to `/hr/[id]` from result rows.
- **Risk:** medium — every item widens what the model can see; keep each behind the allow-list tests.

## P2 — Reliability

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
  - Turn on Slack app ▸ Interactivity (Request URL `/api/slack/interactions`); confirm `SLACK_SIGNING_SECRET` in Vercel matches the app's Signing Secret (a 401 in the Vercel logs on a click means it doesn't).
  - No `marketing_admin` logins exist yet (2026-10-12), so marketing team notifications reach nobody until someone has that role or Admin ▸ Notifications adds people.
  - Missed clock-in / clock-out: no punch data exists. Needs a time-clock source (When I Work API on a higher plan, or payroll). `attendance.missed_shift` fires only when a No-show is marked by hand.
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
