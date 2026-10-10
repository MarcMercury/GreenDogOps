-- 0231_integration_health.sql
--
-- One health record for every scheduled job (Admin ▸ Agents ▸ Health).
--
-- Before this, Admin ▸ Agents showed only the ezyVet browser agents and the
-- inline Sheets / Slack / dispatch jobs. The Vercel crons (calendar sync, Gmail
-- intake, rejection emails, When I Work, digests, …) left no shared record, so
-- a revoked token or an unshared calendar failed silently.
--
-- 1. agent gains last_success_at, last_error and consecutive_failures.
-- 2. A trigger on agent_run keeps them current for EVERY writer (browser
--    workers, inline jobs, crons), so no writer has to remember to.
-- 3. The Vercel crons are registered as agents with runner = 'vercel_cron'.
--    Frequent ones record a run only when they changed something or failed,
--    and otherwise just stamp the agent row (src/lib/admin/cron-run.ts).
-- 4. Every agent gets config.stale_after_minutes: no success for longer than
--    that means the job has silently stopped.

begin;

alter table greendogops.agent
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text,
  add column if not exists consecutive_failures integer not null default 0;

comment on column greendogops.agent.last_success_at is
  'Finish time of the latest successful run (maintained by agent_run_rollup and cron-run.ts).';
comment on column greendogops.agent.last_error is
  'Error text of the latest finished run; a success that carries an error is a partial failure.';
comment on column greendogops.agent.consecutive_failures is
  'Finished runs with status error since the last success.';

-- ---------------------------------------------------------------------------
-- Roll each finished run up onto its agent. Fires once per transition into a
-- finished state, so re-saving a finished run does not double-count.
-- ---------------------------------------------------------------------------
create or replace function greendogops.agent_run_rollup()
returns trigger
language plpgsql
set search_path = greendogops, pg_temp
as $$
begin
  if new.status not in ('success', 'error') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('success', 'error') then
    return new;
  end if;

  update greendogops.agent a
     set last_run_at          = greatest(coalesce(a.last_run_at, '-infinity'), coalesce(new.finished_at, now())),
         last_status          = new.status,
         last_error           = new.error,
         last_success_at      = case
                                  when new.status = 'success'
                                    then greatest(coalesce(a.last_success_at, '-infinity'), coalesce(new.finished_at, now()))
                                  else a.last_success_at
                                end,
         consecutive_failures = case when new.status = 'success' then 0 else a.consecutive_failures + 1 end
   where a.id = new.agent_id;
  return new;
end;
$$;

revoke all on function greendogops.agent_run_rollup() from public, anon, authenticated;

drop trigger if exists agent_run_rollup on greendogops.agent_run;
create trigger agent_run_rollup
  after insert or update of status on greendogops.agent_run
  for each row execute function greendogops.agent_run_rollup();

-- ---------------------------------------------------------------------------
-- Backfill from history.
-- ---------------------------------------------------------------------------
update greendogops.agent a
   set last_success_at = s.last_success,
       last_error = latest.error,
       consecutive_failures = coalesce(f.n, 0)
  from (
    select a2.id,
           (select max(coalesce(r.finished_at, r.started_at, r.created_at))
              from greendogops.agent_run r
             where r.agent_id = a2.id and r.status = 'success') as last_success
      from greendogops.agent a2
  ) s
  left join lateral (
    select r.error
      from greendogops.agent_run r
     where r.agent_id = s.id and r.status in ('success', 'error')
     order by coalesce(r.finished_at, r.started_at, r.created_at) desc
     limit 1
  ) latest on true
  left join lateral (
    select count(*)::int as n
      from greendogops.agent_run r
     where r.agent_id = s.id
       and r.status = 'error'
       and coalesce(r.finished_at, r.started_at, r.created_at) > coalesce(s.last_success, '-infinity')
  ) f on true
 where a.id = s.id;

-- ---------------------------------------------------------------------------
-- Register the Vercel crons (schedules are vercel.json's, in UTC).
-- ---------------------------------------------------------------------------
insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values
  ('calendar_sync', 'Google Calendar Sync',
   'Mirrors the company, Green Dog company and interview Google calendars into the Calendar module.',
   'sync', '*/15 * * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/calendar/sync', 'stale_after_minutes', 60)),
  ('ats_gmail_intake', 'Careers Inbox Intake',
   'Reads new applications from the careers Gmail inbox and creates candidate profiles.',
   'ingest', '*/5 * * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/ats/gmail', 'stale_after_minutes', 30)),
  ('ats_rejection_emails', 'Candidate Rejection Emails',
   'Sends rejection emails once their 48-hour hold has passed.',
   'notify', '*/15 * * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/ats/rejections', 'stale_after_minutes', 60)),
  ('wheniwork_timeoff', 'When I Work Time Off',
   'Turns When I Work time-off notification emails into pending time-off requests.',
   'ingest', '*/15 * * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/agents/wheniwork/timeoff', 'stale_after_minutes', 60)),
  ('user_roster_sync', 'Login ↔ Roster Sync',
   'Links logins to HR roster records by email and refreshes their names and titles.',
   'sync', '15 5 * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/admin/users/roster-sync', 'stale_after_minutes', 1560)),
  ('rescue_partner_sync', 'Rescue Partner Sync',
   'Adds ezyVet "Rescue Partners" contacts to the Rescue/Shelter CRM at 7 AM Pacific.',
   'sync', '0 14,15 * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/agents/ezyvet/rescue-partners', 'stale_after_minutes', 1560)),
  ('med_board_rollover', 'Medical Board Rollover',
   'Archives yesterday''s medical boards and builds today''s from the overnight ezyVet pull.',
   'maintenance', '0 13,14 * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/med-ops/boards/rollover', 'stale_after_minutes', 1560)),
  ('bizdev_refresh', 'Business Development Refresh',
   'Rebuilds the Business Development base numbers from the Agenda snapshots and invoice lines.',
   'maintenance', '30 15,16 * * *', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/agents/bizdev/refresh', 'stale_after_minutes', 1560)),
  ('reporting_slack_digest', 'Weekly Reporting Digest',
   'Posts last business week''s appointments and revenue per clinic to #ops-reporting (Mondays).',
   'notify', '0 16 * * 1', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/agents/reporting/slack-digest', 'stale_after_minutes', 10200)),
  ('reporting_slack_upcoming', 'Upcoming Appointments Report',
   'Posts next week''s booked vs offered appointments to Slack (Tuesdays and Thursdays).',
   'notify', '0 16 * * 2,4', 'UTC',
   jsonb_build_object('runner', 'vercel_cron', 'endpoint', '/api/agents/reporting/slack-upcoming', 'stale_after_minutes', 7320))
on conflict (key) do update set
  name          = excluded.name,
  description   = excluded.description,
  category      = excluded.category,
  schedule_cron = excluded.schedule_cron,
  timezone      = excluded.timezone,
  config        = greendogops.agent.config || excluded.config;

-- Staleness thresholds for the jobs registered earlier (daily = 26 h).
update greendogops.agent
   set config = config || jsonb_build_object('stale_after_minutes', 1560)
 where key in ('ezyvet_daily_ingest', 'ezyvet_agenda_lookahead', 'ezyvet_extra_reports',
               'sheet_daily_sync', 'slack_user_sync');
update greendogops.agent
   set config = config || jsonb_build_object('stale_after_minutes', 30)
 where key = 'notification_dispatch';

commit;
