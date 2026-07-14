-- ============================================================================
-- Green Dog Ops — 0096 Appointment Review (Agenda booked-vs-rendered history)
-- ----------------------------------------------------------------------------
-- The existing ezyvet_agenda_count table is a rolling FORWARD snapshot: it is
-- fully rebuilt for the covered window on every ingest, so it only ever shows
-- the *latest* picture and keeps no history. To review what actually happened
-- on a past day (e.g. 30 appointments were booked but only 28 rendered — 4 were
-- cancelled or moved), we need a dated HISTORY of those aggregate counts.
--
-- ezyvet_agenda_snapshot keeps one row per (location, appt_date, department,
-- snapshot_date). The agent writes a snapshot every time it ingests an Agenda
-- CSV, tagged with the LA date the pull was taken. Comparing the last snapshot
-- taken ON/BEFORE a day (what was booked) with the first snapshot taken AFTER
-- that day (what remained on the calendar = rendered) yields the drop count.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- ezyvet_agenda_snapshot : dated history of the aggregated Agenda counts.
--   snapshot_date = the LA date the Agenda pull was ingested.
--   appt_count    = booked appointments for that (location, day, department) as
--                   seen by that pull (cancelled appts are excluded upstream).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_agenda_snapshot (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references greendogops.location (id) on delete cascade,
  appt_date      date not null,
  department_id  uuid not null references greendogops.sched_department (id) on delete cascade,
  appt_count     integer not null default 0,
  snapshot_date  date not null,
  captured_at    timestamptz not null default now(),
  unique (location_id, appt_date, department_id, snapshot_date)
);

create index if not exists ezyvet_agenda_snapshot_appt_date_idx
  on greendogops.ezyvet_agenda_snapshot (appt_date);
create index if not exists ezyvet_agenda_snapshot_snapshot_date_idx
  on greendogops.ezyvet_agenda_snapshot (snapshot_date);
create index if not exists ezyvet_agenda_snapshot_cell_idx
  on greendogops.ezyvet_agenda_snapshot (location_id, appt_date, department_id);

-- ---------------------------------------------------------------------------
-- appointment_review(p_start, p_end) : per location / department / day, the
-- booked (expected) count vs the rendered (actual) count for the requested
-- past-date range.
--   expected_count  = latest snapshot taken ON or BEFORE the appt_date.
--   rendered_count  = earliest snapshot taken AFTER the appt_date. NULL means
--                     the day has not been re-scanned yet (pending); a scanned
--                     day with no rows for a cell resolves to 0.
-- The UI derives "cancelled / moved" = max(expected - rendered, 0).
-- ---------------------------------------------------------------------------
create or replace function greendogops.appointment_review(p_start date, p_end date)
returns table (
  location_id      uuid,
  location_name    text,
  department_id    uuid,
  department_name  text,
  department_color text,
  appt_date        date,
  expected_count   integer,
  rendered_count   integer,
  expected_snapshot date,
  rendered_snapshot date
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with snap as (
    select location_id, appt_date, department_id, appt_count, snapshot_date
    from greendogops.ezyvet_agenda_snapshot
    where appt_date between p_start and p_end
  ),
  cells as (
    select distinct location_id, appt_date, department_id from snap
  ),
  expected as (
    select distinct on (location_id, appt_date, department_id)
      location_id, appt_date, department_id, appt_count, snapshot_date
    from snap
    where snapshot_date <= appt_date
    order by location_id, appt_date, department_id, snapshot_date desc
  ),
  rendered as (
    select distinct on (location_id, appt_date, department_id)
      location_id, appt_date, department_id, appt_count, snapshot_date
    from snap
    where snapshot_date > appt_date
    order by location_id, appt_date, department_id, snapshot_date asc
  ),
  scanned as (
    -- (location, day) combos that have had at least one post-day re-scan.
    select distinct location_id, appt_date
    from snap
    where snapshot_date > appt_date
  )
  select
    c.location_id,
    l.name as location_name,
    c.department_id,
    d.name as department_name,
    d.color as department_color,
    c.appt_date,
    coalesce(e.appt_count, 0) as expected_count,
    case
      when r.appt_count is not null then r.appt_count
      when s.location_id is not null then 0   -- re-scanned, cell now empty ⇒ 0
      else null                               -- not yet re-scanned ⇒ pending
    end as rendered_count,
    e.snapshot_date as expected_snapshot,
    r.snapshot_date as rendered_snapshot
  from cells c
  join greendogops.location l on l.id = c.location_id
  join greendogops.sched_department d on d.id = c.department_id
  left join expected e
    on e.location_id = c.location_id and e.appt_date = c.appt_date and e.department_id = c.department_id
  left join rendered r
    on r.location_id = c.location_id and r.appt_date = c.appt_date and r.department_id = c.department_id
  left join scanned s
    on s.location_id = c.location_id and s.appt_date = c.appt_date
  order by c.appt_date desc, l.name, d.name;
$$;

grant execute on function greendogops.appointment_review(date, date) to authenticated, service_role;
