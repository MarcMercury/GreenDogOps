-- ============================================================================
-- Green Dog Ops — 0104 Marketing Events management system
-- ----------------------------------------------------------------------------
-- Extends the marketing module into a full, self-managed events workflow
-- (separate from the CE events module, which handles RACE-approved CE only):
--
--   1) marketing_event_source — the "where do we find events" search list. A
--      catalog of chambers / calendars / listings to check on a cadence. Rows
--      convert into scheduled marketing_event records.
--   2) marketing_event gains PLANNING + PROMOTION fields, a planning checklist
--      (jsonb), and a source_id back-link so an event remembers where it came
--      from.
--   3) marketing_event_attendee — sign-ups / contacts / leads captured per
--      event (the "manage attendees & results" side).
-- ============================================================================
set search_path = greendogops, public;

-- 1) Event sources -----------------------------------------------------------
create table if not exists greendogops.marketing_event_source (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  url            text,
  region         text,                         -- Venice / Santa Monica / Valley
  membership_cost text,                        -- free text: "$595/yr", "per event"
  cadence        text default 'monthly',       -- how often to check
  last_checked_on date,
  active         boolean not null default true,
  notes          text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.marketing_event_source;
create trigger set_updated_at before update on greendogops.marketing_event_source
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_event_source
  to authenticated, service_role;

-- 2) Planning / promotion fields on marketing_event --------------------------
alter table greendogops.marketing_event
  add column if not exists planning_phase text,
  add column if not exists staff          text,
  add column if not exists supplies       text,
  add column if not exists promo_channels text,
  add column if not exists landing_url    text,
  add column if not exists rsvp_url       text,
  add column if not exists checklist      jsonb not null default '[]'::jsonb,
  add column if not exists source_id      uuid
    references greendogops.marketing_event_source (id) on delete set null;

comment on column greendogops.marketing_event.checklist is
  'Planning checklist: [{"label":"Book staff","done":false}].';

-- 3) Attendees / sign-ups ----------------------------------------------------
create table if not exists greendogops.marketing_event_attendee (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null
    references greendogops.marketing_event (id) on delete cascade,
  name          text,
  email         text,
  phone         text,
  attendee_type text default 'lead',   -- new_client | returning | lead | vendor | rescue
  is_new_client boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_event_attendee_event_idx
  on greendogops.marketing_event_attendee (event_id);

drop trigger if exists set_updated_at on greendogops.marketing_event_attendee;
create trigger set_updated_at before update on greendogops.marketing_event_attendee
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_event_attendee
  to authenticated, service_role;

-- Seed event sources from the "2026 event host resources" checklist ----------
insert into greendogops.marketing_event_source (name, url, region, membership_cost, notes, sort_order)
select * from (values
  ('Main Street SM Events', 'https://www.mainstreetsm.com/calendar/', 'Santa Monica', 'per event', 'Participated in the Holiday events.', 1),
  ('Venice Chamber Calendar', 'https://venicechamber.net', 'Venice', '$595/yr', 'Hosted the September monthly Happy Hour meeting.', 2),
  ('SM Chamber Calendar', 'https://smchamber.com', 'Santa Monica', '$605/yr', 'Members attended Pet-Chella; help sending emails.', 3),
  ('SO Chamber Calendar', 'https://shermanoakschamber.org', 'Sherman Oaks', '$675/yr', 'Participated in the SO street fair.', 4),
  ('Dog PPL Calendar', 'https://www.dogppl.com', 'Santa Monica', null, 'Member discount partner; cross-promotion.', 5),
  ('Venice Surf Association Events', null, 'Venice', null, 'Local community events.', 6),
  ('Venice Paparazzi', 'https://venicepaparazzi.com', 'Venice', 'exchange for coverage', 'Featured in their monthly newsletter.', 7),
  ('Venice Heritage Museum', null, 'Venice', null, 'Community partner events.', 8),
  ('Ocean Park Association', null, 'Santa Monica', null, 'Neighborhood association events.', 9),
  ('Things To Do LA', 'https://thingstodola.com', 'Los Angeles', null, 'Regional event listings to scout.', 10),
  ('Eventbrite (local)', 'https://www.eventbrite.com', 'Los Angeles', null, 'Search local pet / community events.', 11)
) as v(name, url, region, membership_cost, notes, sort_order)
where not exists (select 1 from greendogops.marketing_event_source);
