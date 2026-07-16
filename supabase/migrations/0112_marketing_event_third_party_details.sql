-- ---------------------------------------------------------------------------
-- Green Dog Ops — 0112 Third-party event intake details
-- ---------------------------------------------------------------------------
-- The Marketing → Events tab captures 3rd-party events (fairs, expos, city
-- events, vet conferences, etc). When a partner invites us, marketing works
-- through a standard "Event Details" intake template that captures everything
-- ops needs to staff & set up correctly:
--
--   • When   — required arrival & departure times (drives staffing).
--   • Where  — indoor vs outdoor, plus the event website / flyer.
--   • Who    — the host organization and their website.
--   • Cost   — already covered by marketing_event.cost.
--   • Audience / foot traffic — how busy the event is expected to be.
--   • Expectations / involvement — sponsor? vet services? judges? gift certs?
--   • Physical set up — what we bring vs. what the host provides.
--   • Parking / loading & unloading for staff.
--   • Food on-site for staff.
--
-- This migration adds those intake fields to marketing_event. All are nullable
-- free text so partial info can be captured during initial outreach and filled
-- in once the event is confirmed.
-- ---------------------------------------------------------------------------

alter table greendogops.marketing_event
  add column if not exists arrival_time          text,
  add column if not exists departure_time        text,
  add column if not exists venue_type            text,   -- indoor | outdoor | mixed
  add column if not exists event_url             text,   -- event website / flyer
  add column if not exists host_company          text,
  add column if not exists host_website          text,
  add column if not exists expected_foot_traffic text,
  add column if not exists involvement           text,   -- expectations / role
  add column if not exists setup_needs           text,   -- physical set up / what to bring
  add column if not exists parking_info          text,
  add column if not exists food_onsite           text;

comment on column greendogops.marketing_event.arrival_time is
  'Required staff arrival time (from event intake template).';
comment on column greendogops.marketing_event.departure_time is
  'Required staff departure time (from event intake template).';
comment on column greendogops.marketing_event.venue_type is
  'indoor | outdoor | mixed.';
comment on column greendogops.marketing_event.event_url is
  'Event website or flyer link.';
comment on column greendogops.marketing_event.host_company is
  'Organization hosting the event.';
comment on column greendogops.marketing_event.host_website is
  'Host organization website.';
comment on column greendogops.marketing_event.expected_foot_traffic is
  'Anticipated audience / foot traffic.';
comment on column greendogops.marketing_event.involvement is
  'Expectations / our role: sponsor, vet services, judges, gift certificates, etc.';
comment on column greendogops.marketing_event.setup_needs is
  'Physical set up: what we bring vs. what the host provides (tables, chairs, tents).';
comment on column greendogops.marketing_event.parking_info is
  'Parking + loading/unloading instructions for staff.';
comment on column greendogops.marketing_event.food_onsite is
  'Whether food is available on-site for staff (e.g. food trucks).';
