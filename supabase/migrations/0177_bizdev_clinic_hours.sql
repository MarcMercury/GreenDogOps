-- ============================================================================
-- Green Dog Ops — 0177 Biz Dev clinic hours
-- ----------------------------------------------------------------------------
-- Per-clinic, per-weekday opening hours for the Business Development planner.
-- The Planning Guide lays a day's planned appointments out across these hours,
-- so the plan fills the whole time the clinic is actually open instead of only
-- the hours that happen to have historical demand.
--
-- Stored as minutes from midnight (480 = 8:00am, 1080 = 6:00pm) to match the
-- planning_guide tables. Follows the existing per-weekday column convention on
-- this table (open_sun.. / factor_sun..).
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.bizdev_location_config
  add column if not exists open_min_sun  smallint not null default 480,
  add column if not exists open_min_mon  smallint not null default 480,
  add column if not exists open_min_tue  smallint not null default 480,
  add column if not exists open_min_wed  smallint not null default 480,
  add column if not exists open_min_thu  smallint not null default 480,
  add column if not exists open_min_fri  smallint not null default 480,
  add column if not exists open_min_sat  smallint not null default 480,
  add column if not exists close_min_sun smallint not null default 1080,
  add column if not exists close_min_mon smallint not null default 1080,
  add column if not exists close_min_tue smallint not null default 1080,
  add column if not exists close_min_wed smallint not null default 1080,
  add column if not exists close_min_thu smallint not null default 1080,
  add column if not exists close_min_fri smallint not null default 1080,
  add column if not exists close_min_sat smallint not null default 1080;

-- Sanity bounds: a day is 0..1440 minutes and must close after it opens.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bizdev_location_config_hours_ck'
      and conrelid = 'greendogops.bizdev_location_config'::regclass
  ) then
    alter table greendogops.bizdev_location_config
      add constraint bizdev_location_config_hours_ck check (
        open_min_sun between 0 and 1439 and close_min_sun between open_min_sun + 15 and 1440 and
        open_min_mon between 0 and 1439 and close_min_mon between open_min_mon + 15 and 1440 and
        open_min_tue between 0 and 1439 and close_min_tue between open_min_tue + 15 and 1440 and
        open_min_wed between 0 and 1439 and close_min_wed between open_min_wed + 15 and 1440 and
        open_min_thu between 0 and 1439 and close_min_thu between open_min_thu + 15 and 1440 and
        open_min_fri between 0 and 1439 and close_min_fri between open_min_fri + 15 and 1440 and
        open_min_sat between 0 and 1439 and close_min_sat between open_min_sat + 15 and 1440
      );
  end if;
end $$;
