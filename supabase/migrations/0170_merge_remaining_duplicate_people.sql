-- ============================================================================
-- 0170 — Merge the remaining duplicate person rows
--
-- 24 groups / 51 rows shared a name. Two are a live row plus a stale 'former'
-- row (Ashley Paredes, Jisun Choi — rehires); the rest are ATS intake creating
-- a second applicant row for someone already captured.
--
-- Keeper precedence: employee > contractor > former > applicant > prospect,
-- then a row WITH an email, then a non-Indeed-proxy address, then oldest.
--
-- SAFETY GUARD: two rows only merge when their emails agree case-insensitively,
-- or one side is blank, or one side is an @indeedemail.com proxy. Two different
-- people who happen to share a name (and have different real addresses) are
-- therefore left alone.
--
-- 37 of the 40 duplicate person_recruiting rows carry notes and the `stage`
-- vocabulary is free text with ~30 variants, so nothing is silently dropped:
-- blank fields on the keeper are filled from the duplicate and the duplicate's
-- notes are appended rather than discarded.
-- ============================================================================

begin;

create temp table _dupmerge(keep_id uuid, dup_id uuid) on commit drop;

with norm as (
  select p.id, p.status, p.created_at,
         nullif(btrim(lower(coalesce(p.email, ''))), '') as em,
         lower(regexp_replace(regexp_replace(coalesce(p.full_name, ''), '[^A-Za-z ]', '', 'g'),
                              '\s+', ' ', 'g')) as k
  from greendogops.person p
),
ranked as (
  select n.*,
         row_number() over (
           partition by n.k
           order by case n.status
                      when 'employee'   then 0
                      when 'contractor' then 1
                      when 'former'     then 2
                      when 'applicant'  then 3
                      else 4
                    end,
                    (n.em is null),                     -- rows with an email first
                    (n.em like '%@indeedemail.com'),    -- prefer a real address
                    n.created_at,
                    n.id
         ) as rn
  from norm n
  where n.k <> ''
)
insert into _dupmerge (keep_id, dup_id)
select k.id, d.id
from ranked k
join ranked d
  on d.k = k.k
 and k.rn = 1
 and d.rn > 1
 and (
      d.em is null
   or k.em is null
   or d.em = k.em
   or d.em like '%@indeedemail.com'
   or k.em like '%@indeedemail.com'
 );

-- Fill contact gaps on the keeper, and keep a trace of the merge.
update greendogops.person k
   set email        = coalesce(nullif(btrim(k.email), ''), d.email),
       phone_mobile = coalesce(nullif(btrim(k.phone_mobile), ''), d.phone_mobile),
       phone_home   = coalesce(nullif(btrim(k.phone_home), ''), d.phone_home),
       phone_other  = coalesce(nullif(btrim(k.phone_other), ''), d.phone_other),
       date_of_birth = coalesce(k.date_of_birth, d.date_of_birth),
       postal_code  = coalesce(nullif(btrim(k.postal_code), ''), d.postal_code),
       preferred_name = coalesce(nullif(btrim(k.preferred_name), ''), d.preferred_name),
       grid_name    = coalesce(nullif(btrim(k.grid_name), ''), d.grid_name),
       source_contact_id = coalesce(k.source_contact_id, d.source_contact_id),
       notes = nullif(trim(both E'\n' from
                 coalesce(k.notes, '')
                 || case when coalesce(nullif(btrim(d.notes), ''), '') <> ''
                          and coalesce(k.notes, '') is distinct from d.notes
                         then E'\n\n' || d.notes else '' end
                 || case when d.email is not null
                          and lower(btrim(d.email)) is distinct from lower(btrim(coalesce(k.email, '')))
                         then E'\n\nMerged duplicate record (' || to_char(now(), 'YYYY-MM-DD')
                              || '), alternate email: ' || d.email
                         else '' end), ''),
       updated_at = now()
  from _dupmerge m
  join greendogops.person d on d.id = m.dup_id
 where k.id = m.keep_id;

-- person_recruiting is 1:1. Move it when the keeper has none, otherwise fill the
-- keeper's blanks from the duplicate and append its notes.
update greendogops.person_recruiting t set person_id = m.keep_id
  from _dupmerge m
 where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.person_recruiting x where x.person_id = m.keep_id);

update greendogops.person_recruiting k
   set target_position_id = coalesce(k.target_position_id, d.target_position_id),
       target_title  = coalesce(nullif(btrim(k.target_title), ''), d.target_title),
       pipeline      = coalesce(nullif(btrim(k.pipeline), ''), d.pipeline),
       stage         = coalesce(nullif(btrim(k.stage), ''), d.stage),
       source        = coalesce(nullif(btrim(k.source), ''), d.source),
       resume_url    = coalesce(nullif(btrim(k.resume_url), ''), d.resume_url),
       interview_date = coalesce(k.interview_date, d.interview_date),
       application_date = coalesce(k.application_date, d.application_date),
       follow_up_date = coalesce(k.follow_up_date, d.follow_up_date),
       score         = coalesce(k.score, d.score),
       notes = nullif(trim(both E'\n' from
                 coalesce(k.notes, '')
                 || case when coalesce(nullif(btrim(d.notes), ''), '') <> ''
                          and coalesce(k.notes, '') is distinct from d.notes
                         then E'\n\n' || d.notes else '' end), ''),
       status_notes = nullif(trim(both E'\n' from
                 coalesce(k.status_notes, '')
                 || case when coalesce(nullif(btrim(d.status_notes), ''), '') <> ''
                          and coalesce(k.status_notes, '') is distinct from d.status_notes
                         then E'\n\n' || d.status_notes else '' end), ''),
       updated_at = now()
  from _dupmerge m
  join greendogops.person_recruiting d on d.person_id = m.dup_id
 where k.person_id = m.keep_id;

update greendogops.person_employment t set person_id = m.keep_id
  from _dupmerge m
 where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.person_employment x where x.person_id = m.keep_id);

update greendogops.sched_employee_setting t set person_id = m.keep_id
  from _dupmerge m
 where t.person_id = m.dup_id
   and not exists (select 1 from greendogops.sched_employee_setting x where x.person_id = m.keep_id);

update greendogops.sched_role_member t set person_id = m.keep_id
  from _dupmerge m
 where t.person_id = m.dup_id
   and not exists (
     select 1 from greendogops.sched_role_member x
      where x.person_id = m.keep_id and x.role_id = t.role_id
   );

-- Multi-row children move wholesale.
update greendogops.sched_assignment       t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.profile_transition_log t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_document        t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_interview       t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_review          t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_license         t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_asset           t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_time_off        t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_pto_day         t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_compliance_entry    t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_disciplinary_action t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;
update greendogops.person_onboarding_item     t set person_id = m.keep_id from _dupmerge m where t.person_id = m.dup_id;

update greendogops.app_user u set person_id = m.keep_id
  from _dupmerge m
 where u.person_id = m.dup_id
   and not exists (select 1 from greendogops.app_user x where x.person_id = m.keep_id);
update greendogops.crm_contact c set promoted_person_id = m.keep_id
  from _dupmerge m where c.promoted_person_id = m.dup_id;

delete from greendogops.person p using _dupmerge m where p.id = m.dup_id;

commit;
