-- ============================================================================
-- Green Dog Ops — 0158 Medical Boards: department coverage
-- ----------------------------------------------------------------------------
-- The board types were hard-coded as five values, but the Agenda routes
-- appointments to SEVEN departments. CARDIO and MPMV appointments were landing
-- on no board at all and disappearing silently (36 of them in August alone).
--
-- Board types now live in a catalog keyed to the schedule department code, and
-- the daily rollover AUTO-REGISTERS a board for any department that has
-- appointments but no board yet. A new department can therefore never again
-- cause appointments to vanish. medical_board_coverage() reports any appointment
-- that is not on a board so the gap is visible rather than silent.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.medical_board_type (
  key          text primary key,
  label        text not null,
  dept_code    text not null unique,
  layout       text not null default 'grid' check (layout in ('grid','card')),
  icon         text not null default '🩺',
  accent       text not null default '#0d9488',
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  auto_created boolean not null default false,
  created_at   timestamptz not null default now()
);

insert into greendogops.medical_board_type
  (key, label, dept_code, layout, icon, accent, sort_order)
values
  ('ap',      'AP Board',      'AP',   'card', '🩺', '#0d9488', 10),
  ('clinic',  'Clinic Board',  'NAD',  'grid', '🏥', '#2563eb', 20),
  ('exotics', 'Exotics Board', 'EXO',  'grid', '🦎', '#16a34a', 30),
  ('im',      'IM Board',      'IM',   'grid', '🔬', '#7c3aed', 40),
  ('surgery', 'Surgery Board', 'SURG', 'card', '🔪', '#e11d48', 50),
  ('cardio',  'Cardio Board',  'CARD', 'grid', '❤️', '#db2777', 60),
  ('mpmv',    'MPMV Board',    'MPMV', 'grid', '🚐', '#ea580c', 70)
on conflict (key) do nothing;

-- Replace the fixed CHECK lists with a reference to the catalog.
alter table greendogops.medical_board_row
  drop constraint if exists medical_board_row_board_type_check;
alter table greendogops.medical_board_day
  drop constraint if exists medical_board_day_board_type_check;

-- ---------------------------------------------------------------------------
-- medical_board_seed : department now resolved through the catalog.
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
           a.animal_name, a.species, a.breed, a.sex, a.age, a.weight_lb,
           a.caution_status, a.master_problems, a.insurance_supplier,
           a.last_visit, a.owner_last_name,
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
    select p.location_id, p.appt_date, p_board_type, p.appt_key, 'agenda',
           row_number() over (order by p.appt_time nulls last, p.patient_final) * 10,
           p.appt_time, p.patient_final, p.client_name, p.appt_type,
           nullif(btrim(p.details->>'Description'), ''),
           p.pet_code, p.species, p.breed,
           greendogops.med_sex_short(p.sex),
           greendogops.med_age_short(p.age),
           p.weight_kg_final,
           p.owner_phone, p.owner_email, p.preferred_contact_method,
           p.caution_status, p.master_problems, p.insurance_supplier,
           p.last_visit, p.alerts_final,
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

-- ---------------------------------------------------------------------------
-- medical_board_register_missing_types() : any department that has Agenda
-- appointments but no board type gets one, so appointments can never be
-- silently dropped because a new service was added in ezyVet.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_register_missing_types()
returns integer
language plpgsql
volatile
security definer
set search_path = greendogops, public
as $$
declare
  v_added integer := 0;
begin
  with missing as (
    select distinct d.code, d.name
    from greendogops.ezyvet_agenda_appt_snapshot s
    join greendogops.sched_department d on d.id = s.department_id
    where d.code is not null
      and s.appt_date >= current_date - 30
      and not exists (
        select 1 from greendogops.medical_board_type t where t.dept_code = d.code
      )
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

grant execute on function greendogops.medical_board_register_missing_types()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- medical_board_coverage(date) : reconciles the Agenda against the boards for
-- one day. Every (location, department) the Agenda routed appointments to is
-- listed with how many are booked and how many reached a board, so a shortfall
-- is visible on screen instead of being discovered weeks later.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_coverage(
  p_date date
)
returns table (
  location_id   uuid,
  location_name text,
  dept_code     text,
  dept_name     text,
  board_type    text,
  board_label   text,
  appointments  bigint,
  on_board      bigint
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
         d.code,
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
    on t.dept_code = d.code and t.is_active
  order by l.name, d.code;
$$;

grant execute on function greendogops.medical_board_coverage(date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- medical_board_rollover : registers any missing board type first, then builds
-- a board for EVERY active board type at every clinic.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_rollover(
  p_today date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = greendogops, public
as $$
declare
  v_today    date := coalesce(p_today, (now() at time zone 'America/Los_Angeles')::date);
  v_archived integer := 0;
  v_seeded   integer := 0;
  v_boards   integer := 0;
  v_new      integer := 0;
  v_uncov    integer := 0;
  r_loc      record;
  r_type     record;
  v_n        integer;
begin
  v_new := greendogops.medical_board_register_missing_types();

  with done as (
    update greendogops.medical_board_day
       set status = 'archived', archived_at = now(), archived_by = 'daily-rollover'
     where board_date < v_today
       and status = 'open'
    returning 1
  )
  select count(*) into v_archived from done;

  for r_loc in
    select id from greendogops.location
    where is_active and kind = 'clinic'
    order by sort_order, name
  loop
    for r_type in
      select key from greendogops.medical_board_type
      where is_active order by sort_order, key
    loop
      v_n := greendogops.medical_board_seed(r_loc.id, v_today, r_type.key);
      v_seeded := v_seeded + v_n;
      v_boards := v_boards + 1;
    end loop;
  end loop;

  select count(*) into v_uncov
  from greendogops.medical_board_coverage(v_today)
  where board_type is null;

  return jsonb_build_object(
    'ok', true,
    'date', v_today,
    'archived_boards', v_archived,
    'boards_built', v_boards,
    'patients_added', v_seeded,
    'board_types_registered', v_new,
    'uncovered_departments', v_uncov
  );
end;
$$;

grant execute on function greendogops.medical_board_rollover(date)
  to authenticated, service_role;
