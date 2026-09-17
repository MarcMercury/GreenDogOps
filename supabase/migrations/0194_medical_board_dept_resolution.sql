-- 0194_medical_board_dept_resolution.sql
--
-- BUG: the AP board (and any other board whose sched_department row lost its
-- `code`) seeded ZERO patients while the Agenda clearly had appointments.
--
-- Root cause: medical_board_seed resolves a board to a department with
-- `where sched_department.code = <board_type.dept_code>`. The live "AP"
-- department row has code = NULL (it was re-created at some point; the original
-- coded 'VET-AP' row from 0015 is orphaned with 0 appointments). So the lookup
-- returned no department and the seed bailed out with `return 0` — silently,
-- on every run, for ~9.4k appointments. medical_board_register_missing_types()
-- could not self-heal it either because it filters `where d.code is not null`.
--
-- Fix, in three layers:
--   1. Departments are now resolved by an EFFECTIVE code = code, or the
--      normalized name when code is null. One helper, used by seed + coverage +
--      register, so all three agree on which appointments belong to which board.
--   2. Backfill sched_department.code for every department that actually
--      carries Agenda appointments, and add a unique index so two departments
--      can never share a code.
--   3. Re-seed every board that is still open.

begin;

-- ---------------------------------------------------------------------------
-- 1. Effective department code
-- ---------------------------------------------------------------------------

create or replace function greendogops.med_dept_code(p_name text, p_code text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(p_code), ''),
    nullif(left(upper(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '', 'g')), 16), '')
  );
$$;

comment on function greendogops.med_dept_code(text, text) is
  'Stable code a department is matched by. Falls back to the normalized name so a department with a NULL code still routes its appointments to a board.';

-- ---------------------------------------------------------------------------
-- 2. Backfill codes for departments that carry Agenda appointments
-- ---------------------------------------------------------------------------

update greendogops.sched_department d
   set code = greendogops.med_dept_code(d.name, null)
 where d.code is null
   and exists (
     select 1 from greendogops.ezyvet_agenda_appt_snapshot s
     where s.department_id = d.id
   )
   and greendogops.med_dept_code(d.name, null) is not null
   and not exists (
     select 1 from greendogops.sched_department o
     where o.id <> d.id
       and upper(o.code) = greendogops.med_dept_code(d.name, null)
   );

create unique index if not exists sched_department_code_uniq
  on greendogops.sched_department (upper(code))
  where code is not null;

-- ---------------------------------------------------------------------------
-- 3. Seed: resolve ALL departments matching the board's dept_code
-- ---------------------------------------------------------------------------

create or replace function greendogops.medical_board_seed(
  p_location uuid,
  p_date date,
  p_board_type text
) returns integer
language plpgsql
security definer
set search_path = greendogops, public
as $$
declare
  v_dept_code text;
  v_depts     uuid[];
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

  -- Match on the EFFECTIVE code and allow more than one department row: a
  -- renamed/duplicated department must not drop a whole day of appointments.
  select array_agg(d.id) into v_depts
  from greendogops.sched_department d
  where upper(greendogops.med_dept_code(d.name, d.code)) = upper(v_dept_code);

  if v_depts is null then
    return 0;
  end if;

  insert into greendogops.medical_board_day (location_id, board_date, board_type)
  values (p_location, p_date, p_board_type)
  on conflict (location_id, board_date, board_type) do nothing;

  select max(snapshot_date) into v_snapshot
  from greendogops.ezyvet_agenda_appt_snapshot
  where location_id = p_location
    and appt_date = p_date
    and department_id = any(v_depts);
  if v_snapshot is null then
    return 0;
  end if;

  with src as (
    select distinct on (s.appt_key)
           s.*,
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
      and s.department_id = any(v_depts)
      and s.snapshot_date = v_snapshot
    order by s.appt_key, s.captured_at desc
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

-- ---------------------------------------------------------------------------
-- 4. Self-heal: give a code to any department that books appointments, then
--    register a board type for it.
-- ---------------------------------------------------------------------------

create or replace function greendogops.medical_board_register_missing_types()
returns integer
language plpgsql
security definer
set search_path = greendogops, public
as $$
declare
  v_added integer := 0;
begin
  -- A department that takes bookings must have a stable code, otherwise every
  -- board lookup for it fails silently (this is what happened to AP).
  update greendogops.sched_department d
     set code = greendogops.med_dept_code(d.name, null)
   where d.code is null
     and greendogops.med_dept_code(d.name, null) is not null
     and exists (
       select 1 from greendogops.ezyvet_agenda_appt_snapshot s
       where s.department_id = d.id and s.appt_date >= current_date - 30
     )
     and not exists (
       select 1 from greendogops.sched_department o
       where o.id <> d.id
         and upper(o.code) = greendogops.med_dept_code(d.name, null)
     );

  with booked_depts as (
    select distinct greendogops.med_dept_code(d.name, d.code) as code, d.name
    from greendogops.ezyvet_agenda_appt_snapshot s
    join greendogops.sched_department d on d.id = s.department_id
    where s.appt_date >= current_date - 30
  ),
  missing as (
    select b.code, min(b.name) as name
    from booked_depts b
    where b.code is not null
      and not exists (
        select 1 from greendogops.medical_board_type t
        where upper(t.dept_code) = upper(b.code)
      )
    group by b.code
  ),
  added as (
    insert into greendogops.medical_board_type
      (key, label, dept_code, layout, sort_order, auto_created)
    select lower(regexp_replace(m.code, '[^a-zA-Z0-9]+', '_', 'g')),
           initcap(m.name) || ' Board',
           m.code,
           'grid',
           500,
           true
    from missing m
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from added;
  return v_added;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Coverage uses the same effective code so the reconciliation banner is real
-- ---------------------------------------------------------------------------

create or replace function greendogops.medical_board_coverage(p_date date)
returns table (
  location_id  uuid,
  location_name text,
  dept_code    text,
  dept_name    text,
  board_type   text,
  board_label  text,
  appointments bigint,
  on_board     bigint
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with latest as (
    select location_id, department_id, max(snapshot_date) as sd
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date = p_date
    group by location_id, department_id
  ),
  booked as (
    select s.location_id, s.department_id, count(*) as appointments
    from greendogops.ezyvet_agenda_appt_snapshot s
    join latest x
      on x.location_id = s.location_id
     and x.department_id = s.department_id
     and x.sd = s.snapshot_date
    where s.appt_date = p_date
    group by s.location_id, s.department_id
  )
  select b.location_id,
         l.name,
         greendogops.med_dept_code(d.name, d.code),
         d.name,
         t.key,
         t.label,
         b.appointments,
         coalesce((
           select count(*) from greendogops.medical_board_row r
           where r.location_id = b.location_id
             and r.board_date = p_date
             and r.board_type = t.key
         ), 0) as on_board
  from booked b
  join greendogops.location l on l.id = b.location_id
  join greendogops.sched_department d on d.id = b.department_id
  left join greendogops.medical_board_type t
    on upper(t.dept_code) = upper(greendogops.med_dept_code(d.name, d.code))
   and t.is_active
  order by l.name, 3;
$$;

-- ---------------------------------------------------------------------------
-- 6. Re-seed every board that is still open (archived days stay frozen)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  perform greendogops.medical_board_register_missing_types();

  for r in
    select distinct d.location_id, d.board_date, t.key
    from greendogops.medical_board_day d
    cross join greendogops.medical_board_type t
    where d.status = 'open'
      and t.is_active
  loop
    perform greendogops.medical_board_seed(r.location_id, r.board_date, r.key);
  end loop;
end $$;

commit;
