-- ============================================================================
-- Green Dog Ops — 0100 Agents: list the Agenda report on the Daily Ingest card
-- ----------------------------------------------------------------------------
-- The Agenda look-ahead pull runs on its own agent (ezyvet_agenda_lookahead,
-- migration 0095) so its four weekly runs show separately in Admin ▸ Agents.
-- Operationally, though, it is one of the ezyVet reports pulled every morning,
-- so it should also appear in the ezyVet Daily Ingest card's report catalog so
-- the "reports being run" list is complete.
--
-- This is a catalog/display row only — the daily ingest worker does not run the
-- Agenda pull (the dedicated look-ahead agent does). Scope is per_location to
-- match how the Agenda report is actually pulled (once per clinic).
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order, config)
select a.id, 'agenda', 'Agenda', 'per_location',
       'Forward appointment schedule pulled per location (one week per run, four runs cover the next 4 weeks). Feeds the Schedule / Daily Capacity per-department booked-appointment counts and the Appointment Review report. Run by the dedicated ezyVet Agenda Look-ahead agent.',
       'ezyvet_agenda_count', 40,
       jsonb_build_object('window_days', 7, 'forward', true)
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
