# Security & data protection

Green Dog Ops holds employee, compensation, HR, recruiting and (soon)
timekeeping data. The target is **OWASP ASVS Level 2**. Payroll, tax, W-4 and
direct-deposit data stay in **ADP** and must never be stored here.

This document records what is in place, the operating procedures the standard
requires, and what the owner still has to do. Keep it current when a control
changes.

---

## 1. Authorization model

Authorization is enforced **on the server and in the database**, never just by
hiding UI.

| Layer | What it enforces |
| --- | --- |
| `src/proxy.ts` | Optimistic "has a session" gate and path stamping. Not a security boundary on its own. |
| `(app)/layout.tsx` + `getAuthState()` | Active `app_user`, two-step verification, module read-gate. |
| Server actions (`ensureCanEdit`, `ensureCanEditSensitiveHr`, `requireAdmin`) | Write permissions, re-checked on every call. |
| Postgres RLS (`0164`, `0165`, `0227`) | Membership floor on every table + the sensitive HR boundaries below, so a direct REST call with a user's own token cannot exceed what the app shows. |

### Sensitive HR boundary (migration `0227`)

| Data | Who can read through the API role | Who can write |
| --- | --- | --- |
| Reviews, disciplinary actions, assets, onboarding, compliance, licenses | HR roles (owner, admin, executive, manager) — or the employee's own record | HR roles with HR edit rights |
| Employee documents, stage history | Same; candidates (`prospect`/`applicant`) also visible to anyone with Recruiting access (not Staff unless granted — `0237`) | HR roles; Recruiting editors for candidates |
| Compensation columns on `person_employment` | **Nobody** — service role only, after `canViewAllCompensation` or own-record check | Same |
| `audit_log` | Nobody — service role only (Admin → Audit) | Append-only; UPDATE/DELETE/TRUNCATE blocked by trigger |

App-level behaviour that matches it:

- Staff see the HR roster grid but cannot open **someone else's** HR profile
  (`canOpenHrProfile`); their own profile is unchanged. Should a Staff user be
  given another profile view, it still shows only General + Shift Eligibility,
  without personal fields (DOB, home ZIP/phones, notes, PTO, separation details).
- Staff have no Recruiting access by default, so neither the app nor the API
  shows them candidates' documents or stage history: migration `0237` makes
  the `ats_read` predicate default to "role is not Staff" when no per-user
  `ats` override is set (it defaulted to on in `0227`).
- Schedule/Marketing Admins keep the restricted profile view they already had;
  the hidden datasets are no longer sent to the browser at all.
- HR-file mutations require an HR role (`ensureCanEditSensitiveHr`).
- Document deletion looks up the storage path server-side (no client-supplied
  paths), in HR and ATS alike.
- Service-role code that touches the shared document shelf (ATS document
  list/upload/delete) applies `personDocumentAccess()` — the same rule as the
  `person_document` RLS policy — because the service role bypasses RLS.

### Staff are read-only in the database (migration `0239`)

Staff is the employee role: every rostered employee has a Staff login (since
2026-10-13). The app has always treated Staff as read-only; `0239` makes the
database agree:

| Layer | Rule |
| --- | --- |
| Postgres | Every `greendogops` table carries three RESTRICTIVE policies (`staff_read_only_insert/update/delete`) that refuse an active Staff login. They AND with the permissive policies, so Staff still read what `gdo_members_all` allows and every other role is unchanged. `protect_new_objects()` adds them to new tables; `rls_audit()` reports any table without them. |
| Postgres | No `SECURITY DEFINER` function is executable by `authenticated` except the policy helpers `is_gdo_user()` / `is_gdo_admin()` (`0238`). |
| App | Anything a Staff user may change is written by a Server Action with the service role after its own check: Med Ops boards (`ensureBoardUser`), and later the self-service time clock and PTO, which must act only on `current.appUser.person_id`. |

The separate `employee` role added by `0238` was retired by `0239` (the value
stays in the enum; `app_user_role_supported` rejects it). The RLS matrix
probes all of the above (`staff_*` keys).

### Testing the boundary ("Can Employee A see Employee B?")

Run on **staging** after any change to roles, RLS or HR tables:

```bash
SUPABASE_PROJECT_REF=<staging_ref> scripts/supabase-sql.sh -f scripts/security_rls_matrix.sql
```

It impersonates every role through PostgREST's own mechanism, probes reviews,
discipline, documents, compensation, audit log and MFA, then rolls everything
back. Expected output: `RLS_MATRIX PASS`. Unit tests in
`src/lib/auth/permissions.test.ts` and `src/lib/hr/types.test.ts` pin the
app-side rules and the compensation column list.

### "View as" (Owner access preview)

Owners can preview the app as any active user, or as a role's default access,
from **View as…** in the sidebar footer, and switch back with **Switch back to
me**. Code: `src/lib/auth/view-as.ts` (rules, unit-tested),
`getAuthState()` / `getRealAuthState()` in `src/lib/auth/session.ts`, and
`POST /api/view-as`.

- The `gdo_view_as` cookie (HttpOnly, 8 h) only names a target. It is honoured
  only while the **real** signed-in user is an active Owner who has passed
  two-step, and that is re-checked on every request. A forged cookie does
  nothing for anyone else.
- `getAuthState()` is the effective (previewed) state that every permission
  check uses. `getRealAuthState()` is the signed-in person, used by two-step
  verification and the switcher.
- **Previews are read-only.** During a preview, `getCurrentUser` /
  `requireUser` / `ensure*` refuse any Server Action or `/api` request
  (detected from the proxy-stamped method and path headers), so nothing can be
  written or sent under the previewed person's identity. Pure reads opt in with
  `{ allowPreview: true }`. Add that only to code that never writes or
  messages anyone.
- Switching back is a plain form post that clears the cookie for any session,
  whatever the previewed access. Sign-out also clears it.
- Render-time syncs that record no actor still run while previewing (e.g.
  opening a Medical Board seeds missing Agenda rows via `medical_board_seed`),
  exactly as they would for the Owner. Render-time audit entries (Emp
  Reporting's `compensation.report_viewed`) are attributed to the real Owner,
  with `viewing_as` in the metadata.
- **Limitation:** RLS still runs as the Owner (`auth.uid()`), so a list that
  relies only on RLS may show rows the previewed user could not see. Menus,
  module gates, role checks and app-side field rules are exact.
- Start and stop are audited as `view_as.start` / `view_as.stop`.

## 2. Authentication & sessions

- Supabase Auth: bcrypt password hashing, 1-hour JWTs, rotating refresh
  tokens, Secure + SameSite cookies over HTTPS. The session cookie is not
  HttpOnly because the realtime board displays use the browser client; RLS is
  what makes a leaked token no more powerful than the app itself.
- **Two-step verification (TOTP)** — `/login/mfa`. Anyone can enroll from the
  sidebar link. Once enrolled, every sign-in asks for a code, enforced in the
  app *and* in `greendogops.is_gdo_user()` (AAL2 required).
  **Admin → Settings → Require two-step verification** forces enrollment for
  Owner/Admin/Executive/Manager. It ships **off**; turn it on after those
  users have been told.
- Lost phone: Admin → Users → *user* → **Reset two-step verification**
  (audited).
- Sign-in throttling: 10 attempts per account and 60 per IP per 15 minutes;
  code verification 8 per 10 minutes per user. Supabase Auth adds its own
  limits underneath.
- Disabling a user (`is_active = false`) blocks them on their **next request**
  at both the app and RLS layers, because every check reads `app_user`. Their
  Supabase session is not deleted, because `auth.users` is shared with
  EmployeeGMGDD and a global sign-out would also log them out there.

## 3. Audit log

`greendogops.audit_log` is append-only. Events recorded include: sign-in,
failed / throttled sign-in, sign-out, two-step enroll/verify/failure/reset,
user role/access changes (with previous values), password resets, compensation
changes (old → new pay rate), Emp Reporting views, HR document upload/delete,
HR roster exports, employee deletion, imports, plus module-specific CRM/ATS
events. Never log passwords, codes or tokens.

**Retention purge** (only under an approved retention policy): an owner runs,
in one transaction in the SQL editor —
`alter table greendogops.audit_log disable trigger audit_log_append_only_row;`
→ the `delete` → re-enable the trigger → insert an `audit.purged` row recording
who, why, the cutoff date and row count.

## 4. Files

- All document buckets (`employee-documents`, `crm-documents`, `resources`) are
  **private**; files are served through short-lived signed URLs after an
  authorization check. `qr-form-banners` is public by design (images only).
- Upload content types are derived from an extension allow-list
  (`src/lib/security/upload.ts`), never from the browser MIME type, so HTML/SVG
  can't render from a signed URL. Names are sanitised and prefixed; size
  limits apply (15 MB public forms, 25 MB internal).
- Known gap: ATS Slack announcements include a 7-day signed resume link.

## 5. Transport, headers, public endpoints

- HTTPS everywhere (Vercel, Supabase). App headers (`next.config.ts`): HSTS,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP
  (`base-uri`/`object-src`/`upgrade-insecure-requests`), and clickjacking
  protection (`frame-ancestors 'none'` / `X-Frame-Options: DENY`) on every
  route except the public capture forms.
- Public forms (`/apply`, `/forms`, `/book`, `/lead`, `/q`, `/ce/signup`) are
  rate-limited per IP (`src/lib/security/rate-limit.ts`, DB-backed) and the
  application form has a honeypot.
- Cron/worker routes require `CRON_SECRET` (timing-safe, fail-closed).
  Webhooks: Resend/Svix signature + 5-minute timestamp tolerance + idempotent
  on message id; Indeed HMAC (timing-safe).

## 6. Integration registry

| Integration | Data sent / received | Auth | Secret location | Rotation |
| --- | --- | --- | --- | --- |
| Supabase (DB, Auth, Storage) | Everything | anon key (public), service-role key (server only) | Vercel env, `.secrets/` | Supabase dashboard → API keys; update Vercel |
| Vercel | App hosting, env | Vercel account (owner) | — | — |
| Google Workspace (Calendar, Gmail, Drive, Sheets) | Interview events, recruiting mail, sheet sync | Service account + OAuth refresh tokens | Vercel env (`GOOGLE_*`, `GMAIL_*`) | Revoke/reissue in Google Cloud; recruiter tokens are per-user (`recruiter_google_token`, service-role only) |
| Google Maps / Custom Search | Addresses, search queries | API keys (restrict by HTTP referrer / API) | Vercel env | Google Cloud → Credentials |
| Resend | Candidate/partner email | API key; webhook `whsec_` secret | Vercel env | Resend dashboard |
| Slack | Hiring/ops posts (no salary, address, HR records); reads workspace member names/emails to link staff (`users:read`, `users:read.email`). Further write/read-metadata scopes are granted for planned DMs/user groups (list in `.env.example`); no `*:history` scope, so the app cannot read messages | Bot token | Vercel env | Slack app settings |
| Indeed (employer portal export, no API) | Candidate CSV export (inbound, manual script) | Username/password | `.secrets/indeed.env` | Indeed employer account |
| When I Work (via Gmail) | Time-off notifications (inbound) | Gmail OAuth refresh token | Vercel env | Google OAuth |
| ezyVet (browser agent) | Clinic reports (inbound) | Username/password | GitHub Actions secrets | ezyVet admin |
| CE Broker (agent) | CE attendance | Credentials | `.secrets/cebroker.env` | CE Broker |
| LLM providers (Gemini/OpenAI/…) | Smart Report questions + scoped query results | API keys | Vercel env | Provider console |
| AWS S3 | Encrypted (`age`) database backups | IAM key | GitHub Actions secrets | AWS IAM |

Owner for every row: the Green Dog Ops administrator. Use least-privilege
scopes; calendar access for interview scheduling should be free/busy only where
the provider allows.

## 7. Data retention (proposed — confirm with counsel)

Retention is a policy decision; nothing is purged automatically.

| Category | Proposed minimum | Basis |
| --- | --- | --- |
| Timekeeping (punches, meals, corrections, exports) | 4 years | CA Labor Code §§226, 1174 (3 yrs) + buffer |
| Personnel files, reviews, discipline | 4 years after separation | FEHA (Gov. Code §12946) |
| Applications, resumes, interview notes | 4 years from decision | FEHA (Gov. Code §12946) |
| Audit log | 6 years | Security investigations |
| Backups | 90 days (artifact), per S3 lifecycle | `backup.yml` |

Employee records should be archived (status `former`), not deleted. Permanent
deletion is Owner/Admin-only and audited.

## 8. Backups & restore testing

Encrypted (`age`) dumps every 4 hours (critical) and nightly (full) to S3 and
GitHub artifacts — see README → Backups. **Quarterly**: restore the latest dump
into staging (`scripts/restore_database.sh --file <f> --to <staging_ref>
--data-only`) and record the date and result below.

| Date | Dump | Result | By |
| --- | --- | --- | --- |
| | | | |

## 9. Access review (quarterly)

Admin → Users shows role, status, two-step status, last sign-in and last seen.
Each quarter: deactivate former employees and contractors, confirm every
Owner/Admin/Executive/Manager has two-step on, and review per-user module
overrides — especially `emp_reporting`, `reporting` and `admin`.

## 10. Incident response

1. **Detect** — Admin → Audit, Supabase auth logs, Vercel logs, user reports.
2. **Contain** — revoke the user (Admin → Users), reset their two-step and
   password; rotate any exposed key (table above); disable the integration.
3. **Preserve evidence** — export the relevant `audit_log` rows and Vercel /
   Supabase logs before anything else changes.
4. **Scope** — which records and people were affected (RLS matrix, audit
   trail, storage access).
5. **Restore** — fix, redeploy, restore data from backup if needed.
6. **Notify** — California breach-notification law (Civil Code §1798.82)
   applies to covered personal information; involve counsel.
7. **Document** — what happened, timeline, remediation, follow-ups.

## 11. Owner actions outstanding

These need account-owner access and cannot be done from the codebase:

- [ ] **Make the GitHub repository private.** It has been public; past history
      contains candidate data and HR documents. Consider a history purge
      (`git filter-repo`) after coordinating with everyone who has a clone.
- [ ] **Rotate the three Google API keys** that were committed in
      `scripts/fix_vercel_maps_env.sh`, and restrict them (referrer / API).
- [ ] Have counsel review whether the public exposure triggers notification.
- [ ] Supabase Auth (shared with EmployeeGMGDD): raise minimum password length
      to 8+, enable leaked-password protection, enable "MFA factor
      enrolled/unenrolled" notification emails.
- [ ] Protect `main` (required review, no force-push), require 2FA for the
      GitHub org, enable secret scanning.
- [ ] Turn on **Require two-step verification** once privileged users are
      ready.
- [ ] Decide on a session lifetime: `security.session_timeout_minutes` exists
      but is not enforced, because enforcing it would sign out the always-on
      clinic board displays (patient window / medical boards) daily.

## 12. Timekeeping — requirements and what is built

Requirements: store every punch append-only with the immutable employee id;
record corrections as separate rows (original, new, who, when, why); lock pay
periods after the ADP export and flag any later change; keep an export history
(period, timestamp, user, employees, hours, file hash, version); authenticate
every punch individually (no shared logins; a kiosk mode limited to clock
in/out/meal and today's punches).

Built in `0240` (My Time, `/me`) and `0241` (location check, approvals):

| Requirement | How |
| --- | --- |
| Append-only punches | `time_punch` has triggers that block UPDATE/DELETE/TRUNCATE for every role, the service role included. Its only writer is `record_time_punch()` (service role only): per-person advisory lock, state check, double-tap idempotency (same punch within 60 s), server `clock_timestamp()`. The device clock is stored as `client_time` for reference only. |
| Per-punch authentication | Each punch is a Server Action by the signed-in user, acting only on their own `app_user.person_id`; refused during a View-as preview; rate-limited. No shared logins, no kiosk yet. |
| Corrections as separate rows | `time_correction_request` (employee asks, with reason). Approval (`decide_time_correction()`) records a `time_punch_adjustment` — `add` a punch, or `void` the wrong one and add the corrected one — append-only, with reason and approver. Approvers can also add a missing punch directly. The timecard is the *effective* punches (punches − voids + adds), and the clock state uses them too. |
| Clinic configuration (D11) | Admin ▸ Time Clock: Owner/Admin edit, Executive view. Networks are validated (public addresses only, no range broader than /24 IPv4 or /48 IPv6) and deactivated rather than deleted; the client IP comes from Vercel's `x-forwarded-for`, which Vercel overwrites so clients cannot spoof it. Every change is audited (`timeclock.*`). |
| Approvals (D9) | Owner, Admin, Executive, HR / Manager with Scheduling access (`canApproveTime`), at Scheduling ▸ Time Clock (`/schedule/time-clock`): off-site punches, correction requests, missing punches. Schedule Admins see the queues without location evidence and cannot change hours. Nobody approves or changes their own time. Every decision is audited (`timeclock.*`). |
| Location captured only at the punch | GPS + accuracy (if the browser allows), IP and user agent are stored on the punch row; nothing is collected between punches. |
| Location check (§F, D6) | `src/lib/timeclock/location-check.ts`: the scheduled clinic first, then every other clinic; a clinic passes on an approved network (`location_network`, IP/CIDR from the request's forwarded IP) **or** an accurate GPS fix inside its geofence, per its `clock_policy`. Mobile locations accept anything (GPS recorded). A clinic with nothing configured is `not_checked` (never sent to approval). A failed check is never refused: the employee confirms "Working off-site" with a required note, and the punch is stored with `needs_approval` until an approver approves it or rejects it (reject voids it, with a note). The result, matched clinic/network and distance are stored with the evidence. |
| Privacy notice | Shown and acknowledged (`time_clock_notice_ack`, versioned) before the first punch; always at `/me/privacy`. |
| Access | All three tables are service-role only and always blocked in Ask Ziggy. Employees see only their own punches; approver views come with item 5. |
| Retention | 4 years after the pay period ends (D10). Nothing deletes punches. |

Decision (owner, 2026-10-13): keep the go-live plan (§F). Each punch keeps its
raw GPS + accuracy, IP and user agent alongside the check result, so a reviewer
can see why it passed or failed; they are visible only to timecard approvers
and are kept for the same 4 years as the punch. This replaces an earlier note
that asked to store only "location verified: <clinic>".

Not built yet: pay-period lock, export history and the ADP file (Gate 2).
