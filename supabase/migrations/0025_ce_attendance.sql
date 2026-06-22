-- ============================================================================
-- Green Dog Ops — 0025 CE attendance tracking
-- ----------------------------------------------------------------------------
-- Per-attendee log of the continuing-education (CE) events a CE lead is going
-- to / has attended. Each row captures one CE event for one contact along with
-- its preparation + payment status, so a CE lead's profile can list every CE
-- they're tied to and the CE CRM can roster attendees by event.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.crm_ce_attendance (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references greendogops.crm_contact (id) on delete cascade,
  ce_name             text not null,
  ce_date             date,            -- date of the CE event
  confirmed_date      date,            -- date the attendee confirmed
  paid                boolean not null default false,
  showed_up           boolean not null default false,
  materials_prepared  boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists crm_ce_attendance_contact_idx
  on greendogops.crm_ce_attendance (contact_id);

create index if not exists crm_ce_attendance_event_idx
  on greendogops.crm_ce_attendance (ce_name, ce_date desc);

drop trigger if exists set_updated_at on greendogops.crm_ce_attendance;
create trigger set_updated_at before update on greendogops.crm_ce_attendance
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.crm_ce_attendance
  to authenticated, service_role;

comment on table greendogops.crm_ce_attendance is
  'Per-attendee CE event log: which CE each lead is attending and its prep/payment status.';
