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

## Recovery log

Add entries as `### YYYY-MM-DD — system — symptom` with root cause, fix, and evidence.
