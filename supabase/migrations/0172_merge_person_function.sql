-- ============================================================================
-- 0172 — greendogops.merge_person(), and merge "Dr. Leonard Yee" / "Leonard Yee"
--
-- Third time writing this by hand (0066, 0168, 0170), so the child-row
-- repointing becomes a function. Callers pass the keeper and the duplicate;
-- the duplicate's data is folded in and the row is deleted.
--
-- The remaining duplicate only differed by the "Dr." honorific, which the
-- name key used in 0170 kept, so the pair was never grouped.
-- ============================================================================

create or replace function greendogops.merge_person(p_keep uuid, p_dup uuid)
returns void
language plpgsql
security definer
set search_path = greendogops, pg_catalog
as $$
begin
  if p_keep is null or p_dup is null or p_keep = p_dup then
    return;
  end if;

  -- Fill contact gaps on the keeper; never overwrite a value it already has.
  update greendogops.person k
     set email         = coalesce(nullif(btrim(k.email), ''), d.email),
         phone_mobile  = coalesce(nullif(btrim(k.phone_mobile), ''), d.phone_mobile),
         phone_home    = coalesce(nullif(btrim(k.phone_home), ''), d.phone_home),
         phone_other   = coalesce(nullif(btrim(k.phone_other), ''), d.phone_other),
         date_of_birth = coalesce(k.date_of_birth, d.date_of_birth),
         postal_code   = coalesce(nullif(btrim(k.postal_code), ''), d.postal_code),
         preferred_name = coalesce(nullif(btrim(k.preferred_name), ''), d.preferred_name),
         grid_name     = coalesce(nullif(btrim(k.grid_name), ''), d.grid_name),
         source_contact_id = coalesce(k.source_contact_id, d.source_contact_id),
         notes = nullif(trim(both E'\n' from
                   coalesce(k.notes, '')
                   || case when coalesce(nullif(btrim(d.notes), ''), '') <> ''
                            and coalesce(k.notes, '') is distinct from d.notes
                           then E'\n\n' || d.notes else '' end), ''),
         updated_at = now()
    from greendogops.person d
   where k.id = p_keep and d.id = p_dup;

  -- 1:1 children move only when the keeper has none.
  update greendogops.person_recruiting t set person_id = p_keep
   where t.person_id = p_dup
     and not exists (select 1 from greendogops.person_recruiting x where x.person_id = p_keep);
  update greendogops.person_employment t set person_id = p_keep
   where t.person_id = p_dup
     and not exists (select 1 from greendogops.person_employment x where x.person_id = p_keep);
  update greendogops.sched_employee_setting t set person_id = p_keep
   where t.person_id = p_dup
     and not exists (select 1 from greendogops.sched_employee_setting x where x.person_id = p_keep);
  update greendogops.sched_role_member t set person_id = p_keep
   where t.person_id = p_dup
     and not exists (
       select 1 from greendogops.sched_role_member x
        where x.person_id = p_keep and x.role_id = t.role_id
     );

  update greendogops.sched_assignment       set person_id = p_keep where person_id = p_dup;
  update greendogops.profile_transition_log set person_id = p_keep where person_id = p_dup;
  update greendogops.person_document        set person_id = p_keep where person_id = p_dup;
  update greendogops.person_interview       set person_id = p_keep where person_id = p_dup;
  update greendogops.person_review          set person_id = p_keep where person_id = p_dup;
  update greendogops.person_license         set person_id = p_keep where person_id = p_dup;
  update greendogops.person_asset           set person_id = p_keep where person_id = p_dup;
  update greendogops.person_time_off        set person_id = p_keep where person_id = p_dup;
  update greendogops.person_pto_day         set person_id = p_keep where person_id = p_dup;
  update greendogops.person_compliance_entry    set person_id = p_keep where person_id = p_dup;
  update greendogops.person_disciplinary_action set person_id = p_keep where person_id = p_dup;
  update greendogops.person_onboarding_item     set person_id = p_keep where person_id = p_dup;

  update greendogops.app_user set person_id = p_keep
   where person_id = p_dup
     and not exists (select 1 from greendogops.app_user x where x.person_id = p_keep);
  update greendogops.crm_contact set promoted_person_id = p_keep where promoted_person_id = p_dup;

  delete from greendogops.person where id = p_dup;
end;
$$;

comment on function greendogops.merge_person(uuid, uuid) is
  'Folds the duplicate person row into the keeper (contact gaps, 1:1 children when absent, all multi-row children) and deletes it. Confirm the pair before calling — this is not reversible.';

revoke all on function greendogops.merge_person(uuid, uuid) from public;
grant execute on function greendogops.merge_person(uuid, uuid) to service_role;

-- Same name once the honorific is dropped, and one side has no email.
do $$
declare
  v_keep uuid;
  v_dup  uuid;
begin
  select id into v_keep from greendogops.person
   where full_name = 'Dr. Leonard Yee' and status = 'applicant' limit 1;
  select id into v_dup  from greendogops.person
   where full_name = 'Leonard Yee' and status = 'applicant'
     and coalesce(btrim(email), '') = '' limit 1;
  if v_keep is not null and v_dup is not null then
    perform greendogops.merge_person(v_keep, v_dup);
  end if;
end $$;
