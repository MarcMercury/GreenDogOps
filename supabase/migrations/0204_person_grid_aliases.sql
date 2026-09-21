-- ---------------------------------------------------------------------------
-- 0204 — extra schedule-sheet spellings for a person
--
-- grid_name holds ONE spelling, but the staff schedule writes some people more
-- than one way: Ashley Paredes appears as both "Ashley" and "Ashley Training".
-- Those rows were landing in the review queue every night with no way to
-- resolve them short of renaming the person.
--
-- Scoped to the schedule importer on purpose. When I Work time-off matching
-- must NOT accept a bare first name, or a request could be filed against the
-- wrong person (there are 13 Ashleys in the roster).
-- ---------------------------------------------------------------------------

alter table greendogops.person
  add column if not exists grid_aliases text[];

comment on column greendogops.person.grid_aliases is
  'Additional spellings the staff schedule sheet uses for this person, beyond grid_name. Read only by the sheet schedule importer.';

update greendogops.person
   set grid_aliases = array['Ashley', 'Ashley Training']
 where full_name = 'Ashley Paredes'
   and status = 'employee';
