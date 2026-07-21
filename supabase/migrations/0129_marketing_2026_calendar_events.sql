-- ============================================================================
-- Green Dog Ops — 0129 Assimilate the "2026 Events Calendar" tab
-- ----------------------------------------------------------------------------
-- Reviews the visual "2026 Events Calendar" tab of the Marketing workbook and
-- folds the real Green Dog activity into existing surfaces (no new tables):
--
--   1) marketing_event — Green Dog events found on the calendar that were not
--      already tracked (3rd-party tabling, GD hosted/tent/city, vet conference).
--   2) marketing_event — date corrections for three previously seeded rows
--      whose dates disagreed with the calendar tab.
--   3) calendar_event  — chamber / networking touchpoints seeded as free-form
--      day-notes (category = 'note') so they surface on the Calendar page.
--
-- The 456 national awareness observances ("National Yorkie Day", …) and the
-- staff-scheduling markers ("JENN", "Laurence") on the tab are intentionally
-- NOT imported. CE courses (IDEXX / Dental) stay in the CE module and were not
-- added here per review. All inserts are idempotent (NOT EXISTS on the natural
-- key). Status/type values are free text enforced by the app layer. "Today"
-- reference for status: mid-2026 — past-dated events => completed.
-- ============================================================================
set search_path = greendogops, public;

-- 1) New Green Dog events from the calendar tab ------------------------------
insert into greendogops.marketing_event
  (name, event_type, status, starts_on, ends_on, location, clinic_served, description)
select * from (values
  -- 3rd-party / tabling ------------------------------------------------------
  ('Reptile Super Show — Pomona',
     'third_party', 'completed', date '2026-01-10', date '2026-01-11',
     'Fairplex, Pomona', null::text,
     'Reptile Super Show at the Fairplex, Pomona (10am–5pm). Exotics-audience tabling opportunity.'),
  ('Repticon Costa Mesa',
     'third_party', 'completed', date '2026-05-17', date '2026-05-18',
     'Costa Mesa', null,
     'Repticon reptile expo, Costa Mesa. Exotics differentiator tabling.'),
  ('AAPI Heritage Celebration — Third Street Promenade',
     'city', 'completed', date '2026-05-17', null,
     'Third Street Promenade, Santa Monica', null,
     'AAPI Heritage Month celebration on the Third Street Promenade.'),
  ('Marina del Rey — Coco Beach',
     'third_party', 'completed', date '2026-05-09', null,
     'Marina del Rey', null,
     'Marina del Rey / Coco Beach event (same weekend as Fur Fest).'),
  ('Wags & Walks — Platform LA Adoption Series',
     'third_party', 'confirmed', date '2026-05-23', null,
     'Platform LA, Culver City', null,
     'Recurring Saturday adoption event series with Wags & Walks at Platform LA. Clone this record per date to track results.'),
  ('Pet Adoption Event — Woodley Park',
     'third_party', 'completed', date '2026-06-24', null,
     'Woodley Park, Van Nuys', null,
     'Pet adoption event at Woodley Park.'),
  ('Reptile Super Show — Exotics',
     'third_party', 'completed', date '2026-07-11', date '2026-07-12',
     'Southern California', null,
     'Reptile Super Show — exotics differentiator tabling.'),
  ('Echo Park Lotus Festival',
     'city', 'completed', date '2026-07-11', date '2026-07-12',
     'Echo Park, Los Angeles', null,
     'Echo Park Lotus Festival community presence.'),
  ('Anaheim Reptile Super Show',
     'third_party', 'tentative', date '2026-10-03', date '2026-10-11',
     'Anaheim Convention Center', null,
     'Reptile Super Show, Anaheim — exotics differentiator tabling (show days Oct 3 & 11).'),
  ('Dogtoberfest — South Coast Botanic Garden',
     'third_party', 'tentative', date '2026-10-03', date '2026-10-24',
     'South Coast Botanic Garden, Palos Verdes', null,
     'Dogtoberfest — recurring October weekends at South Coast Botanic Garden.'),
  ('Wags & Walks Gala',
     'sponsorship', 'tentative', date '2026-11-14', null,
     'Los Angeles', null,
     'Wags & Walks annual gala — sponsorship / attendance.'),
  -- GD hosted / tent / city --------------------------------------------------
  ('Venice Fest — Summer Edition',
     'city', 'completed', date '2026-06-20', null,
     'Venice', 'Venice',
     'Venice Fest summer edition street presence.'),
  ('Summer Solstice — Main Street',
     'city', 'completed', date '2026-06-20', null,
     'Main Street, Santa Monica', null,
     'Summer Solstice celebration on Main Street.'),
  ('Adventure Buddy Day — Van Nuys',
     'tent', 'tentative', date '2026-08-23', null,
     'Van Nuys', null,
     'Adventure Buddy Day — tabling in Van Nuys.'),
  ('Day of the Dog 2026',
     'third_party', 'tentative', date '2026-10-18', null,
     'Los Angeles', null,
     'Day of the Dog event (October 2026).'),
  ('Howl-O-Ween',
     'city', 'tentative', date '2026-10-24', null,
     'Main Street, Santa Monica', null,
     'Howl-O-Ween community Halloween event.'),
  -- Vet conference -----------------------------------------------------------
  ('WVC Conference — Las Vegas',
     'vet_conference', 'completed', date '2026-02-15', date '2026-02-18',
     'Las Vegas, NV', null,
     'Western Veterinary Conference (WVC), Las Vegas. Dre + Gladys TBD.')
) as v(name, event_type, status, starts_on, ends_on, location, clinic_served, description)
where not exists (
  select 1 from greendogops.marketing_event e where e.name = v.name
);

-- 2) Date corrections on previously seeded rows ------------------------------
-- Vanderpump: the "Day of the Dog" event is on Sep 26, not the May date seeded.
update greendogops.marketing_event
set starts_on   = date '2026-09-26',
    status      = 'tentative',
    description  = 'Vanderpump Dogs "Day of the Dog" event (Sep 26 on the 2026 calendar).'
where name = 'Vanderpump'
  and starts_on = date '2026-05-09';

-- Staff Holiday Party: calendar shows Jan 4 (was seeded as a month-only Jan 1).
update greendogops.marketing_event
set starts_on   = date '2026-01-04',
    description  = 'Annual staff holiday party.'
where name = 'Staff Holiday Party'
  and starts_on = date '2026-01-01';

-- AVMA Convention: calendar shows Jul 10–14 in Anaheim (was a single Jul 15).
update greendogops.marketing_event
set starts_on   = date '2026-07-10',
    ends_on     = date '2026-07-14',
    location    = coalesce(nullif(location, ''), 'Anaheim Convention Center')
where name = 'AVMA Convention 2026'
  and starts_on = date '2026-07-15';

-- 3) Chamber / networking touchpoints as Calendar day-notes ------------------
-- Stored as custom calendar_event rows with category = 'note' so they render as
-- free-form notes on the Calendar page (the note body doubles as the title).
insert into greendogops.calendar_event
  (source, title, starts_at, all_day, category, status)
select 'custom', v.body, v.d::timestamptz, true, 'note', 'confirmed'
from (values
  ('Coffee Connection — networking',                         '2026-01-13'),
  ('Sherman Oaks Lunch Break Live (in person) 11:30am–1:30pm', '2026-01-15'),
  ('Sherman Oaks Freshly Brewed Conversation 9:30am–10:30am',  '2026-01-21'),
  ('Sherman Oaks Mix & Mingle LIVE 5:30pm–7pm',              '2026-01-27')
) as v(body, d)
where not exists (
  select 1 from greendogops.calendar_event c
  where c.category = 'note'
    and c.title = v.body
    and c.starts_at::date = v.d::date
);
