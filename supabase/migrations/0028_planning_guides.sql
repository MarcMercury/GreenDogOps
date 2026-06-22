-- ============================================================================
-- Green Dog Ops — 0028 Planning Guides
-- ----------------------------------------------------------------------------
-- STEP 1 of the scheduling process: the per-location / per-service "planning
-- guide" that defines, hour-by-hour, which appointment slots are bookable.
--
-- A guide is a grid of:
--   * COLUMNS  — appointment tracks/lanes (NAD/Clinic, Urgent Care, Internal
--                Med, Dental, Exotics …)
--   * ROWS     — time buckets from start_minute → end_minute every slot_minutes
--   * SLOTS    — the cell contents (NAD, VE, UC, BLOCK, TECH, LUNCH, DROP OFF …)
--
-- Guides are scoped to a location (Sherman Oaks, Venice, Van Nuys) and an
-- optional scheduling department (VET-NAD, VET-IM, VET-EXOTICS …) so the
-- Internal Medicine and Exotics service sites keep their own separate guides.
-- All objects live in the isolated `greendogops` schema.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- planning_guide — one named grid (location + day-model variant)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.planning_guide (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location_id   uuid references greendogops.location (id) on delete set null,
  department_id uuid references greendogops.sched_department (id) on delete set null,
  service_label text,                         -- free-text service when no dept (e.g. "Internal Medicine")
  day_model     text,                         -- e.g. "MON/WED — Vet Exam Heavy"
  weekdays      smallint[] not null default '{}',  -- 0=Sun .. 6=Sat; empty = unspecified
  start_minute  int not null default 540,     -- 9:00
  end_minute    int not null default 1020,    -- 17:00
  slot_minutes  int not null default 30,      -- grid row interval
  status        text not null default 'active'
                  check (status in ('active', 'archived')),
  notes         text,
  sort_order    int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists planning_guide_location_idx
  on greendogops.planning_guide (location_id);
create index if not exists planning_guide_department_idx
  on greendogops.planning_guide (department_id);

-- ---------------------------------------------------------------------------
-- planning_guide_column — an appointment track/lane within a guide
-- ---------------------------------------------------------------------------
create table if not exists greendogops.planning_guide_column (
  id            uuid primary key default gen_random_uuid(),
  guide_id      uuid not null references greendogops.planning_guide (id) on delete cascade,
  name          text not null,
  color         text not null default '#64748b',
  capacity_note text,                          -- e.g. "14 NADs / OEs"
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists planning_guide_column_guide_idx
  on greendogops.planning_guide_column (guide_id);

-- ---------------------------------------------------------------------------
-- planning_guide_slot — a single cell (column × time bucket)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.planning_guide_slot (
  id               uuid primary key default gen_random_uuid(),
  guide_id         uuid not null references greendogops.planning_guide (id) on delete cascade,
  column_id        uuid not null references greendogops.planning_guide_column (id) on delete cascade,
  start_minute     int not null,
  duration_minutes int not null default 30,
  type_code        text not null default 'open',   -- matches the TS appointment-type palette
  label            text,                            -- optional override / detail
  sort_order       int not null default 0,          -- stacking order within a bucket
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists planning_guide_slot_guide_idx
  on greendogops.planning_guide_slot (guide_id);
create index if not exists planning_guide_slot_cell_idx
  on greendogops.planning_guide_slot (column_id, start_minute);

-- updated_at triggers --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.planning_guide;
create trigger set_updated_at before update on greendogops.planning_guide
  for each row execute function greendogops.set_updated_at();

drop trigger if exists set_updated_at on greendogops.planning_guide_column;
create trigger set_updated_at before update on greendogops.planning_guide_column
  for each row execute function greendogops.set_updated_at();

drop trigger if exists set_updated_at on greendogops.planning_guide_slot;
create trigger set_updated_at before update on greendogops.planning_guide_slot
  for each row execute function greendogops.set_updated_at();

-- Grants ---------------------------------------------------------------------
grant select, insert, update, delete
  on greendogops.planning_guide        to authenticated, service_role;
grant select, insert, update, delete
  on greendogops.planning_guide_column to authenticated, service_role;
grant select, insert, update, delete
  on greendogops.planning_guide_slot   to authenticated, service_role;
