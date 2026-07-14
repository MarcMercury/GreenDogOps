-- ============================================================================
-- Green Dog Ops — 0095 dedicated Agenda look-ahead agent
-- ----------------------------------------------------------------------------
-- The Agenda pull is split into FOUR separate runs (one 7-day week each), fired
-- 10 minutes apart starting at 5 AM PT, so the Schedule always has the next 4
-- weeks of appointment demand loaded without a single heavy 28-day pull.
--
-- Move it off the daily ingest agent onto its own agent so the Admin ▸ Agents
-- dashboard shows the four look-ahead runs separately.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values (
  'ezyvet_agenda_lookahead',
  'ezyVet Agenda Look-ahead',
  'Pulls the ezyVet Agenda appointment schedule one week at a time (four runs, 10 minutes apart, from 5 AM PT) so the Schedule and Daily Capacity always show the next 4 weeks of booked-appointment demand per location and department.',
  'ingest',
  '0,10,20,30 12 * * *',
  'America/Los_Angeles',
  jsonb_build_object('weeks', 4, 'window_days', 7)
)
on conflict (key) do nothing;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order, config)
select a.id, 'agenda', 'Agenda', 'global',
       'Forward appointment schedule, one week per run (4 runs cover the next 4 weeks).',
       'ezyvet_agenda_count', 10,
       jsonb_build_object('window_days', 7, 'forward', true)
from greendogops.agent a
where a.key = 'ezyvet_agenda_lookahead'
on conflict (agent_id, key) do nothing;

-- Remove the Agenda entry from the daily ingest catalog (now owned above).
delete from greendogops.agent_report
where key = 'agenda'
  and agent_id = (select id from greendogops.agent where key = 'ezyvet_daily_ingest');
