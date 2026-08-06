-- ============================================================================
-- Green Dog Ops — 0156 Medical Boards: prefill from Animals + Contacts
-- ----------------------------------------------------------------------------
-- The Agenda says WHO is coming and WHEN, but carries almost nothing about the
-- patient. The nightly "Animals" report (ezyvet_animal, 0154) holds the full
-- patient roster — species, breed, sex, age, weight, caution status, master
-- problems, insurance, last visit — and "Contacts" (ezyvet_contact) holds the
-- owner's contact details and preferred contact method.
--
-- The Agenda's raw CSV row carries "Pet Code", which is ezyvet_animal.animal_code
-- (verified: 45/45 appointments matched on a sample day). Joining the three gives
-- a board that is almost entirely pre-filled before the day starts.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.medical_board_row
  add column if not exists patient_code    text,
  add column if not exists species         text,
  add column if not exists breed           text,
  add column if not exists sex             text,
  add column if not exists age             text,
  add column if not exists owner_phone     text,
  add column if not exists owner_email     text,
  add column if not exists owner_contact_method text,
  add column if not exists cautions        text,
  add column if not exists master_problems text,
  add column if not exists insurance       text,
  add column if not exists last_visit      date;

-- ---------------------------------------------------------------------------
-- Display helpers — condense ezyVet's verbose values into the shorthand the
-- boards are written in ("Canine (dog)" -> K9, "Male Neutered" -> MN).
-- ---------------------------------------------------------------------------
create or replace function greendogops.med_species_short(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    when p ilike '%canine%' or p ilike '%dog%'    then 'K9'
    when p ilike '%feline%' or p ilike '%cat%'    then 'Feline'
    when p ilike '%avian%'  or p ilike '%bird%'   then 'Avian'
    when p ilike '%rabbit%'                       then 'Rabbit'
    when p ilike '%reptile%'                      then 'Reptile'
    else split_part(p, ' (', 1)
  end;
$$;

create or replace function greendogops.med_sex_short(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    when p ilike 'male neutered%'  or p ilike 'mn%' then 'MN'
    when p ilike 'female spayed%'  or p ilike 'fs%' then 'FS'
    when p ilike 'male%'                            then 'M'
    when p ilike 'female%'                          then 'F'
    else p
  end;
$$;

-- "13yrs, 9mnths" -> "13Y"; "8mnths" -> "8M"
create or replace function greendogops.med_age_short(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '(\d+)\s*yr'  then (regexp_match(p, '(\d+)\s*yr'))[1]  || 'Y'
    when p ~ '(\d+)\s*mnth' then (regexp_match(p, '(\d+)\s*mnth'))[1] || 'M'
    when p ~ '(\d+)\s*wk'   then (regexp_match(p, '(\d+)\s*wk'))[1]   || 'W'
    else p
  end;
$$;

-- ---------------------------------------------------------------------------
-- medical_board_seed : now joins the patient roster and owner contact.
-- Still insert-only, so re-running never disturbs anything the team has typed.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_seed(
  p_location   uuid,
  p_date       date,
  p_board_type text
)
returns integer
language plpgsql
volatile
security definer
set search_path = greendogops, public
as $$
declare
  v_dept_code text;
  v_dept      uuid;
  v_snapshot  date;
  v_inserted  integer := 0;
  v_is_card   boolean := p_board_type in ('ap','surgery');
begin
  v_dept_code := case p_board_type
                   when 'ap'      then 'AP'
                   when 'clinic'  then 'NAD'
                   when 'exotics' then 'EXO'
                   when 'im'      then 'IM'
                   when 'surgery' then 'SURG'
                 end;
  if v_dept_code is null then
    raise exception 'Unknown board type: %', p_board_type;
  end if;

  select id into v_dept
  from greendogops.sched_department
  where code = v_dept_code
  limit 1;
  if v_dept is null then
    return 0;
  end if;

  select max(snapshot_date) into v_snapshot
  from greendogops.ezyvet_agenda_appt_snapshot
  where location_id = p_location
    and appt_date = p_date
    and department_id = v_dept;
  if v_snapshot is null then
    return 0;
  end if;

  with src as (
    select s.*,
           nullif(btrim(s.details->>'Pet Code'), '') as pet_code,
           a.animal_name, a.species, a.breed, a.sex, a.age, a.weight_lb,
           a.caution_status, a.master_problems, a.insurance_supplier,
           a.last_visit, a.owner_last_name, a.owner_full_name,
           coalesce(nullif(a.mobile,''), nullif(a.phone,'')) as owner_phone,
           coalesce(nullif(a.email,''), nullif(a.home_email,'')) as owner_email,
           c.preferred_contact_method
    from greendogops.ezyvet_agenda_appt_snapshot s
    left join greendogops.ezyvet_animal a
      on a.animal_code = nullif(btrim(s.details->>'Pet Code'), '')
    left join greendogops.ezyvet_contact c
      on c.contact_code = a.owner_contact_code
    where s.location_id = p_location
      and s.appt_date = p_date
      and s.department_id = v_dept
      and s.snapshot_date = v_snapshot
  ),
  prepared as (
    select src.*,
           coalesce(nullif(btrim(src.patient_name), ''),
                    nullif(btrim(src.details->>'Pet Name'), ''),
                    src.animal_name) as patient_final,
           case when src.weight_lb is not null
                then to_char(round(src.weight_lb / 2.20462, 1), 'FM999990.0')
           end as weight_kg_final,
           -- Alerts the floor must see: caution status plus flagged problems.
           nullif(concat_ws(' · ',
             nullif(src.caution_status, ''),
             nullif(src.master_problems, '')), '') as alerts_final
    from src
  ),
  inserted as (
    insert into greendogops.medical_board_row (
      location_id, board_date, board_type, appt_key, source,
      sort_order, appt_time, patient, client_name, appt_type, appt_description,
      patient_code, species, breed, sex, age, weight_kg,
      owner_phone, owner_email, owner_contact_method,
      cautions, master_problems, insurance, last_visit, medical_hx, card
    )
    select p.location_id,
           p.appt_date,
           p_board_type,
           p.appt_key,
           'agenda',
           row_number() over (order by p.appt_time nulls last, p.patient_final) * 10,
           p.appt_time,
           p.patient_final,
           p.client_name,
           p.appt_type,
           nullif(btrim(p.details->>'Description'), ''),
           p.pet_code,
           p.species,
           p.breed,
           greendogops.med_sex_short(p.sex),
           greendogops.med_age_short(p.age),
           p.weight_kg_final,
           p.owner_phone,
           p.owner_email,
           p.preferred_contact_method,
           p.caution_status,
           p.master_problems,
           p.insurance_supplier,
           p.last_visit,
           p.alerts_final,
           case when v_is_card then
             jsonb_strip_nulls(jsonb_build_object(
               'signalment', nullif(concat_ws(', ',
                  nullif(concat_ws(' ',
                    '"' || coalesce(p.patient_final, '?') || '"',
                    nullif(p.owner_last_name, '')), ''),
                  greendogops.med_species_short(p.species),
                  greendogops.med_age_short(p.age),
                  greendogops.med_sex_short(p.sex),
                  nullif(p.breed, '')), ''),
               'weight_kg', p.weight_kg_final,
               'alerts', p.alerts_final
             ))
           else '{}'::jsonb end
    from prepared p
    on conflict (location_id, board_date, board_type, appt_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

grant execute on function greendogops.medical_board_seed(uuid, date, text)
  to authenticated, service_role;
