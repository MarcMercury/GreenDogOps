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
| `hooks/` | Client hooks (`useGrid`, `useGridActions`, the shared `useAppForm` / `useAction`) | `"use client"` files; no server imports. |
| `columns/` | TanStack Table column definitions (today: the scheduling grid) | One column (or one column factory) per file; `grid-columns.ts` assembles them and `ScheduleGrid` passes the result to `useTable`. |
| `types/` | Route-specific TypeScript types (data shapes, UI models) | Row types shared with HR / Planning (`SchedWeek`, `SchedAssignment`, …) stay in `@/lib/schedule/types` — import them, never re-declare. |

No barrel `index.ts` files: import the module you need by its full
`@/features/scheduling/<feature>/<folder>/<file>` path.

## Features and what each owns

| Feature | Route | Owns |
| --- | --- | --- |
| `scheduling-grid` | `/schedule` | Weeks (create, copy, template apply, status workflow, publish checks), shift lines, assignments (place / remove / move, post-publish absence rules), closures, day events, attendance marking from the grid, PTO decisions from the grid, planning-guide generation, the `ScheduleGrid`, the schedule page's sidebar (`WeeksCard`, `RowsCard`) and the `WeekPicker` that Planning and Capacity still use. |
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

## UI stack

- **shadcn/ui** (`@/components/ui/*`, generated with the `base-nova` style on
  Base UI, `cn` from the `cn` package): `Button`, `Card`, `Dialog`,
  `AlertDialog`, `Input`, `Textarea`, `NativeSelect`, `Checkbox`, `Switch`,
  `Label`, `Field`, `Badge`, `Tooltip`, `Table`, `Skeleton`, `Spinner`,
  `Empty`. Dense grid internals (the assignment chips, the PTO chips) keep
  their own markup — a Tooltip per cell would be hundreds of portals.
- **Server components may not render the hook-backed primitives** (`Badge`,
  `Tooltip`, `Checkbox`, `Switch`, `Select`, `Dialog`): Base UI's `useRender`
  runs in the component itself and fails at render time, which neither `tsc`
  nor a dynamic-route `next build` catches. In a server component use the
  class string (`badgeVariants({ variant })` on a `<span>`) or make the leaf a
  `"use client"` file with plain props; `Button` is fine there as long as it
  receives no handlers.
- **Forms** go through TanStack Form via `shared/hooks/use-app-form`
  (`useAppForm` + `form.AppField` + the registered `TextField` /
  `TextareaField` / `NativeSelectField` / `CheckboxField` / `SubmitButton`).
  The feature's zod schema is the validator — wrapped in
  `formValidator<TValues>(schema)` because the `z.preprocess` helpers type
  their input as `unknown` — and the Server Action re-parses it with
  `parseInput`. Actions therefore take the form's value object, not `FormData`.
- **Every database save toasts** (react-toastify, mounted by
  `shared/components/schedule-providers.tsx` in the schedule layout):
  `toastResult(result, message)` in a form's `onSubmit`, `useAction().run(...)`
  for clicks and inline edits, `ActionButton` for one-action buttons (with an
  optional confirmation), `toastInvalidForm()` from `onSubmitInvalid`.
- **No `window.confirm` / `prompt` / `alert`**: `ConfirmDialog` and
  `PromptDialog` in `shared/components/`.
- **Every route has a `loading.tsx`** rendering the feature's
  `components/<feature>-skeleton.tsx` (shadcn `Skeleton` +
  `PageHeaderSkeleton`).
- **The grid is a TanStack Table v9** (`scheduling-grid/columns/`,
  `lib/grid-table-features.ts`): rows are shift lines grouped by department
  (`columnGroupingFeature` + grouped / expanded row models — a group row is a
  department section, its expansion state the collapse), columns are the
  sticky `shift` column plus one group per day of one display column per
  location, and the location toggles are column visibility. `autoResetExpanded`
  is off (every save refreshes the data) and `groupedColumnMode` is `"remove"`.
- **The schedule page is two columns**
  (`scheduling-grid/components/schedule-page-shell.tsx`): the `sidebar/` cards
  — `WeeksCard` (a shadcn `Calendar` / react-day-picker month whose rows are
  weeks: a status dot in the week-number slot, the open week as a navy pill, a
  click on any day opens that week or offers to create it) and `RowsCard`
  (show / hide departments and single shift lines — a view filter applied to
  the table's `data` by `lib/row-visibility.ts`) — beside the week header,
  toolbar, publish banner, location chips and the grid. Set Up's Week Template
  renders the same `ScheduleGrid` in `templateMode` without the sidebar.
  Week-status colours and the navy primary are grid-local
  (`lib/week-status-style.ts`, `bg-slate-900`), section tints come from each
  department's own colour (`lib/color.ts`).
- **Sections open and close with an animation.** A `<tr>` cannot animate its
  height, so every cell of a collapsible row wraps its content in
  `CollapsibleCellContent` (a one-row CSS grid) and the row sets
  `data-collapse={sectionState(key)}`; `components/grid/grid.module.css`
  transitions the track `1fr → 0fr` (plus the cell padding and border) and
  `hooks/use-section-transitions.ts` keeps a closing section mounted for the
  220 ms before applying the TanStack expanded-state change (opening applies
  it first and plays the reverse). `prefers-reduced-motion` turns it off.

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
