-- ============================================================================
-- Green Dog Ops — 0142 Business Development: predictive levers
-- ----------------------------------------------------------------------------
-- Four enhancements to make the planner predictive:
--   (1) Day-of-week volume factors per clinic (Saturdays run lighter, etc.).
--   (2) Per-type capacity ceiling (max/day) to keep scenarios realistic.
--   (5) Hour-of-day demand: backfill appt_time from the raw Agenda Start value
--       and expose a realized hourly-demand RPC.
--   (6) Provider-backed capacity: model DVM count × appts/provider so adding a
--       doctor converts into a concrete revenue delta.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- (1) + (6) : per-clinic scenario columns on bizdev_location_config.
--   factor_*          = day-of-week volume multiplier vs a typical weekday
--                       (1.0 = a normal weekday; Saturday ~0.7, etc.).
--   dvm_count         = current doctors staffed on a typical open day.
--   appts_per_dvm_day = appointments one doctor can render per day (capacity).
--   added_dvms        = scenario: extra doctors to add (revenue-delta driver).
-- ---------------------------------------------------------------------------
alter table greendogops.bizdev_location_config
  add column if not exists factor_sun        numeric not null default 1,
  add column if not exists factor_mon        numeric not null default 1,
  add column if not exists factor_tue        numeric not null default 1,
  add column if not exists factor_wed        numeric not null default 1,
  add column if not exists factor_thu        numeric not null default 1,
  add column if not exists factor_fri        numeric not null default 1,
  add column if not exists factor_sat        numeric not null default 1,
  add column if not exists dvm_count         numeric not null default 0,
  add column if not exists appts_per_dvm_day numeric not null default 0,
  add column if not exists added_dvms        numeric not null default 0;

-- ---------------------------------------------------------------------------
-- (2) : per-type capacity ceiling. 0 = no cap.
-- ---------------------------------------------------------------------------
alter table greendogops.bizdev_appt_type
  add column if not exists max_per_day numeric not null default 0;

-- ---------------------------------------------------------------------------
-- (5) : backfill appt_time from the raw Agenda "Start" value preserved in the
-- per-appointment detail JSON. The ingest looked for a header containing
-- "time" but the export column is literally "Start"/"End", so appt_time was
-- always NULL. Going forward the ingest resolves "Start"; this backfills the
-- history that already stored the raw value in details.
-- ---------------------------------------------------------------------------
update greendogops.ezyvet_agenda_appt_snapshot
set appt_time = details ->> 'Start'
where appt_time is null
  and coalesce(details ->> 'Start', '') <> '';

-- ---------------------------------------------------------------------------
-- (1) bizdev_weekday_factor() : realized day-of-week volume factor per clinic,
-- computed as that weekday's average revenue / the clinic's typical WEEKDAY
-- (Mon–Fri) average revenue. n_days = how many dates back the factor (so the
-- app can ignore thin closed-day samples, e.g. the near-zero Sunday stragglers).
-- ---------------------------------------------------------------------------
create or replace function greendogops.bizdev_weekday_factor()
returns table (
  location_id uuid,
  dow         int,
  factor      numeric,
  n_days      int
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with daily as (
    select location_key,
           line_date,
           extract(dow from line_date)::int as dow,
           sum(coalesce(total_incl, 0)) as rev
    from greendogops.ezyvet_invoice_line
    where line_date >= (current_date - interval '18 months')
      and location_key in ('sherman_oaks', 'van_nuys', 'venice')
    group by location_key, line_date
  ),
  by_dow as (
    select location_key, dow, avg(rev) as avg_rev, count(*) as n_days
    from daily
    group by location_key, dow
  ),
  weekday_base as (
    select location_key, avg(avg_rev) as base
    from by_dow
    where dow between 1 and 5
    group by location_key
  ),
  loc as (
    select id,
           case lower(name)
             when 'sherman oaks' then 'sherman_oaks'
             when 'van nuys'     then 'van_nuys'
             when 'venice'       then 'venice'
           end as lk
    from greendogops.location
  )
  select l.id,
         b.dow,
         round((b.avg_rev / nullif(wb.base, 0))::numeric, 3) as factor,
         b.n_days::int
  from by_dow b
  join weekday_base wb on wb.location_key = b.location_key
  join loc l on l.lk = b.location_key;
$$;

grant execute on function greendogops.bizdev_weekday_factor()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (5) bizdev_hour_demand() : realized booked appointments by hour-of-day per
-- clinic, from the Agenda per-appointment snapshots. Only realized days
-- (appt_date <= LA today), latest snapshot per (loc,day) so each appointment is
-- counted once. avg_per_open_day = appts in that hour / the clinic's realized
-- operating days, so it reads as "appointments this hour on a typical day".
-- ---------------------------------------------------------------------------
create or replace function greendogops.bizdev_hour_demand()
returns table (
  location_id     uuid,
  hour            int,
  appt_count      int,
  avg_per_open_day numeric
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  latest as (
    select location_id, appt_date, max(snapshot_date) as snapshot_date
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date <= (select d from la_today)
    group by location_id, appt_date
  ),
  appts as (
    select s.location_id,
           s.appt_date,
           -- Parse "HH:MMAM"/"HH:MMPM" -> 0..23 hour.
           (
             (substring(s.appt_time from '^([0-9]{1,2}):')::int % 12)
             + case when s.appt_time ilike '%pm' then 12 else 0 end
           ) as hour
    from greendogops.ezyvet_agenda_appt_snapshot s
    join latest l
      on l.location_id   = s.location_id
     and l.appt_date     = s.appt_date
     and l.snapshot_date = s.snapshot_date
    where s.appt_time ~ '^[0-9]{1,2}:[0-9]{2}\s*(AM|PM)$'
  ),
  loc_days as (
    select location_id, count(distinct appt_date) as open_days
    from appts
    group by location_id
  )
  select a.location_id,
         a.hour,
         count(*)::int as appt_count,
         round(count(*)::numeric / nullif(ld.open_days, 0), 2) as avg_per_open_day
  from appts a
  join loc_days ld on ld.location_id = a.location_id
  group by a.location_id, a.hour, ld.open_days;
$$;

grant execute on function greendogops.bizdev_hour_demand()
  to authenticated, service_role;
