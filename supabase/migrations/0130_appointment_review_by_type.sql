-- ============================================================================
-- Green Dog Ops — 0130 Appointment Review BY APPOINTMENT TYPE
-- ----------------------------------------------------------------------------
-- The Appointment Review report compares what was booked on a past day against
-- what actually rendered. 0096 grouped that by location/department and 0126
-- added the per-appointment drill-down (ezyvet_agenda_appt_snapshot carries the
-- Agenda "Appointment Type" for every appointment).
--
-- This migration adds a breakdown by the ezyVet APPOINTMENT TYPE — the category
-- shown on each appointment in the Agenda report:
--   scheduled    = booked appointments of that type on days that were re-scanned,
--   rendered     = those that were still on the calendar after the day passed,
--   not_rendered = scheduled - rendered (cancelled / moved),
--   pending      = booked appointments on days not yet re-scanned (no resolution).
--
-- Booked/rendered pulls are picked per (location, appt_date, department) exactly
-- like appointment_review_detail (latest snapshot on/before the day = booked,
-- first snapshot after the day = rendered), then the appointments are regrouped
-- by their appointment type. Only days pulled AFTER 0126 shipped have
-- appointment-level detail; older days contribute nothing here.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- appointment_review_by_type(p_start, p_end) : per appointment type, the
-- scheduled / rendered / not-rendered / pending counts across all locations for
-- the requested past-date range.
-- ---------------------------------------------------------------------------
create or replace function greendogops.appointment_review_by_type(p_start date, p_end date)
returns table (
  appt_type    text,
  scheduled    integer,
  rendered     integer,
  not_rendered integer,
  pending      integer
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with snap as (
    select
      location_id, appt_date, department_id, snapshot_date, appt_key,
      coalesce(nullif(btrim(appt_type), ''), 'Unspecified') as appt_type
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date between p_start and p_end
  ),
  expected_dt as (
    select location_id, appt_date, department_id, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by location_id, appt_date, department_id
  ),
  rendered_dt as (
    select location_id, appt_date, department_id, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by location_id, appt_date, department_id
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.location_id = s.location_id and e.appt_date = s.appt_date
     and e.department_id = s.department_id and e.snapshot_date = s.snapshot_date
  ),
  rendered_snap as (
    select s.*
    from snap s
    join rendered_dt r
      on r.location_id = s.location_id and r.appt_date = s.appt_date
     and r.department_id = s.department_id and r.snapshot_date = s.snapshot_date
  ),
  -- Each booked appointment tagged: was its day re-scanned, and if so did it
  -- still appear in the post-day (rendered) pull?
  classified as (
    select
      b.appt_type,
      (rd.location_id is not null) as rescanned,
      (rn.appt_key is not null) as did_render
    from booked b
    left join rendered_dt rd
      on rd.location_id = b.location_id and rd.appt_date = b.appt_date
     and rd.department_id = b.department_id
    left join rendered_snap rn
      on rn.location_id = b.location_id and rn.appt_date = b.appt_date
     and rn.department_id = b.department_id and rn.appt_key = b.appt_key
  )
  select
    appt_type,
    count(*) filter (where rescanned)::int as scheduled,
    count(*) filter (where rescanned and did_render)::int as rendered,
    count(*) filter (where rescanned and not did_render)::int as not_rendered,
    count(*) filter (where not rescanned)::int as pending
  from classified
  group by appt_type
  order by not_rendered desc, scheduled desc, appt_type;
$$;

grant execute on function greendogops.appointment_review_by_type(date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- appointment_review_type_detail(p_start, p_end, p_type) : the individual
-- appointments of a given appointment type that were NOT rendered (booked on a
-- re-scanned day but absent from the post-day pull = cancelled / moved), across
-- all locations for the requested past-date range.
-- ---------------------------------------------------------------------------
create or replace function greendogops.appointment_review_type_detail(
  p_start date,
  p_end   date,
  p_type  text
)
returns table (
  location_id     uuid,
  location_name   text,
  department_name text,
  appt_date       date,
  appt_key        text,
  client_name     text,
  patient_name    text,
  resource        text,
  appt_time       text,
  appt_type       text,
  status          text,
  details         jsonb
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with snap as (
    select
      location_id, appt_date, department_id, snapshot_date, appt_key,
      client_name, patient_name, resource, appt_time, status, details,
      coalesce(nullif(btrim(appt_type), ''), 'Unspecified') as appt_type
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date between p_start and p_end
  ),
  expected_dt as (
    select location_id, appt_date, department_id, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by location_id, appt_date, department_id
  ),
  rendered_dt as (
    select location_id, appt_date, department_id, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by location_id, appt_date, department_id
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.location_id = s.location_id and e.appt_date = s.appt_date
     and e.department_id = s.department_id and e.snapshot_date = s.snapshot_date
  ),
  rendered_snap as (
    select s.*
    from snap s
    join rendered_dt r
      on r.location_id = s.location_id and r.appt_date = s.appt_date
     and r.department_id = s.department_id and r.snapshot_date = s.snapshot_date
  )
  select
    b.location_id,
    l.name as location_name,
    d.name as department_name,
    b.appt_date, b.appt_key, b.client_name, b.patient_name, b.resource,
    b.appt_time, b.appt_type, b.status, b.details
  from booked b
  join greendogops.location l on l.id = b.location_id
  join greendogops.sched_department d on d.id = b.department_id
  -- only days that were actually re-scanned
  join rendered_dt rd
    on rd.location_id = b.location_id and rd.appt_date = b.appt_date
   and rd.department_id = b.department_id
  -- and this appointment absent from the rendered pull
  left join rendered_snap rn
    on rn.location_id = b.location_id and rn.appt_date = b.appt_date
   and rn.department_id = b.department_id and rn.appt_key = b.appt_key
  where b.appt_type = p_type
    and rn.appt_key is null
  order by b.appt_date desc, l.name, b.client_name;
$$;

grant execute on function greendogops.appointment_review_type_detail(date, date, text)
  to authenticated, service_role;
