# Improvement backlog

Work discovered but deliberately not done. Highest value first. Each entry:
**why it matters**, **scope**, **risk**. Remove entries when done (mention the commit).

## P1 — Safety net

### CI for lint + unit tests
- **Why:** `.github/workflows/` only verifies the baseline and runs agents/backups. Lint and the vitest suite never run on push, and local `tsc` is impossible — so Vercel's build is the only automated gate.
- **Scope:** one workflow running `npm ci`, `npm run lint`, `npm test` on push/PR.
- **Risk:** low.

### Architectural contract tests
- **Why:** catch violations of the invariants in architecture.md that ordinary unit tests miss.
- **Scope:** static vitest checks over the source tree — e.g. no `createClient(` outside `src/lib/supabase`; no `createAdminClient` / service-role import in `"use client"` files; every `actions.ts` export calls a permission helper; every `src/app/api/**/route.ts` listed in `vercel.json` calls `isAuthorizedCronRequest`; migrations reference no schema but `greendogops`; no `grant execute ... to authenticated`.
- **Risk:** low; may surface existing violations that need triage.

## P2 — Reliability

### Unified integration-health view
- **Why:** `/admin/agents` shows browser-agent runs only. Cron jobs (calendar sync, Gmail poller, Sheets sync, Slack digests) have no shared last-success / staleness record, so silent failures go unnoticed.
- **Scope:** record cron runs in `agent_run` (or a sibling table); add last-success, staleness, and error-category to the admin view; alert on repeated failures.
- **Risk:** medium — touches every cron route.

### Recurring-failure improvement report
- **Why:** turn `agent_run` failures + lessons.md into a periodic, prioritised report instead of rediscovering issues.
- **Scope:** depends on the health view above.
- **Risk:** low once data exists.

## P3 — Code quality

### Two divergent `fetchAllRows` implementations
- `src/lib/supabase/paginate.ts` (used by ~18 files, also exports concurrent variant) and `src/lib/supabase/fetch-all.ts` (2 files, structurally typed builder). Consolidate into one.
- **Risk:** low; check call-site signatures.

### Shared to-one embed helper
- README says "use the existing first*() helpers" but none exist; files unwrap ad hoc (e.g. `one<T>()` in `src/lib/ats/job-hires.ts`). Add one helper in `src/lib/supabase/` and fix the README.
- **Risk:** low.

### Vitest config
- No `vitest.config.*`; works today on defaults. Add one if path aliases or `server-only` imports start breaking tests.
