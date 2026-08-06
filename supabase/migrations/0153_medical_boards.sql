-- ============================================================================
-- Green Dog Ops — 0153 Med Ops: Medical Boards
-- ----------------------------------------------------------------------------
-- A "medical board" is the daily, per-location, per-department workflow view the
-- floor team uses to track every patient through the day (replacing the Google
-- Sheets "CLINIC BOARD" workbooks — one sheet per day, one row per appointment).
--
-- Rows are SEEDED from the ezyVet Agenda (ezyvet_agenda_appt_snapshot, the same
-- feed that powers the appointment-demand overlay) and then edited live by the
-- team. Seeding only ever INSERTS rows that aren't on the board yet, so re-runs
-- pick up newly booked appointments without ever clobbering staff edits.
--
-- Board types map to a schedule department by its stable CODE, not its name:
--   ap -> AP, clinic -> NAD, exotics -> EXO, im -> IM, surgery -> SURG
-- (the NAD department was renamed to "NAD/VE/UC" in 0094 but kept code "NAD").
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- medical_board_row : one row per patient/appointment on one day's board.
--   appt_key  = the Agenda snapshot's stable appointment key, or "manual:<uuid>"
--               for walk-ins and add-ons entered by hand.
--   board_key = generated (location, date, type) identity used by Realtime,
--               whose postgres_changes filters only support ONE column.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.medical_board_row (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references greendogops.location (id) on delete cascade,
  board_date    date not null,
  board_type    text not null check (board_type in ('ap','clinic','exotics','im','surgery')),
  appt_key      text not null,
  source        text not null default 'agenda' check (source in ('agenda','manual')),
  sort_order    integer not null default 0,

  -- Identity seeded from the Agenda (editable — the team corrects these).
  appt_time     text,
  patient       text,
  client_name   text,
  appt_type     text,
  -- The ezyVet appointment description, kept as read-only reference context so
  -- seeding never overwrites the team-curated `services` column.
  appt_description text,

  -- Workflow columns, mirroring the Clinic Board spreadsheet.
  is_out        boolean not null default false,
  pmc           boolean not null default false,
  emr           boolean not null default false,
  csr           text,
  tech          text,
  dt            text,
  weight_kg     text,
  fas_score     text,
  de            boolean not null default false,
  status        text,
  medical_hx    text,
  services      text,
  services_done boolean not null default false,
  sedation      text,
  sedation_done boolean not null default false,
  cbfc          text,
  owner_ud      text,
  room          text,
  lab           boolean not null default false,
  sed           boolean not null default false,
  ev            boolean not null default false,
  inv           boolean not null default false,
  da            boolean not null default false,
  mp            boolean not null default false,
  ds            boolean not null default false,
  notes         text,

  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  board_key     text,

  unique (location_id, board_date, board_type, appt_key)
);

create index if not exists medical_board_row_board_idx
  on greendogops.medical_board_row (location_id, board_date, board_type);
create index if not exists medical_board_row_board_key_idx
  on greendogops.medical_board_row (board_key);

-- board_key is maintained by trigger rather than a GENERATED column because
-- date -> text output depends on DateStyle and so is not immutable.
create or replace function greendogops.medical_board_row_set_key()
returns trigger
language plpgsql
as $$
begin
  new.board_key := new.location_id::text || ':' ||
                   to_char(new.board_date, 'YYYY-MM-DD') || ':' ||
                   new.board_type;
  return new;
end;
$$;

drop trigger if exists set_board_key on greendogops.medical_board_row;
create trigger set_board_key before insert or update on greendogops.medical_board_row
  for each row execute function greendogops.medical_board_row_set_key();

drop trigger if exists set_updated_at on greendogops.medical_board_row;
create trigger set_updated_at before update on greendogops.medical_board_row
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- medical_board_seed(location, date, board_type) : pull that day's appointments
-- from the most recent Agenda snapshot for the board's department and insert any
-- that aren't on the board yet. Existing rows are left completely untouched, so
-- this is safe to call every time the board is opened. Returns rows inserted.
--
-- The Agenda is re-pulled every morning; the LATEST snapshot for the day is the
-- current truth (later snapshots supersede earlier ones).
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

  with inserted as (
    insert into greendogops.medical_board_row (
      location_id, board_date, board_type, appt_key, source,
      sort_order, appt_time, patient, client_name, appt_type, appt_description
    )
    select s.location_id,
           s.appt_date,
           p_board_type,
           s.appt_key,
           'agenda',
           row_number() over (order by s.appt_time nulls last, s.patient_name) * 10,
           s.appt_time,
           -- The Agenda carries the patient as "Pet Name" in the raw CSV row.
           coalesce(nullif(btrim(s.patient_name), ''),
                    nullif(btrim(s.details->>'Pet Name'), '')),
           s.client_name,
           s.appt_type,
           nullif(btrim(s.details->>'Description'), '')
    from greendogops.ezyvet_agenda_appt_snapshot s
    where s.location_id = p_location
      and s.appt_date = p_date
      and s.department_id = v_dept
      and s.snapshot_date = v_snapshot
    on conflict (location_id, board_date, board_type, appt_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

grant execute on function greendogops.medical_board_seed(uuid, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast board edits so every screen on the floor stays in sync.
-- REPLICA IDENTITY FULL is required for DELETE events to carry board_key; with
-- the default (primary key only) the subscription filter would drop deletions.
-- ---------------------------------------------------------------------------
alter table greendogops.medical_board_row replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table greendogops.medical_board_row;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;
