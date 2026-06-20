-- ============================================================================
-- Green Dog Ops — 0023 PTO days
-- ----------------------------------------------------------------------------
-- Ongoing, itemized log of paid-time-off days for each employee. Replaces the
-- free-text "PTO notes" blob ("1 day payroll #63 days payroll #71 …") with a
-- structured list of individual dates that surfaces on the Attendance tab.
-- The summary fields on person_employment (pto_used / pto_available) stay as-is;
-- this table is the date-by-date detail behind them.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.person_pto_day (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references greendogops.person (id) on delete cascade,
  pto_date    date not null,
  hours       numeric,          -- optional: hours taken (blank = full day)
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists person_pto_day_person_idx
  on greendogops.person_pto_day (person_id, pto_date desc);

drop trigger if exists set_updated_at on greendogops.person_pto_day;
create trigger set_updated_at before update on greendogops.person_pto_day
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.person_pto_day
  to authenticated, service_role;

comment on table greendogops.person_pto_day is
  'Itemized PTO days per employee, shown on the HR Attendance tab.';
