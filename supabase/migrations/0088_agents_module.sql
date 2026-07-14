-- ============================================================================
-- Green Dog Ops — 0088 Agents module (automation control plane)
-- ----------------------------------------------------------------------------
-- The Admin ▸ Agents tab is where every automated "agent" we build is
-- registered, monitored, and manually triggered. The first agent is the
-- ezyVet daily ingest (browser automation that logs into ezyVet, runs a set of
-- reports for the previous day, and pushes the data into Green Dog Ops).
--
-- Three tables:
--   * agent          — a registered automation (key, schedule, enabled, config).
--   * agent_report   — the catalog of reports/tasks an agent runs (per agent).
--   * agent_run      — one execution (scheduled or manual): status, timing,
--                      records processed, token usage + cost, error.
--   * agent_run_log  — granular log lines emitted during a run (for drill-down).
--
-- The actual browser worker runs OFF Vercel (e.g. GitHub Actions cron at 5AM +
-- workflow_dispatch for ad-hoc). It reports progress back to the app via the
-- CRON_SECRET-gated /api/agents/ingest endpoint, which writes these rows.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- agent : a registered automation.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.agent (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,          -- stable slug, e.g. 'ezyvet_daily_ingest'
  name           text not null,
  description    text,
  category       text not null default 'ingest',
  -- Cron expression for the scheduled run (display + worker schedule source).
  schedule_cron  text,
  timezone       text not null default 'America/Los_Angeles',
  enabled        boolean not null default true,
  -- Free-form config the worker reads (e.g. login target, options).
  config         jsonb not null default '{}'::jsonb,
  -- Denormalized last-run summary for fast dashboard rendering.
  last_run_at    timestamptz,
  last_status    text,                           -- 'success' | 'error' | 'running' | ...
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.agent;
create trigger set_updated_at before update on greendogops.agent
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_report : the catalog of reports/tasks a given agent runs.
-- scope = 'global' (one run for the whole business) or 'per_location'
-- (must switch the ezyVet reporting clinic and run once per location).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.agent_report (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references greendogops.agent (id) on delete cascade,
  key            text not null,                  -- e.g. 'invoice_lines'
  name           text not null,                  -- e.g. 'Invoice Lines'
  scope          text not null default 'global', -- 'global' | 'per_location'
  description    text,
  -- Which app table/importer this feeds (documentation for the worker/UI).
  target         text,
  enabled        boolean not null default true,
  sort_order     integer not null default 0,
  config         jsonb not null default '{}'::jsonb,
  last_run_at    timestamptz,
  last_status    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (agent_id, key)
);

drop trigger if exists set_updated_at on greendogops.agent_report;
create trigger set_updated_at before update on greendogops.agent_report
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_run : one execution of an agent.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.agent_run (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references greendogops.agent (id) on delete cascade,
  trigger            text not null default 'manual',  -- 'scheduled' | 'manual'
  status             text not null default 'queued',  -- queued|running|success|error|cancelled
  -- The data date this run targets (usually "yesterday" for the 5AM job).
  target_date        date,
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_ms        integer,
  records_processed  integer not null default 0,
  records_new        integer not null default 0,
  -- Token / cost accounting (0 for purely deterministic report runs).
  tokens_input       bigint not null default 0,
  tokens_output      bigint not null default 0,
  cost_usd           numeric(12, 4) not null default 0,
  triggered_by       uuid,                             -- app_user.id for manual runs
  triggered_by_email text,
  error              text,
  -- Per-report breakdown + any other structured detail.
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists agent_run_agent_idx   on greendogops.agent_run (agent_id, created_at desc);
create index if not exists agent_run_status_idx  on greendogops.agent_run (status);

-- ---------------------------------------------------------------------------
-- agent_run_log : granular log lines for a run (drill-down + debugging).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.agent_run_log (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references greendogops.agent_run (id) on delete cascade,
  ts         timestamptz not null default now(),
  level      text not null default 'info',        -- info|warn|error
  message    text not null,
  data       jsonb not null default '{}'::jsonb
);

create index if not exists agent_run_log_run_idx on greendogops.agent_run_log (run_id, ts);

-- ---------------------------------------------------------------------------
-- Seed the first agent: ezyVet daily ingest + its initial report catalog.
-- ---------------------------------------------------------------------------
insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values (
  'ezyvet_daily_ingest',
  'ezyVet Daily Ingest',
  'Logs into ezyVet, runs the reporting exports for the previous day, and updates Green Dog Ops. Some reports are global; some run once per clinic location.',
  'ingest',
  '0 5 * * *',
  'America/Los_Angeles',
  jsonb_build_object(
    'login_url', 'https://greendog.usw2.ezyvet.com/login.php',
    'locations', jsonb_build_array('sherman_oaks', 'van_nuys', 'venice')
  )
)
on conflict (key) do nothing;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, r.key, r.name, r.scope, r.description, r.target, r.sort_order
from greendogops.agent a
cross join (values
  ('invoice_lines',      'Invoice Lines',      'global',       'Detailed invoice lines feeding the main Reporting page and doctor performance reports.', 'ezyvet_invoice_line', 10),
  ('referral_statistics','Referral Statistics','global',       'Referral statistics for referral reporting.',                                            'referral (stats)',    20),
  ('referral_revenue',   'Referral Revenue',   'per_location', 'Referral revenue, run once per clinic location.',                                        'referral (revenue)',  30)
) as r(key, name, scope, description, target, sort_order)
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
