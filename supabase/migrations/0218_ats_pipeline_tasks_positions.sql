-- ============================================================================
-- Green Dog Ops — 0218 Recruiting ATS: Slack announcements, interview times,
-- call/note log, follow-up tasks and open positions
-- ----------------------------------------------------------------------------
-- WHY: the recruiting team sources on Indeed but does everything after that by
-- hand — calls, interview scheduling, follow-ups — and announces candidates in
-- the Slack recruiting channel with a numbered NOTES/NAME/PHONE/... post, then
-- discusses each one in that post's thread. This moves the workflow into the
-- ATS:
--
--   1. person_recruiting remembers the Slack announcement it posted (ts +
--      channel) so stage changes and scheduled interviews thread under it.
--   2. person_interview gains start/end times so interviews land on the
--      calendar at the right hour (null time = all-day, as before).
--   3. recruiting_activity — the in-app log of calls, texts, emails and notes.
--   4. recruiting_task — dated follow-ups per candidate.
--   5. position becomes the open-positions board ("CSR @ Van Nuys, high
--      priority, 2 openings"). Title was UNIQUE on its own, which can't hold the
--      same title at two locations, so uniqueness moves to (title, location).
--      The only other reader (emp-reporting) resolves positions by id.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1) Slack announcement anchor
-- ---------------------------------------------------------------------------
alter table greendogops.person_recruiting
  add column if not exists slack_announce_ts text,
  add column if not exists slack_announce_channel text,
  add column if not exists announced_at timestamptz,
  add column if not exists announced_by uuid;

comment on column greendogops.person_recruiting.slack_announce_ts is
  'Slack ts of the candidate announcement post; later updates reply in its thread.';
comment on column greendogops.person_recruiting.slack_announce_channel is
  'Slack channel id the announcement was posted to.';

-- ---------------------------------------------------------------------------
-- 2) Interview times
-- ---------------------------------------------------------------------------
alter table greendogops.person_interview
  add column if not exists start_time time,
  add column if not exists end_time time;

-- ---------------------------------------------------------------------------
-- 3) Activity log (calls, texts, emails, notes) — in-app only, never posted
-- ---------------------------------------------------------------------------
create table if not exists greendogops.recruiting_activity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references greendogops.person (id) on delete cascade,
  activity_type text not null default 'note',
  body text not null,
  occurred_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

comment on column greendogops.recruiting_activity.activity_type is
  'call | text | email | note';

create index if not exists recruiting_activity_person_idx
  on greendogops.recruiting_activity (person_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 4) Follow-up tasks
-- ---------------------------------------------------------------------------
create table if not exists greendogops.recruiting_task (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references greendogops.person (id) on delete cascade,
  title text not null,
  details text,
  due_date date,
  is_done boolean not null default false,
  completed_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recruiting_task_person_idx
  on greendogops.recruiting_task (person_id);
create index if not exists recruiting_task_open_due_idx
  on greendogops.recruiting_task (due_date) where not is_done;

drop trigger if exists set_updated_at on greendogops.recruiting_task;
create trigger set_updated_at before update on greendogops.recruiting_task
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Open positions board
-- ---------------------------------------------------------------------------
alter table greendogops.position
  add column if not exists location text,
  add column if not exists priority text not null default 'normal',
  add column if not exists status text not null default 'open',
  add column if not exists openings integer not null default 1,
  add column if not exists notes text;

comment on column greendogops.position.priority is 'high | normal | low';
comment on column greendogops.position.status is 'open | on_hold | filled | closed';

alter table greendogops.position drop constraint if exists position_title_key;
create unique index if not exists position_title_location_key
  on greendogops.position (title, coalesce(location, ''));

create index if not exists person_recruiting_target_position_idx
  on greendogops.person_recruiting (target_position_id);
