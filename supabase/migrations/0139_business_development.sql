-- ============================================================================
-- Green Dog Ops — 0139 Business Development planner
-- ----------------------------------------------------------------------------
-- A capacity/revenue planning surface (new Reporting tab). Lets the user model,
-- per clinic:
--   * which days of the week the clinic is open,
--   * how many of each appointment TYPE are rendered per open day,
--   * an editable average dollar value per appointment type,
-- and projects daily -> weekly -> monthly revenue so they can predict the upside
-- of increasing capacity of specific appointment types.
--
-- Per-type dollar values CANNOT be reliably derived from data (the Agenda stores
-- a client display name while invoices key on a business/account name, so the
-- two only match ~0.4% of the time). Instead each value is an EDITABLE ASSUMPTION
-- seeded from the clinic's blended average appointment value
-- (report_by_location.avg_appointment_value). The "current average appointments
-- per day" reference IS derived, from the Agenda per-appointment snapshots.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- bizdev_location_config : per-clinic open-days scenario (one row per location).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.bizdev_location_config (
  location_id uuid primary key references greendogops.location (id) on delete cascade,
  open_sun    boolean not null default false,
  open_mon    boolean not null default true,
  open_tue    boolean not null default true,
  open_wed    boolean not null default true,
  open_thu    boolean not null default true,
  open_fri    boolean not null default true,
  open_sat    boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- bizdev_appt_type : per-clinic, per-appointment-type planning row.
--   avg_value       = editable $ assumption (seeded from clinic blended average)
--   planned_per_day = scenario count rendered per OPEN day (seeded from the
--                     current realized average, editable)
--   included        = whether the row participates in the scenario totals
--   is_custom       = a user-added type not seen in the Agenda snapshots
-- ---------------------------------------------------------------------------
create table if not exists greendogops.bizdev_appt_type (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references greendogops.location (id) on delete cascade,
  appt_type       text not null,
  avg_value       numeric not null default 0,
  planned_per_day numeric not null default 0,
  included        boolean not null default true,
  is_custom       boolean not null default false,
  sort_order      integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (location_id, appt_type)
);

create index if not exists bizdev_appt_type_location_idx
  on greendogops.bizdev_appt_type (location_id);

-- ---------------------------------------------------------------------------
-- bizdev_appt_type_daily_avg() : current realized average appointments/day per
-- (location, appt_type), derived from the Agenda per-appointment snapshots.
--   * Only PAST/TODAY days (appt_date <= LA today) count as realized volume.
--   * For each (location, day) use the LATEST snapshot so an appointment is
--     counted once (the most recent pull that still saw the day).
--   * avg_per_day = total appts of the type / the clinic's number of realized
--     operating days in the window (so days with none still dilute the average).
-- ---------------------------------------------------------------------------
create or replace function greendogops.bizdev_appt_type_daily_avg()
returns table (
  location_id   uuid,
  appt_type     text,
  avg_per_day   numeric,
  days_observed integer,
  total_appts   integer
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
           coalesce(nullif(trim(s.appt_type), ''), 'Unspecified') as appt_type,
           count(*) as cnt
    from greendogops.ezyvet_agenda_appt_snapshot s
    join latest l
      on l.location_id   = s.location_id
     and l.appt_date     = s.appt_date
     and l.snapshot_date = s.snapshot_date
    group by s.location_id, s.appt_date,
             coalesce(nullif(trim(s.appt_type), ''), 'Unspecified')
  ),
  loc_days as (
    select location_id, count(distinct appt_date) as open_days
    from appts
    group by location_id
  )
  select a.location_id,
         a.appt_type,
         round(sum(a.cnt)::numeric / nullif(ld.open_days, 0), 2) as avg_per_day,
         ld.open_days::int as days_observed,
         sum(a.cnt)::int   as total_appts
  from appts a
  join loc_days ld on ld.location_id = a.location_id
  group by a.location_id, a.appt_type, ld.open_days;
$$;

grant execute on function greendogops.bizdev_appt_type_daily_avg()
  to authenticated, service_role;
