-- ============================================================================
-- Green Dog Ops — 0144 Business Development: hide appointment types + drop staffing
-- ----------------------------------------------------------------------------
-- (a) `hidden` lets a clinic fully remove a service line from the planner list
--     (distinct from `included`, which only drops it from the scenario totals).
-- (b) The per-service provider/staffing model (role + throughput + doctor/tech
--     counts) proved unworkable in practice — one doctor covers many services,
--     some services need multiple providers — so the whole staffing portion is
--     removed. Its columns are dropped. (The simple `max_per_day` ceiling stays;
--     it is a practical per-service cap, not a staffing concept.)
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.bizdev_appt_type
  add column if not exists hidden boolean not null default false;

-- Remove the staffing model.
alter table greendogops.bizdev_appt_type
  drop constraint if exists bizdev_appt_type_role_chk;
alter table greendogops.bizdev_appt_type
  drop column if exists provider_role,
  drop column if exists per_provider_day;

alter table greendogops.bizdev_location_config
  drop column if exists dvm_count,
  drop column if exists appts_per_dvm_day,
  drop column if exists added_dvms,
  drop column if exists tech_count,
  drop column if exists added_techs;
