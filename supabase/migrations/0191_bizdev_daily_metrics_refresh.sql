-- ============================================================================
-- Green Dog Ops — 0191 Business Development: DAILY refresh of the real base
--                  numbers (avg appointments/day + avg value per type/clinic)
-- ----------------------------------------------------------------------------
-- 0139/0140 persisted `avg_per_day` and `avg_value` on bizdev_appt_type, but
-- they were only ever SEEDED (on the first page load that found no row). As new
-- Agenda snapshots and invoices land every morning, those numbers went stale.
--
-- This migration makes them a daily-refreshed derivative of the live data while
-- still honouring hand-tuned values:
--   * bizdev_appt_type.value_overridden / per_day_overridden — set when a user
--     edits that cell; an overridden cell is never auto-updated again (until
--     the override is reset).
--   * bizdev_refresh_metrics() — recomputes both numbers for every non-custom,
--     non-overridden row from bizdev_appt_type_daily_avg() /
--     bizdev_appt_type_value(), inserts rows for appointment types that are new
--     in the data, and stamps bizdev_location_config.metrics_refreshed_at.
-- Called every morning by the /api/agents/bizdev/refresh cron (after the ezyVet
-- ingest) and on-demand when the planner is opened with a stale stamp.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.bizdev_appt_type
  add column if not exists value_overridden   boolean not null default false,
  add column if not exists per_day_overridden boolean not null default false;

comment on column greendogops.bizdev_appt_type.value_overridden is
  'User typed an avg_value by hand — the daily refresh must not overwrite it.';
comment on column greendogops.bizdev_appt_type.per_day_overridden is
  'User typed an avg_per_day by hand — the daily refresh must not overwrite it.';

alter table greendogops.bizdev_location_config
  add column if not exists metrics_refreshed_at timestamptz;

comment on column greendogops.bizdev_location_config.metrics_refreshed_at is
  'When bizdev_refresh_metrics() last rebuilt this clinic''s derived base numbers.';

-- ---------------------------------------------------------------------------
-- bizdev_refresh_metrics() : re-derive the planner base numbers from live data.
--   * avg_per_day  <- bizdev_appt_type_daily_avg()  (0 when the type no longer
--                     shows any realized volume at that clinic)
--   * avg_value    <- bizdev_appt_type_value(), falling back to the pooled
--                     all-clinic value for the type (matched-sample weighted)
--   * Skips is_custom rows (the user supplied those numbers) and any cell the
--     user overrode.
--   * Never touches the scenario columns (planned_per_day / planned_per_week /
--     cadence / max_per_day / included / hidden) — those are the user's plan.
-- Idempotent, so running it twice a day (DST-safe cron) is harmless.
-- ---------------------------------------------------------------------------
create or replace function greendogops.bizdev_refresh_metrics()
returns table (
  rows_inserted        integer,
  rows_per_day_updated integer,
  rows_value_updated   integer,
  refreshed_at         timestamptz
)
language plpgsql
security definer
set search_path = greendogops, public
as $$
declare
  v_now        timestamptz := now();
  v_inserted   integer := 0;
  v_per_day    integer := 0;
  v_value      integer := 0;
begin
  -- Both source functions are expensive full scans; materialize them once.
  drop table if exists pg_temp._bd_daily;
  create temp table _bd_daily on commit drop as
    select * from greendogops.bizdev_appt_type_daily_avg();

  drop table if exists pg_temp._bd_value;
  create temp table _bd_value on commit drop as
    select * from greendogops.bizdev_appt_type_value();

  -- Pooled all-clinic value per type, weighted by matched sample size — the
  -- fallback for a clinic that has never invoiced that service.
  drop table if exists pg_temp._bd_pooled;
  create temp table _bd_pooled on commit drop as
    select v.appt_type,
           sum(v.avg_value * v.matched_paid) / nullif(sum(v.matched_paid), 0) as avg_value
    from pg_temp._bd_value v
    where v.matched_paid > 0
    group by v.appt_type;

  -- The clinics the planner covers. Seeded app-side on first load, so this is
  -- a no-op until getBusinessDevelopmentData() has run once.
  drop table if exists pg_temp._bd_loc;
  create temp table _bd_loc on commit drop as
    select distinct location_id from greendogops.bizdev_appt_type;

  -- Appointment types that are new in the data get a row at every planned
  -- clinic: ON with its real average where the clinic renders it, OFF (catalog
  -- only, pooled value) everywhere else.
  with catalog as (
    select appt_type from pg_temp._bd_daily
    union
    select appt_type from pg_temp._bd_value
  ),
  ins as (
    insert into greendogops.bizdev_appt_type
      (location_id, appt_type, avg_value, avg_per_day, planned_per_day, included, sort_order)
    select l.location_id,
           c.appt_type,
           round(coalesce(v.avg_value, p.avg_value, 0), 2),
           round(coalesce(d.avg_per_day, 0), 2),
           round(coalesce(d.avg_per_day, 0)),
           d.appt_type is not null,
           case when d.appt_type is not null
                then 1000 - least(999, coalesce(d.total_appts, 0))
                else 2000
           end
    from pg_temp._bd_loc l
    cross join catalog c
    left join pg_temp._bd_daily  d on d.location_id = l.location_id and d.appt_type = c.appt_type
    left join pg_temp._bd_value  v on v.location_id = l.location_id and v.appt_type = c.appt_type
    left join pg_temp._bd_pooled p on p.appt_type = c.appt_type
    on conflict (location_id, appt_type) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  -- Realized appointments/day. A type with no rows left in the realized window
  -- falls back to 0 so the base number always reflects the data — but only at
  -- clinics that actually reported volume, so a clinic with no snapshots yet is
  -- left alone rather than wiped.
  with target as (
    select t.id,
           round(coalesce(d.avg_per_day, 0), 2) as new_per_day
    from greendogops.bizdev_appt_type t
    left join pg_temp._bd_daily d
      on d.location_id = t.location_id and d.appt_type = t.appt_type
    where not t.per_day_overridden
      and not t.is_custom
      and exists (select 1 from pg_temp._bd_daily x where x.location_id = t.location_id)
  ),
  upd as (
    update greendogops.bizdev_appt_type t
    set avg_per_day = target.new_per_day,
        updated_at  = v_now
    from target
    where target.id = t.id
      and t.avg_per_day is distinct from target.new_per_day
    returning 1
  )
  select count(*)::int into v_per_day from upd;

  -- Recovered average revenue per appointment.
  with target as (
    select t.id,
           round(coalesce(v.avg_value, p.avg_value, 0), 2) as new_value
    from greendogops.bizdev_appt_type t
    left join pg_temp._bd_value  v
      on v.location_id = t.location_id and v.appt_type = t.appt_type
    left join pg_temp._bd_pooled p on p.appt_type = t.appt_type
    where not t.value_overridden
      and not t.is_custom
  ),
  upd as (
    update greendogops.bizdev_appt_type t
    set avg_value  = target.new_value,
        updated_at = v_now
    from target
    where target.id = t.id
      and t.avg_value is distinct from target.new_value
    returning 1
  )
  select count(*)::int into v_value from upd;

  -- Stamp every planned clinic, creating the config row if the planner hasn't.
  insert into greendogops.bizdev_location_config (location_id, metrics_refreshed_at)
  select l.location_id, v_now
  from pg_temp._bd_loc l
  on conflict (location_id) do update
    set metrics_refreshed_at = excluded.metrics_refreshed_at,
        updated_at           = v_now;

  return query select v_inserted, v_per_day, v_value, v_now;
end;
$$;

comment on function greendogops.bizdev_refresh_metrics() is
  'Business Development: re-derive avg_per_day and avg_value per (clinic, appointment type) from the latest Agenda snapshots and invoices. Skips custom rows and user-overridden cells. Run daily after the ezyVet ingest.';

grant execute on function greendogops.bizdev_refresh_metrics()
  to authenticated, service_role;
