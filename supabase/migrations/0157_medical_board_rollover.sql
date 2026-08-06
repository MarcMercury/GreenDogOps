-- ============================================================================
-- Green Dog Ops — 0157 Medical Boards: daily rollover + archive
-- ----------------------------------------------------------------------------
-- Each morning, after the ezyVet reports have run (the agent finishes ~5:30 PT),
-- yesterday's boards are FROZEN and today's boards are built from the fresh
-- Agenda + Animals + Contacts data, so the team walks in to a ready board.
--
-- medical_board_day is the per-board header: it records that a board exists for
-- a (location, date, type) and whether it is still open or archived. A trigger
-- enforces the freeze at the database level, so an archived board cannot be
-- changed by any code path — that is what makes the Board Archive trustworthy.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.medical_board_day (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references greendogops.location (id) on delete cascade,
  board_date   date not null,
  board_type   text not null check (board_type in ('ap','clinic','exotics','im','surgery')),
  status       text not null default 'open' check (status in ('open','archived')),
  seeded_count integer not null default 0,
  archived_at  timestamptz,
  archived_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (location_id, board_date, board_type)
);

create index if not exists medical_board_day_lookup_idx
  on greendogops.medical_board_day (board_date, location_id, board_type);
create index if not exists medical_board_day_status_idx
  on greendogops.medical_board_day (status, board_date);

drop trigger if exists set_updated_at on greendogops.medical_board_day;
create trigger set_updated_at before update on greendogops.medical_board_day
  for each row execute function greendogops.set_updated_at();

-- Backfill headers for boards that already exist.
insert into greendogops.medical_board_day (location_id, board_date, board_type, seeded_count)
select location_id, board_date, board_type, count(*)
from greendogops.medical_board_row
group by location_id, board_date, board_type
on conflict (location_id, board_date, board_type) do nothing;

-- ---------------------------------------------------------------------------
-- Freeze guard: once a day is archived its rows are immutable.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_row_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_loc    uuid;
  v_date   date;
  v_type   text;
begin
  if tg_op = 'DELETE' then
    v_loc := old.location_id; v_date := old.board_date; v_type := old.board_type;
  else
    v_loc := new.location_id; v_date := new.board_date; v_type := new.board_type;
  end if;

  select status into v_status
  from greendogops.medical_board_day
  where location_id = v_loc and board_date = v_date and board_type = v_type;

  if v_status = 'archived' then
    raise exception 'This board was archived on % and is read-only.', v_date
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_archived on greendogops.medical_board_row;
create trigger guard_archived
  before insert or update or delete on greendogops.medical_board_row
  for each row execute function greendogops.medical_board_row_guard();

-- ---------------------------------------------------------------------------
-- medical_board_seed : also registers/updates the day header, and refuses to
-- add appointments to a board that has already been archived.
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

  -- Never reopen or add to an archived board.
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
-- medical_board_rollover(p_today) : the daily job.
--   1. archive every open board before today (they are done — freeze them)
--   2. build today's boards for every active clinic x every board type
-- Idempotent: seeding is insert-only and archiving skips already-archived days,
-- so running it twice (or re-running after a failure) is safe.
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
  r_loc      record;
  r_type     text;
  v_n        integer;
begin
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
    foreach r_type in array array['ap','clinic','exotics','im','surgery'] loop
      v_n := greendogops.medical_board_seed(r_loc.id, v_today, r_type);
      v_seeded := v_seeded + v_n;
      v_boards := v_boards + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'date', v_today,
    'archived_boards', v_archived,
    'boards_built', v_boards,
    'patients_added', v_seeded
  );
end;
$$;

grant execute on function greendogops.medical_board_rollover(date)
  to authenticated, service_role;
