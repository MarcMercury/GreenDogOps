-- ============================================================================
-- Green Dog Ops — 0098 Agenda report runs per location
-- ----------------------------------------------------------------------------
-- The Agenda look-ahead / look-back workers now switch the ezyVet clinic header
-- and pull the Agenda report once per location (Sherman Oaks, Van Nuys, Venice),
-- exactly like the daily Referrer Revenue report. Each per-location upload is
-- scoped so it only rebuilds that clinic's booked-appointment counts, and the
-- agent_run detail records a per-location slug (e.g. "week_0:van_nuys",
-- "review:venice") so the Admin ▸ Agents audit shows the Agenda report running
-- for each location.
--
-- Flip the catalog entry from 'global' to 'per_location' so the dashboard badge
-- reflects the new behaviour.
-- ============================================================================
set search_path = greendogops, public;

update greendogops.agent_report
set scope = 'per_location',
    description = 'Forward appointment schedule pulled per location (one week per run, four runs cover the next 4 weeks). Feeds the Schedule / Daily Capacity per-department booked-appointment counts and the Appointment Review report (booked vs rendered).'
where key = 'agenda'
  and agent_id = (select id from greendogops.agent where key = 'ezyvet_agenda_lookahead');
