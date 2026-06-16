# Green Dog Ops

Operations platform for a veterinary business: **HR, ATS, CRM, and Scheduling**,
with per-user logins, layered access control, an admin portal, and an AI assist layer.

## Stack

- **Next.js 16** (App Router, TypeScript) — note: Next 16 renamed `middleware` to **`proxy`**.
- **Tailwind CSS**
- **Supabase** — Postgres, Auth (email/password), Row-Level Security, Storage.
- Deployed on **Vercel**.

## Database isolation (important)

Green Dog Ops **shares one Supabase project** with the EmployeeGMGDD app, but is fully
isolated in its **own Postgres schema** (`greendogops`). EmployeeGMGDD owns `public`;
this app never touches it.

- Every Supabase client is created with `db.schema = 'greendogops'` (see `src/lib/supabase/`).
- All migrations create objects in the `greendogops` schema only (`supabase/migrations/`).
- `auth.users` is project-level and therefore shared. Access to Green Dog Ops is gated
  by an app-level user/role model + RLS on the `greendogops` schema (Phase 4), so a
  user that only belongs to the other app cannot reach this app's data.

### One-time Supabase setup

1. Run the migrations in `supabase/migrations/`.
2. Dashboard -> Settings -> API -> Exposed schemas: add `greendogops`.

## Getting started

```bash
cp .env.example .env.local   # then fill in your Supabase keys
npm install
npm run dev
```

Open http://localhost:3000 — unauthenticated users are redirected to `/login`.

## Environment variables

See `.env.example`. Secrets live only in `.env.local` (gitignored) and Vercel env
settings — never in the repo.

## Module roadmap

| Phase | Module | Status |
| ----- | ------ | ------ |
| 0 | Foundation (app shell, auth, isolated schema) | scaffolded |
| 1 | HR / Roster | next |
| 2 | ATS (reuses HR template) | planned |
| 3 | CRM / Contacts | planned |
| 4 | Permissions & Admin (RLS, user mgmt) | planned |
| 5 | Scheduling | planned |
| 6 | AI layer | planned |
