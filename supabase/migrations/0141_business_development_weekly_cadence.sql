-- ============================================================================
-- Green Dog Ops — 0141 Business Development: weekly cadence + all-type catalog
-- ----------------------------------------------------------------------------
-- Two enhancements to the Business Development planner:
--
--  1. WEEKLY CADENCE. Some services don't happen every open day (e.g. a weekly
--     specialty surgery block, a monthly-ish advanced procedure). A per-row
--     `cadence` ('daily' | 'weekly') lets the user model those on a WEEKLY
--     basis: a weekly row projects `planned_per_week * avg_value` for the week
--     directly, instead of `planned_per_day * open_days`. `planned_per_week`
--     holds that scenario count.
--
--  2. ALL TYPES AT EVERY CLINIC. The seeding (application-side in
--     getBusinessDevelopmentData) now cross-seeds the FULL union of appointment
--     types to every clinic, so a service a clinic doesn't currently render is
--     still available to toggle ON and model (included=false by default). This
--     migration only adds the columns; the union seeding lives in the action.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.bizdev_appt_type
  add column if not exists planned_per_week numeric not null default 0,
  add column if not exists cadence          text    not null default 'daily';

alter table greendogops.bizdev_appt_type
  drop constraint if exists bizdev_appt_type_cadence_chk;
alter table greendogops.bizdev_appt_type
  add constraint bizdev_appt_type_cadence_chk check (cadence in ('daily', 'weekly'));
