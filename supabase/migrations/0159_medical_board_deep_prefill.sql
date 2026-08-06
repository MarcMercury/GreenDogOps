-- ============================================================================
-- Green Dog Ops — 0159 Medical Boards: deeper prefill
-- ----------------------------------------------------------------------------
-- Squeezing the rest of the available detail out of the three reports.
--
-- 1. The Agenda's Description is a structured booking template on AP (and some
--    Surgery) appointments:
--        7/27/26_LS
--        Initials LS            <- booking CSR
--        Dr: Vartanian          <- doctor
--        Credit: $88 (expire date): 9/27/26
--        BW: BW DONE            <- bloodwork state
--        Medical Hx/RX: HX ARRHYTHMIA and levothyroxine
--    Some clinics use a numbered variant ("2. DR:  HOH"), so the parsers accept
--    an optional "<n>." prefix and both ":" and "." separators.
--
-- 2. ezyvet_animal.caution_status is a clean 4-value field (Friendly / Caution /
--    Unfriendly / Unknown) that maps onto the board's FAS score. It is only a
--    starting point — FAS is assessed per visit — but it beats a blank column.
--
-- Everything here is a PREFILL on insert only; the team's edits always win.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- med_descr_field(description, label) : pull a labelled line out of the booking
-- template. Returns null when the label is absent, so nothing is invented.
-- ---------------------------------------------------------------------------
create or replace function greendogops.med_descr_field(p_text text, p_label text)
returns text language plpgsql immutable as $$
declare
  m text[];
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  m := regexp_match(
         replace(p_text, chr(13), ''),
         '(?:^|\n)[ \t]*(?:\d+[.)][ \t]*)?' || p_label || '[ \t]*[:.][ \t]*([^\n]*)',
         'i');
  if m is null then
    return null;
  end if;
  return nullif(btrim(m[1]), '');
end;
$$;

-- The booking CSR: "Initials LS" (no colon) or the numbered form's first line.
create or replace function greendogops.med_descr_initials(p_text text)
returns text language plpgsql immutable as $$
declare
  t text;
  m text[];
begin
  if p_text is null then return null; end if;
  t := replace(p_text, chr(13), '');
  m := regexp_match(t, '(?:^|\n)[ \t]*initials[ \t]*[:.]?[ \t]*([A-Za-z]{1,4})[ \t]*(?:\n|$)', 'i');
  if m is not null then return upper(btrim(m[1])); end if;
  m := regexp_match(t, '(?:^|\n)[ \t]*1[.)][ \t]*([A-Za-z]{2,4})[ \t]*(?:\n|$)');
  if m is not null then return upper(btrim(m[1])); end if;
  return null;
end;
$$;

-- Just the money out of "Credit: $88 (expire date): 9/27/26".
create or replace function greendogops.med_descr_credit(p_text text)
returns text language plpgsql immutable as $$
declare
  raw text;
  m   text[];
begin
  raw := greendogops.med_descr_field(p_text, 'credit');
  if raw is null then return null; end if;
  m := regexp_match(raw, '(\$[ ]?[0-9][0-9,.]*)');
  if m is not null then return replace(btrim(m[1]), ' ', ''); end if;
  return left(raw, 40);
end;
$$;

-- caution_status -> the board's FAS shorthand.
create or replace function greendogops.med_fas_from_caution(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    when p ilike 'friendly%'   then 'FAS 0-1 (GO)'
    when p ilike 'caution%'    then 'FAS 2-3 (CAUTION)'
    when p ilike 'unfriendly%' then 'FAS 4-5 (STOP)'
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- medical_board_seed : prefill the doctor, CSR, FAS, services, medical history,
-- bloodwork state and estimate wherever the reports actually carry them.
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
  v_is_card   boolean;
begin
  select t.dept_code, t.layout = 'card'
    into v_dept_code, v_is_card
  from greendogops.medical_board_type t
  where t.key = p_board_type and t.is_active;

  if v_dept_code is null then
    raise exception 'Unknown board type: %', p_board_type;
  end if;

  if exists (
    select 1 from greendogops.medical_board_day
    where location_id = p_location and board_date = p_date
      and board_type = p_board_type and status = 'archived'
  ) then
    return 0;
  end if;

  select id into v_dept
  from greendogops.sched_department
  where code = v_dept_code
  limit 1;
  if v_dept is null then
    return 0;
  end if;

  insert into greendogops.medical_board_day (location_id, board_date, board_type)
  values (p_location, p_date, p_board_type)
  on conflict (location_id, board_date, board_type) do nothing;

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
           replace(coalesce(s.details->>'Description',''), chr(13), '') as descr,
           a.animal_name, a.species, a.breed, a.sex, a.age, a.weight_lb,
           a.caution_status, a.master_problems, a.animal_notes,
           a.insurance_supplier, a.last_visit, a.owner_last_name,
           a.microchip_number, a.referring_vet, a.referring_clinic,
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
           nullif(concat_ws(' · ',
             nullif(src.caution_status, ''),
             nullif(src.master_problems, '')), '') as alerts_final,
           greendogops.med_descr_field(src.descr, 'dr')          as dr_final,
           greendogops.med_descr_initials(src.descr)             as csr_final,
           greendogops.med_descr_credit(src.descr)               as credit_final,
           greendogops.med_descr_field(src.descr, 'bw')          as bw_final,
           greendogops.med_descr_field(src.descr, 'medical\s*hx(?:/rx)?') as hx_final,
           greendogops.med_fas_from_caution(src.caution_status)  as fas_final
    from src
  ),
  inserted as (
    insert into greendogops.medical_board_row (
      location_id, board_date, board_type, appt_key, source,
      sort_order, appt_time, patient, client_name, appt_type, appt_description,
      patient_code, species, breed, sex, age, weight_kg,
      owner_phone, owner_email, owner_contact_method,
      cautions, master_problems, insurance, last_visit,
      medical_hx, services, dt, csr, fas_score, card
    )
    select p.location_id, p.appt_date, p_board_type, p.appt_key, 'agenda',
           row_number() over (order by p.appt_time nulls last, p.patient_final) * 10,
           p.appt_time, p.patient_final, p.client_name, p.appt_type, nullif(p.descr,''),
           p.pet_code, p.species, p.breed,
           greendogops.med_sex_short(p.sex),
           greendogops.med_age_short(p.age),
           p.weight_kg_final,
           p.owner_phone, p.owner_email, p.preferred_contact_method,
           p.caution_status, p.master_problems, p.insurance_supplier,
           p.last_visit,
           -- Booking-note history first (it is visit-specific), else the
           -- patient's standing problem list.
           coalesce(p.hx_final, p.alerts_final),
           p.appt_type,
           p.dr_final,
           p.csr_final,
           p.fas_final,
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
               'alerts', p.alerts_final,
               'bw_type', p.bw_final,
               'bw_done', case when p.bw_final ilike '%done%' then true else null end,
               'fields', jsonb_strip_nulls(jsonb_build_object(
                  'estimate', p.credit_final,
                  'surgeon',  p.dr_final
               )),
               'notes', jsonb_strip_nulls(jsonb_build_object(
                  'doctor_notes', p.hx_final
               ))
             ))
           else '{}'::jsonb end
    from prepared p
    on conflict (location_id, board_date, board_type, appt_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  update greendogops.medical_board_day d
     set seeded_count = (
           select count(*) from greendogops.medical_board_row r
           where r.location_id = p_location and r.board_date = p_date
             and r.board_type = p_board_type)
   where d.location_id = p_location and d.board_date = p_date
     and d.board_type = p_board_type;

  return v_inserted;
end;
$$;

grant execute on function greendogops.medical_board_seed(uuid, date, text)
  to authenticated, service_role;
