-- ============================================================================
-- Green Dog Ops — 0193 Upcoming-appointments Slack report
-- ----------------------------------------------------------------------------
-- A forward-looking "how full is next week" report, posted to Slack on Tuesdays
-- and Thursdays. Per clinic and day it shows booked-vs-available for three
-- tracks: DENTAL (NAD + OE), VE (veterinary exams) and AP (advanced procedures).
--
-- The BOOKED side already exists — ezyvet_agenda_appt_snapshot carries one row
-- per upcoming appointment with its ezyVet type. What was missing is:
--
--   1. which report track an appointment TYPE belongs to
--      -> ezyvet_appt_type_dept_map.report_track (this table already holds one
--         row per type and has a Set Up UI, so the vocabulary stays in one place)
--   2. how many slots each clinic OFFERS per track on a given weekday
--      -> report_capacity_target (the recurring weekly pattern)
--   3. one-off deviations — closures, student days, extra doctors
--      -> report_capacity_override (a single date, wins over the pattern)
--
-- Capacity is deliberately NOT derived from planning_capacity_rule: that model
-- resolves ONE number for the whole NAD/VE/UC area, and this report needs the
-- dental and vet-exam lanes reported separately.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Appointment type -> report track
-- ---------------------------------------------------------------------------
alter table greendogops.ezyvet_appt_type_dept_map
  add column if not exists report_track text
    check (report_track is null or report_track in ('nad', 'oe', 've', 'ap'));

comment on column greendogops.ezyvet_appt_type_dept_map.report_track is
  'Track this type is counted in on the upcoming-appointments Slack report: nad + oe roll up to DENTAL, ve = vet exams, ap = advanced procedures. NULL = not counted.';

-- Seed from the types observed in the Agenda snapshot. Evaluated top-down, so
-- the OE rules must precede the broad GDD/dental catch-all.
update greendogops.ezyvet_appt_type_dept_map
set report_track = case
      when appt_type ilike '%oral exam%'
        or appt_type ilike 'oe %'
        or appt_type ilike '%oe possible%'          then 'oe'
      when appt_type ilike '%advanced procedure%'   then 'ap'
      when appt_type ilike 'veterinary exam%'
        or appt_type ilike '%veterinary exam%'      then 've'
      when appt_type ilike 'gdd%'
        or appt_type ilike '%nad%'                  then 'nad'
      else null
    end
where report_track is null;

-- ---------------------------------------------------------------------------
-- 2. Recurring weekly capacity pattern
-- ---------------------------------------------------------------------------
create table if not exists greendogops.report_capacity_target (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references greendogops.location (id) on delete cascade,
  -- Reporting lane. 'dental' covers both the nad and oe appointment tracks.
  track       text not null check (track in ('dental', 've', 'ap')),
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  -- Slots offered. 0 = the lane does not run that weekday (reported as closed).
  capacity    int not null default 0 check (capacity >= 0 and capacity <= 200),
  note        text,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (location_id, track, weekday)
);

comment on table greendogops.report_capacity_target is
  'Recurring per-weekday slot counts per clinic and report track; the denominator on the upcoming-appointments Slack report.';

drop trigger if exists set_updated_at on greendogops.report_capacity_target;
create trigger set_updated_at before update on greendogops.report_capacity_target
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Single-date overrides
-- ---------------------------------------------------------------------------
create table if not exists greendogops.report_capacity_override (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references greendogops.location (id) on delete cascade,
  track       text not null check (track in ('dental', 've', 'ap')),
  appt_date   date not null,
  -- Slots offered on this date. 0 = closed. Overrides the weekday pattern.
  capacity    int not null default 0 check (capacity >= 0 and capacity <= 200),
  -- Shown beside the day on the report, e.g. "Western students".
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (location_id, track, appt_date)
);

comment on table greendogops.report_capacity_override is
  'One-off capacity for a single date (closures, student days, extra doctors); wins over report_capacity_target.';

create index if not exists report_capacity_override_date_idx
  on greendogops.report_capacity_override (appt_date);

drop trigger if exists set_updated_at on greendogops.report_capacity_override;
create trigger set_updated_at before update on greendogops.report_capacity_override
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Seed the weekly pattern from the numbers ops publishes today
--    (week of 2026-09-21). Mon=1 … Sat=6; Sunday is left unseeded (closed).
-- ---------------------------------------------------------------------------
insert into greendogops.report_capacity_target (location_id, track, weekday, capacity)
select l.id, v.track, v.weekday, v.capacity
from (values
  -- Sherman Oaks: Thursday AP only, Friday dental + VE.
  ('Sherman Oaks', 'ap',     4, 4),
  ('Sherman Oaks', 'dental', 5, 14),
  ('Sherman Oaks', 've',     5, 4),
  -- Van Nuys
  ('Van Nuys', 'dental', 1, 18), ('Van Nuys', 've', 1, 4), ('Van Nuys', 'ap', 1, 6),
  ('Van Nuys', 'dental', 2, 17), ('Van Nuys', 've', 2, 4), ('Van Nuys', 'ap', 2, 6),
  ('Van Nuys', 'dental', 3, 14), ('Van Nuys', 've', 3, 4), ('Van Nuys', 'ap', 3, 9),
  ('Van Nuys', 'dental', 4, 19), ('Van Nuys', 've', 4, 4), ('Van Nuys', 'ap', 4, 6),
  ('Van Nuys', 'dental', 5, 14), ('Van Nuys', 've', 5, 4), ('Van Nuys', 'ap', 5, 6),
  ('Van Nuys', 'dental', 6, 15), ('Van Nuys', 've', 6, 4), ('Van Nuys', 'ap', 6, 5),
  -- Venice
  ('Venice', 'dental', 1, 12), ('Venice', 've', 1, 5), ('Venice', 'ap', 1, 4),
  ('Venice', 'dental', 2, 22), ('Venice', 've', 2, 5), ('Venice', 'ap', 2, 6),
  ('Venice', 'dental', 3, 15), ('Venice', 've', 3, 5), ('Venice', 'ap', 3, 5),
  ('Venice', 'dental', 4, 15), ('Venice', 've', 4, 4), ('Venice', 'ap', 4, 5),
  ('Venice', 'dental', 5, 13), ('Venice', 've', 5, 5), ('Venice', 'ap', 5, 4),
  ('Venice', 'dental', 6, 21), ('Venice', 've', 6, 5), ('Venice', 'ap', 6, 5)
) as v(location_name, track, weekday, capacity)
join greendogops.location l on l.name = v.location_name
on conflict (location_id, track, weekday) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Booked demand per (clinic, day, track) for an upcoming date range.
--    Reads the MOST RECENT Agenda pull for each (clinic, day), so the counts
--    always reflect the current state of the books rather than a mix of pulls.
-- ---------------------------------------------------------------------------
create or replace function greendogops.upcoming_appointment_demand(
  p_start date,
  p_end   date
)
returns table (
  location_id   uuid,
  location_name text,
  appt_date     date,
  report_track  text,
  booked        int
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with latest as (
    select s.location_id, s.appt_date, max(s.snapshot_date) as snapshot_date
    from greendogops.ezyvet_agenda_appt_snapshot s
    where s.appt_date between p_start and p_end
    group by s.location_id, s.appt_date
  )
  select s.location_id,
         l.name,
         s.appt_date,
         m.report_track,
         count(*)::int
  from greendogops.ezyvet_agenda_appt_snapshot s
  join latest x
    on  x.location_id   = s.location_id
    and x.appt_date     = s.appt_date
    and x.snapshot_date = s.snapshot_date
  join greendogops.location l
    on l.id = s.location_id
  join greendogops.ezyvet_appt_type_dept_map m
    on m.appt_type = btrim(s.appt_type)
  where m.report_track is not null
    and m.is_ignored = false
  group by s.location_id, l.name, s.appt_date, m.report_track;
$$;

comment on function greendogops.upcoming_appointment_demand(date, date) is
  'Booked appointments per clinic/day/report track from the latest Agenda snapshot; numerator of the upcoming-appointments Slack report.';

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on greendogops.report_capacity_target to authenticated, service_role;
grant select, insert, update, delete
  on greendogops.report_capacity_override to authenticated, service_role;
grant execute on function greendogops.upcoming_appointment_demand(date, date)
  to authenticated, service_role;
