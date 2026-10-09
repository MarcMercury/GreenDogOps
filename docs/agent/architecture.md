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
| Compensation values (`person_employment` pay/benefit columns) | read/write via `src/lib/hr/compensation.ts` (service role) after `canViewAllCompensation` / own-record check | select them through the user-scoped client — the columns are not granted (0227) |
| Who sees the confidential HR file | `canViewSensitiveHr` / `hasRestrictedHrView` in `permissions.ts`, mirrored by the `hr_full`/`hr_edit` RLS predicates in 0227 | change one side without the other (run `scripts/security_rls_matrix.sql`) |
| Who may be texted, and by whom | `blockReason` (`src/lib/sms/rules.ts`) and `canTextPerson` (`src/lib/sms/access.ts`), enforced in `sendSmsToPerson` | send through Twilio directly, or skip the consent/opt-out/quiet-hours checks |

## Decisions log

Add entries as `### YYYY-MM-DD — title` with context, decision, and consequences.

### 2026-10-09 — Texting via Twilio, service-role tables (migration 0228)
- **Context:** staff need to text candidates and employees; US carriers require A2P 10DLC registration, consent, and STOP handling.
- **Decision:** Twilio REST over `fetch` (no SDK). `sms_message`, `sms_opt_out` and `sms_consent` are service-role only (deny-all policy); the app reads and writes them after `canTextPerson`. Opt-outs are keyed by phone number, because STOP comes from a number, not a person. Candidate consent is read straight from the application's `sms_consent` answer (not copied); `sms_consent` only holds consent that staff record. The feature stays dark until all Twilio env vars exist, and `SMS_LIVE` gates real recipients.
- **Consequences:** the `sms_*` tables must exist before the Twilio env vars are set in an environment. Adding a send path (e.g. scheduling-link texts) must go through `sendSmsToPerson` so the same rules apply.

### 2026-10-08 — Sensitive HR boundaries enforced in the database (migration 0227)
- **Context:** 0164's `gdo_members_all` let every active `app_user` (Staff included) read/write every table through PostgREST with their own token — salaries, reviews, discipline, the audit log — regardless of what the UI hid. OWASP ASVS L2 review.
- **Decision:** keep `gdo_members_all` as the floor, but replace it on the HR-file tables with role-aware policies (inline subqueries on `app_user`, no helper RPCs per AGENTS.md); drop table-level SELECT/INSERT/UPDATE on `person_employment` for `authenticated` and re-grant only non-compensation columns; make `audit_log` append-only (trigger) and service-role only; require AAL2 in `is_gdo_user()` once a user has a verified MFA factor. Staff on other people's HR profiles get the same restricted view Schedule Admins already had. See `docs/security.md`.
- **Consequences:** any user-scoped query that selects a compensation column now fails with `42501`; a column added to `person_employment` must be granted explicitly. Changing role semantics in `permissions.ts` must be mirrored in the 0227 predicates — `scripts/security_rls_matrix.sql` (staging) and `permissions.test.ts` pin both.

