# Green Dog Ops

Operations platform for a veterinary business. It brings **HR, Recruiting (ATS),
CRM, ezyVet analytics, Scheduling, Capacity Planning, Reporting, and an AI-assisted
Resources hub** into one internal app, with per-user logins, a layered role/permission
model, an admin portal, and an AI assist layer.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19) — note: Next 16 renamed
  `middleware` to **`proxy`** (see `src/proxy.ts` + `src/lib/supabase/proxy.ts`).
- **Tailwind CSS v4**
- **Supabase** — Postgres, Auth (email/password), Row-Level Security, Storage.
- **AI / LLM** — OpenAI (resume/PDF parsing, web-search research), plus optional
  Gemini / Groq fallbacks and web-enrichment providers.
- Deployed on **Vercel** (with Vercel Cron for scheduled jobs).

## Database isolation (important)

Green Dog Ops **shares one Supabase project** with the EmployeeGMGDD app, but is fully
isolated in its **own Postgres schema** (`greendogops`). EmployeeGMGDD owns `public`;
this app never touches it.

- Every Supabase client is created with `db.schema = 'greendogops'`
  (see `src/lib/supabase/`, `DB_SCHEMA` in `src/lib/supabase/config.ts`).
- All migrations create objects in the `greendogops` schema only
  (`supabase/migrations/`).
- `auth.users` is project-level and therefore shared. Access to Green Dog Ops is
  gated by an app-level user/role model (`app_user`) + RLS on the `greendogops`
  schema, so a user that only belongs to the other app cannot reach this app's data.

### One-time Supabase setup

1. Apply the migrations in `supabase/migrations/` (see below).
2. Dashboard → Settings → API → Exposed schemas: add `greendogops`.

## Getting started

```bash
cp .env.example .env.local   # then fill in your Supabase keys
npm install
npm run dev
```

Open http://localhost:3000 — unauthenticated users are redirected to `/login`.

### Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start the Next.js dev server         |
| `npm run build` | Production build                     |
| `npm run start` | Serve the production build           |
| `npm run lint`  | Run ESLint                           |

## Modules

The signed-in dashboard mirrors the sidebar; every module is gated by a `ModuleKey`
and only shown to users who can access it.

**Core**
- **Resources** — AI search across all program data and the web, a Green Dog
  policies wiki, and a shared document library.
- **HR / Roster** — master employee records: payroll, reviews, discipline, PTO,
  credentials, licenses, provided items, and onboarding checklists.
- **Recruiting (ATS)** — applicant pipeline with interview tracking; hiring a
  prospect promotes them into HR with a single status change. Resumes and PDF
  lists are parsed via OpenAI.

**CRM**
- **Referral CRM** — referring clinics & hospitals, with geocoding and clinic-area
  mapping.
- **Vendor & Partner CRM** — vendors, suppliers, and business partners (the former
  Business CRM merged in here).
- **Student CRM** — students, externs, and program participants.
- **CE Leads/Events** — continuing-education events (CEbroker submission wizard), attendees, outreach, and attendance.
- **Influencer CRM** — influencer partnerships, campaigns, and performance.
- **ezyVet CRM** — client contacts imported from ezyVet, with customer groups,
  revenue, and division trends.

**Operations**
- **Scheduling** — build and manage shifts across locations, with attendance,
  time-off, and availability.
- **Daily Capacity** — live daily staffing capacity vs. demand across service sites.
- **Planning Guides** — service-site staffing guides and signatures that drive
  capacity planning.

**Biz Dev / Admin**
- **Reporting** — appointments, revenue, and client trends derived from ezyVet
  invoice and contact exports (admin-only).
- **Emp Reporting** — payroll and compensation analytics across the roster
  (admin-only; exposes compensation).
- **Admin** — users, roles, permissions, locations, credentials, settings, and the
  audit log.

## Roles & permissions

Access is defined in `src/lib/auth/permissions.ts`. `auth.users` is shared, so
`app_user` is the Green Dog Ops allow-list. Per-user `module_access` overrides win
over role defaults.

| Role             | Access |
| ---------------- | ------ |
| **Owner**        | Full control, including billing, other owners, and the Admin panel. |
| **Admin**        | Full control of users, settings, and every module. |
| **Executive**    | View/edit every module except Admin; can view all compensation. |
| **Manager/HR**   | Manage/edit everything except Admin; can view all compensation. |
| **Schedule Admin** | Read-only everywhere like Staff, but can fully edit the Schedule (and Planning). |
| **Staff**        | Read-only everywhere except Admin; sees only their own compensation. |

Admin-only modules (`admin`, `reporting`, `emp_reporting`) are hidden from
non-admins by default but can be granted per-user.

## Database migrations

SQL migrations live in `supabase/migrations/` (`0001`–`0049`+), each scoped to the
`greendogops` schema. Apply them with the helper, which uses the Supabase Management
API (the same endpoint as the dashboard SQL editor):

```bash
scripts/supabase-sql.sh -f supabase/migrations/0001_init_schema.sql   # apply a file
scripts/supabase-sql.sh -q "select now();"                            # ad-hoc query
```

Credentials are read from `.secrets/supabase.env` (gitignored), so the access token
never lives in the repo.

> **PostgREST note:** the project's `max_rows` is capped at 1000 — queries that scan
> large tables must paginate with `.range()`. Heavy ezyVet report roll-ups are
> materialized views refreshed via the `refresh_ezyvet_reporting()` RPC.

## Data import scripts

`scripts/` contains one-off importers/enrichers (Python + shell) used to seed and
maintain the database from CSV/XLSX exports — e.g. `import_ezyvet_invoices.py`,
`import_roster.py`, `import_ats.py`, `import_schedule_weeks.py`,
`enrich_vendors.py`, and `derive_role_members.py`. Sample source exports live in
`public/`.

## Environment variables

See `.env.example` for the full list. Highlights:

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SUPABASE_DB_SCHEMA=greendogops`, and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS; used for bulk imports, cron, and AI jobs).
- **Cron** — `CRON_SECRET` authenticates Vercel Cron requests.
- **AI / LLM** — `OPENAI_API_KEY` (+ `OPENAI_MODEL`, `OPENAI_BASE_URL`, etc.),
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`. Resources web search
  falls back OpenAI → Claude → Gemini.
- **Enrichment / Maps** — `GOOGLE_MAPS_API_KEY`, `GOOGLE_CSE_*`,
  `GOOGLE_SERVICE_ACCOUNT_JSON`, `BRAVE_API_KEY`, `TAVILY_API_KEY`.

`NEXT_PUBLIC_*` variables are exposed to the browser; everything else is server-only.
Secrets live only in `.env.local` (gitignored) and Vercel env settings — never in
the repo.

## Project structure

```
src/
  proxy.ts              # Next 16 proxy (session refresh + auth gate)
  app/
    (app)/              # authenticated app shell + every module route
    auth/  login/       # auth flows
  lib/
    admin/ ats/ auth/ crm/ hr/ planning/ reporting/ resources/ schedule/
    shared/ supabase/   # domain logic + Supabase clients (schema-scoped)
supabase/migrations/    # schema-isolated SQL migrations
scripts/                # data importers / enrichers
public/                 # sample CSV/XLSX exports
```
