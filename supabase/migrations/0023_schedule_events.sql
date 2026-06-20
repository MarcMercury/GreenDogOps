-- ============================================================================
-- Green Dog Ops — 0023 Schedule events
-- ----------------------------------------------------------------------------
-- Per-week / per-location / per-day "event" banner cells that sit above the
-- location header in the grid (e.g. "Full Team Meeting", "Adoption Event").
-- One event note per (week, location, day) cell.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.sched_event (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references greendogops.sched_week (id) on delete cascade,
  location_id uuid not null references greendogops.location (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists sched_event_uq
  on greendogops.sched_event (week_id, location_id, day_of_week);
create index if not exists sched_event_week_idx
  on greendogops.sched_event (week_id);

-- updated_at trigger ---------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.sched_event;
create trigger set_updated_at before update on greendogops.sched_event
  for each row execute function greendogops.set_updated_at();

-- Grants ---------------------------------------------------------------------
grant select, insert, update, delete
  on greendogops.sched_event to authenticated, service_role;
