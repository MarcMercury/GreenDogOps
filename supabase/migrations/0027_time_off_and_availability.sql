-- ============================================================================
-- Green Dog Ops — 0027 Time-off requests + scheduler availability
-- ----------------------------------------------------------------------------
-- Phase 1 scheduling streamlining. Two additions, both driven from the
-- employee level so there is no separate vacation page to maintain:
--
--   1. greendogops.person_time_off — PTO / Vacation / Time-off requests entered
--      on an employee's own HR profile. A simple approval workflow
--      (requested -> approved / denied) drives color coding in the scheduler:
--      requested = amber (pending), approved = green. Date ranges, so a single
--      row can cover a multi-day vacation.
--
--   2. sched_employee_setting gains two simple eligibility hints used when the
--      scheduler picks people for a shift:
--        * eligible_location_ids — locations this person may work
--          (empty array = no restriction / all locations).
--        * available_days        — weekdays this person is available, 0=Sun..6=Sat
--          (empty array = no restriction / any day).
-- ============================================================================
set search_path = greendogops, public;

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type greendogops.time_off_kind as enum ('pto', 'vacation', 'time_off');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.time_off_status as enum ('requested', 'approved', 'denied');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Employee-level time-off requests (PTO / Vacation / Time-off).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.person_time_off (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references greendogops.person (id) on delete cascade,
  kind         greendogops.time_off_kind   not null default 'pto',
  status       greendogops.time_off_status not null default 'requested',
  start_date   date not null,
  end_date     date not null,
  note         text,
  requested_by uuid,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint person_time_off_range_ck check (end_date >= start_date)
);
create index if not exists person_time_off_person_idx
  on greendogops.person_time_off (person_id, start_date desc);
create index if not exists person_time_off_range_idx
  on greendogops.person_time_off (start_date, end_date);

drop trigger if exists set_updated_at on greendogops.person_time_off;
create trigger set_updated_at before update on greendogops.person_time_off
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.person_time_off
  to authenticated, service_role;

comment on table greendogops.person_time_off is
  'Employee-entered PTO / Vacation / Time-off requests. Approval status drives '
  'scheduler color coding (requested=amber, approved=green).';

-- ---------------------------------------------------------------------------
-- Simple scheduler availability hints on the per-employee setting row.
-- ---------------------------------------------------------------------------
alter table greendogops.sched_employee_setting
  add column if not exists eligible_location_ids uuid[] not null default '{}';
alter table greendogops.sched_employee_setting
  add column if not exists available_days smallint[] not null default '{}';

comment on column greendogops.sched_employee_setting.eligible_location_ids is
  'Locations this employee may be scheduled at; empty = all locations.';
comment on column greendogops.sched_employee_setting.available_days is
  'Weekdays this employee is available, 0=Sun..6=Sat; empty = any day.';
