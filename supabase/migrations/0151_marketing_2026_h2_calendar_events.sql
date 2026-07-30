-- ============================================================================
-- Green Dog Ops — 0151 Assimilate the printed "2026 Events Calendar" PDF
--                     (August 1 → end of year)
-- ----------------------------------------------------------------------------
-- Source: public/"Marketing Spreadsheets - 2026 Events Calendar.pdf" (the
-- printed month-grid version of the workbook's "2026 Events Calendar" tab).
-- Reviewed the highlighted (color-coded) cells for Aug 1 – Dec 31 and folded the
-- real Green Dog activity that was NOT already tracked into marketing_event.
--
-- Legend on the PDF:
--   lime green = Green Dog Event (CE, client facing)
--   green      = Green Dog Internal Event (staff / Western classes)
--   cyan       = 3rd Party Event — Tent set up (CONFIRMED)
--   pale yellow= 3rd Party Event — street teams / flyering
--   gray       = 3rd Party Event — no physical presence / coupon donation
--   orange     = Researched / tentative event   (=> status 'tentative')
--   cream      = City Event — non attended
--   pink       = Major Veterinary Event (CE conference)
--   bright yellow = Holiday / Clinic Closed
--   BOLD text  = event is confirmed
--
-- Intentionally NOT imported (per the user's instruction + repo conventions):
--   * the un-highlighted national awareness "pet day" observances,
--   * the highlighted individual staff-name markers (JENN, Laurence, *_OFF),
--   * the recurring "DOG PPL POP UP CLINIC" cells — already covered by the
--     single "Dog PPL Vaccine Pop-up (Monthly)" row,
--   * the maroon US federal holidays (Labor Day, Halloween, Veterans Day,
--     Thanksgiving, Christmas) — not clinic-closed on this calendar,
--   * "IDEXX CE — CANCELED" (Aug 5) — canceled,
--   * the green "DENTAL CE — GDU" client-facing CE class (Sep 12) — CE courses
--     live in the CE module (crm_ce_event), not marketing_event.
--
-- Everything else highlighted in Aug–Dec was already present in marketing_event
-- (CatCon, Day of the Dog 2026 / Sherman Oaks Street Fair, Howl-O-Ween,
-- Wags & Walks Gala, Vanderpump, Anaheim Reptile Super Show, Dogtoberfest,
-- Adventure Buddy Day). Only the three rows below were missing.
--
-- All inserts are idempotent (NOT EXISTS on the event name). Status/type values
-- are free text enforced by the app layer.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.marketing_event
  (name, event_type, status, starts_on, ends_on, location, clinic_served, description)
select * from (values
  -- cyan / confirmed tent set-up ---------------------------------------------
  ('Art on Ocean',
     'tent', 'confirmed', date '2026-08-08', null::date,
     'Ocean Ave, Santa Monica', null::text,
     'Art on Ocean — confirmed tent set-up. Laurence covering; need one more '
     'person to staff. (2026 Events Calendar PDF, Aug 8.)'),
  -- orange / researched-tentative city festival ------------------------------
  ('Fiesta La Ballona',
     'city', 'tentative', date '2026-08-28', date '2026-08-30',
     'Veterans Memorial Park, Culver City', null,
     'Fiesta La Ballona — Culver City community festival (last weekend of '
     'August). Researched / tentative tabling opportunity. (2026 Events '
     'Calendar PDF, Aug 28–30.)'),
  -- cyan / confirmed tent set-up ---------------------------------------------
  ('Race for the Rescues',
     'tent', 'confirmed', date '2026-10-10', null,
     'Los Angeles', null,
     'Race for the Rescues — confirmed tent set-up, animal-rescue benefit run '
     '(same day as CatCon). (2026 Events Calendar PDF, Oct 10.)')
) as v(name, event_type, status, starts_on, ends_on, location, clinic_served, description)
where not exists (
  select 1 from greendogops.marketing_event e where e.name = v.name
);
