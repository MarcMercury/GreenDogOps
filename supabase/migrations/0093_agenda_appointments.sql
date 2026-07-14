-- ============================================================================
-- Green Dog Ops — 0093 ezyVet Agenda appointment demand (schedule look-forward)
-- ----------------------------------------------------------------------------
-- The ezyVet "Agenda" report is a clinic appointment schedule. The daily agent
-- runs it every morning for the NEXT 4 WEEKS (all locations in one run) so the
-- Schedule / Daily Capacity / Planning views can show, per location per day,
-- how many appointments are already booked in each department. This drives
-- staffing decisions for future days.
--
-- Two tables:
--   * ezyvet_agenda_count    — aggregated booked-appointment counts, one row per
--                              (location, appt_date, schedule department).
--   * ezyvet_agenda_dept_map — maps an ezyVet resource label (extracted from the
--                              Agenda "All Resources / Vets" column) to a
--                              schedule department. Editable so the mapping can
--                              be tuned without a code change.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- ezyvet_agenda_dept_map : ezyVet resource label -> schedule department.
--   ezyvet_label = the department token parsed from the resource name
--                  ('' = the location's general/no-department calendar,
--                   '*' = the catch-all default for any unmapped label).
--   is_ignored   = true → appointments on this resource are not counted.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_agenda_dept_map (
  id             uuid primary key default gen_random_uuid(),
  ezyvet_label   text not null unique,
  department_id  uuid references greendogops.sched_department (id) on delete set null,
  is_ignored     boolean not null default false,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.ezyvet_agenda_dept_map;
create trigger set_updated_at before update on greendogops.ezyvet_agenda_dept_map
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- ezyvet_agenda_count : aggregated booked appointments per location/day/dept.
-- Fully rebuilt for the covered date window on each ingest (the Agenda report
-- is a forward snapshot, so this stays current as bookings move/cancel).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_agenda_count (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references greendogops.location (id) on delete cascade,
  appt_date      date not null,
  department_id  uuid not null references greendogops.sched_department (id) on delete cascade,
  appt_count     integer not null default 0,
  captured_at    timestamptz not null default now(),
  unique (location_id, appt_date, department_id)
);

create index if not exists ezyvet_agenda_count_date_idx
  on greendogops.ezyvet_agenda_count (appt_date);
create index if not exists ezyvet_agenda_count_loc_date_idx
  on greendogops.ezyvet_agenda_count (location_id, appt_date);

-- ---------------------------------------------------------------------------
-- Seed the resource → department mapping (confirmed with the schedule admin):
--   AP → AP, Exotics → EXOTICS, Surgery → SURGERY, Internal Med → IM.
--   UV / 2 DVM UV / Tech / NAD / the general (bare-address) calendar → all
--   count as Clinic/Wellness/UC appointments. Shipments/Pickups is not a
--   patient appointment → ignored. Anything unmapped defaults to Clinic.
-- ---------------------------------------------------------------------------
insert into greendogops.ezyvet_agenda_dept_map (ezyvet_label, department_id, is_ignored, note)
select m.ezyvet_label,
       case when m.is_ignored then null
            else (select id from greendogops.sched_department where name = m.dept_name) end,
       m.is_ignored,
       m.note
from (values
  ('AP',                'AP',                 false, 'Appointment / AP resource'),
  ('Exotics',           'EXOTICS',            false, 'Exotics resource'),
  ('Surgery',           'SURGERY',            false, 'Surgery resource'),
  ('Internal Med',      'IM',                 false, 'Internal Medicine resource'),
  ('UV',                'Clinic/Wellness/UC', false, 'Urgent Care + Vet Exams = Clinic'),
  ('2 DVM UV',          'Clinic/Wellness/UC', false, 'Two-DVM urgent/vet = Clinic'),
  ('',                  'Clinic/Wellness/UC', false, 'General / no-department calendar (Tech, NAD, etc.)'),
  ('Shipments/Pickups', null,                 true,  'Not a patient appointment'),
  ('*',                 'Clinic/Wellness/UC', false, 'Default fallback for any unmapped resource')
) as m(ezyvet_label, dept_name, is_ignored, note)
on conflict (ezyvet_label) do nothing;

-- ---------------------------------------------------------------------------
-- Register the Agenda report in the ezyVet daily-ingest agent catalog.
-- scope 'global' — a single run (blank resource filter) returns every clinic.
-- config.window_days documents the forward look-ahead the worker uses.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order, config)
select a.id, 'agenda', 'Agenda', 'global',
       'Forward appointment schedule (next 4 weeks, all locations). Feeds the Schedule / Daily Capacity per-department booked-appointment counts.',
       'ezyvet_agenda_count', 40,
       jsonb_build_object('window_days', 28, 'forward', true)
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
