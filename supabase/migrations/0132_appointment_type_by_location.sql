-- ============================================================================
-- Green Dog Ops — 0132 Appointment Review By Appointment Type, PER LOCATION
-- ----------------------------------------------------------------------------
-- 0130/0131 gave a GLOBAL (all-clinics) By Appointment Type breakdown. The
-- Appointment Review department breakdown is shown per clinic, so this migration
-- adds a location dimension to the by-type aggregates and drill-downs so the UI
-- can render one appointment-type table per clinic (Sherman Oaks / Van Nuys /
-- Venice), the same as the department view.
--   * appointment_review_by_type      → now returns location_id / location_name
--   * cancelled_appointments_by_type   → now returns location_id / location_name
--   * appointment_review_type_detail   → now takes p_location
--   * cancelled_appointments_detail    → now takes p_location
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- appointment_review_by_type(p_start, p_end) : per LOCATION and appointment
-- type, the scheduled / rendered / not-rendered / added / pending counts.
-- ---------------------------------------------------------------------------
drop function if exists greendogops.appointment_review_by_type(date, date);
create or replace function greendogops.appointment_review_by_type(p_start date, p_end date)
returns table (
  location_id   uuid,
  location_name text,
  appt_type     text,
  scheduled     integer,
  rendered      integer,
  not_rendered  integer,
  added         integer,
  pending       integer
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
  booked_class as (
    select
      b.location_id,
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
  ),
  added_rows as (
    select rn.location_id, rn.appt_type
    from rendered_snap rn
    left join booked b
      on b.location_id = rn.location_id and b.appt_date = rn.appt_date
     and b.department_id = rn.department_id and b.appt_key = rn.appt_key
    where b.appt_key is null
  ),
  agg_booked as (
    select
      location_id,
      appt_type,
      count(*) filter (where rescanned) as scheduled,
      count(*) filter (where rescanned and did_render) as rendered,
      count(*) filter (where rescanned and not did_render) as not_rendered,
      count(*) filter (where not rescanned) as pending
    from booked_class
    group by location_id, appt_type
  ),
  agg_added as (
    select location_id, appt_type, count(*) as added
    from added_rows
    group by location_id, appt_type
  ),
  merged as (
    select
      coalesce(b.location_id, a.location_id) as location_id,
      coalesce(b.appt_type, a.appt_type) as appt_type,
      coalesce(b.scheduled, 0) as scheduled,
      coalesce(b.rendered, 0) as rendered,
      coalesce(b.not_rendered, 0) as not_rendered,
      coalesce(a.added, 0) as added,
      coalesce(b.pending, 0) as pending
    from agg_booked b
    full outer join agg_added a
      on a.location_id = b.location_id and a.appt_type = b.appt_type
  )
  select
    m.location_id,
    l.name as location_name,
    m.appt_type,
    m.scheduled::int,
    m.rendered::int,
    m.not_rendered::int,
    m.added::int,
    m.pending::int
  from merged m
  join greendogops.location l on l.id = m.location_id
  order by l.name, m.not_rendered desc, m.scheduled desc, m.appt_type;
$$;

grant execute on function greendogops.appointment_review_by_type(date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- cancelled_appointments_by_type(p_start, p_end) : per LOCATION and appointment
-- type, the number of cancelled appointments. Rows whose clinic could not be
-- resolved from the "Using" address keep a null location_id (labelled in the UI).
-- ---------------------------------------------------------------------------
drop function if exists greendogops.cancelled_appointments_by_type(date, date);
create or replace function greendogops.cancelled_appointments_by_type(p_start date, p_end date)
returns table (
  location_id   uuid,
  location_name text,
  appt_type     text,
  cancel_count  integer
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  select
    c.location_id,
    l.name as location_name,
    coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') as appt_type,
    count(*)::int as cancel_count
  from greendogops.ezyvet_cancelled_appointment c
  left join greendogops.location l on l.id = c.location_id
  where c.appt_date between p_start and p_end
  group by c.location_id, l.name, 3
  order by l.name nulls last, cancel_count desc, appt_type;
$$;

grant execute on function greendogops.cancelled_appointments_by_type(date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- appointment_review_type_detail(p_location, p_start, p_end, p_type) : the
-- individual NOT-rendered appointments of a type for ONE location.
-- ---------------------------------------------------------------------------
drop function if exists greendogops.appointment_review_type_detail(date, date, text);
create or replace function greendogops.appointment_review_type_detail(
  p_location uuid,
  p_start    date,
  p_end      date,
  p_type     text
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
      and location_id = p_location
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
  join rendered_dt rd
    on rd.location_id = b.location_id and rd.appt_date = b.appt_date
   and rd.department_id = b.department_id
  left join rendered_snap rn
    on rn.location_id = b.location_id and rn.appt_date = b.appt_date
   and rn.department_id = b.department_id and rn.appt_key = b.appt_key
  where b.appt_type = p_type
    and rn.appt_key is null
  order by b.appt_date desc, b.client_name;
$$;

grant execute on function greendogops.appointment_review_type_detail(uuid, date, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- cancelled_appointments_detail(p_location, p_start, p_end, p_type) : the
-- cancelled appointments of a type for ONE location, with reason + description.
-- ---------------------------------------------------------------------------
drop function if exists greendogops.cancelled_appointments_detail(date, date, text);
create or replace function greendogops.cancelled_appointments_detail(
  p_location uuid,
  p_start    date,
  p_end      date,
  p_type     text
)
returns table (
  appt_date      date,
  appt_type      text,
  location_id    uuid,
  location_name  text,
  start_time     text,
  with_who       text,
  using_resource text,
  description    text,
  status         text,
  reason         text
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  select
    c.appt_date,
    coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') as appt_type,
    c.location_id,
    l.name as location_name,
    c.start_time,
    c.with_who,
    c.using_resource,
    c.description,
    c.status,
    c.reason
  from greendogops.ezyvet_cancelled_appointment c
  left join greendogops.location l on l.id = c.location_id
  where c.appt_date between p_start and p_end
    and c.location_id is not distinct from p_location
    and coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') = p_type
  order by c.appt_date desc, c.start_time;
$$;

grant execute on function greendogops.cancelled_appointments_detail(uuid, date, date, text)
  to authenticated, service_role;
