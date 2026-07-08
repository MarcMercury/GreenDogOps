-- ============================================================================
-- Green Dog Ops — 0075 Calendar module
-- ----------------------------------------------------------------------------
-- A combined company calendar. The Calendar page renders a single stream of
-- events made of two kinds of source:
--
--   1. PHYSICAL rows in greendogops.calendar_event
--        * source = 'google'  — mirrored from the company Google Calendar by a
--          scheduled sync job (Phase 2). Keyed by google_event_id.
--        * source = 'custom'  — entered directly on the Calendar page.
--
--   2. PROJECTED rows (read-time only, NOT stored here) — CE events, ATS
--      interviews, and time-off are merged in by the data layer from their own
--      tables so they stay a single source of truth and always render fresh.
--
-- Notifications (email via Resend, Slack) are logged in calendar_notification
-- so reminders never double-send (Phase 4). calendar_sync_state stores the
-- Google incremental sync token (Phase 2).
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Unified event table (physical rows: google + custom).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.calendar_event (
  id               uuid primary key default gen_random_uuid(),
  source           text not null default 'custom'
                     check (source in ('google', 'custom')),
  -- Google's opaque event id; null for custom events. Unique per source so a
  -- sync upsert can target the right row without clobbering custom events.
  google_event_id  text,
  google_calendar_id text,
  title            text not null,
  description      text,
  location         text,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  all_day          boolean not null default false,
  status           text not null default 'confirmed'
                     check (status in ('confirmed', 'tentative', 'cancelled')),
  -- Grouping / colour bucket shown on the calendar. Free text so future
  -- internal event kinds can reuse it without a migration.
  category         text not null default 'general',
  color            text,
  -- Optional linkage back to the people involved (owner + attendees) so we can
  -- resolve emails / Slack handles for reminders in Phase 4.
  owner_person_id  uuid references greendogops.person (id) on delete set null,
  attendee_person_ids uuid[] not null default '{}',
  -- Reminder + channel config, e.g. { "email": true, "slack": true,
  -- "offsets_minutes": [1440, 60] }. Interpreted by the Phase 4 dispatcher.
  notify_config    jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists calendar_event_google_uq
  on greendogops.calendar_event (google_event_id)
  where google_event_id is not null;
create index if not exists calendar_event_range_idx
  on greendogops.calendar_event (starts_at, ends_at);
create index if not exists calendar_event_source_idx
  on greendogops.calendar_event (source);

drop trigger if exists set_updated_at on greendogops.calendar_event;
create trigger set_updated_at before update on greendogops.calendar_event
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.calendar_event
  to authenticated, service_role;

comment on table greendogops.calendar_event is
  'Physical calendar rows: Google-mirrored + custom events. CE / interview / '
  'time-off events are projected at read time from their own tables.';

-- ---------------------------------------------------------------------------
-- Google Calendar sync bookkeeping (Phase 2). One row per mirrored calendar.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.calendar_sync_state (
  google_calendar_id text primary key,
  sync_token         text,             -- Google incremental sync token
  last_synced_at     timestamptz,
  last_status        text,             -- ok | error
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.calendar_sync_state;
create trigger set_updated_at before update on greendogops.calendar_sync_state
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.calendar_sync_state
  to authenticated, service_role;

comment on table greendogops.calendar_sync_state is
  'Per-calendar Google sync token + last-run status for the incremental sync job.';

-- ---------------------------------------------------------------------------
-- Notification log (Phase 4). One row per (event, offset, channel) actually
-- sent, so the reminder dispatcher is idempotent and never double-sends.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.calendar_notification (
  id             uuid primary key default gen_random_uuid(),
  -- Physical event ref when the source is a calendar_event row; source_key lets
  -- us also de-dupe reminders for projected events (e.g. 'interview:<uuid>').
  event_id       uuid references greendogops.calendar_event (id) on delete cascade,
  source_key     text not null,
  channel        text not null check (channel in ('email', 'slack')),
  offset_minutes integer not null,
  recipient      text,             -- email address or slack channel/user id
  status         text not null default 'sent'
                   check (status in ('sent', 'failed')),
  error          text,
  sent_at        timestamptz not null default now()
);

create unique index if not exists calendar_notification_uq
  on greendogops.calendar_notification (source_key, channel, offset_minutes, recipient);
create index if not exists calendar_notification_event_idx
  on greendogops.calendar_notification (event_id);

grant select, insert, update, delete on greendogops.calendar_notification
  to authenticated, service_role;

comment on table greendogops.calendar_notification is
  'Idempotency + audit log of calendar reminders sent via email / Slack.';
