-- ============================================================================
-- Green Dog Ops — 0131 Cancelled Appointments (ezyVet "Canceled Appointments")
-- ----------------------------------------------------------------------------
-- The Agenda report EXCLUDES cancelled appointments, so the Appointment Review
-- can only INFER cancellations by diffing booked-vs-rendered snapshots, and it
-- has no cancellation REASON. ezyVet's separate "Canceled Appointments" report
-- lists every cancelled appointment with its type, clinic, description and the
-- reason it was cancelled. Run from the GDD & MPMV (database) division it spans
-- all clinics (the clinic is identified by the "Using" address column).
--
-- This migration stores each cancelled appointment and exposes:
--   * cancelled_appointments_by_type(start, end)  — per appointment type, the
--     count of cancels across all locations for a past-date range,
--   * cancelled_appointments_detail(start, end, type) — the individual cancels
--     of a type with their reason / description / location / date.
-- These feed a "Cancels" column on the Appointment Review "By Appointment Type"
-- table (source of truth for cancels + reasons).
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- ezyvet_cancelled_appointment : one row per cancelled appointment from the
-- ezyVet "Canceled Appointments" report. The ingest rebuilds the covered date
-- window on every pull (delete appt_date in [min,max] then insert) so a re-run
-- for the same range never duplicates.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_cancelled_appointment (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid references greendogops.location (id) on delete set null,
  appt_date      date not null,
  appt_type      text,
  start_time     text,
  end_time       text,
  with_who       text,
  using_resource text,
  description    text,
  status         text,
  reason         text,
  created_raw    text,
  modified_raw   text,
  ingested_at    timestamptz not null default now()
);

create index if not exists ezyvet_cancelled_appointment_date_idx
  on greendogops.ezyvet_cancelled_appointment (appt_date);
create index if not exists ezyvet_cancelled_appointment_type_idx
  on greendogops.ezyvet_cancelled_appointment (appt_type);
create index if not exists ezyvet_cancelled_appointment_loc_idx
  on greendogops.ezyvet_cancelled_appointment (location_id);

-- ---------------------------------------------------------------------------
-- cancelled_appointments_by_type(p_start, p_end) : per appointment type, the
-- number of cancelled appointments across all locations for the requested
-- past-date range. appt_type null/'' resolves to 'Unspecified'.
-- ---------------------------------------------------------------------------
create or replace function greendogops.cancelled_appointments_by_type(p_start date, p_end date)
returns table (
  appt_type    text,
  cancel_count integer
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  select
    coalesce(nullif(btrim(appt_type), ''), 'Unspecified') as appt_type,
    count(*)::int as cancel_count
  from greendogops.ezyvet_cancelled_appointment
  where appt_date between p_start and p_end
  group by 1
  order by cancel_count desc, appt_type;
$$;

grant execute on function greendogops.cancelled_appointments_by_type(date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- cancelled_appointments_detail(p_start, p_end, p_type) : the individual
-- cancelled appointments of a given type across all locations for a past-date
-- range, with the cancellation reason and description.
-- ---------------------------------------------------------------------------
create or replace function greendogops.cancelled_appointments_detail(
  p_start date,
  p_end   date,
  p_type  text
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
    and coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') = p_type
  order by c.appt_date desc, l.name, c.start_time;
$$;

grant execute on function greendogops.cancelled_appointments_detail(date, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Register the report in the daily ingest agent catalog (Admin ▸ Agents). It
-- runs globally (GDD & MPMV division = all clinics), like the other globals.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'cancelled_appointments', 'Canceled Appointments', 'global',
       'Cancelled appointments with reason, across all clinics (run from GDD & MPMV). Powers the Appointment Review cancels-by-type breakdown.',
       'ezyvet_cancelled_appointment', 40
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Extend appointment_review_by_type (0130) with an `added` (extra) column so
-- the By Appointment Type table can show scheduled / rendered / added, matching
-- the shape the cancels-by-type breakdown sits alongside.
--   added = appointments present in the post-day (rendered) pull that were NOT
--           in the booked pull (booked after the day passed).
-- ---------------------------------------------------------------------------
drop function if exists greendogops.appointment_review_by_type(date, date);
create or replace function greendogops.appointment_review_by_type(p_start date, p_end date)
returns table (
  appt_type    text,
  scheduled    integer,
  rendered     integer,
  not_rendered integer,
  added        integer,
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
  booked_class as (
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
  ),
  added_rows as (
    select rn.appt_type
    from rendered_snap rn
    left join booked b
      on b.location_id = rn.location_id and b.appt_date = rn.appt_date
     and b.department_id = rn.department_id and b.appt_key = rn.appt_key
    where b.appt_key is null
  ),
  agg_booked as (
    select
      appt_type,
      count(*) filter (where rescanned) as scheduled,
      count(*) filter (where rescanned and did_render) as rendered,
      count(*) filter (where rescanned and not did_render) as not_rendered,
      count(*) filter (where not rescanned) as pending
    from booked_class
    group by appt_type
  ),
  agg_added as (
    select appt_type, count(*) as added
    from added_rows
    group by appt_type
  )
  select
    coalesce(b.appt_type, a.appt_type) as appt_type,
    coalesce(b.scheduled, 0)::int as scheduled,
    coalesce(b.rendered, 0)::int as rendered,
    coalesce(b.not_rendered, 0)::int as not_rendered,
    coalesce(a.added, 0)::int as added,
    coalesce(b.pending, 0)::int as pending
  from agg_booked b
  full outer join agg_added a on a.appt_type = b.appt_type
  order by coalesce(b.not_rendered, 0) desc, coalesce(b.scheduled, 0) desc, 1;
$$;

grant execute on function greendogops.appointment_review_by_type(date, date)
  to authenticated, service_role;

