# Integrations

Behaviour, failure modes, and recovery for external systems. Overview of what
exists is in the root [README](../../README.md) "Automation & integrations".

## ezyVet browser agents (`agent/`, GitHub Actions)

- No API — Playwright drives a real Chromium session.
- **AWS WAF JS challenge** on login passes only with a realistic browser fingerprint. A login failure after a UI/agent change: check fingerprint/context options before suspecting credentials.
- **Report Queue keeps stale runs.** Downloads are matched against a queue snapshot taken before printing — preserve that logic or you'll ingest an old report.
- Large reports (Animals ~45k, Contacts ~33k rows) upload in chunks via `agent/lib/ingest.mjs`.
- GitHub cron is UTC-only: each job fires at two UTC times and the worker no-ops the wrong one. A "skipped" run is not necessarily a failure.
- Runs are recorded in `greendogops.agent_run` / `agent_run_log`, viewable at `/admin/agents`. A green Actions run is not proof the data is complete — check row counts and the latest data date.
- Workflows: `.github/workflows/ezyvet-*.yml`. Inspect failures with `GH_TOKEN="$GITHUB_TOKEN" gh run list --workflow <file>` and `gh run view <id> --log-failed`.

## Vercel Cron (`vercel.json`)

- Every route authenticates via `isAuthorizedCronRequest` (`CRON_SECRET`); long jobs set `maxDuration = 300`.
- Jobs that post to Slack or send email are **externally visible** — never trigger them manually to "test" without authorization.

## LLM chain (`src/lib/ai/llm.ts`)

- `callTextLLM()` walks `LLM_PROVIDER_ORDER` (default Gemini → Groq → OpenRouter → OpenAI → Anthropic), temperature 0. One provider failing should degrade, not break; if *all* fail, check keys/quotas before code.

## Google, Slack, Resend

- Google auth: service account or stored OAuth refresh token (`scripts/google_oauth_setup.mjs`, `scripts/gmail_oauth_setup.mjs`). An `invalid_grant` means the refresh token was revoked/expired — needs the user to re-run setup; not fixable by code.
- Resend delivery events arrive at `/api/email/webhook`.

## Twilio texting (`src/lib/sms`)

- Off until `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID` are all set; until then nothing touches the `sms_*` tables (migration 0228).
- Test mode: unless `SMS_LIVE=true`, only numbers in `SMS_TEST_NUMBERS` can be texted.
- Every send is logged in `sms_message` *before* Twilio is called, and is never retried automatically (a timeout may still have delivered it). Staff see the failure and resend by hand.
- Before any send: allowed status (not `former`), US mobile number, consent (application `sms_consent` answer or an `sms_consent` row), no `sms_opt_out` row, 8 AM–9 PM Pacific, 60 sends/hour per staff member.
- Twilio console → Messaging Service → Integration: incoming messages webhook `https://greendogops.com/api/sms/inbound` (HTTP POST). The signature is checked against `APP_BASE_URL` + path, so the URL in Twilio must match it exactly — a mismatch shows up as 403s in Twilio's error log.
- STOP/START are recorded in `sms_opt_out` and Twilio's Advanced Opt-Out sends the replies. Twilio error 21610 means the number opted out at Twilio's level.
- Replies email the staff member who last texted that number.
- Setup (verified 2026-10-09 via the Twilio API): Messaging Service "Green Dog Ops" `MGf23e0d0e4865f65c41a95505986fa0bd` with inbound webhook `https://greendogops.com/api/sms/inbound`; one number, +1 213-269-5208; brand `BN6a1b0a5acd8c954fb9252eed06a60236` is **Sole Proprietor** (approved). That type allows one number and low volume, so re-register as a Standard brand before scaling. Campaign was `IN_PROGRESS` that day; until it's approved, carriers block delivery (Twilio error 30034).
- The same number's own SMS URL still points at another app (`ourhomes.me`). The service setting wins (`use_inbound_webhook_on_number=false`), so that app no longer receives replies on this number.
- Check the setup: an unsigned POST to `/api/sms/status` returns 403; a correctly signed one with an unknown MessageSid returns 204 and writes nothing.

## Recovery log

Add entries as `### YYYY-MM-DD — system — symptom` with root cause, fix, and evidence.
