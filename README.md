# Green Dog Ops

Internal operations platform for a multi-site veterinary practice (Sherman Oaks,
Van Nuys, Venice). One Next.js app that replaces a pile of spreadsheets and point
solutions with a single permissioned workspace covering **HR, Recruiting (ATS),
seven CRMs, Marketing & Events, Scheduling & Capacity, Medical Ops boards, ezyVet
analytics, AI reporting, and an AI-searchable Resources hub**.

This README is written for engineers joining the project — it covers the stack,
the non-obvious architectural constraints, and where things live.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16.2** (App Router, React 19, Server Components + Server Actions) |
| Language | TypeScript 5 |
| Styling | **Tailwind CSS v4** (PostCSS plugin, no config file) |
| Data | **Supabase** — Postgres, Auth (email/password), Storage |
| Calendar UI | FullCalendar v6 (daygrid/timegrid/list/interaction) |
| Files | `xlsx` (spreadsheet import), `unpdf` (PDF text extraction) |
| Automation | **Playwright** headless Chromium workers (`agent/`) |
| AI | Multi-provider LLM chain — Gemini, Groq, OpenRouter, OpenAI, Anthropic |
| Hosting | **Vercel** (Vercel Cron) + **GitHub Actions** (long-running agents) |

> ⚠️ **Next 16 renamed `middleware` to `proxy`.** The request interceptor is
> [src/proxy.ts](src/proxy.ts), backed by [src/lib/supabase/proxy.ts](src/lib/supabase/proxy.ts).
> It refreshes the Supabase session, redirects unauthenticated requests to
> `/login`, and stamps the `x-gdo-pathname` header so Server Components (which
> cannot read the URL) can resolve which module they are rendering.

---

## Non-negotiable architectural constraints

Read this section before writing any code.

### 1. Schema isolation — this app shares a Supabase project

Green Dog Ops lives in **one Supabase project alongside a second app
(EmployeeGMGDD)** but is fully isolated in its own Postgres schema,
**`greendogops`**. EmployeeGMGDD owns `public`; this app never touches it.

- Every Supabase client sets `db.schema = 'greendogops'` — see
  [src/lib/supabase](src/lib/supabase) and `DB_SCHEMA` in
  [src/lib/supabase/config.ts](src/lib/supabase/config.ts). Never hand-roll a client.
- Every migration creates objects in `greendogops` only.
- `auth.users` is **project-level and therefore shared**. Access to this app is
  gated at the application layer by the `app_user` allow-list + role model, not
  by Supabase Auth membership alone.

One-time project setup: apply [supabase/baseline](supabase/baseline), then
Dashboard → Settings → API → **Exposed schemas** → add `greendogops`.

### 2. RLS: membership floor + sensitive HR boundaries in the database

Every table in `greendogops` has Row-Level Security enabled (migrations
`0164`/`0165`). `auth.users` is shared, so ~100 accounts from the other app get
the `authenticated` role; the blanket `gdo_members_all` policy shuts them out by
requiring an active `app_user` row — and, once a user has enrolled two-step
verification, an AAL2 session.

Migration `0227` moves the sensitive HR boundaries into the database too, so
calling the REST API directly with a user's own token cannot reach past what
the app shows them (see [docs/security.md](docs/security.md)):

- `person_review`, `person_disciplinary_action`, `person_asset`,
  `person_compliance_entry`, `person_onboarding_item`, `person_license`: HR
  roles (owner/admin/executive/manager) or the employee's own record only.
- `person_document`, `profile_transition_log`: same, plus candidates
  (`prospect`/`applicant`) for anyone with Recruiting access.
- **Compensation columns on `person_employment` are not granted to
  `authenticated` at all.** Read/write them with `src/lib/hr/compensation.ts`
  (service role) after the app-level check. A column *added* to
  `person_employment` must be explicitly granted unless it is compensation.
- `audit_log` is append-only (no API access; a trigger blocks
  UPDATE/DELETE/TRUNCATE for every role).

Everything else is still gated in server code (`canAccessModule` /
`canEditModule` / `smartScopeFor`), so:

- Every Server Action must re-check permissions. Do not trust the client.
- **Never grant EXECUTE on a Postgres RPC to `authenticated`.** `0211` revoked
  PUBLIC/anon on all routines because `SECURITY DEFINER` functions run as the
  owner and never consult RLS. A browser-callable `smart_query` would leak
  salaries to any logged-in user. (Role checks inside policies are inline
  subqueries on `app_user`, not helper RPCs.)
- The service-role key bypasses RLS entirely — server-only, never in a
  `NEXT_PUBLIC_*` variable.
- Views and materialized views **cannot** enforce RLS, so all of them are
  revoked from `anon`/`authenticated` and read through `createAdminClient()`.

An event trigger (`greendogops_protect_new_objects`) applies the baseline to
newly created objects automatically. Audit with
`select * from greendogops.rls_audit();` — it should always return zero rows.
Verify the role boundaries on staging with
`scripts/security_rls_matrix.sql` (prints `RLS_MATRIX PASS`).

### 3. PostgREST row cap

The project's `max_rows` is capped at **1000**. Any query that can scan a large
table must paginate with `.range()`. Heavy ezyVet roll-ups are materialized
views refreshed through the `refresh_ezyvet_reporting()` RPC rather than
recomputed per request.

### 4. Type-checking in the dev container

`npx tsc --noEmit` gets OOM-killed in the Codespace (exit 143). Use editor
diagnostics and `npm run lint` locally; Vercel runs the real type-check on push.

---

## Getting started

```bash
cp .env.example .env.local   # fill in your Supabase keys at minimum
npm install
npm run dev
```

Open http://localhost:3000 — unauthenticated users are redirected to `/login`.

| Command         | Description                             |
| --------------- | --------------------------------------- |
| `npm run dev`   | Next.js dev server                      |
| `npm run build` | Production build (runs the type-check)  |
| `npm run start` | Serve the production build              |
| `npm run lint`  | ESLint (flat config, `eslint.config.mjs`) |

---

## Modules

The signed-in shell ([src/app/(app)/_components/app-shell.tsx](src/app/(app)/_components/app-shell.tsx))
renders six sidebar sections. Every item is keyed by a `ModuleKey` and hidden
from users who cannot access it.

**Modules**
- **Dashboard** (`/`, the default page) — each user's work center
  ([src/lib/worklist](src/lib/worklist)):
  - **My work** — their `ops_task` to-dos (made in Ops or by a Slack workflow)
    plus items projected from the modules at read time, filtered by role and
    module access: interviews they host, recruiting queues, time-off and
    schedule approvals, expiring licenses. Each item opens in Ops or in Slack.
  - **Reminders** — recurring checks by day of week / month
    (`reminder_rule`). Admins manage shared ones in **Admin → Reminders**; anyone
    can add personal ones at `/reminders`.
  - **Notifications** — in-app feed (`user_notification`), written only through
    `publishNotification()` ([src/lib/notify](src/lib/notify)), optionally also
    sent as a Slack DM.
  - **Slack** — their Slack link status and what Ops has sent them in Slack.
    Ops does not read Slack messages; summaries need a later per-user consent.
  - **Your activity** — their own audit-log entries.
- **Resources** (`/resources`) — AI search across all program data *and* the
  web, a Green Dog policies wiki (`/resources/policies`, `/policies`), and a
  shared document library with PDF text extraction so uploads are searchable.

**HR / Recruit / GDU**
- **HR / Roster** (`/hr`) — master employee records: employment, payroll,
  reviews, discipline, PTO, credentials, licenses, assets, documents, and
  onboarding checklists.
- **Recruiting (ATS)** (`/ats`) — applicant pipeline, interview tracking, and
  Jobs (open/close; candidates linked to a job, auto-matched on intake), Forms
  (public application at `/apply`, role-specific questionnaires at
  `/forms/<token>`) and interview self-scheduling (`/book/<token>`, per-recruiter
  Google Calendar free/busy). Queues: Review, Form Responses, Interviews and
  Rejected (48-hour cancellable rejection emails via the `/api/ats/rejections`
  cron); 0–10 Candidate Score with history; Slack stays quiet until an
  in-person interview or shadow is scheduled.
  Resumes and PDF candidate lists are parsed with an LLM; a Gmail poller and an
  Indeed export feed candidates in. Hiring promotes the record into HR with a
  single status change.
- **Student CRM** (`/crm/student`) — students, externs, and GDU participants;
  promotable into the ATS, with documents migrated along with the profile.

**Marketing**
- **Marketing Mgmt** (`/marketing`) — campaigns, assets, resource passwords.
- **Event Mgmt** (`/marketing/events`) + **QR Codes** (`/marketing/qr-codes`) —
  event/partner/influencer QR codes with branded landing forms and lead capture.
- **CE / GDU Mgmt** (`/crm/ce`) — continuing-education events, attendees,
  outreach, attendance, and a CEbroker course-submission wizard.
- **Influencer CRM** (`/crm/influencer`) — partnerships, campaigns, performance.
- **Referral CRM** (`/crm/referral`) — referring clinics and hospitals, with
  geocoding, clinic-area mapping, and ezyVet referral-revenue attribution.
- **Rescue/Shelter CRM** (`/crm/rescue`) — rescue and shelter partners.
- **Non-Med Partners** (`/crm/vendor`) — business partners (the former Business
  CRM merged in here).

**Operations**
- **Calendar** (`/calendar`) — unified company calendar: Google Calendar sync +
  custom events stored in `calendar_event`, with CE events, interviews, and
  time-off **projected at read time** rather than duplicated into the table.
- **Scheduling** (`/schedule`) — shift building across locations, plus
  attendance, time-off, availability, setup/eligibility, and a Google Sheet
  two-way sync.
- **Daily Capacity** (`/capacity`) — live daily staffing capacity vs. demand.
- **Planning Guides** (`/planning`) — service-site staffing guides and
  signatures that drive capacity planning.
- **Schedule Search** (`/schedule-search`) — cross-week lookup.

**Med Ops**
- **Medical Boards** (`/med-ops/medical-boards`) + **Board Archive** — clinical
  workflow boards per location, with automatic daily rollover.
- **Vendors & Supplies** (`/crm/supplies`) — medical suppliers and ordering.
- **ezyVet Contacts / Patients** (`/ezyvet`, `/ezyvet/patients`) — client and
  patient records imported from ezyVet, with customer groups, revenue, and
  division trends.

**Biz Dev**
- **Reporting** (`/reporting`) — appointment, revenue, doctor-production, and
  client-trend dashboards built on ezyVet invoice/contact data.
- **Smart Report** (`/reporting/smart`) — natural-language reporting (below).
- **Emp Reporting** (`/emp-reporting`) — payroll and compensation analytics.
- **Biz Dev** (`/biz-dev`) — business-development planner and partner targeting.
- **Admin** (`/admin`) — users, roles, per-user module overrides, locations,
  credentials, Slack user links, settings, agent runs, and the audit log.

---

## Roles & permissions

All of it is defined in [src/lib/auth/permissions.ts](src/lib/auth/permissions.ts).
Because `auth.users` is shared with the other app, **`app_user` is the Green Dog
Ops allow-list**. Per-user `module_access` overrides always win over role
defaults, in both directions.

| Role | Access |
| --- | --- |
| **Owner** | Full control, including billing, other owners, and Admin. |
| **Admin** | Full control of users, settings, and every module. |
| **Executive** | Sees every module including Admin (Admin is read-only); edits everything else; can view all compensation. |
| **Manager / HR** | Edits everything except Admin, Reporting, and Emp Reporting; can view all compensation. |
| **Schedule Admin** | Edits every module they can see; no Admin panel, no all-compensation view. |
| **Marketing Admin** | Same pages as Schedule Admin, but the Operations section (Calendar, Scheduling, Planning) is view-only. |
| **Staff** | Read-only everywhere except Admin and Email Templates; sees only their own compensation. On other people's HR profiles sees only General + Shift Eligibility, without personal fields (DOB, home ZIP/phones, notes, PTO, separation). |

`admin`, `reporting`, and `emp_reporting` are admin-only by default and can be
granted per user. `/reporting/smart` is an explicit exception
(`ROUTE_MODULE_EXCEPTIONS`): it is open to everyone above Staff via
`canUseSmartReport`, and *what data they can see* is narrowed separately.

Key helpers:

- `canAccessModule(user, key)` — visibility; overrides beat role defaults.
- `canEditModule(user, key)` — write rights, with the Admin-panel and
  Marketing-Admin/Operations carve-outs.
- `canViewAllCompensation(role)` / `canViewCredentials(role)`.
- `canViewSensitiveHr(role)` / `hasRestrictedHrView(user, personId)` /
  `seesPrivateHrFields(user, personId)` — the HR-file boundary, mirrored in SQL
  by the `hr_full` / `hr_edit` predicates in the RLS policies (migration `0227`).
- Two-step verification: `src/lib/auth/mfa.ts`; enforcement for
  Owner/Admin/Executive/Manager is the **Admin → Settings → Require two-step
  verification** switch (ships off). Anyone who has enrolled is always asked
  for a code.
- `moduleForPathname(path)` — longest-prefix route → module mapping used by the
  `(app)` layout to gate whole route subtrees.

---

## Cross-module data model

`person` is the spine shared by HR, ATS, and Scheduling, distinguished by a
`status` enum (`prospect | applicant | employee | former | contractor`) with 1:1
`person_employment` and `person_recruiting` rows. `app_user.id` equals
`auth.users.id` and links to `person` via `person_id`.

Promotion lineage runs **Student CRM → ATS → HR** through
`crm_contact.promoted_person_id` ↔ `person.source_contact_id`, and documents move
with the profile. Status changes cascade through **database triggers**
(`person_before_change` / `person_after_change`): they stamp timestamps, flip
`sched_employee_setting.is_schedulable`, and deactivate the linked `app_user`
when someone becomes `former`. Application code only revalidates paths — do not
reimplement that logic in TypeScript.

An append-only `profile_transition_log` records every stage movement and is
surfaced on both the ATS and HR History tabs.

---

## Smart Report (natural-language analytics)

`/reporting/smart` lets a user ask a business question in English and get an
answer, a table, and the SQL behind it. Pipeline
([src/lib/reporting/smart.ts](src/lib/reporting/smart.ts)):

1. `smart_schema()` + `smart_value_hints()` + `smart_functions()` build a catalog
   of every readable table/view/matview, common column values, and callable
   read-only functions (cached 10 minutes).
2. An LLM writes **one** `SELECT`, prompted with the catalog plus hand-curated
   `DOMAIN_NOTES` that encode real business semantics — what counts as an
   appointment, the two irreconcilable revenue bases, service-line mappings,
   wellness-plan renewal rules, and so on.
3. `smart_query()` executes it: SELECT/WITH only, single statement, keyword
   blacklist applied to a literal-stripped copy of the SQL, wrapped as a
   sub-select to block data-modifying CTEs, 60s statement timeout. Errors and
   empty results are fed back for a bounded retry.
4. A second LLM call turns the rows into prose.

**Per-user data scope** ([src/lib/reporting/smart-scope.ts](src/lib/reporting/smart-scope.ts))
is enforced in three layers — the catalog is filtered before the model sees it,
identifiers are blocked before execution, and rows are scrubbed after — because
the RPC runs as `service_role`. Tiers: `full` (owner/admin/executive), `hr`
(manager, no compensation columns), `basic` (everyone else; the confidential
employee file is blocked outright).

There is a **learning loop**: every question is logged to `smart_question_log`
(result rows are deliberately *not* stored — history re-runs the query), an admin
thumbs-up marks a row `verified`, and verified rows are retrieved by full-text
search as worked examples for future questions. A self-drafting `smart_glossary`
captures house terminology; the LLM proposes draft terms from recent failures and
humans approve them.

---

## Automation & integrations

### Browser agents (`agent/`)

IDEXX/ezyVet will not grant this practice an API, so data is pulled by **driving
a real Chromium browser with Playwright**: log in, queue reports, download CSVs,
scrape UI-only pages, and POST them to the app's ingest endpoints.

```
agent/
  run.mjs                 # daily ingest orchestrator (invoice lines, animals,
                          # contacts, products, pricing, referrals, cancellations)
  agenda-week.mjs         # forward-looking booked-appointment snapshots
  agenda-review.mjs       # look-back scheduled vs. rendered review
  appointment-records.mjs, extra-reports.mjs, record-tags.mjs
  ezyvet/                 # session, report-center, per-report drivers, probes
  cebroker/               # CE course prefill/submission
  indeed/                 # candidate export
  lib/ingest.mjs          # upload/chunk CSVs, report run progress back to the app
```

Agents run on **GitHub Actions** (`.github/workflows/ezyvet-*.yml`) rather than
Vercel because they far exceed serverless time limits. GitHub cron is UTC-only
with no DST awareness, so each job fires at **two UTC times** (e.g. 13:00 and
14:00) and the worker no-ops the wrong one. Runs are tracked in `agent_run` and
visible at `/admin/agents`; oversized reports (Animals ~45k rows, Contacts ~33k)
upload in chunks. Credentials live in `.secrets/` (gitignored) and GitHub secrets.

Two gotchas are baked into the agent code: the ezyVet login sits behind an AWS
WAF JS challenge (passes automatically only with a realistic browser
fingerprint), and the Report Queue retains stale runs, so downloads are matched
against a queue snapshot taken before printing.

### Vercel Cron (`vercel.json`)

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/calendar/sync` | every 15 min | Google Calendar → `calendar_event` |
| `/api/ats/gmail` | every 5 min | Poll Gmail for new applicants |
| `/api/agents/wheniwork/timeoff` | every 15 min | WhenIWork PTO via Gmail notifications |
| `/api/admin/users/roster-sync` | daily | Reconcile `app_user` against the roster |
| `/api/admin/slack/sync` | daily | Link active staff to Slack accounts by email (`person_slack_link`) |
| `/api/notify/dispatch` | every 5 min | Send queued notification Slack DMs (off unless `SLACK_DM_LIVE=true`) |
| `/api/agents/ezyvet/rescue-partners` | daily | Rescue/shelter partner refresh |
| `/api/med-ops/boards/rollover` | daily | Roll medical boards to the next day |
| `/api/agents/sheets/sync` | daily | Google Sheets ⇄ roster / schedule / students |
| `/api/agents/bizdev/refresh` | daily | Business-development metrics |
| `/api/agents/reporting/slack-digest` | Mondays | Weekly Slack digest |
| `/api/agents/reporting/slack-upcoming` | Tue/Thu | Upcoming-appointments Slack report |

All cron routes authenticate with `CRON_SECRET`; long-running ones set
`export const maxDuration = 300`.

### Other integrations

- **Google** — Calendar sync, Sheets two-way sync for the HR roster, schedule and
  students ([src/lib/sheets](src/lib/sheets)), Docs ingestion for Resources,
  Maps/Places geocoding, and Custom Search. Auth via a service account or a
  stored OAuth refresh token.
- **Slack** ([src/lib/slack](src/lib/slack)) — hiring, ops reporting, and
  upcoming-appointment channels. Every active employee/contractor is linked to
  their Slack user id in `person_slack_link` (matched by exact email nightly,
  or by hand in **Admin → Slack**). Notifications can be DMed to them
  (`notification_delivery`, `/api/notify/dispatch`).
- **Slack workflows ⇄ Ops tasks** — a Slack workflow creates an Ops task by
  POSTing to `/api/tasks/inbound` (bearer `OPS_INBOUND_TASK_SECRET`, idempotent on
  `external_id`); Ops posts `task.created` / `task.completed` / `task.dismissed`
  to a workflow's webhook trigger (`SLACK_WORKFLOW_WEBHOOK_URL`). Both are off
  until their env var is set. Contract: [src/lib/worklist/inbound.ts](src/lib/worklist/inbound.ts),
  [src/lib/notify/slack-workflow.ts](src/lib/notify/slack-workflow.ts).
- **Resend** — transactional email plus a delivery webhook (`/api/email/webhook`).
- **Twilio** ([src/lib/sms](src/lib/sms)) — texting candidates and employees
  from the **Texts** tab on their profiles; replies and STOP arrive at
  `/api/sms/inbound`, delivery status at `/api/sms/status` (both verified by
  `X-Twilio-Signature`). Off until the Twilio env vars are set.
- **Enrichment** — Brave, Tavily, SerpAPI, Apollo, Hunter, and Nominatim for CRM
  research and contact enrichment.
- **LLM fallback chain** ([src/lib/ai/llm.ts](src/lib/ai/llm.ts)) —
  `callTextLLM()` walks providers in order (`LLM_PROVIDER_ORDER`, default
  Gemini → Groq → OpenRouter → OpenAI → Anthropic) so one provider outage does
  not take down parsing, search, or Smart Report. Temperature is 0 throughout.

---

## Database migrations

SQL migrations live in [supabase/migrations](supabase/migrations) (220+ files,
strictly sequential, each scoped to `greendogops`). Apply them with the helper,
which posts to the Supabase Management API — the same endpoint the dashboard SQL
editor uses:

```bash
scripts/supabase-sql.sh -f supabase/migrations/0001_init_schema.sql   # apply a file
scripts/supabase-sql.sh -q "select now();"                            # ad-hoc query
```

Credentials are read from `.secrets/supabase.env` (gitignored), so the access
token never enters the repo. The Management API silently hangs on very large
payloads, so bulk data loads must go through a service-role client script rather
than a generated `.sql` file.

### The migration history is not replayable — use the baseline

Do **not** try to build a new database by replaying `supabase/migrations/`. It
aborts partway: several data-seed migrations hard-code UUIDs that were generated
at runtime and have since been deleted, so their foreign keys no longer resolve.

[supabase/baseline](supabase/baseline) is the rebuild path instead — a snapshot
of a working database, which by construction has no dangling references. It
carries the full schema with grants, revokes and RLS policies, the cluster-wide
event trigger that `pg_dump --schema` omits, and the configuration rows the app
cannot start without. No operational data.

```bash
scripts/rebuild_database.sh --to <empty_ref> --verify-against <prod_ref>
scripts/generate_baseline.sh      # regenerate after any schema migration
scripts/verify_baseline.sh        # rebuild into a throwaway Postgres and assert
scripts/compare_schemas.py --a <ref> --b <ref>   # drift; exits 1 on difference
```

CI runs `verify_baseline.sh` on every change under `supabase/`.

### Environments

| | Project | Used by |
| --- | --- | --- |
| Production | `uekumyupkhnpjpdcjfxb` | `main` deployments |
| Staging | `yzxcuiwklrmxarzjzukr` | Vercel **preview** deployments |

Staging holds configuration plus synthetic people only — no real employee,
candidate or client records. Repopulate it with
`scripts/seed_staging.py --to <ref>`. Local `.env.local` deliberately still
points at production, because the import scripts target production on purpose.

One-time setup on a new project: apply the baseline, then expose the schema —
`PATCH /v1/projects/<ref>/postgrest` with
`db_schema=public,graphql_public,greendogops`. A new project exposes only
`public`, and every request 404s until this is set.

### Backups

Supabase takes daily backups, but they live inside the Supabase account, so
losing the account loses them too. `.github/workflows/backup.yml` writes
encrypted dumps that Supabase never holds the key to.

The data is not uniform: 46 `ezyvet_*` ingest tables are ~90% of the volume and
can be rebuilt by re-running the agent, while the other 92 tables — schedules,
attendance, HR, CRM, ATS — are only ~47 MB and cannot be regenerated at all. So
the critical tier runs every four hours and the full tier nightly.

```bash
scripts/backup_database.sh --critical          # ~7 MB, seconds
scripts/restore_database.sh --file <f> --to <ref> --data-only
```

Encryption is `age`, asymmetric: CI holds only the public key. **If
`.secrets/backup-age-key.txt` is lost, every backup is unreadable.**

---

## Data import scripts

[scripts](scripts) holds the importers, enrichers, and probes (Python, Node, and
shell) used to seed and maintain the database from CSV/XLSX exports — e.g.
`import_ezyvet_invoices.py`, `import_roster.py`, `import_ats.py`,
`import_schedule_weeks.py`, `ingest_resource_pdfs.mjs`, `enrich_vendors.py`,
`derive_role_members.py`, and `ask_smart.mts` (run a Smart Report question
locally with no dev server and no auth). Sample source exports live in
[public](public).

---

## Environment variables

See `.env.example` for the full list (~90 keys). Groups:

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SUPABASE_DB_SCHEMA=greendogops`, and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` (bypasses everything; used for bulk imports, cron,
  agent ingest, and AI jobs).
- **Cron / agents** — `CRON_SECRET`, `APP_BASE_URL`.
- **LLM** — `LLM_PROVIDER_ORDER`, `WEB_SEARCH_PROVIDER_ORDER`, plus per-provider
  key/model pairs for OpenAI, Anthropic, Gemini, Groq, and OpenRouter.
- **Google** — `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_OAUTH_*`,
  `GOOGLE_CALENDAR_ID`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_CSE_*`.
- **Enrichment** — `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPAPI_API_KEY`,
  `APOLLO_API_KEY`, `HUNTER_API_KEY`.
- **Messaging** — `RESEND_*`, `SLACK_*` (incl. `SLACK_DM_LIVE`,
  `SLACK_DM_TEST_USER_IDS`, `SLACK_WORKFLOW_WEBHOOK_URL`), `OPS_INBOUND_TASK_SECRET`,
  `WHENIWORK_GMAIL_*`, `TWILIO_*`, `SMS_LIVE`, `SMS_TEST_NUMBERS`.

`NEXT_PUBLIC_*` is exposed to the browser; everything else is server-only.
Secrets live only in `.env.local`, `.secrets/`, GitHub secrets, and Vercel env
settings — never in the repo.

---

## Project structure

```
src/
  proxy.ts                  # Next 16 proxy: session refresh + auth gate
  app/
    (app)/                  # authenticated shell + every module route
      _components/          # app-shell (sidebar/nav), shared UI
      admin/ ats/ hr/ crm/ marketing/ med-ops/ schedule/ planning/
      capacity/ calendar/ reporting/ emp-reporting/ ezyvet/ resources/
    api/
      agents/               # agent ingest endpoints + scheduled jobs
      ats/ calendar/ email/ med-ops/ admin/
    auth/  login/           # auth flows
  lib/
    admin/ agents/ ai/ ats/ auth/ calendar/ crm/ google/ hr/ marketing/
    med-ops/ planning/ reporting/ resources/ schedule/ sheets/ slack/
    shared/ supabase/ worklist/ notify/  # domain logic + schema-scoped Supabase clients
agent/                      # Playwright browser workers (ezyVet, CEbroker, Indeed)
supabase/migrations/        # sequential, schema-isolated SQL (history; not replayable)
supabase/baseline/          # rebuild path: schema + security + config snapshot
scripts/                    # importers, enrichers, probes, SQL helper,
                            # backup/restore, baseline + drift tooling
public/                     # sample CSV/XLSX exports
docs/agent/                 # verified engineering memory: lessons, integrations,
                            # architecture invariants, improvement backlog
.github/workflows/          # scheduled agent runs, backups, baseline verification
```

Conventions worth knowing:

- A route's reads live in `data.ts`; mutations live in `actions.ts` as Server
  Actions that re-check permissions and then `revalidatePath`.
- Adding a module means touching **four** places: the `ModuleKey` union and
  `MODULES` in `permissions.ts`, `ROUTE_MODULES` in the same file, the nav in
  `app-shell.tsx`, and `MODULE_ICONS` in `src/lib/shared/module-icons.ts` — an exhaustive
  `Record`, so the build fails if you miss it.
- Supabase infers to-one embeds as **arrays**; use the existing `first*()`
  helpers when reading joined rows.

