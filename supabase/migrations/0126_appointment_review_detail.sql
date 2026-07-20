-- ============================================================================
-- Green Dog Ops — 0126 Appointment Review detail (per-appointment drill-down)
-- ----------------------------------------------------------------------------
-- 0096 gave us dated AGGREGATE snapshots (one count per location/day/dept) so
-- the Appointment Review report can compare booked vs rendered. To let a user
-- click a Cancelled/Moved or Added On number and see WHICH appointments make it
-- up, we also need the per-appointment detail of each Agenda pull.
--
-- ezyvet_agenda_appt_snapshot keeps one row per appointment per (location,
-- appt_date, department, snapshot_date). The agenda ingest writes it alongside
-- the aggregate snapshot. Diffing the booked snapshot (last pull on/before a
-- day) against the rendered snapshot (first pull after the day) yields:
--   dropped = booked appt not present in the rendered pull (cancelled / moved),
--   added   = appt present in the rendered pull but not the booked pull.
-- NOTE: only days pulled AFTER this ships have appointment-level detail; older
-- days keep only their aggregate counts.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- ezyvet_agenda_appt_snapshot : dated per-appointment history for the Agenda.
--   appt_key = stable identity within a (location, day, dept, snapshot) cell,
--              derived from an appointment id when present, else a composite of
--              client / patient / resource / time (with an occurrence suffix so
--              two otherwise-identical rows stay distinct).
--   details  = the full CSV row (original header -> value) so any column the
--              Agenda export carries is preserved for display.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_agenda_appt_snapshot (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references greendogops.location (id) on delete cascade,
  appt_date     date not null,
  department_id uuid not null references greendogops.sched_department (id) on delete cascade,
  snapshot_date date not null,
  appt_key      text not null,
  client_name   text,
  patient_name  text,
  resource      text,
  appt_time     text,
  appt_type     text,
  status        text,
  details       jsonb not null default '{}'::jsonb,
  captured_at   timestamptz not null default now(),
  unique (location_id, appt_date, department_id, snapshot_date, appt_key)
);

create index if not exists ezyvet_agenda_appt_snapshot_cell_idx
  on greendogops.ezyvet_agenda_appt_snapshot (location_id, appt_date, department_id);
create index if not exists ezyvet_agenda_appt_snapshot_snapshot_date_idx
  on greendogops.ezyvet_agenda_appt_snapshot (snapshot_date);

-- ---------------------------------------------------------------------------
-- appointment_review_detail(p_location, p_department, p_start, p_end) : the
-- individual appointments behind the Cancelled/Moved and Added On counts for a
-- (location, department) over a past-date range.
--   For each day: booked  = detail rows at the latest snapshot on/before the day,
--                 rendered = detail rows at the first snapshot after the day.
--   dropped rows come from the booked pull (their pre-drop detail); added rows
--   come from the rendered pull.
-- ---------------------------------------------------------------------------
create or replace function greendogops.appointment_review_detail(
  p_location   uuid,
  p_department uuid,
  p_start      date,
  p_end        date
)
returns table (
  appt_date    date,
  change       text,
  appt_key     text,
  client_name  text,
  patient_name text,
  resource     text,
  appt_time    text,
  appt_type    text,
  status       text,
  details      jsonb
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with snap as (
    select *
    from greendogops.ezyvet_agenda_appt_snapshot
    where location_id = p_location
      and department_id = p_department
      and appt_date between p_start and p_end
  ),
  expected_dt as (
    select appt_date, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by appt_date
  ),
  rendered_dt as (
    select appt_date, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by appt_date
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.appt_date = s.appt_date and e.snapshot_date = s.snapshot_date
  ),
  rendered as (
    select s.*
    from snap s
    join rendered_dt r
      on r.appt_date = s.appt_date and r.snapshot_date = s.snapshot_date
  )
  -- Dropped: in the booked pull, absent from the rendered pull (only for days
  -- that were actually re-scanned, i.e. have a rendered snapshot).
  select
    b.appt_date, 'dropped'::text as change, b.appt_key, b.client_name,
    b.patient_name, b.resource, b.appt_time, b.appt_type, b.status, b.details
  from booked b
  join rendered_dt r on r.appt_date = b.appt_date
  left join rendered rn
    on rn.appt_date = b.appt_date and rn.appt_key = b.appt_key
  where rn.appt_key is null
  union all
  -- Added: in the rendered pull, absent from the booked pull.
  select
    rn.appt_date, 'added'::text as change, rn.appt_key, rn.client_name,
    rn.patient_name, rn.resource, rn.appt_time, rn.appt_type, rn.status, rn.details
  from rendered rn
  left join booked b
    on b.appt_date = rn.appt_date and b.appt_key = rn.appt_key
  where b.appt_key is null
  order by appt_date desc, change, client_name;
$$;

grant execute on function greendogops.appointment_review_detail(uuid, uuid, date, date)
  to authenticated, service_role;
