-- ============================================================================
-- 0168 — Merge duplicate people, and record schedule-sheet spellings
--
-- Confirmed with the team:
--   * "Lizbeth Gallegos" (employee) / "Lizbeth Ramos" (applicant) / the staff
--     schedule's "Lizbeth Martinez" are all ONE person.
--   * The two "Raquel Romero" employee rows (same email, raquelsrg10@gmail.com)
--     are a straight duplicate.
--
-- Follows the merge pattern established in 0066: the keeper is authoritative,
-- the duplicate's data is migrated onto it, then the duplicate is deleted.
--
-- person.grid_name is the name AS WRITTEN ON THE SCHEDULE ("Dr. Faro",
-- "Raquel R") and is already what lib/hr/wheniwork.ts matches on, so the sheet
-- spellings are recorded there rather than hard-coded in an import script.
-- ============================================================================

begin;

create temp table _merge(keep_id uuid, dup_id uuid, why text) on commit drop;

insert into _merge(keep_id, dup_id, why)
select k.id, d.id, 'Lizbeth Ramos (applicant) -> Lizbeth Gallegos (employee)'
from greendogops.person k, greendogops.person d
where k.full_name = 'Lizbeth Gallegos' and k.status = 'employee'
  and d.full_name = 'Lizbeth Ramos'    and d.status = 'applicant';

-- Same name AND same email: keep the older row, drop the newer.
insert into _merge(keep_id, dup_id, why)
select k.id, d.id, 'duplicate Raquel Romero (same email)'
from greendogops.person k
join greendogops.person d
  on d.id <> k.id
 and lower(trim(d.full_name)) = lower(trim(k.full_name))
 and nullif(lower(trim(d.email)), '') = nullif(lower(trim(k.email)), '')
where k.full_name = 'Raquel Romero'
  and k.created_at < d.created_at;

-- Fill any contact gap on the keeper before the duplicate goes away.
update greendogops.person k
   set email        = coalesce(nullif(trim(k.email), ''), d.email),
       phone_mobile = coalesce(nullif(trim(k.phone_mobile), ''), d.phone_mobile),
       phone_home   = coalesce(nullif(trim(k.phone_home), ''), d.phone_home),
       phone_other  = coalesce(nullif(trim(k.phone_other), ''), d.phone_other),
       date_of_birth = coalesce(k.date_of_birth, d.date_of_birth),
       postal_code  = coalesce(nullif(trim(k.postal_code), ''), d.postal_code),
       source_contact_id = coalesce(k.source_contact_id, d.source_contact_id),
       updated_at   = now()
  from _merge m
  join greendogops.person d on d.id = m.dup_id
 where k.id = m.keep_id;

-- 1:1 children (person_id is the primary key): move only if the keeper has none.
update greendogops.person_employment t set person_id = m.keep_id
  from _merge m where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.person_employment x where x.person_id = m.keep_id);

update greendogops.person_recruiting t set person_id = m.keep_id
  from _merge m where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.person_recruiting x where x.person_id = m.keep_id);

update greendogops.sched_employee_setting t set person_id = m.keep_id
  from _merge m where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.sched_employee_setting x where x.person_id = m.keep_id);

-- Role membership: skip rows that would collide with one the keeper already has.
update greendogops.sched_role_member t set person_id = m.keep_id
  from _merge m where t.person_id = m.dup_id
   and not exists (
     select 1 from greendogops.sched_role_member x
      where x.person_id = m.keep_id and x.role_id = t.role_id
   );

-- Multi-row children: move everything.
update greendogops.sched_assignment       t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.profile_transition_log t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_document        t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_interview       t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_review          t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_license         t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_asset           t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_time_off        t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_pto_day         t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_compliance_entry     t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_disciplinary_action  t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;
update greendogops.person_onboarding_item      t set person_id = m.keep_id from _merge m where t.person_id = m.dup_id;

-- Login links and CRM promotion links follow the keeper.
update greendogops.app_user u set person_id = m.keep_id
  from _merge m where u.person_id = m.dup_id
   and not exists (select 1 from greendogops.app_user x where x.person_id = m.keep_id);
update greendogops.crm_contact c set promoted_person_id = m.keep_id
  from _merge m where c.promoted_person_id = m.dup_id;

delete from greendogops.person p using _merge m where p.id = m.dup_id;

-- ---------------------------------------------------------------------------
-- Schedule-sheet spellings that differ from full_name
-- ---------------------------------------------------------------------------
update greendogops.person set grid_name = 'Lizbeth Martinez', updated_at = now()
 where full_name = 'Lizbeth Gallegos' and status = 'employee';

update greendogops.person set grid_name = 'Tay Fox', updated_at = now()
 where full_name = 'Taylor Fox' and status = 'employee';

commit;
