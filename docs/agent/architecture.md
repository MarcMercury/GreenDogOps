# Architecture notes

The root [README](../../README.md) is the primary architecture reference — read
its "Non-negotiable architectural constraints" and "Cross-module data model"
first. This file holds only invariants and decisions that are **not** written
there, or that need a sharper statement for agents.

## Invariants (candidates for contract tests — see improvements.md)

1. Every Supabase client is created through `src/lib/supabase/*` with `db.schema = 'greendogops'`.
2. No migration creates or alters objects outside `greendogops`.
3. No routine is executable by `anon` / `authenticated`; `greendogops.rls_audit()` returns zero rows.
4. `SUPABASE_SERVICE_ROLE_KEY` / `createAdminClient()` are never reachable from client components or `NEXT_PUBLIC_*`.
5. Every exported Server Action in an `actions.ts` re-checks permissions before writing.
6. Every cron route checks `isAuthorizedCronRequest` (`src/lib/auth/cron.ts`).
7. Adding a module touches `ModuleKey`/`MODULES`/`ROUTE_MODULES` in `permissions.ts`, the nav in `app-shell.tsx`, and `MODULE_ICONS` in `(app)/page.tsx`.

## Authoritative sources

| Fact | Source of truth | Do not |
| --- | --- | --- |
| Person lifecycle side-effects | `person_before_change` / `person_after_change` triggers | reimplement in TypeScript |
| Calendar view of CE events, interviews, time-off | projected at read time | copy into `calendar_event` |
| ezyVet reporting roll-ups | materialized views via `refresh_ezyvet_reporting()` | recompute per request |
| Who may use the app | `app_user` (not `auth.users`, which is shared) | gate on Supabase Auth alone |

## Decisions log

Add entries as `### YYYY-MM-DD — title` with context, decision, and consequences.
