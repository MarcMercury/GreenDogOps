-- ============================================================================
-- Green Dog Ops — 0070 Clean up & consolidate recruiting `target_title` (Position)
-- ----------------------------------------------------------------------------
-- The person_recruiting.target_title ("Position") column has three problems:
--   1. Compensation notes were entered as the position (e.g. "$20/ hr").
--   2. Interview-scheduling junk landed here too (e.g. "Skype 3/23 @1:15pm").
--   3. Many real positions differ only by case / typo / abbreviation.
--
-- Fix order:
--   A. Move non-position text (comp + scheduling notes) into person.notes
--      ("other notes on the account"), then null the position.
--   B. Move embedded commentary into notes but keep a clean position.
--   C. Consolidate the remaining position variants onto canonical spellings.
-- Genuinely distinct roles/credentials (CT, RVT, DH, DVM, etc.) are left alone.
-- ============================================================================

set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- A. Comp + scheduling junk -> account notes, then clear the position field.
-- ---------------------------------------------------------------------------
update person p
set notes = concat_ws(e'\n', nullif(p.notes, ''), 'From Position field: ' || r.target_title)
from person_recruiting r
where r.person_id = p.id
  and (
    r.target_title in (
      '$17-18', '$19-20', '$20 /hr current pay', '$20/ hr',
      '$20/ hr- Compensation salary- currently making wants to stay around there.',
      '$21.50/hr',
      '1030.0', '12:00:00', '1PM', '7/5 @ 7pm', '2021-04-30', '23.0',
      'Monday after 11AM PHONER!!!', 'Shadow Friday 4/30',
      'Skype 3/23 @1:15pm', 'Skype 3/23 @13:20pm',
      'Thur 4/29', 'Thur 4/29 phoner after 3pm', 'Tuesday after 11:30am',
      'Wednesday Aft 12pm PST.', 'Wednesday Aft 1pm', 'Wednesday Aft 3pm'
    )
    or r.target_title like '9:00 am%'
  );

update person_recruiting
set target_title = null
where target_title in (
    '$17-18', '$19-20', '$20 /hr current pay', '$20/ hr',
    '$20/ hr- Compensation salary- currently making wants to stay around there.',
    '$21.50/hr',
    '1030.0', '12:00:00', '1PM', '7/5 @ 7pm', '2021-04-30', '23.0',
    'Monday after 11AM PHONER!!!', 'Shadow Friday 4/30',
    'Skype 3/23 @1:15pm', 'Skype 3/23 @13:20pm',
    'Thur 4/29', 'Thur 4/29 phoner after 3pm', 'Tuesday after 11:30am',
    'Wednesday Aft 12pm PST.', 'Wednesday Aft 1pm', 'Wednesday Aft 3pm'
  )
  or target_title like '9:00 am%';

-- ---------------------------------------------------------------------------
-- B. Values that mix a real position with embedded commentary/comp.
--    Preserve the commentary in notes, keep a clean position.
-- ---------------------------------------------------------------------------
update person p
set notes = concat_ws(e'\n', nullif(p.notes, ''), 'From Position field: ' || r.target_title)
from person_recruiting r
where r.person_id = p.id
  and r.target_title in (
    '20 - Overnight ER manager',
    'Recruiting Asst, could be remote recep from resume I see',
    'Marketing Director - left vet med in 2015'
  );

update person_recruiting set target_title = 'Overnight ER Manager'
where target_title = '20 - Overnight ER manager';
update person_recruiting set target_title = 'Recruiting Asst'
where target_title = 'Recruiting Asst, could be remote recep from resume I see';
update person_recruiting set target_title = 'Marketing Director'
where target_title = 'Marketing Director - left vet med in 2015';

-- ---------------------------------------------------------------------------
-- C. Consolidate real position variants (case / typo / abbreviation).
-- ---------------------------------------------------------------------------

-- DVM
update person_recruiting set target_title = 'DVM'
where target_title in ('DVM (final year)');
update person_recruiting set target_title = 'DVM Extern'
where target_title in ('DVM extern', 'DVM EXTERN', 'DVM/Extern');

-- Extern / Intern
update person_recruiting set target_title = 'Extern' where target_title in ('EXTERN');
update person_recruiting set target_title = 'Intern' where target_title in ('INTERN');

-- CSR
update person_recruiting set target_title = 'CSR - SO'
where target_title in ('CSR- SO', 'CSR-SO');
update person_recruiting set target_title = 'CSR - Venice'
where target_title in ('CSR- Venice', 'CSR- VENICE');
update person_recruiting set target_title = 'In-House CSR'
where target_title in ('IN HOUSE CSR');
update person_recruiting set target_title = 'Remote CSR'
where target_title in ('RCSR', 'REMOTE VET CSR!');

-- Reception
update person_recruiting set target_title = 'Remote Receptionist'
where target_title in ('REMOTE receptionist', 'Remote Receptionsit');
update person_recruiting set target_title = 'Vet Receptionist'
where target_title in ('Vet receptionist');

-- Vet Tech
update person_recruiting set target_title = 'Vet Tech'
where target_title in ('VET TECH', 'Vet tech', 'Veterinary Technician');
update person_recruiting set target_title = 'Vet Tech - SO'
where target_title in ('Vet Tech-SO', 'VT- SO');
update person_recruiting set target_title = 'Vet Tech - Venice'
where target_title in ('Vet Tech- Venice');
update person_recruiting set target_title = 'RVT' where target_title in ('RTV');
update person_recruiting set target_title = 'Exotics RVT' where target_title in ('EXOTICS RVT');
update person_recruiting set target_title = 'NAD Tech' where target_title in ('NAD TECH');

-- Dental Tech
update person_recruiting set target_title = 'Dental Tech'
where target_title in ('Dental tech', '2 Dental tech', 'DT', 'Teethcleaner');

-- Facility
update person_recruiting set target_title = 'Fac' where target_title in ('FAC');
update person_recruiting set target_title = 'Fac - Venice' where target_title in ('Facility Venice');

-- Janitor / Maintenance
update person_recruiting set target_title = 'Janitor' where target_title in ('JANITOR');
update person_recruiting set target_title = 'Maintenance' where target_title in ('Maintenence');

-- Managers
update person_recruiting set target_title = 'Practice Manager'
where target_title in ('Practice manager');
update person_recruiting set target_title = 'Practice Manager - Long Beach'
where target_title in ('Practice manager - Long beach');
update person_recruiting set target_title = 'Practice Office Manager'
where target_title in ('Practice office manager');
