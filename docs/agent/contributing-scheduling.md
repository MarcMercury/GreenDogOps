# Contributing to Scheduling

Ground rules for the Scheduling module: the weekly grid, Set Up, time off,
attendance, time clock and payroll. They add to [AGENTS.md](../../AGENTS.md),
which always wins.

## Who it is for

Angie, our scheduler, uses the grid more than anyone. Her feedback sets the
priorities, and the grid has to work well for her now. But we build for the
**scheduler role**, not for one person. Other people will schedule, at other
locations, with different roles, shifts and PTO rules.

- Don't hardcode names, clinics, role or shift names, or one person's workflow.
- Rules about roles, shifts, locations, capacity and PTO belong in Set Up or in
  the database, not in `if` statements.
- Labels, defaults and empty states should make sense to any scheduler at any
  location.
- When Angie asks for something, turn it into a general requirement
  ("schedulers need X") before building it.

## Scope

- **Scheduling code:** `src/features/scheduling/**` and
  `src/app/(app)/schedule/**`. Outside these, only repoint imports.
- **Shared files need sign-off first:** `src/app/globals.css`, the app layout,
  `src/lib/**`, `src/components/ui/**`, `package.json`. Call out any effect on
  other modules in the PR description.
- **Don't change the app's design tokens** (`--muted`, `--background`,
  `--foreground`, `--border`, `--ring`, fonts) to suit one module. Other
  modules must look identical before and after a scheduling PR.
- **New packages:** ask first.

## Folder layout

Each area (`scheduling-grid`, `setup`, `attendance`, `time-clock`, `payroll`,
`time-off`, `shared`) has the same folders:

| Folder | Holds |
| --- | --- |
| `actions/` | Server Actions (`"use server"`), one concern per file |
| `components/` | React components |
| `db/` | Supabase queries (`server-only`) |
| `server/` | Other server-only helpers (gates, revalidation) |
| `schema/` | Zod input schemas, built from `src/lib/validation/form.ts` |
| `lib/` | Pure business rules, each with a `*.test.ts` |
| `types/` | Shared types |

Keep business rules in `lib/`, so tests can import them. Tests can't load
`server-only` or `next/cache`.

## Behaviour you must not break

- **Permissions.** Every Server Action starts with `ensureCanEdit("schedule")`,
  or with the approver gate (`canApproveTime`) for timecards. RLS is only a
  floor. `src/lib/security/server-action-gates.test.ts` fails the build if an
  action doesn't call a gate first. Never loosen a gate.
- **Time off has one approval path.** Since migration 0246, approving a
  `pto`/`vacation` request deducts days from the employee's balance in the
  database (`person_time_off_balance` trigger, audited in `pto_ledger`).
  - Approvals go through the PTO feature's approval logic.
  - Don't add new code that writes `person_time_off`.
  - Never write `pto_days_deducted` or `balance_tracked`.
  - The grid's Approve/Deny still needs to move onto that shared path; see
    [improvements.md](./improvements.md).
- **Employee status changes** (for example marking someone a former employee,
  or whether they can be scheduled) are handled by `person` triggers. Don't
  re-implement them in TypeScript.
- **Calendar** shows time off and interviews by reading them live. Never copy
  them into `calendar_event`.
- **Connected modules.** Scheduling feeds PTO/attendance, Daily Capacity,
  Planning Guides, HR profiles and Payroll. If a shared query or action
  changes, check those pages too.

## Database

- **Schema:** we only own `greendogops`. Never touch `public`, which belongs
  to EmployeeGMGDD.
- **Clients:** use the existing ones in `src/lib/supabase`.
- **Schema changes:** add the next numbered migration (check with the owner
  first), then run `scripts/generate_baseline.sh`.
- **Production:** `.env.local` points at production. Reading is fine. Any
  write, backfill or schema change needs explicit approval. Test on staging
  or with made-up data.

## Before every PR

1. `npx eslint <changed files>`
2. `npx vitest run`
3. Push and confirm the Vercel preview build is green. `npx tsc --noEmit`
   runs out of memory in the Codespace, so the Vercel build is the type check.
4. Click through the preview:
   - grid, Set Up, Time off, Attendance, Time Clock, Payroll;
   - **plus Calendar, Capacity, Planning and an HR profile.**
5. Every bug fix comes with a test that fails without the fix.

## Git

- **Small PRs to `main`,** one feature or fix at a time. Keep changes that
  only move code separate from changes in behaviour.
- **Rebase often** while a PR is open. Never force-push shared branches.
- **Write things down:** non-obvious lessons in [lessons.md](./lessons.md),
  ideas you didn't build in [improvements.md](./improvements.md).
