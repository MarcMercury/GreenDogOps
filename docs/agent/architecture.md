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

### 2026-10-12 — Ask Ziggy: lookups yes, revenue reporting no (migrations 0233–0234)
- **Context:** the owner wants every employee to look up retail prices and what ONE client paid ("how much did X pay on 3/14?"), but not run revenue reports ("how much did Venice make on 3/14?"). Both read `ezyvet_invoice_line`, so a table grant cannot tell them apart. The owner also confirmed AI-provider privacy is not a constraint.
- **Decision:** bounded, service-role-only lookup functions (`client_summary`, `client_visits`, `patient_visits`) that resolve to at most 10 clients/patients per call, plus — for the General tier only — a TS guard (`lookupCallProblem`) that accepts them only as `name('literal')`, at most 3 per query, so no join or subquery can fan them out across every client. Retail prices come from `product_catalog` (no cost/markup/margin). `staff_directory` and `schedule_roster` give names and who-works-when without private fields or attendance notes.
- **Consequences:** a new per-entity money lookup must follow the same pattern (cap in SQL + listed in `GENERAL_LOOKUP_FUNCTIONS`); `smart-scope.test.ts` checks every listed function calls a capped `ziggy_*_codes` helper. Raw billing tables and `report_*` revenue views stay off the General allow-list.

### 2026-10-12 — Smart Report becomes Ask Ziggy, open to every employee
- **Context:** the owner wants one AI assistant for every employee (company knowledge, cross-location patient/client lookup, own schedule/PTO), with higher roles reaching more. Smart Report already had conversation, policy retrieval with sources, per-role scope and a learning loop, but was closed to Staff and lived under Reporting. Location-level scoping is explicitly not wanted ("location agnostic").
- **Decision:** rename to Ask Ziggy at `/ask-ziggy` with its own `ask_ziggy` module key (on for every role, per-user override). Roles stay as they are; Staff get a new `general` tier that is an **allow-list** (`GENERAL_ALLOWED_TABLES`) resolved against the live catalog, because a deny-list cannot keep revenue out of ~100 tables and column blocking is defeated by whole-row expressions (`to_jsonb(t)`, `t::text`). Questions about the asker are answered from server-fetched own records (`ziggy-context.ts`), never by SQL over other employees. Functions that execute SQL from a string literal are rejected for every tier.
- **Consequences:** a new table/view is invisible to Staff until added to the allow-list, and anything added must be safe to read in full (`smart-scope.test.ts` checks existence and money columns). Employee names, the roster, prices and per-client charges came next through purpose-built views and bounded functions (0233, below).

### 2026-10-12 — Required basic-info fields on QR capture forms (migration 0232)
- **Context:** QR capture forms (`/q/<token>`, `/lead/<token>`) let custom questions be Required, but the built-in contact block only enforced the name and "email OR phone", so event leads arrived without a way to follow up.
- **Decision:** `qr_form.require_email` / `require_phone` (default **true**, applied to all existing forms) and `require_pet_name` / `require_zip` (default false, only effective while `collect_pet_name` / `collect_zip` is on). One rule, `checkBasicAnswers()` + `basicRequirementsFrom()` in `src/lib/marketing/qr.ts`, is used by both public submit actions; the browser `required` attributes are a convenience only. Both the pages and the actions treat an inactive form as "no form" (default rules, no custom questions). `saveQrForm` only writes `require_*` when the `basic_fields` marker is posted, so a stale editor tab cannot clear them.
- **Consequences:** new basic fields need a `require_*` column, a branch in `checkBasicAnswers`, and a row in `BasicFieldsEditor`. Rules are pinned by `src/lib/marketing/qr.test.ts`. ATS forms already had per-question Required and are unchanged.

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
- **Decision:** Twilio REST over `fetch` (no SDK). `sms_message`, `sms_opt_out` and `sms_consent` are service-role only (deny-all policy); the app reads and writes them after `canTextPerson`. Opt-outs are keyed by phone number, because STOP comes from a number, not a person. Consent is self-service only. On `/apply`, ticking the box writes an `sms_consent` row (older Indeed/website applications still count through the application's `sms_consent` answer). Anyone else opts in at the public `/texts` page, matched by mobile number + last name. Staff can remove consent but not record it (2026-10-12): carriers rejected the campaign (30923) when consent looked like an onboarding requirement and couldn't be verified. The feature stays dark until all Twilio env vars exist, and `SMS_LIVE` gates real recipients.
- **Consequences:** the `sms_*` tables must exist before the Twilio env vars are set in an environment. Adding a send path (e.g. scheduling-link texts) must go through `sendSmsToPerson` so the same rules apply.

### 2026-10-08 — Sensitive HR boundaries enforced in the database (migration 0227)
- **Context:** 0164's `gdo_members_all` let every active `app_user` (Staff included) read/write every table through PostgREST with their own token — salaries, reviews, discipline, the audit log — regardless of what the UI hid. OWASP ASVS L2 review.
- **Decision:** keep `gdo_members_all` as the floor, but replace it on the HR-file tables with role-aware policies (inline subqueries on `app_user`, no helper RPCs per AGENTS.md); drop table-level SELECT/INSERT/UPDATE on `person_employment` for `authenticated` and re-grant only non-compensation columns; make `audit_log` append-only (trigger) and service-role only; require AAL2 in `is_gdo_user()` once a user has a verified MFA factor. Staff on other people's HR profiles get the same restricted view Schedule Admins already had. See `docs/security.md`.
- **Consequences:** any user-scoped query that selects a compensation column now fails with `42501`; a column added to `person_employment` must be granted explicitly. Changing role semantics in `permissions.ts` must be mirrored in the 0227 predicates — `scripts/security_rls_matrix.sql` (staging) and `permissions.test.ts` pin both.

