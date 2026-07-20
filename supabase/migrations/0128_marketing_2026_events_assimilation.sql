-- ============================================================================
-- Green Dog Ops — 0128 Assimilate the 2026 event calendar + Local Event SOP
-- ----------------------------------------------------------------------------
-- Folds the hand-maintained "Events 2026" calendar and the "Local Event Search
-- SOP" into the existing Marketing surfaces (no new tables / pages):
--
--   1) marketing_event   — the dated GD 2026 events (parties, pop-ups, fests).
--   2) crm_ce_event      — the two GDU continuing-education courses (Dentistry,
--                          Ultrasound) live in the CE module, not the events tab.
--   3) marketing_event_source — the SOP's required sources + chambers that were
--                          missing, and bumps the scouting sources to a weekly
--                          cadence (SOP = every Monday).
--   4) marketing_tree_node — fills the owner gap on the Local Event Scouting SOP
--                          node (the steps/scoring are already seeded there).
--
-- All inserts are idempotent (guarded by NOT EXISTS on the natural key).
-- Status/type values are free text enforced by the app layer.
-- "Today" reference for status: mid-2026 — past-dated events => completed.
-- ============================================================================
set search_path = greendogops, public;

-- 1) 2026 GD event calendar --------------------------------------------------
insert into greendogops.marketing_event
  (name, event_type, status, starts_on, ends_on, location, clinic_served, description)
select * from (values
  ('Staff Holiday Party',
     'internal', 'completed', date '2026-01-01', null::date,
     'Los Olivos', 'All clinics',
     'Annual staff holiday party. Month only on the 2026 calendar — confirm exact date.'),
  ('Venice Love Fest',
     'city', 'completed', date '2026-03-21', null,
     'Venice', 'Venice',
     'Community love-fest street presence in Venice.'),
  ('Pet Resource Fair',
     'tent', 'completed', date '2026-04-12', null,
     'Santa Monica', 'Venice',
     'Pet resource fair — tent / booth presence in Santa Monica.'),
  ('Fur Fest',
     'city', 'completed', date '2026-05-09', null,
     'Valley (Van Nuys)', 'Sherman Oaks',
     'Fur Fest community event in the Valley.'),
  ('Vanderpump',
     'third_party', 'completed', date '2026-05-09', null,
     'Valley (Van Nuys)', 'Sherman Oaks',
     'Vanderpump Dogs event in the Valley (same weekend as Fur Fest).'),
  ('Dog PPL Vaccine Pop-up (Monthly)',
     'tent', 'confirmed', date '2026-08-01', null,
     'Dog PPL — Santa Monica', 'Venice',
     'Recurring monthly low-cost vaccine pop-up at Dog PPL (Santa Monica), '
     'Jan–Dec 2026. March runs as an "Ask-a-Vet" format. Clone this record per '
     'month to track attendance & results.'),
  ('TBD Haunted Halloween Party',
     'hosted', 'tentative', date '2026-10-01', null,
     'GD Valley', 'Sherman Oaks',
     'TBD — Haunted Halloween party at GD Valley (October 2026). Confirm date.')
) as v(name, event_type, status, starts_on, ends_on, location, clinic_served, description)
where not exists (
  select 1 from greendogops.marketing_event e where e.name = v.name
);

-- Link the recurring pop-up back to the Dog PPL scout source when present.
update greendogops.marketing_event e
set source_id = s.id
from greendogops.marketing_event_source s
where e.name = 'Dog PPL Vaccine Pop-up (Monthly)'
  and e.source_id is null
  and s.name = 'Dog PPL Calendar';

-- Reconcile the existing Adoptapalooza record to the authoritative 2026 calendar
-- entry (June 13 @ GD Venice). Only touches the one pre-seeded row.
update greendogops.marketing_event
set starts_on   = date '2026-06-13',
    location    = 'GD Venice',
    event_type  = 'hosted',
    status      = 'completed',
    clinic_served = coalesce(clinic_served, 'Venice')
where name = 'Adoptapalooza 2026';

-- 2) GDU continuing-education courses (CE module) ----------------------------
-- The July 2026 ultrasound course already lives in the CE module
-- ("Ultrasound CE (July 2026)"), so only the spring dentistry course is a gap.
-- Guarded on the date+subject so it never duplicates an existing dentistry CE.
insert into greendogops.crm_ce_event
  (name, subject, event_date, end_date, location, audience, course_type,
   delivery_method, cost_type, status, notes)
select 'Spring Dentistry CE (Apr 2026)', 'Dentistry',
       date '2026-04-18', date '2026-04-19', 'GDU Valley',
       'dvm', 'live', 'in_person', 'paid', 'completed',
       'Green Dog University hands-on dentistry CE (2026 calendar).'
where not exists (
  select 1 from greendogops.crm_ce_event c
  where c.subject ilike '%dent%' and c.event_date = date '2026-04-18'
);

-- 3) SOP event sources -------------------------------------------------------
-- Missing "required sources" + chambers from the Local Event Search SOP.
insert into greendogops.marketing_event_source
  (name, url, region, membership_cost, cadence, notes, sort_order)
select * from (values
  ('Discover Los Angeles Events', 'https://www.discoverlosangeles.com/events',
     'Los Angeles', null, 'weekly', 'SOP required source — regional event discovery.', 12),
  ('Santa Monica Events (santamonica.com)', 'https://www.santamonica.com/events/',
     'Santa Monica', null, 'weekly', 'SOP required source — Santa Monica city events.', 13),
  ('LA Beaches & Harbors Events', 'https://beaches.lacounty.gov/events/',
     'Los Angeles', null, 'weekly', 'SOP required source — LA County beaches & harbors.', 14),
  ('Bandsintown (Los Angeles)', 'https://www.bandsintown.com/c/los-angeles-ca/events',
     'Los Angeles', null, 'weekly', 'SOP required source — live music / entertainment.', 15),
  ('San Fernando Valley Chamber', 'https://www.sanfernandovalleychamber.com',
     'Van Nuys', null, 'weekly', 'SOP chamber check — events, networking, sponsorships.', 16),
  ('Beverly Hills Chamber', 'https://beverlyhillschamber.com',
     'Los Angeles', null, 'weekly', 'SOP chamber check — events, networking, sponsorships.', 17),
  ('Ocean Park Association', 'https://www.opassociation.org',
     'Santa Monica', null, 'weekly', 'SOP chamber check — neighborhood association events.', 18),
  ('Main Street Business Association (SM)', 'https://www.mainstreetsm.com/calendar/',
     'Santa Monica', null, 'weekly', 'SOP chamber check — Main Street SM business association.', 19)
) as v(name, url, region, membership_cost, cadence, notes, sort_order)
where not exists (
  select 1 from greendogops.marketing_event_source s where s.name = v.name
);

-- Bump the SOP-covered scouting sources to a weekly cadence (SOP = every Monday)
-- and normalize the Eventbrite deep-link to the SOP URL.
update greendogops.marketing_event_source
set cadence = 'weekly'
where name in (
  'Venice Chamber Calendar', 'SM Chamber Calendar', 'SO Chamber Calendar',
  'Venice Paparazzi', 'Eventbrite (local)', 'Things To Do LA',
  'Ocean Park Association', 'Main Street SM Events'
);

update greendogops.marketing_event_source
set url = 'https://www.eventbrite.com/d/ca--los-angeles/events/'
where name = 'Eventbrite (local)'
  and (url is null or url = 'https://www.eventbrite.com');

-- 4) Local Event Scouting SOP node — fill the owner gap (steps already seeded)
update greendogops.marketing_tree_node
set owner_name = coalesce(owner_name, 'Jennifer Velasquez')
where label = 'Local Event Scouting' and zone = 'canopy';
