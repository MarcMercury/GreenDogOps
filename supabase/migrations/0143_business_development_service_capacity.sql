-- ============================================================================
-- Green Dog Ops — 0143 Business Development: per-service provider capacity
-- ----------------------------------------------------------------------------
-- Provider capacity is not one flat "appts per doctor per day" — it depends on
-- the SERVICE and varies per clinic:
--   * an Advanced Procedure ties up a doctor far longer than a wellness exam,
--   * Tech Services need a technician, not a doctor,
--   * some lines (retail, waitlist) need no provider at all.
--
-- So capacity moves onto the per-(clinic,service) row: each line gets a provider
-- ROLE (doctor / tech / none) and a per-provider daily THROUGHPUT (how many of
-- THIS service one provider of that role can render in a full day). Clinic-level
-- config tracks how many of each provider type are staffed.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.bizdev_appt_type
  add column if not exists provider_role    text    not null default 'dvm',
  add column if not exists per_provider_day numeric not null default 0;

alter table greendogops.bizdev_appt_type
  drop constraint if exists bizdev_appt_type_role_chk;
alter table greendogops.bizdev_appt_type
  add constraint bizdev_appt_type_role_chk
  check (provider_role in ('dvm', 'tech', 'none'));

-- Seed an obvious default: anything named "…Tech…" is tech-rendered.
update greendogops.bizdev_appt_type
set provider_role = 'tech'
where provider_role = 'dvm'
  and appt_type ilike '%tech%';

alter table greendogops.bizdev_location_config
  add column if not exists tech_count  numeric not null default 0,
  add column if not exists added_techs numeric not null default 0;
