-- ============================================================================
-- Green Dog Ops — 0014 Scheduling module
-- ----------------------------------------------------------------------------
-- A visual, location-aware weekly schedule with:
--   * Setup: departments, roles/titles, shift templates, employee eligibility
--   * Planning Guide: which lines/locations are in play for a given week
--   * Grid: per-week / per-location / per-day assignment cells
--   * Approval workflow: draft -> pending_approval -> approved -> published
--   * Attendance: post-publish tracking + reliability rollups (incl. auto-absence)
-- All objects live in the isolated `greendogops` schema.
-- ============================================================================
set search_path = greendogops, public;

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type greendogops.schedule_status as enum
    ('draft', 'pending_approval', 'approved', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.attendance_status as enum
    ('scheduled', 'present', 'late', 'late_excused',
     'absent', 'absent_excused', 'no_show', 'pto');
exception when duplicate_object then null; end $$;

-- Locations: extend the shared HR `location` table with scheduling metadata --
alter table greendogops.location add column if not exists color      text;
alter table greendogops.location add column if not exists short_code text;
alter table greendogops.location add column if not exists sort_order int not null default 0;

-- Seed the practice locations if the table is empty.
insert into greendogops.location (name, code, short_code, color, sort_order, is_active)
select * from (values
  ('Venice',     'VEN', 'VEN', '#0ea5e9', 10, true),
  ('Van Nuys',   'VAN', 'VAN', '#8b5cf6', 20, true),
  ('Aetna',      'AET', 'AET', '#f59e0b', 30, true),
  ('San Marino', 'SM',  'SO',  '#10b981', 40, true)
) as v(name, code, short_code, color, sort_order, is_active)
where not exists (select 1 from greendogops.location);

-- ---------------------------------------------------------------------------
-- Departments: the grid's left-hand sections (VET-SURGERY, CSR, ...).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_department (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  color       text not null default '#64748b',   -- header / cell accent
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists sched_department_name_idx
  on greendogops.sched_department (lower(name));

-- ---------------------------------------------------------------------------
-- Roles / titles within a department. The unit of eligibility.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_role (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references greendogops.sched_department (id) on delete cascade,
  name          text not null,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sched_role_dept_idx on greendogops.sched_role (department_id);

-- ---------------------------------------------------------------------------
-- Employee <-> role eligibility (who can fill a role). Many-to-many.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_role_member (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references greendogops.sched_role (id) on delete cascade,
  person_id   uuid not null references greendogops.person (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index if not exists sched_role_member_uq
  on greendogops.sched_role_member (role_id, person_id);
create index if not exists sched_role_member_person_idx
  on greendogops.sched_role_member (person_id);

-- ---------------------------------------------------------------------------
-- Per-employee scheduling settings (weekly target, schedulable flag).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_employee_setting (
  person_id           uuid primary key references greendogops.person (id) on delete cascade,
  weekly_shift_target int  not null default 5,
  is_schedulable      boolean not null default true,
  default_location_id uuid references greendogops.location (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Shift templates: the reusable grid rows (dept + role + time window).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_shift_template (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references greendogops.sched_department (id) on delete cascade,
  role_id       uuid references greendogops.sched_role (id) on delete set null,
  label         text,                  -- optional override; defaults to role name
  start_time    time,
  end_time      time,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sched_shift_template_dept_idx
  on greendogops.sched_shift_template (department_id);

-- ---------------------------------------------------------------------------
-- A schedule week (one row per Sunday-start week).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_week (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,         -- Sunday
  title         text,
  status        greendogops.schedule_status not null default 'draft',
  notes         text,
  created_by    uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  approved_by   uuid,
  approved_at   timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists sched_week_start_idx
  on greendogops.sched_week (week_start);

-- ---------------------------------------------------------------------------
-- Planning guide: which locations are in play for the week.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_week_location (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references greendogops.sched_week (id) on delete cascade,
  location_id uuid not null references greendogops.location (id) on delete cascade,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists sched_week_location_uq
  on greendogops.sched_week_location (week_id, location_id);

-- ---------------------------------------------------------------------------
-- Planning guide: per-week snapshot of the active shift lines (grid rows).
-- Snapshotting dept/role/label/times keeps a published week immutable even if
-- templates later change. template_id is the origin (null for ad-hoc lines).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_week_line (
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid not null references greendogops.sched_week (id) on delete cascade,
  template_id   uuid references greendogops.sched_shift_template (id) on delete set null,
  department_id uuid not null references greendogops.sched_department (id) on delete cascade,
  role_id       uuid references greendogops.sched_role (id) on delete set null,
  label         text,
  start_time    time,
  end_time      time,
  sort_order    int  not null default 0,
  is_adhoc      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists sched_week_line_week_idx
  on greendogops.sched_week_line (week_id);

-- ---------------------------------------------------------------------------
-- Close a location for a given day of the week.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_closure (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references greendogops.sched_week (id) on delete cascade,
  location_id uuid not null references greendogops.location (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  reason      text,
  created_at  timestamptz not null default now()
);
create unique index if not exists sched_closure_uq
  on greendogops.sched_closure (week_id, location_id, day_of_week);

-- ---------------------------------------------------------------------------
-- Assignments: a person placed into a (line, location, day) cell.
-- Post-publish edits are flagged so the grid stays the single source of truth.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_assignment (
  id                  uuid primary key default gen_random_uuid(),
  week_id             uuid not null references greendogops.sched_week (id) on delete cascade,
  line_id             uuid not null references greendogops.sched_week_line (id) on delete cascade,
  location_id         uuid not null references greendogops.location (id) on delete cascade,
  person_id           uuid not null references greendogops.person (id) on delete cascade,
  day_of_week         smallint not null check (day_of_week between 0 and 6),
  work_date           date not null,
  attendance_status   greendogops.attendance_status not null default 'scheduled',
  attendance_note     text,
  attendance_marked_by uuid,
  attendance_marked_at timestamptz,
  added_post_publish  boolean not null default false,
  removed_post_publish boolean not null default false,
  auto_absent         boolean not null default false,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists sched_assignment_week_idx
  on greendogops.sched_assignment (week_id);
create index if not exists sched_assignment_cell_idx
  on greendogops.sched_assignment (line_id, location_id, day_of_week);
create index if not exists sched_assignment_person_idx
  on greendogops.sched_assignment (person_id, work_date);

-- ---------------------------------------------------------------------------
-- Change log: post-publish history (added / moved / removed / attendance).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sched_change_log (
  id            uuid primary key default gen_random_uuid(),
  week_id       uuid not null references greendogops.sched_week (id) on delete cascade,
  assignment_id uuid,
  person_id     uuid,
  action        text not null,         -- 'added','removed','relocated','attendance','auto_absent'
  detail        text,
  actor_id      uuid,
  actor_email   text,
  created_at    timestamptz not null default now()
);
create index if not exists sched_change_log_week_idx
  on greendogops.sched_change_log (week_id, created_at desc);

-- Seed the real department structure (only when none exist yet) -------------
insert into greendogops.sched_department (name, code, color, sort_order)
select * from (values
  ('VET-SURGERY', 'SURG', '#e11d48', 10),
  ('VET-AP',      'AP',   '#0d9488', 20),
  ('VET-NAD',     'NAD',  '#2563eb', 30),
  ('VET-IM',      'IM',   '#7c3aed', 40),
  ('VET-EXOTICS', 'EXO',  '#16a34a', 50),
  ('VET-MPMV',    'MPMV', '#ea580c', 60),
  ('VET-CARDIO',  'CARD', '#db2777', 70),
  ('CSR',         'CSR',  '#0891b2', 80),
  ('MANAGEMENT',  'MGMT', '#475569', 90)
) as v(name, code, color, sort_order)
where not exists (select 1 from greendogops.sched_department);

-- updated_at triggers -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sched_department','sched_role','sched_employee_setting',
    'sched_shift_template','sched_week','sched_assignment'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on greendogops.%I;
       create trigger set_updated_at before update on greendogops.%I
       for each row execute function greendogops.set_updated_at();', t, t);
  end loop;
end $$;

-- Grants --------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sched_department','sched_role','sched_role_member','sched_employee_setting',
    'sched_shift_template','sched_week','sched_week_location','sched_week_line',
    'sched_closure','sched_assignment','sched_change_log'
  ]
  loop
    execute format(
      'grant select, insert, update, delete on greendogops.%I to authenticated, service_role;', t);
  end loop;
end $$;
