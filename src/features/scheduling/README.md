# Scheduling features

The code behind every `/schedule/*` page. One folder per sub-page (each is slated
to become its own Scheduling item in the sidebar), plus `shared/` for the few
primitives they all use. The route files under `src/app/(app)/schedule/**` are
thin composers: gate → load through `db/` → derive through `lib/` → render
`components/`. Nothing else lives in the route folder.

## Folder roles (same shape in every feature)

| Folder | Holds | Rules |
| --- | --- | --- |
| `actions/` | Server Actions (`"use server"`), one file per domain (`week-actions.ts`, `role-actions.ts`…) | Only `async` functions may be exported (Next rule). Each action: permission gate → zod parse from `schema/` → `db/` calls → audit / notify → revalidate → `ActionResult`. Keep names, parameters and messages stable — other modules import them. |
| `components/` | React components, **exactly one per file**, named export, kebab-case file = PascalCase component | `"use client"` only where hooks / handlers need it. Prop types stay inline. |
| `db/` | One exported async function per file, named after the query (`get-weeks.ts` → `getWeeks`) | First line `import "server-only"`. Only the Supabase call — no gates, no revalidation, no notifications. Compound single-purpose writes (`clone-week-contents.ts`) count as one query. |
| `lib/` | Pure logic and constants (CSV builder, overlap check, template drift, rollups, selectors) | No React, no server imports. Every pure module has a `*.test.ts` beside it (vitest resolves `@/`; `server-only` modules cannot be imported by tests). |
| `schema/` | Zod objects for the data an action accepts (`<domain>.schema.ts`, exporting `<name>Schema` and `<Name>Input`) | Built from `@/lib/validation/form` helpers. Shape-only: ids are uuids, days are 0–6, text has a cap. Business rules (no self-approval, date windows, duplicate names) stay in the action with their user-facing message. |
| `server/` | Server-only helpers that are neither a query nor an action (role gates, `logChange`, path revalidation) | `import "server-only"` first. |
| `types/` | Route-specific TypeScript types (data shapes, UI models) | Row types shared with HR / Planning (`SchedWeek`, `SchedAssignment`, …) stay in `@/lib/schedule/types` — import them, never re-declare. |

No barrel `index.ts` files: import the module you need by its full
`@/features/scheduling/<feature>/<folder>/<file>` path.

## Features and what each owns

| Feature | Route | Owns |
| --- | --- | --- |
| `scheduling-grid` | `/schedule` | Weeks (create, copy, template apply, status workflow, publish checks), shift lines, assignments (place / remove / move, post-publish absence rules), closures, day events, attendance marking from the grid, PTO decisions from the grid, planning-guide generation, the `ScheduleGrid` and `WeekPicker` components. |
| `setup` | `/schedule/setup` | Departments, roles and eligibility (`sched_role_member`, student Mentor / Coordinator flags), the Dept/Shift Template, employee scheduling settings and preferred location, appointment-type → department map, named Week Templates. Also the HR-profile loaders for a person's scheduling settings and eligibility. |
| `attendance` | `/schedule/attendance` | The reliability rollup over published weeks, the per-person attendance summary the HR profile shows, and the safe time-clock grade lookup (`getSystemAttendance`). Read-only: no `actions/`, no `schema/`. |
| `time-clock` | `/schedule/time-clock` | Approver queues: off-site punch review, correction decisions, adding a missing punch. Queue reads come from `@/lib/timeclock/review`. |
| `payroll` | `/schedule/payroll` | Timecard approval / un-approval, locking and reopening a pay period, the period summary and timecard table. Hours come from `@/lib/payroll/*`. |
| `time-attendance` | `/schedule/time-attendance` | The live, per-clinic grading of today's published shifts (`gradeRange`), date navigation, shadow / live banner. Read-only: no `actions/`. |
| `shared` | — | `ActionResult`, `actor()`, `revalidateSchedulePaths()`, `PERSON_COLS`, the tab strip, the restricted-access card. |

## Cross-feature contract

Features import from each other only through these modules; everything else is
private to its feature.

- `scheduling-grid` → `setup`: `db/get-setup-data` (+ `types/setup-data`), `db/resolve-role-id`, `actions/department-actions` (the grid's department modal).
- `scheduling-grid` → `attendance`: `db/get-system-attendance` (time-clock grades for a published week).
- `setup` → `scheduling-grid`: `db/get-weeks`, `db/get-templates`, `db/get-template-week-data`, `db/clone-week-contents`, `types/week-data`, `components/schedule-grid` (the Week Template tab renders the grid in `templateMode`).
- `attendance` → `setup`: `db/get-location-lookup-rows`.
- Everyone → `shared`.

Other modules that depend on these features (update them if a path changes):

- `src/app/(app)/hr/[id]/*` — `attendance/db/get-person-attendance`, `setup/db/get-person-schedule-settings`, `setup/db/get-person-eligibility`, `setup/actions/role-actions`, `setup/actions/employee-setting-actions`, and their types.
- `src/app/(app)/capacity/*` — `setup/db/get-setup-data`, `scheduling-grid/db/get-weeks` / `get-week-data` / `get-week-data-for` / `get-agenda-counts`, `scheduling-grid/components/week-picker`, `scheduling-grid/actions/planning-guide-actions`, `scheduling-grid/types/agenda-count`.
- `src/app/(app)/planning/*` — `scheduling-grid/db/get-weeks`, `scheduling-grid/components/week-picker`.

## Why it is shaped this way

- **Server Action files can only export async functions**, so gates, revalidation
  and multi-step DB helpers live in `server/` and `db/`; nothing in `db/` is
  reachable as a public endpoint.
- **One query per file** makes "what does this page read / write" answerable
  from the directory listing, and keeps each query's columns, filters and
  ordering reviewable on their own.
- **Schemas are shape-only** so the behaviour of every action is unchanged from
  the pre-split route: the same inputs reach the database, malformed ones are
  refused at the boundary.
- **Pages stay in `src/app`** because Next routes must; they hold no logic worth
  testing, so the testable parts (`lib/`) are plain modules.
