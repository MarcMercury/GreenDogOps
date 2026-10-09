-- ============================================================================
-- Green Dog Ops — 0229 Slack user linking
-- ----------------------------------------------------------------------------
--   person_slack_link   one row per person: the Slack account Ops messages
--                       that person at. Keyed by person (the HR identity), not
--                       app_user, because most employees never sign in.
--
-- slack_user_id is the permanent identifier; email is only used to find it.
-- Rows are never deleted when a Slack account is deactivated or an employee
-- leaves: status records why the link can't be used, and the old id stays
-- for audit. Whether the person may still be messaged is decided at send
-- time from person.status, not copied here.
--
-- Service-role only: the app reads/writes it in server code after
-- requireAdmin / HR access checks (src/lib/slack/link-sync.ts).
-- ============================================================================

set search_path = greendogops, public;

begin;

create table if not exists person_slack_link (
  person_id uuid primary key references person (id) on delete cascade,
  status text not null default 'not_found'
    check (status in ('connected', 'not_found', 'ambiguous', 'inactive', 'disconnected')),
  slack_team_id text,
  slack_user_id text check (slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]+$'),
  slack_email text,
  slack_display_name text,
  slack_real_name text,
  match_method text check (match_method in ('email', 'manual')),
  matched_by uuid references app_user (id) on delete set null,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_slack_link_connected_has_user
    check (status <> 'connected' or slack_user_id is not null)
);

comment on table person_slack_link is
  'Ops person -> Slack user. slack_user_id is the permanent id; email only finds it. Service role only.';
comment on column person_slack_link.status is
  'connected | not_found (no Slack account with their email) | ambiguous (several) | inactive (Slack account deactivated/removed) | disconnected (admin unlinked; never auto-rematched)';
comment on column person_slack_link.match_method is
  'email = matched automatically; manual = an admin picked the Slack user (emails need not agree)';

-- One Slack account can be connected to only one person.
create unique index if not exists person_slack_link_connected_user_uq
  on person_slack_link (slack_team_id, slack_user_id)
  where status = 'connected';

create index if not exists person_slack_link_status_idx on person_slack_link (status);

drop trigger if exists set_updated_at on person_slack_link;
create trigger set_updated_at before update on person_slack_link
  for each row execute function set_updated_at();

-- The event trigger adds gdo_members_all to new tables; this one is
-- service-role only, so replace it with an explicit deny-all (keeps
-- rls_audit() clean).
alter table greendogops.person_slack_link enable row level security;
drop policy if exists gdo_members_all on greendogops.person_slack_link;
drop policy if exists service_role_only on greendogops.person_slack_link;
create policy service_role_only on greendogops.person_slack_link
  for all to authenticated using (false) with check (false);
revoke all on greendogops.person_slack_link from anon, authenticated;

-- Register the reconcile job so it shows up in Admin ▸ Agents with history and
-- a "Run now" button. `runner: inline` = runs inside the app.
insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values (
  'slack_user_sync',
  'Slack User Sync',
  'Links active employees to their Slack accounts by email, and flags Slack accounts that were deactivated or removed. Never re-links anyone by name.',
  'ingest',
  '30 22 * * *',
  'America/Los_Angeles',
  jsonb_build_object('runner', 'inline', 'endpoint', '/api/admin/slack/sync')
)
on conflict (key) do update set
  name          = excluded.name,
  description   = excluded.description,
  schedule_cron = excluded.schedule_cron,
  config        = greendogops.agent.config || excluded.config;

commit;
