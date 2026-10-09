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
7. Adding a module touches `ModuleKey`/`MODULES`/`ROUTE_MODULES` in `permissions.ts`, the nav in `app-shell.tsx`, and `MODULE_ICONS` in `src/lib/shared/module-icons.ts`.
8. Every write to `ops_task` goes through `src/lib/worklist/tasks.ts`, and every notification through `publishNotification()` (`src/lib/notify/publish.ts`). Work-center tables are service-role only and every read filters to the signed-in user.

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
| What is waiting on a user (dashboard work list) | module tables, projected at read time by `src/lib/worklist/sources.ts`; only ad-hoc work lives in `ops_task` | copy module work (interviews, approvals, licenses) into `ops_task` |
| Who may be DMed by Ops | `connectedSlackUserFor()` (`src/lib/notify/publish.ts`): active login + employee/contractor + `connected` link, re-checked at send time | DM a Slack id without that check, or set `username`/`icon_url` on DMs |

## Decisions log

Add entries as `### YYYY-MM-DD — title` with context, decision, and consequences.

### 2026-10-09 — Dashboard becomes a per-user work center (migration 0230)
- **Context:** the home page was a grid of module tiles. Users need one place for what is waiting on them, recurring checks, and notifications, and the owner plans Slack workflows that create Ops tasks and vice versa. Only `person_interview.host_user_id` was a true per-user assignment; everything else was a shared queue.
- **Decision:** five service-role tables — `ops_task`, `user_notification`, `notification_delivery`, `reminder_rule`, `reminder_ack` — keyed on `app_user` (the dashboard is for logins). Module work is **projected** at read time, gated by `canAccessModule`/`canEditModule`, never copied into `ops_task`. Each source loads independently, so one failure becomes a warning. Slack → Ops: `/api/tasks/inbound` (bearer secret, idempotent on `(source, external_ref)`). Ops → Slack: DMs through `notification_delivery` and the 5-minute dispatcher, recorded before sending, never resent after a possible delivery, dark until `SLACK_DM_LIVE`; and workflow events to `SLACK_WORKFLOW_WEBHOOK_URL`, never echoed back for Slack-sourced tasks. Ops still does not read Slack messages (no `*:history` scopes). Smart Report always blocks these tables.
- **Consequences:** a new module event should call `publishNotification()` with a `dedupeKey`. A new work source is a `Source` in `sources.ts` with its permission gate. Notifying employees who have no login (most of them) needs a person-keyed recipient — see improvements.md.

### 2026-10-09 — Slack identity keyed on person (migration 0229)
- **Context:** Ops needs to DM employees (schedule changes, PTO decisions, interview assignments). Only 22 of 94 active employees have an `app_user` login, so a link on `app_user` would miss most staff.
- **Decision:** `person_slack_link` keyed by `person_id` (service-role only, deny-all policy). `slack_user_id` is the permanent identifier; email is only used to find it, and never a name. A partial unique index stops one Slack account being connected to two people. Rows are never deleted. Whether a person may be messaged (`person.status`) is checked at send time and not copied onto the link, so the `person_after_change` triggers stay the single source for offboarding.
- **Consequences:** any future sender (Phase 2 notification service) must use only `status = 'connected'` links and must also check `person.status` itself. The rules are pinned by `src/lib/slack/matching.test.ts`.

### 2026-10-09 — Texting via Twilio, service-role tables (migration 0228)
- **Context:** staff need to text candidates and employees; US carriers require A2P 10DLC registration, consent, and STOP handling.
- **Decision:** Twilio REST over `fetch` (no SDK). `sms_message`, `sms_opt_out` and `sms_consent` are service-role only (deny-all policy); the app reads and writes them after `canTextPerson`. Opt-outs are keyed by phone number, because STOP comes from a number, not a person. Candidate consent is read straight from the application's `sms_consent` answer (not copied); `sms_consent` only holds consent that staff record. The feature stays dark until all Twilio env vars exist, and `SMS_LIVE` gates real recipients.
- **Consequences:** the `sms_*` tables must exist before the Twilio env vars are set in an environment. Adding a send path (e.g. scheduling-link texts) must go through `sendSmsToPerson` so the same rules apply.

### 2026-10-08 — Sensitive HR boundaries enforced in the database (migration 0227)
- **Context:** 0164's `gdo_members_all` let every active `app_user` (Staff included) read/write every table through PostgREST with their own token — salaries, reviews, discipline, the audit log — regardless of what the UI hid. OWASP ASVS L2 review.
- **Decision:** keep `gdo_members_all` as the floor, but replace it on the HR-file tables with role-aware policies (inline subqueries on `app_user`, no helper RPCs per AGENTS.md); drop table-level SELECT/INSERT/UPDATE on `person_employment` for `authenticated` and re-grant only non-compensation columns; make `audit_log` append-only (trigger) and service-role only; require AAL2 in `is_gdo_user()` once a user has a verified MFA factor. Staff on other people's HR profiles get the same restricted view Schedule Admins already had. See `docs/security.md`.
- **Consequences:** any user-scoped query that selects a compensation column now fails with `42501`; a column added to `person_employment` must be granted explicitly. Changing role semantics in `permissions.ts` must be mirrored in the 0227 predicates — `scripts/security_rls_matrix.sql` (staging) and `permissions.test.ts` pin both.

