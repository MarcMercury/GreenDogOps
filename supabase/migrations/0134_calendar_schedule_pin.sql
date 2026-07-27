-- ============================================================================
-- Green Dog Ops — 0134 Calendar Schedule Pins
-- ----------------------------------------------------------------------------
-- Records which employees' work schedules should be projected onto the company
-- Calendar. Each pinned person's published/pending shifts (from the Schedule
-- grid) render as small, subtle calendar entries — read-time projections, no
-- copied rows — so they always stay in sync with the schedule.
--
-- Managed from the Calendar page via the "Add employee schedules" wizard.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.calendar_schedule_pin (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null unique references greendogops.person (id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists calendar_schedule_pin_person_idx
  on greendogops.calendar_schedule_pin (person_id);
