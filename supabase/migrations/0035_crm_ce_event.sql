-- ============================================================================
-- Green Dog Ops — 0035 CE event entity
-- ----------------------------------------------------------------------------
-- Promotes "CE events" from a derived grouping (a repeated ce_name string on
-- crm_ce_attendance rows) into a first-class record with its own details:
-- date, time, location, subject, presenters, description, cost, audience, etc.
-- A CE event can now exist on its own (before any attendees are rostered) and
-- be assigned to CE leads. Each attendance row optionally links back to its
-- parent event via crm_ce_attendance.ce_event_id.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.crm_ce_event (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  event_date      date,            -- date the CE is held
  start_time      text,            -- e.g. "09:00" / "9:00 AM"
  end_time        text,
  location        text,
  subject         text,            -- topic / focus area
  presenters      text,            -- presenter name(s)
  description     text,
  cost_type       text not null default 'free',   -- free | paid
  cost_amount     numeric,         -- price when paid
  audience        text,            -- dvm | tech | assistant | manager | csr | student | anyone
  status          text not null default 'planned', -- planned | scheduled | completed | cancelled
  capacity        integer,         -- max attendees, optional
  registration_url text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Link attendance rows to their parent event. Kept nullable so legacy rows
-- (which only carry a ce_name string) remain valid; clearing an event detaches
-- rather than deletes the roster.
alter table greendogops.crm_ce_attendance
  add column if not exists ce_event_id uuid
    references greendogops.crm_ce_event (id) on delete set null;

create index if not exists crm_ce_event_date_idx
  on greendogops.crm_ce_event (event_date desc);

create index if not exists crm_ce_attendance_event_id_idx
  on greendogops.crm_ce_attendance (ce_event_id);

drop trigger if exists set_updated_at on greendogops.crm_ce_event;
create trigger set_updated_at before update on greendogops.crm_ce_event
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.crm_ce_event
  to authenticated, service_role;

comment on table greendogops.crm_ce_event is
  'First-class CE event: scheduling + logistics details that CE leads can be rostered against.';
