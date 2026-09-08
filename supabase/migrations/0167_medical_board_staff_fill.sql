-- ============================================================================
-- 0167 — Medical board: fill the doctor and CSR columns
--
-- Both had a 0% fill rate on every board since launch, for two different
-- reasons (the Description feed itself was fine — 100% populated):
--
--   csr  med_descr_initials() looked for a line reading "initials: XX" or
--        "1. XX". The real notes are a running CSR log whose initials are fused
--        to a date prefix, with the separator varying:
--             8/27_BKM- ...      09/01/26_SCA: ...
--             9/1KD_ texted ...  8/31/26RES_ text ...   8/20/26/ng- VE
--        Nothing ever matched. The corrected pattern below hits ~71% of rows.
--
--   dt   med_descr_field(descr,'dr') looked for a "dr:" line that does not
--        exist — the only doctor-ish text is "pDVM:" (the REFERRING vet). The
--        agenda's "All Resources / Vets" column is a room/address, not a
--        person, so ezyVet carries no attending doctor at all. The doctor comes
--        from the schedule (forward-looking, 94% of board rows) and is later
--        corrected from ezyvet_invoice_line.case_owner (ground truth, but ~2
--        days behind because invoices lag the visit).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CSR initials — parse the real "<date><sep><INITIALS><terminator>" prefix
-- ---------------------------------------------------------------------------
create or replace function greendogops.med_descr_initials(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
  m text[];
begin
  if p_text is null then return null; end if;
  t := replace(p_text, chr(13), '');

  -- Booking notes are newest-first, so the FIRST match is the CSR who last
  -- touched the appointment. Separator between date and initials may be
  -- "_", "/", a space, or nothing; the terminator may be "-", "_" or ":".
  m := regexp_match(
         t,
         '(?:^|\n|\. )[ \t]*\d{1,2}/\d{1,2}(?:/\d{2,4})?[ \t_/]*([A-Za-z]{2,4})[ \t]*[-_:]');
  if m is not null then return upper(btrim(m[1])); end if;

  -- Legacy/explicit forms kept as fallbacks.
  m := regexp_match(t, '(?:^|\n)[ \t]*initials[ \t]*[:.]?[ \t]*([A-Za-z]{1,4})[ \t]*(?:\n|$)', 'i');
  if m is not null then return upper(btrim(m[1])); end if;

  m := regexp_match(t, '(?:^|\n)[ \t]*1[.)][ \t]*([A-Za-z]{2,4})[ \t]*(?:\n|$)');
  if m is not null then return upper(btrim(m[1])); end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Scheduled DVM for a board (location + date + board type)
-- ---------------------------------------------------------------------------
-- Draft weeks count: the schedule is mid-migration off the Google sheet, so
-- requiring status='published' would return nothing for the weeks just loaded.
create or replace function greendogops.med_scheduled_dvm(
  p_location uuid,
  p_date date,
  p_board_type text
)
returns text
language sql
stable
set search_path = greendogops, pg_catalog
as $$
  select nullif(string_agg(distinct p.full_name, ' / ' order by p.full_name), '')
  from greendogops.sched_assignment a
  join greendogops.sched_week_line l on l.id = a.line_id
  join greendogops.sched_role r      on r.id = l.role_id and r.name = 'DVM'
  join greendogops.sched_department d on d.id = l.department_id
  join greendogops.person p          on p.id = a.person_id
  where a.work_date = p_date
    and a.location_id = p_location
    and not a.removed_post_publish
    and d.name = case p_board_type
                   when 'ap'      then 'AP'
                   when 'clinic'  then 'NAD/VE/UC'
                   when 'surgery' then 'SURGERY'
                   when 'im'      then 'IM'
                   when 'exotics' then 'EXOTICS'
                   when 'cardio'  then 'CARDIO'
                   when 'mpmv'    then 'MPMV'
                 end;
$$;

comment on function greendogops.med_scheduled_dvm(uuid, date, text) is
  'Doctor(s) the schedule places on a board that day. Multiple vets are joined with " / " (e.g. a department running two DVMs).';

-- Archived boards are a frozen record; medical_board_row_guard() raises on any
-- write to one, so every fill below has to exclude them.
create or replace function greendogops.med_board_is_archived(
  p_location uuid,
  p_date date,
  p_board_type text
)
returns boolean
language sql
stable
set search_path = greendogops, pg_catalog
as $$
  select exists (
    select 1 from greendogops.medical_board_day
     where location_id = p_location
       and board_date = p_date
       and board_type = p_board_type
       and status = 'archived'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Fill dt / csr for a day's boards
-- ---------------------------------------------------------------------------
-- Rows a human has edited (updated_by is not null) are never overwritten, and
-- archived boards are skipped — medical_board_row_guard() makes them read-only
-- and raises on any write.
create or replace function greendogops.medical_board_fill_staff(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = greendogops, pg_catalog
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'America/Los_Angeles')::date);
  v_csr int := 0;
  v_sched int := 0;
  v_invoice int := 0;
begin
  update greendogops.medical_board_row r
     set csr = greendogops.med_descr_initials(r.appt_description)
   where r.board_date = v_date
     and r.updated_by is null
     and coalesce(r.csr, '') = ''
     and greendogops.med_descr_initials(r.appt_description) is not null
     and not greendogops.med_board_is_archived(r.location_id, r.board_date, r.board_type);
  get diagnostics v_csr = row_count;

  update greendogops.medical_board_row r
     set dt = greendogops.med_scheduled_dvm(r.location_id, r.board_date, r.board_type)
   where r.board_date = v_date
     and r.updated_by is null
     and coalesce(r.dt, '') = ''
     and greendogops.med_scheduled_dvm(r.location_id, r.board_date, r.board_type) is not null
     and not greendogops.med_board_is_archived(r.location_id, r.board_date, r.board_type);
  get diagnostics v_sched = row_count;

  -- Ground truth once the visit is invoiced: the case owner on that patient's
  -- lines for that day. Overrides the schedule guess, which cannot know which
  -- of two rostered vets actually saw the patient.
  update greendogops.medical_board_row r
     set dt = o.case_owner
    from (
      select distinct on (l.animal_code, l.line_date)
             l.animal_code, l.line_date, l.case_owner
      from greendogops.ezyvet_invoice_line l
      where l.line_date = v_date
        and coalesce(l.case_owner, '') <> ''
      order by l.animal_code, l.line_date, l.case_owner
    ) o
   where r.board_date = v_date
     and r.updated_by is null
     and coalesce(r.patient_code, '') <> ''
     and o.animal_code = r.patient_code
     and o.line_date = r.board_date
     and coalesce(r.dt, '') is distinct from o.case_owner
     and not greendogops.med_board_is_archived(r.location_id, r.board_date, r.board_type);
  get diagnostics v_invoice = row_count;

  return jsonb_build_object(
    'date', v_date,
    'csr_filled', v_csr,
    'doctor_from_schedule', v_sched,
    'doctor_from_invoice', v_invoice
  );
end;
$$;

comment on function greendogops.medical_board_fill_staff(date) is
  'Fills medical_board_row.csr (from the booking-note initials) and .dt (schedule first, then the invoiced case owner). Skips rows edited by a human.';
