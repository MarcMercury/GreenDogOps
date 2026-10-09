-- ============================================================================
-- Green Dog Ops — baseline schema for the greendogops schema
-- Generated 2026-10-09 by scripts/generate_baseline.sh. DO NOT HAND-EDIT.
-- ----------------------------------------------------------------------------
-- A single, internally consistent snapshot: every table, view, materialised
-- view, function, trigger, enum, index, grant, revoke and RLS policy.
--
-- This exists because supabase/migrations/ cannot be replayed from scratch.
-- Several data-seed migrations hard-code UUIDs that were generated at runtime
-- and have since been deleted, so a fresh build aborts partway through. A
-- snapshot of a working database has no dangling references by construction.
--
-- Rebuild order is documented in scripts/rebuild_database.sh.
-- ============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: greendogops; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA greendogops;


--
-- Name: SCHEMA greendogops; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA greendogops IS 'Isolated schema for the Green Dog Ops app. Shares the Supabase project with EmployeeGMGDD (public) but must never collide with it.';


--
-- Name: app_role; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.app_role AS ENUM (
    'owner',
    'admin',
    'manager',
    'staff',
    'viewer',
    'schedule_admin',
    'executive',
    'marketing_admin'
);


--
-- Name: attendance_status; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.attendance_status AS ENUM (
    'scheduled',
    'present',
    'late',
    'late_excused',
    'absent',
    'absent_excused',
    'no_show',
    'pto'
);


--
-- Name: employment_status; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.employment_status AS ENUM (
    'prospect',
    'applicant',
    'employee',
    'former',
    'contractor'
);


--
-- Name: flsa_status; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.flsa_status AS ENUM (
    'exempt',
    'non_exempt'
);


--
-- Name: schedule_status; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.schedule_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'published',
    'archived'
);


--
-- Name: separation_type; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.separation_type AS ENUM (
    'quit',
    'fired',
    'laid_off',
    'other'
);


--
-- Name: time_off_kind; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.time_off_kind AS ENUM (
    'pto',
    'vacation',
    'time_off'
);


--
-- Name: time_off_status; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.time_off_status AS ENUM (
    'requested',
    'approved',
    'denied'
);


--
-- Name: work_location_type; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.work_location_type AS ENUM (
    'in_house',
    'remote',
    'hybrid'
);


--
-- Name: work_schedule; Type: TYPE; Schema: greendogops; Owner: -
--

CREATE TYPE greendogops.work_schedule AS ENUM (
    'full_time',
    'part_time',
    'per_diem',
    'contractor'
);


--
-- Name: apply_sheet_dvm_assignments(jsonb); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.apply_sheet_dvm_assignments(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  v_week       uuid;
  v_week_start date;
  r            record;
  v_weeks      integer := 0;
  v_skipped    integer := 0;
  v_inserted   integer := 0;
  v_n          integer;
  v_skipped_weeks text[] := '{}';
begin
  create temp table _pl on commit drop as
  select * from jsonb_to_recordset(coalesce(payload, '[]'::jsonb)) as x(
    week_start date, work_date date, day_of_week integer,
    dept text, second boolean, location text, person_id uuid
  );

  for v_week_start in select distinct p.week_start from _pl p order by 1 loop
    select id into v_week
      from greendogops.sched_week
     where week_start = v_week_start
       and coalesce(is_template, false) = false
       and status <> 'published'
     limit 1;

    if v_week is null then
      v_skipped := v_skipped + 1;
      v_skipped_weeks := v_skipped_weeks || v_week_start::text;
      continue;
    end if;

    delete from greendogops.sched_assignment a
     using greendogops.sched_week_line l, greendogops.sched_role rr
     where a.week_id = v_week and l.id = a.line_id
       and rr.id = l.role_id and rr.name = 'DVM';

    for r in select * from _pl p where p.week_start = v_week_start loop
      -- "2nd VET-*" wants the department's second DVM line, but some
      -- departments only have one; least(pick, cnt) falls back to the single
      -- line instead of silently dropping the placement.
      insert into greendogops.sched_assignment
        (week_id, line_id, location_id, person_id, day_of_week, work_date)
      select v_week, ln.id, loc.id, r.person_id, r.day_of_week, r.work_date
        from (
          select l.id,
                 row_number() over (order by l.sort_order) rn,
                 count(*) over () cnt
            from greendogops.sched_week_line l
            join greendogops.sched_department d
              on d.id = l.department_id and d.name = r.dept
            join greendogops.sched_role rr
              on rr.id = l.role_id and rr.name = 'DVM'
           where l.week_id = v_week
        ) ln
        cross join lateral (
          select id from greendogops.location where name = r.location limit 1
        ) loc
       where ln.rn = least(case when r.second then 2 else 1 end, ln.cnt)
       limit 1;
      get diagnostics v_n = row_count;
      v_inserted := v_inserted + v_n;
    end loop;

    v_weeks := v_weeks + 1;
  end loop;

  return jsonb_build_object(
    'parsed', (select count(*) from _pl),
    'inserted', v_inserted,
    'weeks_applied', v_weeks,
    'weeks_skipped', v_skipped,
    'skipped_week_starts', to_jsonb(v_skipped_weeks)
  );
end;
$$;


--
-- Name: FUNCTION apply_sheet_dvm_assignments(payload jsonb); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.apply_sheet_dvm_assignments(payload jsonb) IS 'Load DVM placements from the staff schedule sheet; skips published weeks.';


--
-- Name: apply_student_grid(jsonb); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.apply_student_grid(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  v_enriched integer := 0;
  v_inserted integer := 0;
  v_parsed   integer := coalesce(jsonb_array_length(payload), 0);
begin
  create temp table _stg on commit drop as
  select row_number() over () as stg_id, *
  from jsonb_to_recordset(coalesce(payload, '[]'::jsonb)) as x(
    full_name text, first_name text, last_name text, email text,
    location text, program_type text, supervising_dvm text,
    weekday_schedule text, doc_recommendation text, hire_interest text,
    grad_year text, stipend text, start_date date, end_date date,
    completed boolean, stipend_paid boolean, check_cashed boolean,
    notes text, eligible boolean
  );

  -- Clear the previous grid import FIRST. It has to happen before matching:
  -- otherwise last night's grid rows match themselves, get "enriched", and are
  -- then deleted without being re-inserted (they already "matched").
  delete from greendogops.crm_contact
   where source in ('student_grid_xlsx', 'student_grid_sheet');

  -- Match staging rows to the students tracked from other sources, by email OR
  -- normalised name/prefix ("Laura Callison" vs "Laura Callison (Webb)").
  create temp table _match on commit drop as
  select s.stg_id, c.id as cid,
         row_number() over (
           partition by c.id
           order by (s.doc_recommendation is not null) desc,
                    s.start_date desc nulls last
         ) as rn
  from _stg s
  join greendogops.crm_contact c
    on c.contact_type = 'student'
   and (
        (s.email is not null and c.email is not null
           and lower(trim(s.email)) = lower(trim(c.email)))
     or (greendogops.normalize_person_key(s.full_name) <> '' and (
           greendogops.normalize_person_key(c.full_name) = greendogops.normalize_person_key(s.full_name)
        or greendogops.normalize_person_key(c.full_name) like greendogops.normalize_person_key(s.full_name) || '%'
        or greendogops.normalize_person_key(s.full_name) like greendogops.normalize_person_key(c.full_name) || '%'
     ))
   );

  -- Enrich matched students in place: fill gaps, never clobber curated values.
  update greendogops.crm_contact c set
    email              = case when c.email is null or c.email like '%@unknown.edu'
                                then coalesce(s.email, c.email) else c.email end,
    location           = coalesce(nullif(trim(c.location), ''), s.location),
    supervising_dvm    = coalesce(nullif(trim(c.supervising_dvm), ''), s.supervising_dvm),
    weekday_schedule   = coalesce(nullif(trim(c.weekday_schedule), ''), s.weekday_schedule),
    doc_recommendation = coalesce(nullif(trim(c.doc_recommendation), ''), s.doc_recommendation),
    hire_interest      = coalesce(nullif(trim(c.hire_interest), ''), s.hire_interest),
    grad_year          = coalesce(nullif(trim(c.grad_year), ''), s.grad_year),
    cohort             = coalesce(nullif(trim(c.cohort), ''), s.grad_year),
    stipend            = coalesce(nullif(trim(c.stipend), ''), s.stipend),
    start_date         = coalesce(c.start_date, s.start_date),
    end_date           = coalesce(c.end_date, s.end_date),
    completed          = coalesce(c.completed, s.completed),
    stipend_paid       = coalesce(c.stipend_paid, s.stipend_paid),
    check_cashed       = coalesce(c.check_cashed, s.check_cashed),
    notes              = coalesce(nullif(trim(c.notes), ''), s.notes),
    updated_at         = now()
  from _match m
  join _stg s on s.stg_id = m.stg_id
  where c.id = m.cid and m.rn = 1;
  get diagnostics v_enriched = row_count;

  insert into greendogops.crm_contact
    (contact_type, first_name, last_name, full_name, email, location,
     program_type, supervising_dvm, weekday_schedule, doc_recommendation,
     hire_interest, grad_year, cohort, stipend, start_date, end_date,
     completed, stipend_paid, check_cashed, eligible_for_employment,
     notes, source)
  select 'student', s.first_name, s.last_name, s.full_name, s.email,
     s.location, s.program_type, s.supervising_dvm, s.weekday_schedule,
     s.doc_recommendation, s.hire_interest, s.grad_year, s.grad_year,
     s.stipend, s.start_date, s.end_date, s.completed, s.stipend_paid,
     s.check_cashed, nullif(s.eligible, false), s.notes, 'student_grid_sheet'
  from _stg s
  where not exists (select 1 from _match m where m.stg_id = s.stg_id);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'parsed', v_parsed,
    'updated', v_enriched,
    'inserted', v_inserted,
    'total_students', (select count(*) from greendogops.crm_contact where contact_type = 'student')
  );
end;
$$;


--
-- Name: FUNCTION apply_student_grid(payload jsonb); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.apply_student_grid(payload jsonb) IS 'Reconcile parsed student-grid rows into crm_contact: enrich matches, insert the rest.';


--
-- Name: appointment_review(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.appointment_review(p_start date, p_end date) RETURNS TABLE(location_id uuid, location_name text, department_id uuid, department_name text, department_color text, appt_date date, expected_count integer, rendered_count integer, expected_snapshot date, rendered_snapshot date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with snap as (
    select location_id, appt_date, department_id, appt_count, snapshot_date
    from greendogops.ezyvet_agenda_snapshot
    where appt_date between p_start and p_end
  ),
  cells as (
    select distinct location_id, appt_date, department_id from snap
  ),
  expected as (
    select distinct on (location_id, appt_date, department_id)
      location_id, appt_date, department_id, appt_count, snapshot_date
    from snap
    where snapshot_date <= appt_date
    order by location_id, appt_date, department_id, snapshot_date desc
  ),
  rendered as (
    select distinct on (location_id, appt_date, department_id)
      location_id, appt_date, department_id, appt_count, snapshot_date
    from snap
    where snapshot_date > appt_date
    order by location_id, appt_date, department_id, snapshot_date asc
  ),
  scanned as (
    -- (location, day) combos that have had at least one post-day re-scan.
    select distinct location_id, appt_date
    from snap
    where snapshot_date > appt_date
  )
  select
    c.location_id,
    l.name as location_name,
    c.department_id,
    d.name as department_name,
    d.color as department_color,
    c.appt_date,
    coalesce(e.appt_count, 0) as expected_count,
    case
      when r.appt_count is not null then r.appt_count
      when s.location_id is not null then 0   -- re-scanned, cell now empty ⇒ 0
      else null                               -- not yet re-scanned ⇒ pending
    end as rendered_count,
    e.snapshot_date as expected_snapshot,
    r.snapshot_date as rendered_snapshot
  from cells c
  join greendogops.location l on l.id = c.location_id
  join greendogops.sched_department d on d.id = c.department_id
  left join expected e
    on e.location_id = c.location_id and e.appt_date = c.appt_date and e.department_id = c.department_id
  left join rendered r
    on r.location_id = c.location_id and r.appt_date = c.appt_date and r.department_id = c.department_id
  left join scanned s
    on s.location_id = c.location_id and s.appt_date = c.appt_date
  order by c.appt_date desc, l.name, d.name;
$$;


--
-- Name: FUNCTION appointment_review(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.appointment_review(p_start date, p_end date) IS 'Booked vs rendered appointments per location/department/day. Returns location_name, department_name, appt_date, expected_count (booked) and rendered_count. THE canonical source for "how many appointments are booked on <day>" — it already picks the right agenda snapshot, and expected_count is correct for FUTURE dates (rendered_count is simply null until the day is re-scanned).';


--
-- Name: appointment_review_by_type(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.appointment_review_by_type(p_start date, p_end date) RETURNS TABLE(location_id uuid, location_name text, appt_type text, scheduled integer, rendered integer, not_rendered integer, added integer, pending integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with snap as (
    select
      location_id, appt_date, department_id, snapshot_date, appt_key,
      coalesce(nullif(btrim(appt_type), ''), 'Unspecified') as appt_type
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date between p_start and p_end
  ),
  expected_dt as (
    select location_id, appt_date, department_id, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by location_id, appt_date, department_id
  ),
  rendered_dt as (
    select location_id, appt_date, department_id, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by location_id, appt_date, department_id
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.location_id = s.location_id and e.appt_date = s.appt_date
     and e.department_id = s.department_id and e.snapshot_date = s.snapshot_date
  ),
  rendered_snap as (
    select s.*
    from snap s
    join rendered_dt r
      on r.location_id = s.location_id and r.appt_date = s.appt_date
     and r.department_id = s.department_id and r.snapshot_date = s.snapshot_date
  ),
  booked_class as (
    select
      b.location_id,
      b.appt_type,
      (rd.location_id is not null) as rescanned,
      (rn.appt_key is not null) as did_render
    from booked b
    left join rendered_dt rd
      on rd.location_id = b.location_id and rd.appt_date = b.appt_date
     and rd.department_id = b.department_id
    left join rendered_snap rn
      on rn.location_id = b.location_id and rn.appt_date = b.appt_date
     and rn.department_id = b.department_id and rn.appt_key = b.appt_key
  ),
  added_rows as (
    select rn.location_id, rn.appt_type
    from rendered_snap rn
    left join booked b
      on b.location_id = rn.location_id and b.appt_date = rn.appt_date
     and b.department_id = rn.department_id and b.appt_key = rn.appt_key
    where b.appt_key is null
  ),
  agg_booked as (
    select
      location_id,
      appt_type,
      count(*) filter (where rescanned) as scheduled,
      count(*) filter (where rescanned and did_render) as rendered,
      count(*) filter (where rescanned and not did_render) as not_rendered,
      count(*) filter (where not rescanned) as pending
    from booked_class
    group by location_id, appt_type
  ),
  agg_added as (
    select location_id, appt_type, count(*) as added
    from added_rows
    group by location_id, appt_type
  ),
  merged as (
    select
      coalesce(b.location_id, a.location_id) as location_id,
      coalesce(b.appt_type, a.appt_type) as appt_type,
      coalesce(b.scheduled, 0) as scheduled,
      coalesce(b.rendered, 0) as rendered,
      coalesce(b.not_rendered, 0) as not_rendered,
      coalesce(a.added, 0) as added,
      coalesce(b.pending, 0) as pending
    from agg_booked b
    full outer join agg_added a
      on a.location_id = b.location_id and a.appt_type = b.appt_type
  )
  select
    m.location_id,
    l.name as location_name,
    m.appt_type,
    m.scheduled::int,
    m.rendered::int,
    m.not_rendered::int,
    m.added::int,
    m.pending::int
  from merged m
  join greendogops.location l on l.id = m.location_id
  order by l.name, m.not_rendered desc, m.scheduled desc, m.appt_type;
$$;


--
-- Name: FUNCTION appointment_review_by_type(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.appointment_review_by_type(p_start date, p_end date) IS 'Booked vs rendered appointments grouped by ezyVet appointment TYPE per location: scheduled, rendered, added, not_rendered, pending. ⚠️ This is a LOOK-BACK comparison: scheduled/rendered/not_rendered only count days that have already been re-scanned after they happened. For TODAY or any FUTURE date nothing has been re-scanned, so those three are 0 and the entire booked count is in PENDING. For "what is booked next week" either sum pending here, or use appointment_review() and sum expected_count.';


--
-- Name: appointment_review_detail(uuid, uuid, date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.appointment_review_detail(p_location uuid, p_department uuid, p_start date, p_end date) RETURNS TABLE(appt_date date, change text, appt_key text, client_name text, patient_name text, resource text, appt_time text, appt_type text, status text, details jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with snap as (
    select *
    from greendogops.ezyvet_agenda_appt_snapshot
    where location_id = p_location
      and department_id = p_department
      and appt_date between p_start and p_end
  ),
  expected_dt as (
    select appt_date, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by appt_date
  ),
  rendered_dt as (
    select appt_date, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by appt_date
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.appt_date = s.appt_date and e.snapshot_date = s.snapshot_date
  ),
  rendered as (
    select s.*
    from snap s
    join rendered_dt r
      on r.appt_date = s.appt_date and r.snapshot_date = s.snapshot_date
  )
  -- Dropped: in the booked pull, absent from the rendered pull (only for days
  -- that were actually re-scanned, i.e. have a rendered snapshot).
  select
    b.appt_date, 'dropped'::text as change, b.appt_key, b.client_name,
    b.patient_name, b.resource, b.appt_time, b.appt_type, b.status, b.details
  from booked b
  join rendered_dt r on r.appt_date = b.appt_date
  left join rendered rn
    on rn.appt_date = b.appt_date and rn.appt_key = b.appt_key
  where rn.appt_key is null
  union all
  -- Added: in the rendered pull, absent from the booked pull.
  select
    rn.appt_date, 'added'::text as change, rn.appt_key, rn.client_name,
    rn.patient_name, rn.resource, rn.appt_time, rn.appt_type, rn.status, rn.details
  from rendered rn
  left join booked b
    on b.appt_date = rn.appt_date and b.appt_key = rn.appt_key
  where b.appt_key is null
  order by appt_date desc, change, client_name;
$$;


--
-- Name: appointment_review_type_detail(uuid, date, date, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.appointment_review_type_detail(p_location uuid, p_start date, p_end date, p_type text) RETURNS TABLE(location_id uuid, location_name text, department_name text, appt_date date, appt_key text, client_name text, patient_name text, resource text, appt_time text, appt_type text, status text, details jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with snap as (
    select
      location_id, appt_date, department_id, snapshot_date, appt_key,
      client_name, patient_name, resource, appt_time, status, details,
      coalesce(nullif(btrim(appt_type), ''), 'Unspecified') as appt_type
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date between p_start and p_end
      and location_id = p_location
  ),
  expected_dt as (
    select location_id, appt_date, department_id, max(snapshot_date) as snapshot_date
    from snap
    where snapshot_date <= appt_date
    group by location_id, appt_date, department_id
  ),
  rendered_dt as (
    select location_id, appt_date, department_id, min(snapshot_date) as snapshot_date
    from snap
    where snapshot_date > appt_date
    group by location_id, appt_date, department_id
  ),
  booked as (
    select s.*
    from snap s
    join expected_dt e
      on e.location_id = s.location_id and e.appt_date = s.appt_date
     and e.department_id = s.department_id and e.snapshot_date = s.snapshot_date
  ),
  rendered_snap as (
    select s.*
    from snap s
    join rendered_dt r
      on r.location_id = s.location_id and r.appt_date = s.appt_date
     and r.department_id = s.department_id and r.snapshot_date = s.snapshot_date
  )
  select
    b.location_id,
    l.name as location_name,
    d.name as department_name,
    b.appt_date, b.appt_key, b.client_name, b.patient_name, b.resource,
    b.appt_time, b.appt_type, b.status, b.details
  from booked b
  join greendogops.location l on l.id = b.location_id
  join greendogops.sched_department d on d.id = b.department_id
  join rendered_dt rd
    on rd.location_id = b.location_id and rd.appt_date = b.appt_date
   and rd.department_id = b.department_id
  left join rendered_snap rn
    on rn.location_id = b.location_id and rn.appt_date = b.appt_date
   and rn.department_id = b.department_id and rn.appt_key = b.appt_key
  where b.appt_type = p_type
    and rn.appt_key is null
  order by b.appt_date desc, b.client_name;
$$;


--
-- Name: appt_type_observed_counts(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.appt_type_observed_counts() RETURNS TABLE(appt_type text, observed_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  select btrim(appt_type) as appt_type, count(*)::bigint
  from greendogops.ezyvet_agenda_appt_snapshot
  where appt_type is not null and btrim(appt_type) <> ''
  group by btrim(appt_type)
$$;


--
-- Name: FUNCTION appt_type_observed_counts(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.appt_type_observed_counts() IS 'How often each ezyVet appointment type appears in the booked-appointment snapshots (popularity).';


--
-- Name: audit_log_append_only(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.audit_log_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
begin
  raise exception 'greendogops.audit_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;


--
-- Name: bizdev_appt_type_daily_avg(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.bizdev_appt_type_daily_avg() RETURNS TABLE(location_id uuid, appt_type text, avg_per_day numeric, days_observed integer, total_appts integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  latest as (
    select location_id, appt_date, max(snapshot_date) as snapshot_date
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date <= (select d from la_today)
    group by location_id, appt_date
  ),
  appts as (
    select s.location_id,
           s.appt_date,
           coalesce(nullif(trim(s.appt_type), ''), 'Unspecified') as appt_type,
           count(*) as cnt
    from greendogops.ezyvet_agenda_appt_snapshot s
    join latest l
      on l.location_id   = s.location_id
     and l.appt_date     = s.appt_date
     and l.snapshot_date = s.snapshot_date
    group by s.location_id, s.appt_date,
             coalesce(nullif(trim(s.appt_type), ''), 'Unspecified')
  ),
  loc_days as (
    select location_id, count(distinct appt_date) as open_days
    from appts
    group by location_id
  )
  select a.location_id,
         a.appt_type,
         round(sum(a.cnt)::numeric / nullif(ld.open_days, 0), 2) as avg_per_day,
         ld.open_days::int as days_observed,
         sum(a.cnt)::int   as total_appts
  from appts a
  join loc_days ld on ld.location_id = a.location_id
  group by a.location_id, a.appt_type, ld.open_days;
$$;


--
-- Name: FUNCTION bizdev_appt_type_daily_avg(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.bizdev_appt_type_daily_avg() IS 'Realized average appointments per open day per (location, appointment type).';


--
-- Name: bizdev_appt_type_value(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.bizdev_appt_type_value() RETURNS TABLE(location_id uuid, appt_type text, avg_value numeric, matched_paid integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  ag as (
    select s.id,
           s.appt_date,
           s.location_id,
           coalesce(nullif(btrim(s.appt_type), ''), 'Unspecified') as appt_type,
           lower(btrim(regexp_replace(s.client_name, '^(mr|mrs|ms|miss|dr)\.?\s+', '', 'i'))) as name_key
    from greendogops.ezyvet_agenda_appt_snapshot s
    where s.appt_date <= (select d from la_today)
  ),
  bounds as (
    select min(appt_date) as lo, max(appt_date) as hi from ag
  ),
  c as (
    select contact_code,
           lower(btrim(last_name)) || ', ' || lower(btrim(first_name)) as name_key
    from greendogops.ezyvet_contact
    where coalesce(last_name, '') <> '' and coalesce(first_name, '') <> ''
  ),
  loc as (
    select id,
           case lower(name)
             when 'sherman oaks' then 'sherman_oaks'
             when 'van nuys'     then 'van_nuys'
             when 'venice'       then 'venice'
           end as lk
    from greendogops.location
  ),
  inv as (
    select client_contact_code, line_date, location_key,
           sum(coalesce(total_incl, 0)) as revenue
    from greendogops.ezyvet_invoice_line
    where client_contact_code is not null
      and line_date between (select lo from bounds) and (select hi from bounds)
    group by client_contact_code, line_date, location_key
  ),
  joined as (
    select ag.id, ag.location_id, ag.appt_type, max(inv.revenue) as revenue
    from ag
    join loc l on l.id = ag.location_id
    join c    on c.name_key = ag.name_key
    join inv  on inv.client_contact_code = c.contact_code
             and inv.line_date          = ag.appt_date
             and inv.location_key        = l.lk
    group by ag.id, ag.location_id, ag.appt_type
  )
  select location_id,
         appt_type,
         round(avg(revenue) filter (where revenue > 0)) as avg_value,
         count(*) filter (where revenue > 0)::int       as matched_paid
  from joined
  group by location_id, appt_type
  having count(*) filter (where revenue > 0) >= 1;
$$;


--
-- Name: FUNCTION bizdev_appt_type_value(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.bizdev_appt_type_value() IS 'Average realized revenue per appointment per (location, appointment type), recovered by matching the agenda to invoices.';


--
-- Name: bizdev_hour_demand(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.bizdev_hour_demand() RETURNS TABLE(location_id uuid, hour integer, appt_count integer, avg_per_open_day numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $_$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  latest as (
    select location_id, appt_date, max(snapshot_date) as snapshot_date
    from greendogops.ezyvet_agenda_appt_snapshot
    where appt_date <= (select d from la_today)
    group by location_id, appt_date
  ),
  appts as (
    select s.location_id,
           s.appt_date,
           -- Parse "HH:MMAM"/"HH:MMPM" -> 0..23 hour.
           (
             (substring(s.appt_time from '^([0-9]{1,2}):')::int % 12)
             + case when s.appt_time ilike '%pm' then 12 else 0 end
           ) as hour
    from greendogops.ezyvet_agenda_appt_snapshot s
    join latest l
      on l.location_id   = s.location_id
     and l.appt_date     = s.appt_date
     and l.snapshot_date = s.snapshot_date
    where s.appt_time ~ '^[0-9]{1,2}:[0-9]{2}\s*(AM|PM)$'
  ),
  loc_days as (
    select location_id, count(distinct appt_date) as open_days
    from appts
    group by location_id
  )
  select a.location_id,
         a.hour,
         count(*)::int as appt_count,
         round(count(*)::numeric / nullif(ld.open_days, 0), 2) as avg_per_open_day
  from appts a
  join loc_days ld on ld.location_id = a.location_id
  group by a.location_id, a.hour, ld.open_days;
$_$;


--
-- Name: FUNCTION bizdev_hour_demand(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.bizdev_hour_demand() IS 'Realized booked appointments by hour of day per location (avg_per_open_day) — when appointments actually book.';


--
-- Name: bizdev_refresh_metrics(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.bizdev_refresh_metrics() RETURNS TABLE(rows_inserted integer, rows_per_day_updated integer, rows_value_updated integer, refreshed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  v_now        timestamptz := now();
  v_inserted   integer := 0;
  v_per_day    integer := 0;
  v_value      integer := 0;
begin
  -- Both source functions are expensive full scans; materialize them once.
  drop table if exists pg_temp._bd_daily;
  create temp table _bd_daily on commit drop as
    select * from greendogops.bizdev_appt_type_daily_avg();

  drop table if exists pg_temp._bd_value;
  create temp table _bd_value on commit drop as
    select * from greendogops.bizdev_appt_type_value();

  -- Pooled all-clinic value per type, weighted by matched sample size — the
  -- fallback for a clinic that has never invoiced that service.
  drop table if exists pg_temp._bd_pooled;
  create temp table _bd_pooled on commit drop as
    select v.appt_type,
           sum(v.avg_value * v.matched_paid) / nullif(sum(v.matched_paid), 0) as avg_value
    from pg_temp._bd_value v
    where v.matched_paid > 0
    group by v.appt_type;

  -- The clinics the planner covers. Seeded app-side on first load, so this is
  -- a no-op until getBusinessDevelopmentData() has run once.
  drop table if exists pg_temp._bd_loc;
  create temp table _bd_loc on commit drop as
    select distinct location_id from greendogops.bizdev_appt_type;

  -- Appointment types that are new in the data get a row at every planned
  -- clinic: ON with its real average where the clinic renders it, OFF (catalog
  -- only, pooled value) everywhere else.
  with catalog as (
    select appt_type from pg_temp._bd_daily
    union
    select appt_type from pg_temp._bd_value
  ),
  ins as (
    insert into greendogops.bizdev_appt_type
      (location_id, appt_type, avg_value, avg_per_day, planned_per_day, included, sort_order)
    select l.location_id,
           c.appt_type,
           round(coalesce(v.avg_value, p.avg_value, 0), 2),
           round(coalesce(d.avg_per_day, 0), 2),
           round(coalesce(d.avg_per_day, 0)),
           d.appt_type is not null,
           case when d.appt_type is not null
                then 1000 - least(999, coalesce(d.total_appts, 0))
                else 2000
           end
    from pg_temp._bd_loc l
    cross join catalog c
    left join pg_temp._bd_daily  d on d.location_id = l.location_id and d.appt_type = c.appt_type
    left join pg_temp._bd_value  v on v.location_id = l.location_id and v.appt_type = c.appt_type
    left join pg_temp._bd_pooled p on p.appt_type = c.appt_type
    on conflict (location_id, appt_type) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  -- Realized appointments/day. A type with no rows left in the realized window
  -- falls back to 0 so the base number always reflects the data — but only at
  -- clinics that actually reported volume, so a clinic with no snapshots yet is
  -- left alone rather than wiped.
  with target as (
    select t.id,
           round(coalesce(d.avg_per_day, 0), 2) as new_per_day
    from greendogops.bizdev_appt_type t
    left join pg_temp._bd_daily d
      on d.location_id = t.location_id and d.appt_type = t.appt_type
    where not t.per_day_overridden
      and not t.is_custom
      and exists (select 1 from pg_temp._bd_daily x where x.location_id = t.location_id)
  ),
  upd as (
    update greendogops.bizdev_appt_type t
    set avg_per_day = target.new_per_day,
        updated_at  = v_now
    from target
    where target.id = t.id
      and t.avg_per_day is distinct from target.new_per_day
    returning 1
  )
  select count(*)::int into v_per_day from upd;

  -- Recovered average revenue per appointment.
  with target as (
    select t.id,
           round(coalesce(v.avg_value, p.avg_value, 0), 2) as new_value
    from greendogops.bizdev_appt_type t
    left join pg_temp._bd_value  v
      on v.location_id = t.location_id and v.appt_type = t.appt_type
    left join pg_temp._bd_pooled p on p.appt_type = t.appt_type
    where not t.value_overridden
      and not t.is_custom
  ),
  upd as (
    update greendogops.bizdev_appt_type t
    set avg_value  = target.new_value,
        updated_at = v_now
    from target
    where target.id = t.id
      and t.avg_value is distinct from target.new_value
    returning 1
  )
  select count(*)::int into v_value from upd;

  -- Stamp every planned clinic, creating the config row if the planner hasn't.
  insert into greendogops.bizdev_location_config (location_id, metrics_refreshed_at)
  select l.location_id, v_now
  from pg_temp._bd_loc l
  on conflict (location_id) do update
    set metrics_refreshed_at = excluded.metrics_refreshed_at,
        updated_at           = v_now;

  return query select v_inserted, v_per_day, v_value, v_now;
end;
$$;


--
-- Name: FUNCTION bizdev_refresh_metrics(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.bizdev_refresh_metrics() IS 'Business Development: re-derive avg_per_day and avg_value per (clinic, appointment type) from the latest Agenda snapshots and invoices. Skips custom rows and user-overridden cells. Run daily after the ezyVet ingest.';


--
-- Name: bizdev_weekday_factor(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.bizdev_weekday_factor() RETURNS TABLE(location_id uuid, dow integer, factor numeric, n_days integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with daily as (
    select location_key,
           line_date,
           extract(dow from line_date)::int as dow,
           sum(coalesce(total_incl, 0)) as rev
    from greendogops.ezyvet_invoice_line
    where line_date >= (current_date - interval '18 months')
      and location_key in ('sherman_oaks', 'van_nuys', 'venice')
    group by location_key, line_date
  ),
  by_dow as (
    select location_key, dow, avg(rev) as avg_rev, count(*) as n_days
    from daily
    group by location_key, dow
  ),
  weekday_base as (
    select location_key, avg(avg_rev) as base
    from by_dow
    where dow between 1 and 5
    group by location_key
  ),
  loc as (
    select id,
           case lower(name)
             when 'sherman oaks' then 'sherman_oaks'
             when 'van nuys'     then 'van_nuys'
             when 'venice'       then 'venice'
           end as lk
    from greendogops.location
  )
  select l.id,
         b.dow,
         round((b.avg_rev / nullif(wb.base, 0))::numeric, 3) as factor,
         b.n_days::int
  from by_dow b
  join weekday_base wb on wb.location_key = b.location_key
  join loc l on l.lk = b.location_key;
$$;


--
-- Name: FUNCTION bizdev_weekday_factor(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.bizdev_weekday_factor() IS 'How busy each weekday runs per location versus a typical weekday (1.0 = normal), from 18 months of revenue.';


--
-- Name: book_interview_slot(uuid, date, time without time zone, time without time zone, text, timestamp with time zone); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.book_interview_slot(p_invite_id uuid, p_date date, p_start time without time zone, p_end time without time zone, p_interviewer text, p_booked_start timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  v_invite interview_invite%rowtype;
  v_interview_id uuid;
begin
  select * into v_invite from interview_invite where id = p_invite_id;
  if not found or v_invite.status <> 'sent' then
    raise exception 'invite_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtext('interview_host:' || v_invite.host_user_id::text));

  if exists (
    select 1 from person_interview
    where host_user_id = v_invite.host_user_id
      and status = 'scheduled'
      and interview_date = p_date
      and start_time is not null
      and start_time < p_end
      and coalesce(end_time, start_time + interval '60 minutes') > p_start
  ) then
    raise exception 'slot_taken';
  end if;

  update interview_invite
  set status = 'booked', booked_start = p_booked_start, booked_at = now()
  where id = p_invite_id and status = 'sent';
  if not found then
    raise exception 'invite_unavailable';
  end if;

  insert into person_interview (
    person_id, interview_date, start_time, end_time, interview_type, interviewer,
    location, status, responses, host_user_id, invite_id
  ) values (
    v_invite.person_id, p_date, p_start, p_end, v_invite.interview_type, p_interviewer,
    v_invite.location, 'scheduled', '[]'::jsonb, v_invite.host_user_id, v_invite.id
  ) returning id into v_interview_id;

  update interview_invite set interview_id = v_interview_id where id = p_invite_id;
  return v_interview_id;
end;
$$;


--
-- Name: cancelled_appointments_by_type(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.cancelled_appointments_by_type(p_start date, p_end date) RETURNS TABLE(location_id uuid, location_name text, appt_type text, cancel_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  select
    c.location_id,
    l.name as location_name,
    coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') as appt_type,
    count(*)::int as cancel_count
  from greendogops.ezyvet_cancelled_appointment c
  left join greendogops.location l on l.id = c.location_id
  where c.appt_date between p_start and p_end
  group by c.location_id, l.name, 3
  order by l.name nulls last, cancel_count desc, appt_type;
$$;


--
-- Name: FUNCTION cancelled_appointments_by_type(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.cancelled_appointments_by_type(p_start date, p_end date) IS 'Cancelled appointments per location and appointment type over a date range. The source of truth for cancellations — the agenda excludes cancelled appointments, so booked-vs-rendered only infers them.';


--
-- Name: cancelled_appointments_detail(uuid, date, date, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.cancelled_appointments_detail(p_location uuid, p_start date, p_end date, p_type text) RETURNS TABLE(appt_date date, appt_type text, location_id uuid, location_name text, start_time text, with_who text, using_resource text, description text, status text, reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  select
    c.appt_date,
    coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') as appt_type,
    c.location_id,
    l.name as location_name,
    c.start_time,
    c.with_who,
    c.using_resource,
    c.description,
    c.status,
    c.reason
  from greendogops.ezyvet_cancelled_appointment c
  left join greendogops.location l on l.id = c.location_id
  where c.appt_date between p_start and p_end
    and c.location_id is not distinct from p_location
    and coalesce(nullif(btrim(c.appt_type), ''), 'Unspecified') = p_type
  order by c.appt_date desc, c.start_time;
$$;


--
-- Name: is_appt_line(text, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.is_appt_line(p_name text, p_group text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select
    lower(coalesce(p_name, '')) not like '%deposit%'
    and lower(coalesce(p_name, '')) not like '%refund%'
    and coalesce(nullif(p_group, ''), '') not in (
      -- retail / OTC
      'Retail',
      'Consumables, Food, and Supplements',
      'Supplies',
      'Parasite Control',
      -- prescription refills / pharmacy pickups (no visit)
      'Medications - Rx',
      'Controlled Substances - Rx',
      -- membership billing, reminders, aftercare, fees, financial adjustments
      'Green Dog Pet Plus Wellness Plan',
      'Follow Up',
      'Cremation Services',
      'Service Fee',
      '*Discount/Credit/Deposit'
    );
$$;


--
-- Name: is_gdo_admin(uuid); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.is_gdo_admin(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops'
    AS $$
  select exists (
    select 1 from greendogops.app_user
    where id = uid and is_active and role in ('owner', 'admin')
  );
$$;


--
-- Name: is_gdo_user(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.is_gdo_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
  select exists (
    select 1
    from greendogops.app_user
    where id = auth.uid()
      and is_active
  )
  and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    )
  );
$$;


--
-- Name: FUNCTION is_gdo_user(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.is_gdo_user() IS 'True when the current JWT belongs to an active greendogops.app_user. auth.users is shared with EmployeeGMGDD, so a session alone is NOT sufficient.';


--
-- Name: med_age_short(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_age_short(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '(\d+)\s*yr'  then (regexp_match(p, '(\d+)\s*yr'))[1]  || 'Y'
    when p ~ '(\d+)\s*mnth' then (regexp_match(p, '(\d+)\s*mnth'))[1] || 'M'
    when p ~ '(\d+)\s*wk'   then (regexp_match(p, '(\d+)\s*wk'))[1]   || 'W'
    else p
  end;
$$;


--
-- Name: med_board_is_archived(uuid, date, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_board_is_archived(p_location uuid, p_date date, p_board_type text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
  select exists (
    select 1 from greendogops.medical_board_day
     where location_id = p_location
       and board_date = p_date
       and board_type = p_board_type
       and status = 'archived'
  );
$$;


--
-- Name: med_dept_code(text, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_dept_code(p_name text, p_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select coalesce(
    nullif(btrim(p_code), ''),
    nullif(left(upper(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '', 'g')), 16), '')
  );
$$;


--
-- Name: FUNCTION med_dept_code(p_name text, p_code text); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.med_dept_code(p_name text, p_code text) IS 'Stable code a department is matched by. Falls back to the normalized name so a department with a NULL code still routes its appointments to a board.';


--
-- Name: med_descr_credit(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_descr_credit(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: med_descr_field(text, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_descr_field(p_text text, p_label text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
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


--
-- Name: med_descr_initials(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_descr_initials(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: med_fas_from_caution(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_fas_from_caution(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select case
    when p is null then null
    when p ilike 'friendly%'   then 'FAS 0-1 (GO)'
    when p ilike 'caution%'    then 'FAS 2-3 (CAUTION)'
    when p ilike 'unfriendly%' then 'FAS 4-5 (STOP)'
    else null
  end;
$$;


--
-- Name: med_scheduled_dvm(uuid, date, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_scheduled_dvm(p_location uuid, p_date date, p_board_type text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
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


--
-- Name: FUNCTION med_scheduled_dvm(p_location uuid, p_date date, p_board_type text); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.med_scheduled_dvm(p_location uuid, p_date date, p_board_type text) IS 'Doctor(s) the schedule places on a board that day. Multiple vets are joined with " / " (e.g. a department running two DVMs).';


--
-- Name: med_sex_short(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_sex_short(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select case
    when p is null then null
    when p ilike 'male neutered%'  or p ilike 'mn%' then 'MN'
    when p ilike 'female spayed%'  or p ilike 'fs%' then 'FS'
    when p ilike 'male%'                            then 'M'
    when p ilike 'female%'                          then 'F'
    else p
  end;
$$;


--
-- Name: med_species_short(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.med_species_short(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
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


--
-- Name: medical_board_coverage(date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_coverage(p_date date) RETURNS TABLE(location_id uuid, location_name text, dept_code text, dept_name text, board_type text, board_label text, appointments bigint, on_board bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
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


--
-- Name: FUNCTION medical_board_coverage(p_date date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.medical_board_coverage(p_date date) IS 'Medical board coverage for one day: which board slots are staffed and by whom.';


--
-- Name: medical_board_fill_staff(date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_fill_staff(p_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
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


--
-- Name: FUNCTION medical_board_fill_staff(p_date date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.medical_board_fill_staff(p_date date) IS 'Fills medical_board_row.csr (from the booking-note initials) and .dt (schedule first, then the invoiced case owner). Skips rows edited by a human.';


--
-- Name: medical_board_patch_card(uuid, jsonb, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_patch_card(p_row uuid, p_patch jsonb, p_actor text DEFAULT NULL::text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  update greendogops.medical_board_row
     set card = coalesce(card, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
         updated_by = coalesce(p_actor, updated_by)
   where id = p_row;
$$;


--
-- Name: medical_board_register_missing_types(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_register_missing_types() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
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


--
-- Name: medical_board_rollover(date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_rollover(p_today date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
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


--
-- Name: medical_board_row_guard(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_row_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
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


--
-- Name: medical_board_row_set_key(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_row_set_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
begin
  new.board_key := new.location_id::text || ':' ||
                   to_char(new.board_date, 'YYYY-MM-DD') || ':' ||
                   new.board_type;
  return new;
end;
$$;


--
-- Name: medical_board_seed(uuid, date, text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.medical_board_seed(p_location uuid, p_date date, p_board_type text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
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


--
-- Name: merge_person(uuid, uuid); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.merge_person(p_keep uuid, p_dup uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
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


--
-- Name: FUNCTION merge_person(p_keep uuid, p_dup uuid); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.merge_person(p_keep uuid, p_dup uuid) IS 'Folds the duplicate person row into the keeper (contact gaps, 1:1 children when absent, all multi-row children) and deletes it. Confirm the pair before calling — this is not reversible.';


--
-- Name: merge_record_tag(text, text, text, text, date, jsonb, text, text, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text DEFAULT 'pet_tag'::text, p_tag_group text DEFAULT NULL::text, p_activity_from date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
declare
  v_codes     text[];
  v_matched   integer := 0;
  v_added     integer := 0;
  v_confirmed integer := 0;
  v_removed   integer := 0;
  v_existing  integer := 0;
begin
  if p_mode not in ('backfill', 'incremental') then
    raise exception 'merge_record_tag: unknown mode %', p_mode;
  end if;
  if p_mode = 'incremental' and p_activity_from is null then
    raise exception 'merge_record_tag: an incremental run needs p_activity_from';
  end if;
  if p_record_type not in ('contact', 'animal') then
    raise exception 'merge_record_tag: unknown record type %', p_record_type;
  end if;

  select count(*) into v_existing
  from greendogops.ezyvet_record_tag
  where tag_key = p_tag_key and record_type = p_record_type and removed_on is null;

  select array_agg(distinct btrim(r->>'record_code'))
    into v_codes
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
  where nullif(btrim(r->>'record_code'), '') is not null;

  v_codes   := coalesce(v_codes, '{}');
  v_matched := coalesce(array_length(v_codes, 1), 0);

  -- A backfill that comes back empty for a tag that currently has members is
  -- almost always a broken export, and acting on it would retire the entire
  -- population. Refuse rather than destroy.
  if p_mode = 'backfill' and v_matched = 0 and v_existing > 0 then
    raise exception
      'merge_record_tag: backfill of % returned no records but % are currently tagged — refusing to retire them all',
      p_tag_key, v_existing;
  end if;

  insert into greendogops.ezyvet_tag
    (tag_key, tag_label, tag_type, tag_group, record_type, last_run_on, backfilled_on)
  values
    (p_tag_key, p_tag_label, coalesce(p_tag_type, 'pet_tag'), p_tag_group, p_record_type, p_run_on,
     case when p_mode = 'backfill' then p_run_on end)
  on conflict (tag_key) do update
    set tag_label     = excluded.tag_label,
        tag_type      = excluded.tag_type,
        tag_group     = coalesce(excluded.tag_group, greendogops.ezyvet_tag.tag_group),
        record_type   = excluded.record_type,
        last_run_on   = excluded.last_run_on,
        backfilled_on = coalesce(excluded.backfilled_on, greendogops.ezyvet_tag.backfilled_on);

  with incoming as (
    select distinct on (btrim(r->>'record_code'))
           btrim(r->>'record_code')                   as record_code,
           nullif(btrim(r->>'record_name'), '')       as record_name,
           nullif(btrim(r->>'contact_code'), '')      as contact_code,
           nullif(btrim(r->>'ezyvet_contact_id'), '') as ezyvet_contact_id,
           nullif(btrim(r->>'email'), '')             as email
    from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
    where nullif(btrim(r->>'record_code'), '') is not null
  ),
  up as (
    insert into greendogops.ezyvet_record_tag as m
      (tag_key, record_type, record_code, record_name, contact_code,
       ezyvet_contact_id, email, first_seen_on, last_confirmed_on)
    select p_tag_key, p_record_type, record_code, record_name, contact_code,
           ezyvet_contact_id, email, p_run_on, p_run_on
    from incoming
    on conflict (tag_key, record_type, record_code) do update
      set record_name       = coalesce(excluded.record_name, m.record_name),
          contact_code      = coalesce(excluded.contact_code, m.contact_code),
          ezyvet_contact_id = coalesce(excluded.ezyvet_contact_id, m.ezyvet_contact_id),
          email             = coalesce(excluded.email, m.email),
          last_confirmed_on = excluded.last_confirmed_on,
          -- A tag put back on a record revives the existing row; first_seen_on
          -- keeps the ORIGINAL date so the history is not rewritten.
          removed_on        = null,
          first_seen_on     = least(m.first_seen_on, excluded.first_seen_on)
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into v_added, v_confirmed
  from up;

  update greendogops.ezyvet_record_tag m
     set removed_on = p_run_on
   where m.tag_key = p_tag_key
     and m.record_type = p_record_type
     and m.removed_on is null
     and not (m.record_code = any (v_codes))
     and (
       p_mode = 'backfill'
       or (p_record_type = 'contact' and exists (
             select 1 from greendogops.ezyvet_contact c
              where c.contact_code = m.record_code
                and c.ezyvet_modified_at >= p_activity_from))
       or (p_record_type = 'animal' and exists (
             select 1 from greendogops.ezyvet_animal a
              where a.animal_code = m.record_code
                and a.ezyvet_modified_at >= p_activity_from))
     );
  get diagnostics v_removed = row_count;

  insert into greendogops.ezyvet_record_tag_run
    (tag_key, mode, activity_from, matched, added, confirmed, removed, ran_on)
  values
    (p_tag_key, p_mode, p_activity_from, v_matched, v_added, v_confirmed, v_removed, p_run_on);

  return jsonb_build_object(
    'tag_key', p_tag_key, 'mode', p_mode, 'matched', v_matched,
    'added', v_added, 'confirmed', v_confirmed, 'removed', v_removed
  );
end;
$$;


--
-- Name: FUNCTION merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text, p_tag_group text, p_activity_from date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text, p_tag_group text, p_activity_from date) IS 'Apply one ezyVet tag pull: upsert catalog + membership, retire records that lost the tag (backfill = all, incremental = only records inside the activity window), log the run.';


--
-- Name: name_tokens(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.name_tokens(raw text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select array_remove(
    regexp_split_to_array(
      trim(
        regexp_replace(
          lower(regexp_replace(coalesce(raw, ''), '^\s*dr\.?\s*', '', 'i')),
          '[^a-z ]', ' ', 'g'
        )
      ),
      '\s+'
    ),
    ''
  );
$$;


--
-- Name: new_confirmation_code(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.new_confirmation_code() RETURNS text
    LANGUAGE sql
    SET search_path TO 'pg_catalog'
    AS $$
  select string_agg(
           substr('23456789ABCDEFGHJKMNPQRSTVWXYZ',
                  (floor(random() * 30) + 1)::int, 1),
           ''
         )
  from generate_series(1, 6);
$$;


--
-- Name: FUNCTION new_confirmation_code(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.new_confirmation_code() IS 'Six-character human-readable confirmation code shown on the post-submission ticket. Ambiguous glyphs (I/L/O/U/0/1) are excluded.';


--
-- Name: new_qr_token(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.new_qr_token() RETURNS text
    LANGUAGE sql
    SET search_path TO 'greendogops', 'extensions', 'pg_catalog', 'public'
    AS $$ select encode(extensions.gen_random_bytes(8), 'hex') $$;


--
-- Name: FUNCTION new_qr_token(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.new_qr_token() IS 'Random 16-char hex token used as the public, non-enumerable handle in a partner QR code URL.';


--
-- Name: normalize_doc_recommendation(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.normalize_doc_recommendation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
begin
  new.doc_recommendation := nullif(lower(trim(coalesce(new.doc_recommendation, ''))), '');
  if new.doc_recommendation is not null
     and new.doc_recommendation not in ('red', 'yellow', 'green') then
    new.doc_recommendation := null;
  end if;
  return new;
end;
$$;


--
-- Name: normalize_job_title(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.normalize_job_title(raw text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select coalesce(
    (
      select a.canonical
        from (values
          -- Veterinary support staff
          ('vet assistant',                       'Veterinary Assistant'),
          ('vet asst',                            'Veterinary Assistant'),
          ('veterinary assistant',                'Veterinary Assistant'),
          ('vet assistant trainee',               'Veterinary Assistant Trainee'),
          ('veterinary assistant trainee',        'Veterinary Assistant Trainee'),
          ('vet tech',                            'Veterinary Technician'),
          ('vet technician',                      'Veterinary Technician'),
          ('veterinary tech',                     'Veterinary Technician'),
          ('veterinary technician',               'Veterinary Technician'),
          ('dental tech',                         'Dental Technician'),
          ('dental technician',                   'Dental Technician'),
          ('lead clinical tech',                  'Lead Clinical Technician'),
          ('lead clinical technician',            'Lead Clinical Technician'),
          ('registered vet tech',                 'RVT'),
          ('registered vet technician',           'RVT'),
          ('registered veterinary tech',          'RVT'),
          ('registered veterinary technician',    'RVT'),
          ('registered veterinary technician rvt','RVT'),
          ('rvt',                                 'RVT'),
          -- Doctors
          ('dvm',                                 'DVM'),
          ('doctor of veterinary medicine',       'DVM'),
          ('relief vet',                          'Relief DVM'),
          ('relief dvm',                          'Relief DVM'),
          ('relief veterinarian',                 'Relief DVM'),
          ('opthamologist',                       'Ophthalmologist'),
          ('ophthalmologist',                     'Ophthalmologist'),
          -- Interns / students
          ('vet intern',                          'Veterinary Intern'),
          ('veterinary intern',                   'Veterinary Intern'),
          ('foreign vet graduate intern',         'Foreign Veterinary Graduate Intern'),
          ('foreign veterinary graduate intern',  'Foreign Veterinary Graduate Intern'),
          ('foreign veterinary graduate internship','Foreign Veterinary Graduate Intern'),
          -- Client service
          ('csr',                                 'CSR'),
          ('csr lead',                            'CSR Lead'),
          ('rcsr',                                'RCSR'),
          ('in house csr',                        'In-House CSR'),
          ('remote csr',                          'Remote CSR'),
          ('remote csr manager',                  'Remote CSR Manager'),
          ('remote csr admin',                    'Remote CSR / Administrator'),
          -- Administration
          ('remote admin',                        'Remote Administrator'),
          ('remote administration',               'Remote Administrator'),
          ('remote administrator',                'Remote Administrator'),
          ('in house admin',                      'In-House Administrator'),
          ('in house administration',             'In-House Administrator'),
          ('in house administrator',              'In-House Administrator'),
          ('my pet admin',                        'My Pet Administrator'),
          ('my pet administration',               'My Pet Administrator'),
          ('my pet administrator',                'My Pet Administrator'),
          ('mp truck admin',                      'MP Truck Administrator'),
          ('mp truck administrator',              'MP Truck Administrator'),
          -- Leadership
          ('coo',                                 'COO'),
          ('chief operations officer',            'COO'),
          ('cfo',                                 'CFO'),
          ('chief financial officer',             'CFO'),
          ('cmo',                                 'CMO'),
          ('chief marketing officer',             'CMO'),
          ('cco',                                 'CCO'),
          ('chief culture officer',               'CCO')
        ) as a(key, canonical)
        -- Match on a punctuation-free lookup key so hyphen/casing/"?" variants
        -- ("In-House CSR", "in house csr", "Remote CSR?") collapse to one entry.
       where a.key = btrim(regexp_replace(lower(raw), '[^a-z0-9]+', ' ', 'g'))
       limit 1
    ),
    -- Unknown titles: keep the text, just trim and collapse inner whitespace.
    nullif(btrim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g')), '')
  );
$$;


--
-- Name: normalize_person_key(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.normalize_person_key(t text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public'
    AS $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '\([^)]*\)', ' ', 'g'),
        '\mdr\.?\M', ' ', 'g'),
      '[^a-z ]', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;


--
-- Name: normalize_student_program(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.normalize_student_program() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $_$
declare
  np text;
  ns text;
begin
  if new.contact_type is distinct from 'student' then
    return new;
  end if;

  -- (a) A managed label parked in program_type while program_name is empty
  --     (legacy grid import): promote it. Bare lowercase classification tokens
  --     such as 'externship' / 'paid_cohort' are NOT labels, so skip them.
  if nullif(btrim(new.program_name), '') is null
     and new.program_type is not null
     and new.program_type !~ '^[a-z_]+$' then
    select s.pname, s.psub into np, ns
      from greendogops.split_student_program(new.program_type) s;
    if np is not null then
      new.program_name := np;
      new.program_subcategory :=
        coalesce(ns, nullif(btrim(new.program_subcategory), ''));
      new.program_type := null;
      return new;
    end if;
  end if;

  -- (b) A managed prefix stored directly in program_name WITH trailing text:
  --     split it into canonical name + subcategory.
  if nullif(btrim(new.program_name), '') is not null then
    select s.pname, s.psub into np, ns
      from greendogops.split_student_program(new.program_name) s;
    if np is not null and btrim(new.program_name) <> np then
      new.program_name := np;
      new.program_subcategory :=
        coalesce(ns, nullif(btrim(new.program_subcategory), ''));
    end if;
  end if;

  return new;
end;
$_$;


--
-- Name: person_after_change(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.person_after_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops'
    AS $$
declare
  schedulable    boolean := (new.status = 'employee' and new.is_active);
  status_changed boolean := (tg_op = 'INSERT')
                            or (new.status is distinct from old.status)
                            or (new.is_active is distinct from old.is_active);
  synced_name    text;
begin
  -- (a) Status transitions cascade into scheduling eligibility + access.
  if status_changed then
    if schedulable then
      -- An active employee is schedulable and must have a settings row so they
      -- appear in the schedule Setup + grids.
      insert into greendogops.sched_employee_setting (person_id, is_schedulable)
      values (new.id, true)
      on conflict (person_id) do update set is_schedulable = true;
    else
      -- Prospects / applicants / contractors / former staff are not schedulable
      -- until someone switches them on explicitly.
      update greendogops.sched_employee_setting
        set is_schedulable = false
        where person_id = new.id;

      -- A departing employee automatically loses their login account.
      if new.status = 'former' then
        update greendogops.app_user
          set is_active = false
          where person_id = new.id;
      end if;
    end if;
  end if;

  -- (b) Identity always stays in sync with a linked login account, so the
  --     roster and the user list can never drift apart.
  synced_name := nullif(
    trim(coalesce(new.full_name, concat_ws(' ', new.first_name, new.last_name))),
    ''
  );
  update greendogops.app_user
    set full_name = coalesce(synced_name, full_name),
        email     = coalesce(new.email, email)
    where person_id = new.id;

  return null;
end;
$$;


--
-- Name: person_before_change(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.person_before_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    new.status_changed_at := now();
    if new.status in ('employee', 'contractor') then
      new.is_active := true;
    elsif new.status = 'former' then
      new.is_active := false;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: process_reporting_refresh(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.process_reporting_refresh() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  pending boolean;
begin
  -- Only one refresh at a time (manual request vs. daily job).
  if not pg_try_advisory_xact_lock(hashtext('greendogops.reporting_refresh')) then
    return;
  end if;

  select requested_at is not null
         and (completed_at is null or requested_at > completed_at)
    into pending
  from greendogops.reporting_refresh_state
  where id;

  if not pending then
    return;
  end if;

  perform greendogops.refresh_ezyvet_reporting();
  update greendogops.reporting_refresh_state set completed_at = now() where id;
end;
$$;


--
-- Name: protect_new_objects(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.protect_new_objects() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
declare
  cmd record;
  obj_schema text;
  obj_name text;
  fn_sig text;
  fn_has_search_path boolean;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name is distinct from 'greendogops' then
      continue;
    end if;

    if cmd.command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE') then
      select format('%I.%I(%s)', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid)),
             p.proconfig is not null
               and exists (select 1 from unnest(p.proconfig) c
                            where c like 'search_path=%')
        into fn_sig, fn_has_search_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.oid = cmd.objid;

      if fn_sig is null then
        continue;
      end if;

      execute format('revoke all on routine %s from public, anon', fn_sig);
      execute format('grant execute on routine %s to service_role', fn_sig);

      if not fn_has_search_path then
        execute format('alter function %s set search_path = greendogops, public, pg_temp', fn_sig);
      end if;

      raise notice '%: EXECUTE revoked from public/anon (service role only; grant authenticated explicitly if a page needs it)', fn_sig;
      continue;
    end if;

    select n.nspname, c.relname into obj_schema, obj_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.oid = cmd.objid;

    if obj_name is null then
      continue;
    end if;

    if cmd.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') then
      execute format('alter table greendogops.%I enable row level security', obj_name);
      execute format(
        'create policy gdo_members_all on greendogops.%I '
        'for all to authenticated '
        'using (greendogops.is_gdo_user()) '
        'with check (greendogops.is_gdo_user())',
        obj_name
      );
      raise notice 'greendogops.%: RLS enabled with gdo_members_all policy', obj_name;

    elsif cmd.command_tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW') then
      execute format('revoke all on greendogops.%I from anon, authenticated', obj_name);
      raise notice 'greendogops.%: revoked from anon/authenticated (read it with the service role)', obj_name;
    end if;
  end loop;
end;
$$;


--
-- Name: FUNCTION protect_new_objects(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.protect_new_objects() IS 'Event-trigger body: applies the migration 0164 RLS baseline to newly created greendogops tables/views.';


--
-- Name: rate_limit_hit(text, integer, integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
declare
  v_hits integer;
begin
  insert into greendogops.rate_limit_bucket as b (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update set
    hits = case
      when b.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else b.hits + 1
    end,
    window_start = case
      when b.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else b.window_start
    end
  returning hits into v_hits;

  -- Opportunistic cleanup keeps the table small without a cron.
  if random() < 0.01 then
    delete from greendogops.rate_limit_bucket
    where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: referral_partners; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.referral_partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hospital_name text,
    contact_person text,
    email text,
    phone text,
    address text,
    tier text DEFAULT 'Coal'::text NOT NULL,
    total_referrals integer DEFAULT 0 NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    key_decision_maker text,
    key_decision_maker_title text,
    key_decision_maker_email text,
    key_decision_maker_phone text,
    preferences jsonb DEFAULT '{}'::jsonb,
    communication_preference text DEFAULT 'email'::text,
    relationship_status text DEFAULT 'new'::text,
    last_contact_date date,
    next_followup_date date,
    specialty_areas text[],
    referral_value_monthly numeric(10,2),
    contract_end_date date,
    status text DEFAULT 'active'::text,
    category text,
    website text,
    description text,
    icon text DEFAULT 'mdi-factory'::text,
    color text DEFAULT 'grey'::text,
    products text[] DEFAULT '{}'::text[],
    revenue_ytd numeric(12,2) DEFAULT 0,
    revenue_last_year numeric(12,2) DEFAULT 0,
    average_monthly_revenue numeric(10,2) DEFAULT 0,
    priority text,
    zone text,
    clinic_type text DEFAULT 'general'::text,
    size text DEFAULT 'small'::text,
    monthly_referral_goal integer DEFAULT 0,
    quarterly_revenue_goal numeric(12,2) DEFAULT 0,
    current_month_referrals integer DEFAULT 0,
    current_quarter_revenue numeric(12,2) DEFAULT 0,
    visit_frequency text DEFAULT 'monthly'::text,
    last_visit_date date,
    preferred_visit_day text,
    preferred_visit_time text,
    best_contact_person text,
    needs_followup boolean DEFAULT false,
    followup_reason text,
    referral_agreement_type text DEFAULT 'none'::text,
    ce_event_host boolean DEFAULT false,
    lunch_and_learn_eligible boolean DEFAULT true,
    drop_off_materials boolean DEFAULT true,
    tags text[] DEFAULT '{}'::text[],
    name text DEFAULT 'Unknown'::text NOT NULL,
    contact_name text,
    deleted_at timestamp with time zone,
    partner_type text DEFAULT 'clinic'::text,
    events_attended text[] DEFAULT '{}'::text[],
    is_confirmed boolean DEFAULT false,
    booth_size text,
    total_referrals_ytd integer DEFAULT 0,
    total_referrals_all_time integer DEFAULT 0,
    relationship_score integer DEFAULT 50,
    preferred_contact_time text,
    instagram_handle text,
    facebook_url text,
    linkedin_url text,
    payment_status text,
    payment_amount numeric(10,2),
    payment_date date,
    organization_type text,
    employee_count text,
    total_revenue_all_time numeric(12,2) DEFAULT 0.00,
    last_sync_date timestamp with time zone,
    visit_overdue boolean DEFAULT false,
    expected_visit_frequency_days integer DEFAULT 180,
    days_since_last_visit integer,
    visit_tier text DEFAULT 'Low'::text,
    relationship_health integer DEFAULT 50,
    last_referral_date timestamp with time zone,
    last_data_source text DEFAULT 'manual'::text,
    referral_divisions text[] DEFAULT '{}'::text[],
    services text[] DEFAULT '{}'::text[],
    latitude numeric,
    longitude numeric,
    place_id text,
    geocoded_address text,
    service_radius_km numeric DEFAULT 25,
    referrals_last_12_months integer DEFAULT 0,
    geocoded_at timestamp with time zone,
    last_email_date date,
    geocode_attempted_at timestamp with time zone,
    geocode_error text,
    CONSTRAINT referral_partners_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['Imaging Equipment'::text, 'Surgical Instruments'::text, 'Laboratory'::text, 'Pharmaceuticals'::text, 'Anesthesia'::text, 'Dental'::text, 'Monitoring'::text, 'Consumables'::text, 'Software'::text, 'Other'::text])))),
    CONSTRAINT referral_partners_clinic_type_check CHECK ((clinic_type = ANY (ARRAY['general'::text, 'specialty'::text, 'emergency'::text, 'urgent_care'::text, 'mobile'::text, 'shelter'::text, 'corporate'::text, 'independent'::text]))),
    CONSTRAINT referral_partners_communication_preference_check CHECK ((communication_preference = ANY (ARRAY['email'::text, 'phone'::text, 'text'::text, 'in_person'::text]))),
    CONSTRAINT referral_partners_employee_count_check CHECK ((employee_count = ANY (ARRAY['1-5'::text, '6-20'::text, '21-50'::text, '51-200'::text, '200+'::text, NULL::text]))),
    CONSTRAINT referral_partners_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'pending'::text, 'overdue'::text, 'waived'::text, NULL::text]))),
    CONSTRAINT referral_partners_preferred_visit_day_check CHECK ((preferred_visit_day = ANY (ARRAY['monday'::text, 'tuesday'::text, 'wednesday'::text, 'thursday'::text, 'friday'::text, NULL::text]))),
    CONSTRAINT referral_partners_preferred_visit_time_check CHECK ((preferred_visit_time = ANY (ARRAY['morning'::text, 'midday'::text, 'afternoon'::text, NULL::text]))),
    CONSTRAINT referral_partners_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['Very High'::text, 'High'::text, 'Medium'::text, 'Low'::text])))),
    CONSTRAINT referral_partners_referral_agreement_type_check CHECK ((referral_agreement_type = ANY (ARRAY['none'::text, 'informal'::text, 'formal'::text, 'exclusive'::text]))),
    CONSTRAINT referral_partners_relationship_score_check CHECK (((relationship_score >= 0) AND (relationship_score <= 100))),
    CONSTRAINT referral_partners_relationship_status_check CHECK ((relationship_status = ANY (ARRAY['Excellent'::text, 'Good'::text, 'Fair'::text, 'Needs Attention'::text, 'At Risk'::text, 'new'::text, 'developing'::text, 'established'::text, 'at_risk'::text, 'churned'::text]))),
    CONSTRAINT referral_partners_size_check CHECK ((size = ANY (ARRAY['small'::text, 'medium'::text, 'large'::text, 'enterprise'::text]))),
    CONSTRAINT referral_partners_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text])))),
    CONSTRAINT referral_partners_tier_check CHECK (((tier IS NULL) OR (tier = ANY (ARRAY['Platinum'::text, 'Gold'::text, 'Silver'::text, 'Bronze'::text, 'Coal'::text])))),
    CONSTRAINT referral_partners_visit_frequency_check CHECK ((visit_frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'annually'::text, 'as_needed'::text]))),
    CONSTRAINT referral_partners_zone_check CHECK (((zone IS NULL) OR (zone = ANY (ARRAY['Westside & Coastal'::text, 'South Valley'::text, 'North Valley'::text, 'Central & Eastside'::text, 'South Bay'::text, 'San Gabriel Valley'::text]))))
);


--
-- Name: COLUMN referral_partners.latitude; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.latitude IS 'Cached latitude (WGS84) resolved from address via Google Geocoding API.';


--
-- Name: COLUMN referral_partners.longitude; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.longitude IS 'Cached longitude (WGS84) resolved from address via Google Geocoding API.';


--
-- Name: COLUMN referral_partners.geocoded_address; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.geocoded_address IS 'The address string that produced the cached coordinates; used to detect staleness when the address changes.';


--
-- Name: COLUMN referral_partners.geocoded_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.geocoded_at IS 'Timestamp of the last successful geocode.';


--
-- Name: COLUMN referral_partners.geocode_attempted_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.geocode_attempted_at IS 'When geocoding was last attempted for the current address (success or failure).';


--
-- Name: COLUMN referral_partners.geocode_error; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.referral_partners.geocode_error IS 'Google Geocoding status for the last failed attempt (e.g. ZERO_RESULTS); null when located.';


--
-- Name: recalculate_partner_metrics(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.recalculate_partner_metrics() RETURNS SETOF greendogops.referral_partners
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops'
    AS $$
begin
  -- Step 0: re-derive ledger totals first.
  perform greendogops.recompute_referral_partner_totals();

  -- Step 1: Tier (FIXED revenue thresholds)
  update greendogops.referral_partners
  set tier = case
    when coalesce(total_revenue_all_time, 0) >= 30000 then 'Platinum'
    when coalesce(total_revenue_all_time, 0) >= 15000 then 'Gold'
    when coalesce(total_revenue_all_time, 0) >= 5000  then 'Silver'
    when coalesce(total_revenue_all_time, 0) >= 500   then 'Bronze'
    else 'Coal'
  end;

  -- Step 2: Priority (FIXED referral-count thresholds)
  update greendogops.referral_partners
  set priority = case
    when coalesce(total_referrals_all_time, 0) >= 20 then 'Very High'
    when coalesce(total_referrals_all_time, 0) >= 10 then 'High'
    when coalesce(total_referrals_all_time, 0) >= 3  then 'Medium'
    else 'Low'
  end;

  -- Step 3: Visit tier and expected cadence (unchanged — blended quantile)
  with visit_tier_calc as (
    select id,
      ntile(3) over (
        order by (coalesce(total_revenue_all_time, 0) + coalesce(total_referrals_all_time, 0) * 100) desc
      ) as visit_bucket
    from greendogops.referral_partners
  )
  update greendogops.referral_partners rp
  set
    visit_tier = case vtc.visit_bucket when 1 then 'High' when 2 then 'Medium' when 3 then 'Low' end,
    expected_visit_frequency_days = case vtc.visit_bucket when 1 then 60 when 2 then 120 when 3 then 180 end
  from visit_tier_calc vtc
  where rp.id = vtc.id;

  -- Step 4: Days since last visit + overdue
  update greendogops.referral_partners
  set
    days_since_last_visit = case
      when last_visit_date is not null then extract(day from (now() - last_visit_date::timestamp))::integer
      else null end,
    visit_overdue = case
      when last_visit_date is null then true
      when extract(day from (now() - last_visit_date::timestamp)) > coalesce(expected_visit_frequency_days, 120) then true
      else false end;

  -- Step 5a: Relationship health (tier + priority + visit recency + email
  -- recency). Email recency = 25% of the visit recency bands. Capped at 100.
  update greendogops.referral_partners
  set relationship_health = least(100, round(
      case tier
        when 'Platinum' then 40 when 'Gold' then 32 when 'Silver' then 24
        when 'Bronze' then 16 when 'Coal' then 8 else 0 end
      +
      case priority
        when 'Very High' then 30 when 'High' then 22 when 'Medium' then 15 when 'Low' then 8 else 0 end
      +
      case
        when last_visit_date is null then 0
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) * 0.5 then 30
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) then 20
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) * 1.5 then 10
        else 0 end
      +
      case
        when last_email_date is null then 0
        when extract(day from (now() - last_email_date::timestamp)) <= coalesce(expected_visit_frequency_days, 120) * 0.5 then 7.5
        when extract(day from (now() - last_email_date::timestamp)) <= coalesce(expected_visit_frequency_days, 120) then 5
        when extract(day from (now() - last_email_date::timestamp)) <= coalesce(expected_visit_frequency_days, 120) * 1.5 then 2.5
        else 0 end
    )::int);

  -- Step 5b: Status + follow-up flag, derived from the fresh health value.
  update greendogops.referral_partners
  set
    relationship_status = case
      when relationship_health >= 80 then 'Excellent'
      when relationship_health >= 60 then 'Good'
      when relationship_health >= 40 then 'Fair'
      when relationship_health >= 20 then 'Needs Attention'
      else 'At Risk' end,
    needs_followup = case
      when visit_overdue = true then true
      when relationship_health < 40 then true
      else needs_followup end;

  return query select * from greendogops.referral_partners order by name;
end;
$$;


--
-- Name: recompute_referral_partner_totals(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.recompute_referral_partner_totals() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops'
    AS $$
begin
  with agg as (
    select
      partner_id,
      count(*)::int                          as visit_count,
      round(sum(amount)::numeric, 2)         as revenue_sum,
      max(nullif(transaction_date,'')::date) as last_date
    from greendogops.referral_revenue_line_items
    where partner_id is not null
    group by partner_id
  )
  update greendogops.referral_partners p
  set
    total_revenue_all_time   = coalesce(a.revenue_sum, 0),
    total_referrals_all_time = coalesce(a.visit_count, 0),
    last_referral_date       = greatest(
      coalesce(p.last_referral_date::date, a.last_date),
      a.last_date
    )
  from agg a
  where p.id = a.partner_id;

  -- Zero out partners with no ledger rows so stale data clears.
  update greendogops.referral_partners p
  set
    total_revenue_all_time   = 0,
    total_referrals_all_time = 0
  where not exists (
    select 1 from greendogops.referral_revenue_line_items li
    where li.partner_id = p.id
  )
  and (p.total_revenue_all_time <> 0 or p.total_referrals_all_time <> 0);
end;
$$;


--
-- Name: record_qr_scan(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.record_qr_scan(p_token text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
  update greendogops.qr_code
     set scan_count = scan_count + 1,
         last_scanned_at = now()
   where token = p_token
     and active;
$$;


--
-- Name: FUNCTION record_qr_scan(p_token text); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.record_qr_scan(p_token text) IS 'Atomically bump a QR code''s scan counter. Called by the public /q/<token> page via the service-role client.';


--
-- Name: refresh_ezyvet_reporting(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.refresh_ezyvet_reporting() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops'
    SET statement_timeout TO '0'
    AS $$
declare
  mv text;
begin
  -- Base appointment roll-up first (report_* views read from it).
  begin
    refresh materialized view concurrently greendogops.ezyvet_appointment;
  exception when others then
    refresh materialized view greendogops.ezyvet_appointment;
  end;

  -- Every other matview, concurrently, falling back to a plain refresh. New
  -- report matviews are picked up automatically (auto-discovery from 0054).
  for mv in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'greendogops'
      and c.relkind = 'm'
      and c.relname <> 'ezyvet_appointment'
    order by c.relname
  loop
    begin
      execute format('refresh materialized view concurrently greendogops.%I', mv);
    exception when others then
      execute format('refresh materialized view greendogops.%I', mv);
    end;
  end loop;
end;
$$;


--
-- Name: register_influencer_qr_code(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.register_influencer_qr_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
begin
  insert into greendogops.qr_code (label, code_type, influencer_id, active)
  select coalesce(
           nullif(nullif(trim(new.contact_name), ''), '-'),
           nullif(trim(new.pet_name), ''),
           nullif('@' || trim(new.instagram_handle), '@'),
           'Influencer'
         ),
         'influencer',
         new.id,
         coalesce(new.status::text, '') <> 'inactive'
  where not exists (
    select 1 from greendogops.qr_code c where c.influencer_id = new.id
  );
  return new;
end;
$$;


--
-- Name: register_partner_qr_code(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.register_partner_qr_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
begin
  if lower(trim(coalesce(new.category, ''))) = 'marketing' and new.qr_token is not null then
    insert into greendogops.qr_code (token, label, code_type, org_id, active)
    values (
      new.qr_token,
      new.name,
      case
        when new.org_type = 'marketing_partner' and new.subtype = 'rescue' then 'rescue'
        else 'partner'
      end,
      new.id,
      true
    )
    on conflict (token) do nothing;
  end if;
  return new;
end;
$$;


--
-- Name: register_referral_qr_code(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.register_referral_qr_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
begin
  insert into greendogops.qr_code (label, code_type, referral_partner_id, active)
  select coalesce(nullif(trim(new.name), ''), new.hospital_name, 'Referral clinic'),
         'referral',
         new.id,
         coalesce(new.is_active, true)
  where not exists (
    select 1 from greendogops.qr_code c where c.referral_partner_id = new.id
  );
  return new;
end;
$$;


--
-- Name: report_location_daily(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.report_location_daily(p_start date, p_end date) RETURNS TABLE(location_key text, location_label text, service_date date, appointments integer, revenue numeric, unique_clients integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  select
    a.location_key,
    max(a.location_label)                        as location_label,
    a.service_date,
    count(*)::int                                as appointments,
    coalesce(sum(a.revenue), 0)                  as revenue,
    count(distinct a.client_contact_code)::int   as unique_clients
  from greendogops.ezyvet_appointment a
  where a.service_date between p_start and p_end
  group by a.location_key, a.service_date
  order by a.service_date, a.location_key;
$$;


--
-- Name: FUNCTION report_location_daily(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.report_location_daily(p_start date, p_end date) IS 'Appointments, revenue and unique clients per clinic PER DAY for an arbitrary date range (inclusive), from the ezyvet_appointment day-grain matview. Rows exist only for days a clinic actually billed, so the caller can count real trading days, detect missing ingest days, and normalize totals per open day. Use report_location_period() when a single collapsed total per clinic is enough.';


--
-- Name: report_location_period(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.report_location_period(p_start date, p_end date) RETURNS TABLE(location_key text, location_label text, appointments integer, revenue numeric, unique_clients integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  select
    a.location_key,
    max(a.location_label)                        as location_label,
    count(*)::int                                as appointments,
    coalesce(sum(a.revenue), 0)                  as revenue,
    count(distinct a.client_contact_code)::int   as unique_clients
  from greendogops.ezyvet_appointment a
  where a.service_date between p_start and p_end
  group by a.location_key
  order by appointments desc;
$$;


--
-- Name: FUNCTION report_location_period(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.report_location_period(p_start date, p_end date) IS 'Appointments, revenue and unique clients per clinic for an arbitrary date range (inclusive), from the ezyvet_appointment day-grain matview. Use for month-to-date / same-day-last-month comparisons; report_by_location and report_location_monthly only offer year and month grains.';


--
-- Name: request_reporting_refresh(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.request_reporting_refresh() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  update greendogops.reporting_refresh_state set requested_at = now() where id;
$$;


--
-- Name: rls_audit(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.rls_audit() RETURNS TABLE(object_name text, object_kind text, problem text)
    LANGUAGE sql STABLE
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
  select c.relname::text,
         'table',
         case when not c.relrowsecurity then 'RLS disabled'
              else 'RLS enabled but no policy' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'greendogops'
    and c.relkind = 'r'
    and (
      not c.relrowsecurity
      or not exists (select 1 from pg_policies p
                     where p.schemaname = 'greendogops' and p.tablename = c.relname)
    )
    -- service-role-only by design (0164)
    and c.relname not in ('credential', 'ats_hr_merge_backup_0032')

  union all

  select c.relname::text,
         case c.relkind when 'm' then 'matview' else 'view' end,
         'granted to ' || g.grantee
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.role_table_grants g
    on g.table_schema = n.nspname and g.table_name = c.relname
  where n.nspname = 'greendogops'
    and c.relkind in ('v', 'm')
    and g.grantee in ('anon', 'authenticated')
  group by c.relname, c.relkind, g.grantee

  union all

  select g.table_name::text, 'table', 'granted to anon'
  from information_schema.role_table_grants g
  where g.table_schema = 'greendogops'
    and g.grantee = 'anon'
  group by g.table_name

  union all

  -- 0211: anon must not be able to call anything in greendogops.
  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         'function',
         'EXECUTE granted to anon'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'greendogops'
    and p.prokind in ('f', 'p')
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all

  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         'function',
         'search_path not pinned'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'greendogops'
    and p.prokind in ('f', 'p')
    and not (p.proconfig is not null
             and exists (select 1 from unnest(p.proconfig) c
                          where c like 'search_path=%'));
$$;


--
-- Name: FUNCTION rls_audit(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.rls_audit() IS 'Returns every greendogops object still reachable by anon/authenticated without RLS. Expect zero rows.';


--
-- Name: search_resource_content(text, integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.search_resource_content(p_query text, p_limit integer DEFAULT 8) RETURNS TABLE(document_id uuid, title text, category text, source_url text, chunk_index integer, content text, rank real)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'greendogops', 'public'
    AS $$
declare
  v_all tsquery := websearch_to_tsquery('english', coalesce(p_query, ''));
  v_any tsquery;
begin
  -- OR of every lexeme left after stemming and stop-word removal.
  select string_agg(quote_literal(lex), ' | ')::tsquery
    into v_any
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) as lex;

  if v_any is null then
    return;
  end if;

  return query
    select d.id, d.title, d.category, d.source_url, c.chunk_index, c.content,
           ts_rank(c.tsv, v_any) as rank
      from greendogops.resource_document_chunk c
      join greendogops.resource_document d on d.id = c.document_id
     where d.is_active
       and c.tsv @@ v_any
     order by (v_all is not null and c.tsv @@ v_all) desc,
              ts_rank(c.tsv, v_any) desc,
              d.title, c.chunk_index
     limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: smart_examples(text, integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_examples(p_question text, p_limit integer DEFAULT 3) RETURNS TABLE(question text, sql text, rank real)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select l.question,
         l.sql,
         ts_rank(to_tsvector('english', l.question),
                 websearch_to_tsquery('english', p_question)) as rank
  from greendogops.smart_question_log l
  where l.verified
    and l.sql is not null
    and to_tsvector('english', l.question) @@ websearch_to_tsquery('english', p_question)
  order by rank desc, l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;


--
-- Name: FUNCTION smart_examples(p_question text, p_limit integer); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_examples(p_question text, p_limit integer) IS 'Verified question/SQL pairs closest to a new question, used as few-shot examples in the Smart Report prompt.';


--
-- Name: smart_functions(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_functions() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select coalesce(jsonb_agg(f order by f->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'name',    p.proname,
             'args',    pg_get_function_identity_arguments(p.oid),
             'returns', pg_get_function_result(p.oid),
             'comment', obj_description(p.oid, 'pg_proc')
           ) as f
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'greendogops'
      and p.prokind = 'f'
      and p.proretset
      and p.provolatile in ('i', 's')          -- immutable/stable = cannot write
      and p.proname not in (
        'smart_query', 'smart_schema', 'smart_value_hints', 'smart_functions',
        'recalculate_partner_metrics', 'undo_referral_upload', 'rls_audit'
      )
  ) s;
$$;


--
-- Name: FUNCTION smart_functions(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_functions() IS 'Read-only set-returning functions the Smart Report may call from a SELECT.';


--
-- Name: smart_glossary_for(text, integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_glossary_for(p_question text, p_limit integer DEFAULT 8) RETURNS TABLE(term text, definition text, sql_hint text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $_$
  with phrases as (
    select g.id, g.term, g.definition, g.sql_hint,
           unnest(array_prepend(g.term, g.aliases)) as phrase
    from greendogops.smart_glossary g
    where g.status = 'active'
  )
  select distinct on (p.id) p.term, p.definition, p.sql_hint
  from phrases p
  where coalesce(p_question, '') ~*
        ('\m' || regexp_replace(p.phrase, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(s|es)?\M')
  order by p.id, length(p.phrase) desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$_$;


--
-- Name: FUNCTION smart_glossary_for(p_question text, p_limit integer); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_glossary_for(p_question text, p_limit integer) IS 'Glossary entries whose term or alias appears in a question, for injection into the Smart Report prompt.';


--
-- Name: smart_query(text, integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_query(p_sql text, p_limit integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    SET statement_timeout TO '60s'
    AS $_$
declare
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := case when coalesce(p_limit, 0) > 0 then p_limit else null end;
  v_code  text;
  v_out   jsonb;
begin
  v_sql := btrim(regexp_replace(v_sql, ';+\s*$', ''));

  if v_sql = '' then
    raise exception 'empty query';
  end if;
  if v_sql !~* '^(with|select)\s' then
    raise exception 'only SELECT queries are allowed';
  end if;
  if v_sql ~ '\$[A-Za-z_0-9]*\$' then
    raise exception 'dollar-quoted strings are not allowed';
  end if;

  -- Comments and quoted literals are DATA, not code. Strip them before the
  -- structural checks so a value like 'DO NOT USE' cannot read as a keyword.
  v_code := regexp_replace(v_sql, '/\*.*?\*/', ' ', 'gs');
  v_code := regexp_replace(v_code, '--[^' || chr(10) || ']*', ' ', 'g');
  v_code := regexp_replace(v_code, $re$'(?:[^']|'')*'$re$, ' ', 'g');

  if v_code like '%;%' then
    raise exception 'only a single statement is allowed';
  end if;
  if v_code ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|refresh|reindex|merge|call|do|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|dblink|set_config|current_setting|lo_import|lo_export)\M' then
    raise exception 'query contains a disallowed keyword';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (select * from (%s) q %s) r',
    v_sql,
    case when v_limit is null then '' else format('limit %s', v_limit) end
  )
  into v_out;

  return v_out;
end;
$_$;


--
-- Name: FUNCTION smart_query(p_sql text, p_limit integer); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_query(p_sql text, p_limit integer) IS 'Smart Report: runs one read-only SELECT and returns jsonb rows. No row cap unless p_limit > 0. service_role only.';


--
-- Name: smart_schema(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_schema() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', t.relname, 'kind', t.kind, 'rows', t.rows, 'columns', t.cols)
      order by t.relname
    ),
    '[]'::jsonb
  )
  from (
    select
      c.relname,
      case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind,
      case when c.reltuples < 0 then null else c.reltuples::bigint end as rows,
      jsonb_agg(
        jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod))
        order by a.attnum
      ) as cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'greendogops'
      and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege(c.oid, 'select')
    group by c.relname, c.relkind, c.reltuples
  ) t;
$$;


--
-- Name: FUNCTION smart_schema(); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_schema() IS 'Smart Report: table/column catalog used as LLM context. service_role only.';


--
-- Name: smart_value_hints(integer); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.smart_value_hints(p_max_distinct integer DEFAULT 40) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('table', h.tablename, 'column', h.attname, 'values', h.vals)
      order by h.tablename, h.attname
    ),
    '[]'::jsonb
  )
  from (
    select
      s.tablename,
      s.attname,
      (
        select jsonb_agg(left(v, 60) order by ord)
        from (
          select v, ord
          from unnest(s.most_common_vals::text::text[]) with ordinality u(v, ord)
          where v is not null and v <> '' and length(v) <= 60
          order by ord
          limit 40
        ) x
      ) as vals
    from pg_stats s
    join pg_class c on c.relname = s.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = s.schemaname
    join pg_attribute a on a.attrelid = c.oid and a.attname = s.attname
    join pg_type ty on ty.oid = a.atttypid
    where s.schemaname = 'greendogops'
      and c.relkind in ('r', 'p', 'm')
      and s.most_common_vals is not null
      and s.n_distinct between 1 and greatest(coalesce(p_max_distinct, 40), 1)
      -- booleans carry no vocabulary worth spending prompt tokens on
      and ty.typname in ('text', 'varchar', 'bpchar')
      and s.attname !~* '(password|secret|token|api_key|access_key|private|ssn|hash|salt)'
  ) h
  where h.vals is not null;
$$;


--
-- Name: FUNCTION smart_value_hints(p_max_distinct integer); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.smart_value_hints(p_max_distinct integer) IS 'Smart Report: distinct-value vocabulary for low-cardinality text columns, read from planner stats. service_role only.';


--
-- Name: split_student_program(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.split_student_program(label text) RETURNS TABLE(pname text, psub text)
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
  select
    case
      when label ~* '^SAPP'               then 'SAP'
      when label ~* '^SAP'                then 'SAP'
      when label ~* '^Western Extern'     then 'Western Extern'
      when label ~* '^Externship'         then 'Externship'
      when label ~* '^Dentistry Rotation' then 'Dentistry Rotation'
    end,
    nullif(btrim(
      case
        when label ~* '^SAPP'               then substr(label, 5)
        when label ~* '^SAP'                then substr(label, 4)
        when label ~* '^Western Extern'     then substr(label, 15)
        when label ~* '^Externship'         then substr(label, 11)
        when label ~* '^Dentistry Rotation' then substr(label, 19)
      end
    ), '');
$$;


--
-- Name: split_tag_list(text); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.split_tag_list(p_list text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'greendogops', 'public', 'pg_temp'
    AS $$
declare
  tags  text[] := '{}';
  buf   text   := '';
  ch    text;
  depth int    := 0;
  i     int;
begin
  for i in 1..length(p_list) loop
    ch := substr(p_list, i, 1);
    if ch = '(' then
      depth := depth + 1;
      buf := buf || ch;
    elsif ch = ')' then
      depth := greatest(depth - 1, 0);
      buf := buf || ch;
    elsif ch = ',' and depth = 0 then
      if btrim(buf) <> '' then tags := tags || btrim(buf); end if;
      buf := '';
    else
      buf := buf || ch;
    end if;
  end loop;
  if btrim(buf) <> '' then tags := tags || btrim(buf); end if;
  return tags;
end;
$$;


--
-- Name: FUNCTION split_tag_list(p_list text); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.split_tag_list(p_list text) IS 'Split an ezyVet comma-joined tag cell into individual tags, ignoring commas inside parentheses.';


--
-- Name: trg_request_reporting_refresh(); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.trg_request_reporting_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
begin
  perform greendogops.request_reporting_refresh();
  return null;  -- AFTER STATEMENT trigger: the return value is ignored.
end;
$$;


--
-- Name: undo_referral_upload(uuid); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.undo_referral_upload(p_upload_id uuid) RETURNS TABLE(rows_deleted integer, upload_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops'
    AS $$
declare
  v_deleted integer;
begin
  if p_upload_id is null then
    raise exception 'upload_id is required';
  end if;

  delete from greendogops.referral_revenue_line_items
  where upload_id = p_upload_id;
  get diagnostics v_deleted = row_count;

  update greendogops.referral_sync_history
  set sync_details = coalesce(sync_details, '{}'::jsonb)
                     || jsonb_build_object('undone_at', now(), 'rows_removed', v_deleted)
  where id = p_upload_id;

  perform greendogops.recompute_referral_partner_totals();

  return query select v_deleted, p_upload_id;
end;
$$;


--
-- Name: upcoming_appointment_demand(date, date); Type: FUNCTION; Schema: greendogops; Owner: -
--

CREATE FUNCTION greendogops.upcoming_appointment_demand(p_start date, p_end date) RETURNS TABLE(location_id uuid, location_name text, appt_date date, report_track text, booked integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'greendogops', 'public'
    AS $$
  with latest as (
    select s.location_id, s.appt_date, max(s.snapshot_date) as snapshot_date
    from greendogops.ezyvet_agenda_appt_snapshot s
    where s.appt_date between p_start and p_end
    group by s.location_id, s.appt_date
  )
  select s.location_id,
         l.name,
         s.appt_date,
         m.report_track,
         count(*)::int
  from greendogops.ezyvet_agenda_appt_snapshot s
  join latest x
    on  x.location_id   = s.location_id
    and x.appt_date     = s.appt_date
    and x.snapshot_date = s.snapshot_date
  join greendogops.location l
    on l.id = s.location_id
  join greendogops.ezyvet_appt_type_dept_map m
    on m.appt_type = btrim(s.appt_type)
  where m.report_track is not null
    and m.is_ignored = false
  group by s.location_id, l.name, s.appt_date, m.report_track;
$$;


--
-- Name: FUNCTION upcoming_appointment_demand(p_start date, p_end date); Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON FUNCTION greendogops.upcoming_appointment_demand(p_start date, p_end date) IS 'Booked appointments per clinic/day/report track from the latest Agenda snapshot; numerator of the upcoming-appointments Slack report.';


--
-- Name: agent; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.agent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    category text DEFAULT 'ingest'::text NOT NULL,
    schedule_cron text,
    timezone text DEFAULT 'America/Los_Angeles'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_report; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.agent_report (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    description text,
    target text,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_run; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.agent_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    trigger text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    target_date date,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    duration_ms integer,
    records_processed integer DEFAULT 0 NOT NULL,
    records_new integer DEFAULT 0 NOT NULL,
    tokens_input bigint DEFAULT 0 NOT NULL,
    tokens_output bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(12,4) DEFAULT 0 NOT NULL,
    triggered_by uuid,
    triggered_by_email text,
    error text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_run_log; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.agent_run_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    message text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: app_setting; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.app_setting (
    key text NOT NULL,
    value jsonb DEFAULT 'null'::jsonb NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    label text,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: app_user; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.app_user (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    title text,
    role greendogops.app_role DEFAULT 'staff'::greendogops.app_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    module_access jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    person_id uuid
);


--
-- Name: ats_hr_merge_backup_0032; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ats_hr_merge_backup_0032 (
    ats_id uuid NOT NULL,
    emp_id uuid NOT NULL,
    person_json jsonb NOT NULL,
    recruiting_json jsonb,
    merged_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    action text NOT NULL,
    entity text,
    entity_id text,
    summary text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.audit_log IS 'Append-only security/audit trail. UPDATE/DELETE/TRUNCATE are blocked by trigger for every role. A retention purge must be a deliberate, documented owner action (disable trigger, purge, re-enable) — see docs/security.md.';


--
-- Name: bizdev_appt_type; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.bizdev_appt_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    appt_type text NOT NULL,
    avg_value numeric DEFAULT 0 NOT NULL,
    planned_per_day numeric DEFAULT 0 NOT NULL,
    included boolean DEFAULT true NOT NULL,
    is_custom boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avg_per_day numeric DEFAULT 0 NOT NULL,
    planned_per_week numeric DEFAULT 0 NOT NULL,
    cadence text DEFAULT 'daily'::text NOT NULL,
    max_per_day numeric DEFAULT 0 NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    value_overridden boolean DEFAULT false NOT NULL,
    per_day_overridden boolean DEFAULT false NOT NULL,
    CONSTRAINT bizdev_appt_type_cadence_chk CHECK ((cadence = ANY (ARRAY['daily'::text, 'weekly'::text])))
);


--
-- Name: COLUMN bizdev_appt_type.value_overridden; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.bizdev_appt_type.value_overridden IS 'User typed an avg_value by hand — the daily refresh must not overwrite it.';


--
-- Name: COLUMN bizdev_appt_type.per_day_overridden; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.bizdev_appt_type.per_day_overridden IS 'User typed an avg_per_day by hand — the daily refresh must not overwrite it.';


--
-- Name: bizdev_location_config; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.bizdev_location_config (
    location_id uuid NOT NULL,
    open_sun boolean DEFAULT false NOT NULL,
    open_mon boolean DEFAULT true NOT NULL,
    open_tue boolean DEFAULT true NOT NULL,
    open_wed boolean DEFAULT true NOT NULL,
    open_thu boolean DEFAULT true NOT NULL,
    open_fri boolean DEFAULT true NOT NULL,
    open_sat boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    factor_sun numeric DEFAULT 1 NOT NULL,
    factor_mon numeric DEFAULT 1 NOT NULL,
    factor_tue numeric DEFAULT 1 NOT NULL,
    factor_wed numeric DEFAULT 1 NOT NULL,
    factor_thu numeric DEFAULT 1 NOT NULL,
    factor_fri numeric DEFAULT 1 NOT NULL,
    factor_sat numeric DEFAULT 1 NOT NULL,
    open_min_sun smallint DEFAULT 480 NOT NULL,
    open_min_mon smallint DEFAULT 480 NOT NULL,
    open_min_tue smallint DEFAULT 480 NOT NULL,
    open_min_wed smallint DEFAULT 480 NOT NULL,
    open_min_thu smallint DEFAULT 480 NOT NULL,
    open_min_fri smallint DEFAULT 480 NOT NULL,
    open_min_sat smallint DEFAULT 480 NOT NULL,
    close_min_sun smallint DEFAULT 1080 NOT NULL,
    close_min_mon smallint DEFAULT 1080 NOT NULL,
    close_min_tue smallint DEFAULT 1080 NOT NULL,
    close_min_wed smallint DEFAULT 1080 NOT NULL,
    close_min_thu smallint DEFAULT 1080 NOT NULL,
    close_min_fri smallint DEFAULT 1080 NOT NULL,
    close_min_sat smallint DEFAULT 1080 NOT NULL,
    metrics_refreshed_at timestamp with time zone,
    CONSTRAINT bizdev_location_config_hours_ck CHECK ((((open_min_sun >= 0) AND (open_min_sun <= 1439)) AND ((close_min_sun >= (open_min_sun + 15)) AND (close_min_sun <= 1440)) AND ((open_min_mon >= 0) AND (open_min_mon <= 1439)) AND ((close_min_mon >= (open_min_mon + 15)) AND (close_min_mon <= 1440)) AND ((open_min_tue >= 0) AND (open_min_tue <= 1439)) AND ((close_min_tue >= (open_min_tue + 15)) AND (close_min_tue <= 1440)) AND ((open_min_wed >= 0) AND (open_min_wed <= 1439)) AND ((close_min_wed >= (open_min_wed + 15)) AND (close_min_wed <= 1440)) AND ((open_min_thu >= 0) AND (open_min_thu <= 1439)) AND ((close_min_thu >= (open_min_thu + 15)) AND (close_min_thu <= 1440)) AND ((open_min_fri >= 0) AND (open_min_fri <= 1439)) AND ((close_min_fri >= (open_min_fri + 15)) AND (close_min_fri <= 1440)) AND ((open_min_sat >= 0) AND (open_min_sat <= 1439)) AND ((close_min_sat >= (open_min_sat + 15)) AND (close_min_sat <= 1440))))
);


--
-- Name: COLUMN bizdev_location_config.metrics_refreshed_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.bizdev_location_config.metrics_refreshed_at IS 'When bizdev_refresh_metrics() last rebuilt this clinic''s derived base numbers.';


--
-- Name: calendar_event; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.calendar_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT 'custom'::text NOT NULL,
    google_event_id text,
    google_calendar_id text,
    title text NOT NULL,
    description text,
    location text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    all_day boolean DEFAULT false NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    color text,
    owner_person_id uuid,
    attendee_person_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    notify_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_event_source_check CHECK ((source = ANY (ARRAY['google'::text, 'custom'::text]))),
    CONSTRAINT calendar_event_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'tentative'::text, 'cancelled'::text])))
);


--
-- Name: TABLE calendar_event; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.calendar_event IS 'Physical calendar rows: Google-mirrored + custom events. CE / interview / time-off events are projected at read time from their own tables.';


--
-- Name: calendar_notification; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.calendar_notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid,
    source_key text NOT NULL,
    channel text NOT NULL,
    offset_minutes integer NOT NULL,
    recipient text,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_notification_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'slack'::text]))),
    CONSTRAINT calendar_notification_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: TABLE calendar_notification; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.calendar_notification IS 'Idempotency + audit log of calendar reminders sent via email / Slack.';


--
-- Name: calendar_schedule_pin; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.calendar_schedule_pin (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_sync_state; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.calendar_sync_state (
    google_calendar_id text NOT NULL,
    sync_token text,
    last_synced_at timestamp with time zone,
    last_status text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE calendar_sync_state; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.calendar_sync_state IS 'Per-calendar Google sync token + last-run status for the incremental sync job.';


--
-- Name: clinic_visits; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.clinic_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    profile_id uuid,
    partner_id uuid,
    clinic_name text NOT NULL,
    visit_date date DEFAULT CURRENT_DATE NOT NULL,
    spoke_to text,
    items_discussed text[] DEFAULT '{}'::text[],
    next_visit_date date,
    visit_notes text,
    logged_via text DEFAULT 'web'::text,
    is_archived boolean DEFAULT false,
    CONSTRAINT clinic_visits_logged_via_check CHECK ((logged_via = ANY (ARRAY['web'::text, 'mobile'::text, 'api'::text])))
);


--
-- Name: credential; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.credential (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text DEFAULT 'vendor'::text NOT NULL,
    label text NOT NULL,
    service text,
    url text,
    username text,
    password text,
    account_number text,
    location text,
    contact_name text,
    contact_email text,
    contact_phone text,
    order_method text,
    payment_method text,
    status text,
    owner_scope text,
    notes text,
    org_id uuid,
    source text DEFAULT 'import'::text NOT NULL,
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: TABLE credential; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.credential IS 'Admin-only credential/account vault. Access via service-role client behind requireAdmin() only.';


--
-- Name: crm_ce_attendance; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_ce_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    ce_name text NOT NULL,
    ce_date date,
    confirmed_date date,
    paid boolean DEFAULT false NOT NULL,
    showed_up boolean DEFAULT false NOT NULL,
    materials_prepared boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ce_event_id uuid
);


--
-- Name: TABLE crm_ce_attendance; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.crm_ce_attendance IS 'Per-attendee CE event log: which CE each lead is attending and its prep/payment status.';


--
-- Name: crm_ce_event; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_ce_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    event_date date,
    start_time text,
    end_time text,
    location text,
    subject text,
    presenters text,
    description text,
    cost_type text DEFAULT 'free'::text NOT NULL,
    cost_amount numeric,
    audience text,
    status text DEFAULT 'planned'::text NOT NULL,
    capacity integer,
    registration_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    course_type text,
    delivery_method text,
    tracking_number text,
    learning_objectives text,
    disclosure_statements text,
    approval_board text,
    approval_status text,
    race_approved boolean DEFAULT false NOT NULL,
    ce_hours_total numeric,
    ce_hours_medical numeric,
    ce_hours_nonmedical numeric,
    effective_start date,
    effective_end date,
    projected_offering_date date,
    rosters_allowed_date date,
    presenter_bio text,
    website_url text,
    whats_included text,
    who_should_attend text,
    social_dinner boolean DEFAULT false NOT NULL,
    planning_checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    itinerary jsonb DEFAULT '[]'::jsonb NOT NULL,
    end_date date,
    race_program_category text,
    race_interactivity text,
    race_course_format text,
    presenter_qualifications text,
    presenter_cv_url text,
    has_conflict_of_interest boolean DEFAULT false NOT NULL,
    post_test_questions numeric,
    ada_acknowledged boolean DEFAULT false NOT NULL,
    submission_documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    cebroker_submitted boolean DEFAULT false NOT NULL,
    cebroker_submitted_at timestamp with time zone
);


--
-- Name: TABLE crm_ce_event; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.crm_ce_event IS 'First-class CE event: scheduling + logistics details that CE leads can be rostered against.';


--
-- Name: COLUMN crm_ce_event.event_date; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.event_date IS 'Event Start date. Paired with end_date for the full event range.';


--
-- Name: COLUMN crm_ce_event.tracking_number; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.tracking_number IS 'CEbroker course tracking number assigned on submission (e.g. 20-1305377).';


--
-- Name: COLUMN crm_ce_event.ce_hours_medical; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.ce_hours_medical IS 'RACE medical CE hours granted for this course.';


--
-- Name: COLUMN crm_ce_event.ce_hours_nonmedical; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.ce_hours_nonmedical IS 'RACE non-medical CE hours granted for this course.';


--
-- Name: COLUMN crm_ce_event.planning_checklist; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.planning_checklist IS 'Per-event planning checklist: jsonb map of { item_key: boolean } tracked in the CE Events management tab.';


--
-- Name: COLUMN crm_ce_event.itinerary; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.itinerary IS 'Editable event itinerary: jsonb array of { id, day, time, description } line items rendered/printed in the CE Events management tab.';


--
-- Name: COLUMN crm_ce_event.end_date; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.end_date IS 'Event End date. Equals event_date for single-day events.';


--
-- Name: COLUMN crm_ce_event.race_program_category; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.race_program_category IS 'RACE program category (Sec 3): medical, nonmedical, or both. Drives the medical/non-medical CE hour split.';


--
-- Name: COLUMN crm_ce_event.race_interactivity; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.race_interactivity IS 'RACE method of delivery (Sec 5): interactive (able to interact with the presenter) vs non-interactive/on-demand. Non-interactive requires a post-course test (>=5 questions per credit, 70% pass).';


--
-- Name: COLUMN crm_ce_event.race_course_format; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.race_course_format IS 'RACE course type (Sec 7): single course, conference (multi-session roster), or series/modular (all courses required before credit).';


--
-- Name: COLUMN crm_ce_event.presenter_qualifications; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.presenter_qualifications IS 'Presenter subject-matter-expert qualifications required for RACE (Sec 7.04): board certification / VTS / advanced degree / peer-reviewed publications, etc.';


--
-- Name: COLUMN crm_ce_event.presenter_cv_url; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.presenter_cv_url IS 'Link to the presenter CV / resume / RACE template page attached to the RACE application (required per presenter, Sec 7.04).';


--
-- Name: COLUMN crm_ce_event.has_conflict_of_interest; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.has_conflict_of_interest IS 'Program educates about a product/service/company or presenter has a commercial relationship (Sec 6.01/6.02) — a disclosure statement is then required.';


--
-- Name: COLUMN crm_ce_event.post_test_questions; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.post_test_questions IS 'Number of post-course test questions. RACE requires >=5 per CE credit for non-interactive programs, awarded only at 70% or higher (Sec 5.02).';


--
-- Name: COLUMN crm_ce_event.ada_acknowledged; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.ada_acknowledged IS 'Provider acknowledges ADA / disabilities-law compliance for the program (Sec 5.03).';


--
-- Name: COLUMN crm_ce_event.submission_documents; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.submission_documents IS 'Documents attached to the CE Broker / board submission: jsonb array of {id, kind, label, url, description}. kind ∈ course_summary | race_approval | agenda | presenter_cv | disclosure | marketing | other.';


--
-- Name: COLUMN crm_ce_event.cebroker_submitted; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.cebroker_submitted IS 'True once the RACE-approved course has been submitted to CE Broker for board distribution.';


--
-- Name: COLUMN crm_ce_event.cebroker_submitted_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_ce_event.cebroker_submitted_at IS 'Timestamp the course was submitted to CE Broker.';


--
-- Name: crm_contact; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_type text NOT NULL,
    first_name text,
    last_name text,
    full_name text,
    email text,
    phone text,
    status text,
    organization text,
    program_type text,
    program_name text,
    cohort text,
    school text,
    location text,
    mentor text,
    coordinator text,
    visitor_type text,
    start_date date,
    end_date date,
    hours_completed numeric,
    hours_required numeric,
    eligible_for_employment boolean,
    ce_events_attended text,
    lead_source text,
    notes text,
    source text NOT NULL,
    external_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    promoted_person_id uuid,
    promoted_at timestamp with time zone,
    opportunity_type text,
    supervising_dvm text,
    weekday_schedule text,
    doc_recommendation text,
    hire_interest text,
    grad_year text,
    stipend text,
    completed boolean,
    stipend_paid boolean,
    check_cashed boolean,
    degree_type text,
    program_subcategory text
);


--
-- Name: COLUMN crm_contact.opportunity_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.opportunity_type IS 'Nature of engagement (see OPPORTUNITY_TYPES in src/lib/shared/opportunity-types.ts)';


--
-- Name: COLUMN crm_contact.supervising_dvm; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.supervising_dvm IS 'Assigned supervising doctor for the rotation (Any / Doc / Geist / Rally…).';


--
-- Name: COLUMN crm_contact.weekday_schedule; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.weekday_schedule IS 'Days on site for the rotation (e.g. M-F, "TU & TH ONLY").';


--
-- Name: COLUMN crm_contact.doc_recommendation; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.doc_recommendation IS 'Dr. Hab color-coded recommendation from the student grid (Green / Red…).';


--
-- Name: COLUMN crm_contact.hire_interest; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.hire_interest IS 'Recruiting flag from the student grid ("Want to hire", "No", "Absent"…).';


--
-- Name: COLUMN crm_contact.grad_year; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.grad_year IS 'DVM graduation cohort (e.g. DVM 2026).';


--
-- Name: COLUMN crm_contact.stipend; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.stipend IS 'Stipend status text (Yes / No / "No stipend" / "No, Professor"…).';


--
-- Name: COLUMN crm_contact.completed; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.completed IS 'Whether the rotation has been completed.';


--
-- Name: COLUMN crm_contact.stipend_paid; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.stipend_paid IS 'Whether the student stipend has been paid out.';


--
-- Name: COLUMN crm_contact.check_cashed; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_contact.check_cashed IS 'Whether the stipend check has cleared.';


--
-- Name: crm_contact_document; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_contact_document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    title text NOT NULL,
    category text,
    storage_path text NOT NULL,
    file_name text,
    mime_type text,
    size_bytes bigint,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_org_document; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_org_document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    title text NOT NULL,
    category text,
    storage_path text NOT NULL,
    file_name text,
    mime_type text,
    size_bytes bigint,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_org_visit; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_org_visit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    visit_date date DEFAULT CURRENT_DATE NOT NULL,
    spoke_to text,
    visit_notes text,
    logged_via text DEFAULT 'web'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    topics text[]
);


--
-- Name: COLUMN crm_org_visit.topics; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_org_visit.topics IS 'Subjects discussed during the visit (e.g. adoption_event, vaccine_clinic).';


--
-- Name: crm_organization; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_type text NOT NULL,
    name text NOT NULL,
    subtype text,
    status text,
    contact_name text,
    title text,
    phone text,
    phone_alt text,
    email text,
    website text,
    instagram text,
    address text,
    city text,
    state text,
    zip text,
    area text,
    services text,
    products text[],
    tier text,
    priority text,
    membership_level text,
    annual_fee numeric,
    account_number text,
    account_rep text,
    total_referrals integer,
    revenue numeric,
    monthly_spend numeric,
    spend_ytd numeric,
    relationship_score integer,
    internal_rating integer,
    is_preferred boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_visit_date date,
    last_contact_date date,
    last_referral_date date,
    notes text,
    source text NOT NULL,
    external_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    clinic_area text,
    category text,
    agreement_status text,
    agreement_signed_date date,
    tax_id text,
    secondary_contact_name text,
    secondary_contact_title text,
    secondary_contact_email text,
    secondary_contact_phone text,
    confirmed_leads integer,
    confirmed_clients integer,
    verified_adoptions integer,
    latitude double precision,
    longitude double precision,
    geocoded_at timestamp with time zone,
    geocoded_address text,
    ezyvet_contact_id text,
    geocode_attempted_at timestamp with time zone,
    geocode_error text,
    qr_token text DEFAULT greendogops.new_qr_token() NOT NULL
);


--
-- Name: COLUMN crm_organization.clinic_area; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.clinic_area IS 'Green Dog Ops clinic(s) this business is served by / closest to (comma-separated location names).';


--
-- Name: COLUMN crm_organization.category; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.category IS 'High-level Vendor & Partner CRM category: medical_equip, medical_supplies, facility_supply, marketing, facility_maintenance. Null for referral clinics.';


--
-- Name: COLUMN crm_organization.verified_adoptions; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.verified_adoptions IS 'User-maintained count of verified adoptions credited to this rescue/shelter.';


--
-- Name: COLUMN crm_organization.latitude; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.latitude IS 'Cached latitude (WGS84) resolved from address via Google Geocoding API.';


--
-- Name: COLUMN crm_organization.longitude; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.longitude IS 'Cached longitude (WGS84) resolved from address via Google Geocoding API.';


--
-- Name: COLUMN crm_organization.geocoded_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.geocoded_at IS 'Timestamp of the last successful geocode.';


--
-- Name: COLUMN crm_organization.geocoded_address; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.geocoded_address IS 'The address string that produced the cached coordinates.';


--
-- Name: COLUMN crm_organization.qr_token; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_organization.qr_token IS 'Public handle encoded in this record''s QR code (/lead/<qr_token>). Auto-assigned on insert.';


--
-- Name: crm_program_name; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_program_name (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_retail_lead; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.crm_retail_lead (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    full_name text NOT NULL,
    email text,
    phone text,
    pet_name text,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    source text DEFAULT 'qr_scan'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    zip text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    confirmation_code text DEFAULT greendogops.new_confirmation_code() NOT NULL
);


--
-- Name: TABLE crm_retail_lead; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.crm_retail_lead IS 'Consumer leads captured from a Non-Med Partner QR code scan (public /lead/<token> form).';


--
-- Name: COLUMN crm_retail_lead.answers; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.crm_retail_lead.answers IS 'Answers to the custom questions on the qr_form attached to this partner''s code, keyed by QrFormField.key.';


--
-- Name: email_event; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.email_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resend_event_id text,
    event_type text NOT NULL,
    email_id text,
    to_addrs text[] DEFAULT '{}'::text[] NOT NULL,
    from_addr text,
    subject text,
    reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_template; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.email_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    category text DEFAULT 'referral'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_by_email text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_aged_receivable; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_aged_receivable (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_code text,
    title text,
    client text,
    first_name text,
    contact_tags text,
    email text,
    total_due numeric,
    last_30_days_payments numeric,
    bucket_current numeric,
    bucket_30 numeric,
    bucket_60 numeric,
    bucket_90_plus numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_aged_receivable; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_aged_receivable IS 'Daily snapshot of client A/R (one row per client per snapshot_date, so the aging can be trended). ezyVet names the aging columns after calendar months, which move every month, so they are stored positionally: bucket_current is the newest month, then bucket_30 / bucket_60 / bucket_90_plus going further back. total_due is the balance owed. Join to ezyvet_contact on contact_code.';


--
-- Name: ezyvet_agenda_appt_snapshot; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_agenda_appt_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    appt_date date NOT NULL,
    department_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    appt_key text NOT NULL,
    client_name text,
    patient_name text,
    resource text,
    appt_time text,
    appt_type text,
    status text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_agenda_count; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_agenda_count (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    appt_date date NOT NULL,
    department_id uuid NOT NULL,
    appt_count integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_agenda_dept_map; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_agenda_dept_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ezyvet_label text NOT NULL,
    department_id uuid,
    is_ignored boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_agenda_snapshot; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_agenda_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    appt_date date NOT NULL,
    department_id uuid NOT NULL,
    appt_count integer DEFAULT 0 NOT NULL,
    snapshot_date date NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_animal; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_animal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ezyvet_animal_id text NOT NULL,
    animal_code text,
    animal_name text,
    division text,
    species text,
    breed text,
    color text,
    sex text,
    weight_lb numeric,
    date_of_birth date,
    dob_is_estimated boolean,
    age text,
    is_active boolean,
    has_passed_away boolean,
    date_of_passing date,
    cause_of_death text,
    caution_status text,
    microchip_number text,
    rabies_number text,
    rabies_number_date date,
    last_vaccination_date date,
    last_vaccination_name text,
    next_vaccination_due date,
    next_vaccination_name text,
    master_problems text,
    animal_notes text,
    last_visit date,
    next_appointment date,
    latest_bcs text,
    latest_ds text,
    latest_temp text,
    insurance_supplier text,
    insurance_number text,
    referring_clinic text,
    referring_vet text,
    owner_contact_code text,
    owner_business_name text,
    owner_title text,
    owner_first_name text,
    owner_last_name text,
    owner_full_name text,
    owner_is_business boolean,
    opt_out_marketing boolean,
    email text,
    home_email text,
    business_email text,
    accounts_email text,
    phone text,
    mobile text,
    fax text,
    physical_street1 text,
    physical_street2 text,
    physical_suburb text,
    physical_city text,
    physical_state text,
    physical_post_code text,
    physical_country text,
    postal_street1 text,
    postal_street2 text,
    postal_suburb text,
    postal_city text,
    postal_state text,
    postal_post_code text,
    postal_country text,
    ezyvet_created_at timestamp with time zone,
    ezyvet_created_by text,
    ezyvet_modified_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_import_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_animal_import; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_animal_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text,
    uploaded_by uuid,
    total_rows integer DEFAULT 0 NOT NULL,
    new_animals integer DEFAULT 0 NOT NULL,
    updated_animals integer DEFAULT 0 NOT NULL,
    unchanged_animals integer DEFAULT 0 NOT NULL,
    snapshot_date date,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_invoice_line; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_invoice_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_line_id text NOT NULL,
    invoice_no text,
    invoice_date date,
    line_date date,
    line_type text,
    department_raw text,
    location_key text,
    location_label text,
    inventory_location text,
    client_contact_code text,
    business_name text,
    first_name text,
    last_name text,
    email text,
    animal_code text,
    pet_name text,
    species text,
    species_group text,
    breed text,
    product_code text,
    product_name text,
    product_group text,
    account text,
    staff_member text,
    staff_member_id text,
    salesperson_is_vet boolean,
    consult_id text,
    qty numeric,
    total_excl numeric,
    total_incl numeric,
    import_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    case_owner text
);


--
-- Name: ezyvet_appointment; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.ezyvet_appointment AS
 SELECT client_contact_code,
    line_date AS service_date,
    location_key,
    max(location_label) AS location_label,
    (count(*))::integer AS line_count,
    (count(DISTINCT animal_code))::integer AS pet_count,
    sum(total_incl) AS revenue,
    max(business_name) AS business_name,
    (array_agg(species ORDER BY total_incl DESC NULLS LAST))[1] AS species,
    (array_agg(species_group ORDER BY total_incl DESC NULLS LAST))[1] AS species_group
   FROM greendogops.ezyvet_invoice_line
  WHERE ((client_contact_code IS NOT NULL) AND (client_contact_code <> ''::text) AND (line_date IS NOT NULL))
  GROUP BY client_contact_code, line_date, location_key
 HAVING (count(*) FILTER (WHERE greendogops.is_appt_line(product_name, product_group)) > 0)
  WITH NO DATA;


--
-- Name: ezyvet_appointment_record; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_appointment_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource text,
    division text,
    appt_date date,
    start_time text,
    end_date date,
    end_time text,
    appointment_type text,
    appointment_group text,
    description text,
    client_name text,
    client_code text,
    pet_name text,
    pet_code text,
    preferred_contact text,
    client_landline text,
    client_mobile text,
    client_email text,
    client_address text,
    animal_referring_clinic text,
    animal_referring_vet text,
    clinical_referring_clinic text,
    clinical_referring_vet text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_appointment_record; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_appointment_record IS 'THE appointment-level table: one row per appointment, covering every hospital, with appointment_type, appointment_group, the resource/column it was booked on, the free-text booking note (description), and the client and pet it belongs to. Pulled from the ezyVet Records dashboard (not the Report Center), so it carries detail the agenda counts do not. Join pet_code to ezyvet_animal.animal_code for species/breed/master problems/animal notes, and client_code to ezyvet_contact.contact_code for the client record. Rows with an empty client_code/pet_code are blocks and internal calendar entries, not real bookings — exclude them when counting appointments. Cancelled appointments ARE included (the export is run with ''include cancelled''), and there is no status column here, so use ezyvet_appointment_status or cancelled_appointments for status questions. The window is rebuilt on every pull, so re-running a date range is idempotent and reflects reschedules. Prefer the report_appointment_* views so answers match the Reporting page.';


--
-- Name: ezyvet_appointment_status; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_appointment_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    division text,
    animal text,
    owner text,
    appt_at timestamp with time zone,
    appt_date date,
    mins_no_status numeric,
    mins_unconfirmed numeric,
    mins_confirmed numeric,
    mins_in_transit numeric,
    mins_in_waiting_room numeric,
    mins_in_consultation numeric,
    mins_in_procedure numeric,
    mins_admit_for_surgery numeric,
    mins_in_hospital numeric,
    mins_in_discharge numeric,
    mins_awaiting_collect numeric,
    mins_departed numeric,
    mins_interim_report numeric,
    mins_referral_done numeric,
    mins_complete numeric,
    time_to_complete text,
    mins_to_complete numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_appointment_status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_appointment_status IS 'One row per appointment, with the MINUTES it spent in each ezyVet status (mins_in_waiting_room, mins_in_consultation, mins_in_hospital...) and mins_to_complete. This is the operational counterpart to the agenda counts: use it for wait times, room/doctor throughput and how long visit types really take. time_to_complete reads ''Not Complete'' (and mins_to_complete is null) when the appointment was never finished, which is common — filter those out before averaging.';


--
-- Name: ezyvet_appointment_type_stat; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_appointment_type_stat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    division text,
    appt_type text,
    appt_count bigint,
    avg_minutes numeric,
    total_minutes numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_appointment_type_stat; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_appointment_type_stat IS 'Aggregated per appointment type and division for the pulled window: how many were booked and the average and total minutes. Use this to size scheduling templates against how long visits actually take.';


--
-- Name: ezyvet_appt_type_dept_map; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_appt_type_dept_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appt_type text NOT NULL,
    department_id uuid,
    is_ignored boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    report_track text,
    CONSTRAINT ezyvet_appt_type_dept_map_report_track_check CHECK (((report_track IS NULL) OR (report_track = ANY (ARRAY['nad'::text, 'oe'::text, 've'::text, 'ap'::text]))))
);


--
-- Name: COLUMN ezyvet_appt_type_dept_map.report_track; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ezyvet_appt_type_dept_map.report_track IS 'Track this type is counted in on the upcoming-appointments Slack report: nad + oe roll up to DENTAL, ve = vet exams, ap = advanced procedures. NULL = not counted.';


--
-- Name: ezyvet_cancelled_appointment; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_cancelled_appointment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid,
    appt_date date NOT NULL,
    appt_type text,
    start_time text,
    end_time text,
    with_who text,
    using_resource text,
    description text,
    status text,
    reason text,
    created_raw text,
    modified_raw text,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_clinical_note; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_clinical_note (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_type text,
    consult_number bigint,
    case_owner text,
    department text,
    animal_name text,
    animal_code text,
    approved_by text,
    approved_at timestamp with time zone,
    note_created_by text,
    note_created_at timestamp with time zone,
    note_created_date date,
    modified_by text,
    modified_at timestamp with time zone,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_clinical_note; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_clinical_note IS 'One row per clinical note (SOAP and similar) with its approver and created/approved/modified timestamps. approved_by null means the record is still unapproved — the medical-records compliance backlog. Rebuilt over a rolling 30-day window each run.';


--
-- Name: ezyvet_consult_metric; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_consult_metric (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consult_created_at timestamp with time zone,
    created_date date,
    consult_number bigint,
    case_owner text,
    pet_name text,
    date_of_birth date,
    owner text,
    species text,
    breed text,
    weight_lb numeric,
    master_problems text,
    presenting_problems text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_consult_metric; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_consult_metric IS 'One row per clinical record: the case owner, the pet (species, breed, weight, date of birth) and the MASTER and PRESENTING PROBLEMS. This is the only source of what we actually treat, so use it for case-mix, caseload-by-condition and per-doctor clinical questions. Problems are free text and may list several separated by commas, so match with ILIKE.';


--
-- Name: ezyvet_contact; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ezyvet_contact_id text NOT NULL,
    contact_code text,
    business_name text,
    title text,
    first_name text,
    last_name text,
    full_name text,
    date_of_birth date,
    is_customer boolean,
    is_business boolean,
    is_vet boolean,
    is_active boolean,
    is_supplier boolean,
    preferred_contact_method text,
    physical_street1 text,
    physical_street2 text,
    physical_city text,
    physical_state text,
    physical_post_code text,
    physical_country text,
    number_of_miles numeric,
    email text,
    phone text,
    mobile text,
    website text,
    notes text,
    account_code text,
    last_invoiced date,
    staff_member text,
    hear_about text,
    customer_group text,
    regional_group text,
    division text,
    revenue_spend_ytd numeric,
    opt_out_marketing boolean,
    ezyvet_created_at timestamp with time zone,
    ezyvet_created_by text,
    ezyvet_modified_at timestamp with time zone,
    ezyvet_modified_by text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_import_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_tags text
);


--
-- Name: COLUMN ezyvet_contact.contact_tags; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ezyvet_contact.contact_tags IS 'ezyVet "Contact Tag(s)": the contact''s tags as one comma-joined list. Query greendogops.report_contact_tag instead of matching this text directly.';


--
-- Name: ezyvet_contact_change; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_contact_change (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ezyvet_contact_id text NOT NULL,
    import_id uuid,
    change_type text NOT NULL,
    changed_fields jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_contact_import; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_contact_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text,
    uploaded_by uuid,
    total_rows integer DEFAULT 0 NOT NULL,
    new_contacts integer DEFAULT 0 NOT NULL,
    updated_contacts integer DEFAULT 0 NOT NULL,
    unchanged_contacts integer DEFAULT 0 NOT NULL,
    snapshot_date date,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_controlled_drug; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_controlled_drug (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispensed_at timestamp with time zone,
    dispensed_date date,
    product_code text,
    product_name text,
    prescriber text,
    prescriber_dea text,
    dispense_type text,
    dispensed_qty numeric,
    qty_on_hand numeric,
    dispensing_user text,
    client_code text,
    client_name text,
    pet_code text,
    pet_name text,
    pet_species text,
    prescription_no text,
    medication_instructions text,
    refills_left bigint,
    days_supply bigint,
    invoice_no text,
    invoice_status text,
    product_schedule_class text,
    division text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_controlled_drug; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_controlled_drug IS 'Every controlled-substance dispense: product, prescriber and DEA number, quantity, quantity on hand, and the pet/client it was dispensed for. dispensed_qty is negative for a dispense. Client date of birth, phone and address ARE in the ezyVet export but are deliberately not stored. Note ezyVet''s export is column-shifted, so the clinic arrives under its ''Batch'' header and is stored as division; batch number is not available.';


--
-- Name: ezyvet_customer_invoice_stat; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_customer_invoice_stat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_name text,
    first_name text,
    last_name text,
    email text,
    turnover numeric,
    gross_profit numeric,
    invoice_count bigint,
    invoice_line_count bigint,
    avg_turnover_per_invoice numeric,
    avg_turnover_per_line numeric,
    avg_gross_profit_per_invoice numeric,
    avg_gross_profit_per_line numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_customer_invoice_stat; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_customer_invoice_stat IS 'Per-client totals for the pulled window: turnover, gross profit, number of invoices and lines, and the averages per invoice and per line. Good for client-value and basket-size questions; matched on name/email since the report does not export the contact code.';


--
-- Name: ezyvet_disabled_record; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_disabled_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text,
    disabled_date date,
    disabled_at timestamp with time zone,
    disabled_by text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_disabled_record; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_disabled_record IS 'Invoices and payments that were disabled (voided), with who did it and when. Financial-control surface: a spike here, or voids by one user, is worth investigating. Usually empty on a normal day.';


--
-- Name: ezyvet_end_of_day; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_end_of_day (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric text,
    amount numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_end_of_day; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_end_of_day IS 'Long-form daily close figures — one row per metric per day. Metrics include Pending Invoices, Approved Invoices, Opening Debtors, Closing Debtors, Payments Received, plus one row per payment method. Query with metric ILIKE, and remember amounts are practice-wide for that day.';


--
-- Name: ezyvet_estimate; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_estimate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date_sent date,
    date_sent_raw text,
    originator text,
    estimate_number bigint,
    estimate_name text,
    customer_number text,
    customer_name text,
    email text,
    status text,
    excluded_from_markup_value numeric,
    product_value numeric,
    total_value numeric,
    next_action_date date,
    last_comment text,
    cost_of_estimate numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_estimate; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_estimate IS 'One row per estimate with its status (Created / Sent / Accepted / Declined), value and originating doctor. Conversion rate = accepted value over total value. date_sent is null while the estimate is unsent (date_sent_raw then reads ''Not Sent''). Re-read on a rolling window and upserted, since estimates change status days after they are written.';


--
-- Name: ezyvet_expired_inventory; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_expired_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text,
    product_name text,
    supplier text,
    batch_number text,
    expiry_date date,
    qty_in_stock numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_expired_inventory; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_expired_inventory IS 'Stock that has already expired and should be pulled and written off. Daily snapshot — anything appearing here is a live problem.';


--
-- Name: ezyvet_expiring_inventory; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_expiring_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text,
    product_name text,
    supplier_name text,
    batch_number text,
    expiry_date date,
    qty_in_stock numeric,
    qty_available numeric,
    total_available_cost numeric,
    location_name text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_expiring_inventory; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_expiring_inventory IS 'Product batches with an expiry date inside the look-ahead window, with quantity and the cost at risk. Daily snapshot; use the latest snapshot_date and order by expiry_date to work the list.';


--
-- Name: ezyvet_inventory_ordering; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_inventory_ordering (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text,
    product_name text,
    in_inventory numeric,
    available numeric,
    ordered numeric,
    receipting numeric,
    short numeric,
    to_order numeric,
    turn_last_month numeric,
    turn_last_12_months numeric,
    avg_monthly_turn numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_inventory_ordering; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_inventory_ordering IS 'Daily snapshot of the ordering position per product: in inventory, available, on order, receipting, short, and to_order, plus inventory turns for last month, the last 12 months and the monthly average. to_order > 0 is the buy list; low turns with high stock is dead money.';


--
-- Name: ezyvet_inventory_transfer; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_inventory_transfer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_number text,
    product_code text,
    product_name text,
    product_description text,
    transferred_at timestamp with time zone,
    transfer_date date,
    created_by text,
    inventory_location text,
    last_modified text,
    reason text,
    quantity numeric,
    batch text,
    account text,
    in_inventory numeric,
    available numeric,
    per_unit_cost numeric,
    total numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_inventory_transfer; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_inventory_transfer IS 'Stock movements between inventory locations: product, quantity, reason, per-unit cost and total. Explains why a clinic''s stock changed without a sale, and surfaces stock quietly shifting between hospitals.';


--
-- Name: ezyvet_inventory_value; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_inventory_value (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text,
    product_name text,
    product_group text,
    current_unit_cost numeric,
    weighted_avg_unit_cost numeric,
    qty_in_inventory numeric,
    total_inventory_value numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_inventory_value; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_inventory_value IS 'Daily snapshot of stocked products: quantity in inventory, current and weighted-average unit cost, and total value. Trend total_inventory_value by snapshot_date for stock levels over time. Negative quantities are real in ezyVet (items sold that were never received) and flag count errors.';


--
-- Name: ezyvet_invoice_import; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_invoice_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text,
    label text,
    uploaded_by uuid,
    total_rows integer DEFAULT 0 NOT NULL,
    new_rows integer DEFAULT 0 NOT NULL,
    skipped_rows integer DEFAULT 0 NOT NULL,
    date_range_start date,
    date_range_end date,
    revenue_total numeric DEFAULT 0 NOT NULL,
    appointment_count integer DEFAULT 0 NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_invoice_summary; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_invoice_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_code text,
    invoice_date date,
    invoice_number bigint,
    purchase_order text,
    client text,
    status text,
    total_credits_incl numeric,
    total_debits_incl numeric,
    amount_excl numeric,
    amount_incl numeric,
    amount_due numeric,
    due_at timestamp with time zone,
    contact_department text,
    pet_code text,
    pet_name text,
    pet_insurance_supplier text,
    pet_insurance_number text,
    invoice_department text,
    invoice_comments text,
    payment_terms text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_invoice_summary; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_invoice_summary IS 'One row per INVOICE (ezyvet_invoice_line holds the line detail, this holds the header). Adds what lines cannot answer: status (Approved/Pending), credits vs debits, amount still due, due date, and the pet the invoice was for. Re-read on a rolling window and upserted, because invoices flip from Pending to Approved days later.';


--
-- Name: ezyvet_payment; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_payment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_date date,
    paid_at timestamp with time zone,
    payment_number bigint,
    division text,
    customer_code text,
    customer text,
    amount numeric,
    surcharge numeric,
    card_brand text,
    integrated_surcharge numeric,
    created_by text,
    modified_by text,
    payment_method text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_payment; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_payment IS 'One row per payment received, from the ezyVet Payment Summary report. payment_method is the section the payment was listed under (Visa, Cash, CareCredit, Remote Payment...), card_brand the specific card. This is CASH COLLECTED and is NOT the same as revenue billed (ezyvet_invoice_line): a payment may settle an older invoice, and an invoice may go unpaid. Use this for deposits, payment-mix and collections questions.';


--
-- Name: ezyvet_payment_allocation; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_payment_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    allocation_date date,
    payment_number bigint,
    payment_division text,
    client text,
    invoice_number bigint,
    division text,
    divisional_amount numeric,
    total_for_invoice numeric,
    total_payment_amount numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_payment_allocation; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_payment_allocation IS 'One row per payment-to-invoice allocation. Shows which division earned the money when a payment taken at one hospital settles another''s invoice. divisional_amount is that division''s share; total_payment_amount repeats the whole payment, so NEVER sum total_payment_amount across rows.';


--
-- Name: ezyvet_product; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_product (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ezyvet_product_id text NOT NULL,
    product_code text,
    product_name text,
    description text,
    product_group text,
    product_type text,
    new_product_type text,
    clinical_type text,
    bundle_type text,
    is_fixed_price_bundle boolean,
    diagnostic_name text,
    therapeutic_name text,
    schedule_or_class text,
    is_active boolean,
    is_sold boolean,
    is_purchased boolean,
    excluded_from_sales boolean,
    on_special boolean,
    available_on_web boolean,
    requires_prescription boolean,
    generates_prescription boolean,
    is_rvm_medication boolean,
    is_rabies_vax boolean,
    can_expire boolean,
    is_container boolean,
    is_template boolean,
    has_markup boolean,
    stock_goes_negative boolean,
    requires_freight boolean,
    tracking_level text,
    rrp numeric,
    barcode text,
    primary_barcode text,
    external_reference text,
    secondary_external_reference text,
    unique_identifier text,
    supplier text,
    default_supplier text,
    default_supplier_product_code text,
    supplier_contact text,
    sales_account text,
    purchases_account text,
    inventory_account text,
    minimum_inventory numeric,
    minimum_reorder numeric,
    minimum_sell_units numeric,
    default_sell_units numeric,
    lowest_dispensable_unit text,
    lowest_dispensable_quantity numeric,
    concentration numeric,
    concentration_unit text,
    booster_duration_seconds numeric,
    default_vaccination_qty numeric,
    last_invoiced_date date,
    notes text,
    notes_important boolean,
    warning text,
    instructions text,
    default_medication_text text,
    default_prescribing_user text,
    ezyvet_created_at timestamp with time zone,
    ezyvet_created_by text,
    ezyvet_modified_at timestamp with time zone,
    ezyvet_modified_by text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_import_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_product_import; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_product_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text,
    source text DEFAULT 'products'::text NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    new_rows integer DEFAULT 0 NOT NULL,
    updated_rows integer DEFAULT 0 NOT NULL,
    unchanged_rows integer DEFAULT 0 NOT NULL,
    snapshot_date date,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_product_price; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_product_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text NOT NULL,
    division text NOT NULL,
    product_name text,
    product_group text,
    cost numeric,
    sell_price_excl numeric,
    sell_price_incl numeric,
    markup numeric,
    service_fee_product_id text,
    service_fee_product_code text,
    service_fee_product_ref text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_import_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ezyvet_purchase; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_purchase (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_date date,
    receive_invoice text,
    supplier_invoice_number text,
    purchase_for text,
    purchase_orders text,
    product_code text,
    product_name text,
    supplier_code text,
    qty numeric,
    unit_price_excl numeric,
    unit_price_incl numeric,
    total_excl numeric,
    total_incl numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_purchase; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_purchase IS 'Purchase-order lines received from suppliers over a rolling window: product, quantity, unit price and totals excluding and including tax. The source for supplier spend and COGS-side questions; ties to the vendor CRM by supplier code.';


--
-- Name: ezyvet_record_tag; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_record_tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_key text NOT NULL,
    record_type text DEFAULT 'contact'::text NOT NULL,
    record_code text NOT NULL,
    record_name text,
    contact_code text,
    ezyvet_contact_id text,
    email text,
    first_seen_on date NOT NULL,
    last_confirmed_on date NOT NULL,
    removed_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ezyvet_record_tag_record_type_check CHECK ((record_type = ANY (ARRAY['contact'::text, 'animal'::text])))
);


--
-- Name: TABLE ezyvet_record_tag; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_record_tag IS 'Which records carry which ezyVet tag. Merged, never replaced: removed_on marks a tag that was taken off a record we actually re-read. Current membership = removed_on is null.';


--
-- Name: ezyvet_record_tag_run; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_record_tag_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_key text NOT NULL,
    mode text NOT NULL,
    activity_from date,
    matched integer DEFAULT 0 NOT NULL,
    added integer DEFAULT 0 NOT NULL,
    confirmed integer DEFAULT 0 NOT NULL,
    removed integer DEFAULT 0 NOT NULL,
    ran_on date DEFAULT ((now() AT TIME ZONE 'America/Los_Angeles'::text))::date NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ezyvet_record_tag_run_mode_check CHECK ((mode = ANY (ARRAY['backfill'::text, 'incremental'::text])))
);


--
-- Name: ezyvet_soc_overdue; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_soc_overdue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    animal_number text,
    animal_name text,
    species text,
    breed text,
    owner_first_name text,
    owner_last_name text,
    phone_numbers text,
    mobile_numbers text,
    email_addresses text,
    soc_treatment text,
    soc_type text,
    soc_due_date date,
    days_overdue bigint,
    last_fulfilled_date date,
    appt_date date,
    days_until_appt bigint,
    appt_duration_minutes bigint,
    appt_reason text,
    appt_status text,
    appt_type text,
    soc_created_date date,
    department text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_soc_overdue; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_soc_overdue IS 'The pre-visit preparation worklist: pets with an overdue standard-of-care item (vaccine, test, treatment) AND an upcoming appointment, so the team can add it before the visit. days_overdue is how late the item is, days_until_appt how soon they are coming in. Daily snapshot — filter to the latest snapshot_date, and note the same pet appears once per overdue item.';


--
-- Name: ezyvet_staff_sale; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_staff_sale (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number bigint,
    invoiced_at timestamp with time zone,
    invoice_date date,
    turnover numeric,
    gross_profit numeric,
    gross_profit_pct numeric,
    staff_member text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_staff_sale; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_staff_sale IS 'One row per invoice per staff member, with turnover and gross profit in dollars and percent. This is the ONLY source of margin in the warehouse — ezyvet_invoice_line carries revenue but no cost. Note gross profit only counts products that have a cost price and markup. staff_member is the SALESPERSON who raised the invoice, not the case-owning doctor.';


--
-- Name: ezyvet_tag; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_key text NOT NULL,
    tag_label text NOT NULL,
    tag_type text DEFAULT 'pet_tag'::text NOT NULL,
    tag_group text,
    ezyvet_tag_id text,
    is_active boolean DEFAULT true NOT NULL,
    backfilled_on date,
    last_run_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_type text DEFAULT 'animal'::text NOT NULL,
    CONSTRAINT ezyvet_tag_record_type_check CHECK ((record_type = ANY (ARRAY['contact'::text, 'animal'::text])))
);


--
-- Name: TABLE ezyvet_tag; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_tag IS 'Catalog of ezyVet tags discovered from the Dashboard > Records filter. backfilled_on is the last full pull; membership for a tag with a null backfilled_on is incomplete.';


--
-- Name: COLUMN ezyvet_tag.record_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ezyvet_tag.record_type IS 'Grain this tag is pulled at: animal for pet tags (the activity window must be judged on the pet, which is what a tag edit modifies), contact for tags on the client record.';


--
-- Name: ezyvet_taxable_sales; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_taxable_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tax_code text,
    tax_percent numeric,
    total_invoiced_excl numeric,
    total_tax numeric,
    total_invoiced_incl numeric,
    department text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_taxable_sales; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_taxable_sales IS 'Tax-code totals for the pulled window, grouped by department (the department section drives location_key). Used for tax remittance and to reconcile taxable vs exempt sales.';


--
-- Name: ezyvet_unapplied_payment; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_unapplied_payment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_number bigint,
    payment_date date,
    client_code text,
    client_name text,
    record_type text,
    amount numeric,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_unapplied_payment; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_unapplied_payment IS 'Payments and credits sitting unapplied on client accounts. Amounts are negative (money held). A row disappearing means it was applied, so this is a worklist, not a ledger.';


--
-- Name: ezyvet_unbilled_consult; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_unbilled_consult (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appt_at timestamp with time zone,
    appt_date date,
    client_contact_code text,
    business_name text,
    first_name text,
    last_name text,
    pet_name text,
    consult_number bigint,
    appt_type text,
    consult_division text,
    reason text,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_unbilled_consult; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_unbilled_consult IS 'Consults that happened but were never invoiced: the daily missed-revenue worklist. Re-read over a rolling two-week window, so a consult that gets invoiced later simply drops out of the table.';


--
-- Name: ezyvet_vaccination; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_vaccination (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vaccination_id text,
    creating_user text,
    created_at_ezyvet timestamp with time zone,
    modifying_user text,
    modified_at timestamp with time zone,
    is_active boolean,
    sales_resource text,
    approved_by text,
    approved_at timestamp with time zone,
    consult text,
    external_reference text,
    animal text,
    vaccination_date date,
    notes text,
    vet_user text,
    product text,
    quantity numeric,
    description text,
    next_date date,
    send_reminder boolean,
    is_historical boolean,
    annual_health_product text,
    event text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_vaccination; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_vaccination IS 'One row per vaccination administered: product, quantity, the vet who gave it, the date, and next_date for the reminder. is_historical marks vaccinations recorded from an outside clinic rather than given here.';


--
-- Name: ezyvet_wellness_plan_use; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ezyvet_wellness_plan_use (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unique_id text,
    customer_code text,
    customer_name text,
    pet_code text,
    pet_name text,
    plan text,
    department text,
    term_start_date date,
    benefit text,
    benefit_type text,
    saved numeric,
    allocated numeric,
    used numeric,
    available numeric,
    location_key text,
    snapshot_date date NOT NULL,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ezyvet_wellness_plan_use; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ezyvet_wellness_plan_use IS 'One row per pet per plan benefit per snapshot: allocated, used and available. Unused ''available'' benefits are the practice''s outstanding liability and the reason to recall the client. Large table (~20k rows per snapshot), so always filter to one snapshot_date and aggregate.';


--
-- Name: interview_invite; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.interview_invite (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    person_id uuid NOT NULL,
    interview_type text DEFAULT 'phone_screen'::text NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    host_user_id uuid NOT NULL,
    host_name text,
    date_from date NOT NULL,
    date_to date NOT NULL,
    location text,
    message text,
    status text DEFAULT 'sent'::text NOT NULL,
    interview_id uuid,
    booked_start timestamp with time zone,
    booked_at timestamp with time zone,
    sent_to text,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interview_invite_duration_minutes_check CHECK (((duration_minutes >= 10) AND (duration_minutes <= 240))),
    CONSTRAINT interview_invite_range_check CHECK ((date_to >= date_from)),
    CONSTRAINT interview_invite_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'booked'::text, 'cancelled'::text])))
);


--
-- Name: location; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color text,
    short_code text,
    sort_order integer DEFAULT 0 NOT NULL,
    kind text DEFAULT 'clinic'::text NOT NULL,
    display_name text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    postal_code text,
    phone text,
    email text,
    map_url text,
    website_url text,
    notes text,
    parent_location_id uuid,
    CONSTRAINT location_kind_chk CHECK ((kind = ANY (ARRAY['clinic'::text, 'mobile'::text])))
);


--
-- Name: TABLE location; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.location IS 'Clinic locations. "Van Nuys" is also referred to as "Aetna" (14661 Aetna St) — the staff schedule sheet uses AETNA; both mean this one row.';


--
-- Name: marketing_activity; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    entity_type text DEFAULT 'node'::text NOT NULL,
    entity_id uuid,
    title text NOT NULL,
    detail text,
    actor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_budget_entry; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_budget_entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    category text,
    business text,
    description text,
    amount numeric DEFAULT 0 NOT NULL,
    paid_by text,
    payment_method text,
    status text DEFAULT 'paid'::text NOT NULL,
    receipt_submitted boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_budget_period; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_budget_period (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year integer NOT NULL,
    total_budget numeric DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_event; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    event_type text DEFAULT 'third_party'::text NOT NULL,
    status text DEFAULT 'researching'::text NOT NULL,
    starts_on date,
    ends_on date,
    location text,
    clinic_served text,
    owner_name text,
    cost numeric,
    staff_needed text,
    description text,
    calendar_event_id uuid,
    attendees integer,
    signups integer,
    appointments integer,
    products_sold text,
    redemption_codes text,
    coupons_redeemed integer,
    client_spend numeric,
    feedback text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    planning_phase text,
    staff text,
    supplies text,
    promo_channels text,
    landing_url text,
    rsvp_url text,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_id uuid,
    arrival_time text,
    departure_time text,
    venue_type text,
    event_url text,
    host_company text,
    host_website text,
    expected_foot_traffic text,
    involvement text,
    setup_needs text,
    parking_info text,
    food_onsite text,
    packing_list jsonb DEFAULT '[]'::jsonb NOT NULL,
    has_promo boolean DEFAULT false NOT NULL,
    promo_name text,
    promo_details text,
    promo_starts_on date,
    promo_ends_on date,
    staff_ids jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: COLUMN marketing_event.checklist; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.checklist IS 'Planning checklist: [{"label":"Book staff","done":false}].';


--
-- Name: COLUMN marketing_event.arrival_time; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.arrival_time IS 'Required staff arrival time (from event intake template).';


--
-- Name: COLUMN marketing_event.departure_time; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.departure_time IS 'Required staff departure time (from event intake template).';


--
-- Name: COLUMN marketing_event.venue_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.venue_type IS 'indoor | outdoor | mixed.';


--
-- Name: COLUMN marketing_event.event_url; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.event_url IS 'Event website or flyer link.';


--
-- Name: COLUMN marketing_event.host_company; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.host_company IS 'Organization hosting the event.';


--
-- Name: COLUMN marketing_event.host_website; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.host_website IS 'Host organization website.';


--
-- Name: COLUMN marketing_event.expected_foot_traffic; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.expected_foot_traffic IS 'Anticipated audience / foot traffic.';


--
-- Name: COLUMN marketing_event.involvement; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.involvement IS 'Expectations / our role: sponsor, vet services, judges, gift certificates, etc.';


--
-- Name: COLUMN marketing_event.setup_needs; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.setup_needs IS 'Physical set up: what we bring vs. what the host provides (tables, chairs, tents).';


--
-- Name: COLUMN marketing_event.parking_info; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.parking_info IS 'Parking + loading/unloading instructions for staff.';


--
-- Name: COLUMN marketing_event.food_onsite; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.food_onsite IS 'Whether food is available on-site for staff (e.g. food trucks).';


--
-- Name: COLUMN marketing_event.packing_list; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.packing_list IS 'Editable, grouped Packing / Material list. Each item: {label, qty, status, note}; status ∈ need|decided|ordered|received|packed. Defaults to the GD master template in the app layer.';


--
-- Name: COLUMN marketing_event.has_promo; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.has_promo IS 'Does this event have its own promotion? Drives the Promo column in the event list and whether a marketing_promotion row is mirrored.';


--
-- Name: COLUMN marketing_event.staff_ids; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_event.staff_ids IS 'Array of person.id uuids staffing the event (picked from the roster). `staff` holds the rendered names.';


--
-- Name: marketing_event_attendee; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_event_attendee (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    name text,
    email text,
    phone text,
    attendee_type text DEFAULT 'lead'::text,
    is_new_client boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_event_source; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_event_source (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    url text,
    region text,
    membership_cost text,
    cadence text DEFAULT 'monthly'::text,
    last_checked_on date,
    active boolean DEFAULT true NOT NULL,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    crm_organization_id uuid
);


--
-- Name: marketing_goal; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_goal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text,
    metric_unit text,
    target_value numeric,
    current_value numeric,
    period text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    node_id uuid
);


--
-- Name: marketing_influencers; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_influencers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_name text NOT NULL,
    pet_name text,
    phone text,
    email text,
    status public.influencer_status DEFAULT 'prospect'::public.influencer_status NOT NULL,
    agreement_details text,
    promo_code text,
    instagram_handle text,
    instagram_url text,
    facebook_url text,
    tiktok_handle text,
    youtube_url text,
    follower_count integer,
    highest_platform text,
    engagement_rate numeric(5,2),
    location text,
    ezyvet_tracking text,
    notes text,
    last_post_date date,
    posts_completed integer DEFAULT 0,
    stories_completed integer DEFAULT 0,
    reels_completed integer DEFAULT 0,
    events_attended text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    tier text DEFAULT 'micro'::text,
    content_niche text,
    audience_age_range text,
    audience_gender_split text,
    audience_location text,
    instagram_followers integer,
    tiktok_followers integer,
    youtube_subscribers integer,
    facebook_followers integer,
    avg_likes integer,
    avg_comments integer,
    avg_saves integer,
    avg_shares integer,
    avg_views integer,
    relationship_status text DEFAULT 'new'::text,
    relationship_score integer DEFAULT 50,
    last_contact_date date,
    next_followup_date date,
    needs_followup boolean DEFAULT false,
    priority text DEFAULT 'medium'::text,
    collaboration_type text,
    content_rights text,
    exclusivity_terms text,
    contract_start_date date,
    contract_end_date date,
    compensation_type text,
    compensation_rate numeric(10,2),
    commission_percentage numeric(5,2),
    total_paid numeric(10,2) DEFAULT 0,
    total_value_generated numeric(10,2) DEFAULT 0,
    total_campaigns integer DEFAULT 0,
    total_impressions bigint DEFAULT 0,
    total_clicks integer DEFAULT 0,
    total_conversions integer DEFAULT 0,
    conversion_rate numeric(5,2),
    roi numeric(5,2),
    preferred_content_types text[],
    content_guidelines text,
    brand_alignment_score integer,
    pet_breed text,
    pet_age text,
    pet_type text,
    pet_instagram text,
    media_kit_url text,
    profile_image_url text,
    bio text,
    source text,
    referral_source text,
    discovered_via text,
    tags text[]
);


--
-- Name: marketing_initiative; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_initiative (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    owner_name text,
    partner_name text,
    next_action text,
    due_date date,
    notes text,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    node_id uuid
);


--
-- Name: marketing_promotion; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_promotion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    placement text,
    status text DEFAULT 'active'::text NOT NULL,
    promo_type text DEFAULT 'standard'::text NOT NULL,
    duration_text text,
    discount_text text,
    discount_amount numeric,
    product_code text,
    ezyvet_line_item text,
    how_to_redeem text,
    promo_url text,
    booking_url text,
    rules text,
    appointments integer,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active_start date,
    active_end date,
    source_event_id uuid
);


--
-- Name: COLUMN marketing_promotion.active_start; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_promotion.active_start IS 'First day the promotion can be redeemed.';


--
-- Name: COLUMN marketing_promotion.active_end; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_promotion.active_end IS 'Last day the promotion can be redeemed.';


--
-- Name: COLUMN marketing_promotion.source_event_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_promotion.source_event_id IS 'Set when this promotion is owned by a marketing_event. The event is the editor of record; deleting the event removes its promotion.';


--
-- Name: marketing_resource; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_resource (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'tool'::text NOT NULL,
    url text,
    description text,
    owner_name text,
    credential_note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username text,
    password text,
    crm_organization_id uuid
);


--
-- Name: marketing_tree_node; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.marketing_tree_node (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    zone text DEFAULT 'canopy'::text NOT NULL,
    parent_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    owner_name text,
    due_date date,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_person_id uuid,
    priority text DEFAULT 'medium'::text NOT NULL,
    budget_amount numeric,
    budget_spent numeric,
    budget_notes text,
    last_handled_at timestamp with time zone,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    event_type text
);


--
-- Name: COLUMN marketing_tree_node.last_handled_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.marketing_tree_node.last_handled_at IS 'Last time someone clicked "Updated" on the node; drives the staleness tint.';


--
-- Name: medical_board_day; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.medical_board_day (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    board_date date NOT NULL,
    board_type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    seeded_count integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    archived_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT medical_board_day_status_check CHECK ((status = ANY (ARRAY['open'::text, 'archived'::text])))
);


--
-- Name: medical_board_row; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.medical_board_row (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    board_date date NOT NULL,
    board_type text NOT NULL,
    appt_key text NOT NULL,
    source text DEFAULT 'agenda'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    appt_time text,
    patient text,
    client_name text,
    appt_type text,
    is_out boolean DEFAULT false NOT NULL,
    pmc boolean DEFAULT false NOT NULL,
    emr boolean DEFAULT false NOT NULL,
    csr text,
    tech text,
    dt text,
    weight_kg text,
    fas_score text,
    de boolean DEFAULT false NOT NULL,
    status text,
    medical_hx text,
    services text,
    services_done boolean DEFAULT false NOT NULL,
    sedation text,
    sedation_done boolean DEFAULT false NOT NULL,
    cbfc text,
    owner_ud text,
    room text,
    lab boolean DEFAULT false NOT NULL,
    sed boolean DEFAULT false NOT NULL,
    ev boolean DEFAULT false NOT NULL,
    inv boolean DEFAULT false NOT NULL,
    da boolean DEFAULT false NOT NULL,
    mp boolean DEFAULT false NOT NULL,
    ds boolean DEFAULT false NOT NULL,
    notes text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    board_key text,
    appt_description text,
    card jsonb DEFAULT '{}'::jsonb NOT NULL,
    patient_code text,
    species text,
    breed text,
    sex text,
    age text,
    owner_phone text,
    owner_email text,
    owner_contact_method text,
    cautions text,
    master_problems text,
    insurance text,
    last_visit date,
    CONSTRAINT medical_board_row_source_check CHECK ((source = ANY (ARRAY['agenda'::text, 'manual'::text])))
);

ALTER TABLE ONLY greendogops.medical_board_row REPLICA IDENTITY FULL;


--
-- Name: medical_board_type; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.medical_board_type (
    key text NOT NULL,
    label text NOT NULL,
    dept_code text NOT NULL,
    layout text DEFAULT 'grid'::text NOT NULL,
    icon text DEFAULT '🩺'::text NOT NULL,
    accent text DEFAULT '#0d9488'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    auto_created boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT medical_board_type_layout_check CHECK ((layout = ANY (ARRAY['grid'::text, 'card'::text])))
);


--
-- Name: notification_delivery; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.notification_delivery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    channel text NOT NULL,
    slack_user_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    slack_channel_id text,
    slack_ts text,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_delivery_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT notification_delivery_channel_check CHECK ((channel = 'slack_dm'::text)),
    CONSTRAINT notification_delivery_slack_user_id_check CHECK (((slack_user_id IS NULL) OR (slack_user_id ~ '^[UW][A-Z0-9]+$'::text))),
    CONSTRAINT notification_delivery_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: TABLE notification_delivery; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.notification_delivery IS 'Outbound copies of a notification. Recorded before sending; a send that may have reached Slack is never retried automatically. Service role only.';


--
-- Name: ops_task; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.ops_task (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    details text,
    assignee_user_id uuid NOT NULL,
    created_by_user_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    due_date date,
    module text,
    href text,
    action_target text DEFAULT 'ops'::text NOT NULL,
    source text DEFAULT 'ops'::text NOT NULL,
    external_ref text,
    slack_user_id text,
    completed_at timestamp with time zone,
    completed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_task_action_target_check CHECK ((action_target = ANY (ARRAY['ops'::text, 'slack'::text]))),
    CONSTRAINT ops_task_details_check CHECK (((details IS NULL) OR (length(details) <= 4000))),
    CONSTRAINT ops_task_done_has_time CHECK (((status = 'open'::text) OR (completed_at IS NOT NULL))),
    CONSTRAINT ops_task_external_ref_check CHECK (((external_ref IS NULL) OR (length(external_ref) <= 200))),
    CONSTRAINT ops_task_href_check CHECK (((href IS NULL) OR (href ~ '^/([^/\\]|$)'::text) OR (href ~ '^https://([a-z0-9-]+\.)*slack\.com/'::text))),
    CONSTRAINT ops_task_module_check CHECK (((module IS NULL) OR (module ~ '^[a-z_]+$'::text))),
    CONSTRAINT ops_task_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT ops_task_slack_user_id_check CHECK (((slack_user_id IS NULL) OR (slack_user_id ~ '^[UW][A-Z0-9]+$'::text))),
    CONSTRAINT ops_task_source_check CHECK ((source = ANY (ARRAY['ops'::text, 'slack'::text, 'system'::text]))),
    CONSTRAINT ops_task_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text]))),
    CONSTRAINT ops_task_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 200)))
);


--
-- Name: TABLE ops_task; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.ops_task IS 'Per-user to-do. source=ops (made in the app) | slack (Slack workflow via /api/tasks/inbound) | system. Service role only.';


--
-- Name: COLUMN ops_task.action_target; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ops_task.action_target IS 'Where the work happens: ops = open href in the app; slack = href is a Slack link.';


--
-- Name: COLUMN ops_task.external_ref; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ops_task.external_ref IS 'Idempotency key from the creating system (e.g. a Slack workflow run id). Unique per source.';


--
-- Name: COLUMN ops_task.slack_user_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.ops_task.slack_user_id IS 'Slack user who created it, for source=slack.';


--
-- Name: partner_contacts; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.partner_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    name text NOT NULL,
    title text,
    email text,
    phone text,
    is_primary boolean DEFAULT false,
    relationship_notes text,
    preferred_contact_method text DEFAULT 'email'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_contacts_preferred_contact_method_check CHECK ((preferred_contact_method = ANY (ARRAY['email'::text, 'phone'::text, 'text'::text, 'in_person'::text])))
);


--
-- Name: partner_notes; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.partner_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    note_type text DEFAULT 'general'::text,
    content text NOT NULL,
    is_pinned boolean DEFAULT false,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    author_initials text,
    edited_at timestamp with time zone,
    edited_by uuid,
    edited_by_initials text,
    category text,
    CONSTRAINT partner_notes_note_type_check CHECK ((note_type = ANY (ARRAY['general'::text, 'visit'::text, 'call'::text, 'email'::text, 'meeting'::text, 'issue'::text, 'opportunity'::text, 'goal'::text])))
);


--
-- Name: person; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status greendogops.employment_status DEFAULT 'prospect'::greendogops.employment_status NOT NULL,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name text,
    last_name text,
    preferred_name text,
    grid_name text,
    full_name text,
    email text,
    phone_mobile text,
    date_of_birth date,
    postal_code text,
    work_location_type greendogops.work_location_type,
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    source_contact_id uuid,
    phone_home text,
    phone_other text,
    opportunity_type text,
    grid_aliases text[]
);


--
-- Name: COLUMN person.preferred_name; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person.preferred_name IS 'Unused and empty as of 0213. Retained only so production and the migration history agree. Safe to drop once confirmed no external consumer reads it.';


--
-- Name: COLUMN person.opportunity_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person.opportunity_type IS 'Nature of engagement (see OPPORTUNITY_TYPES in src/lib/shared/opportunity-types.ts)';


--
-- Name: COLUMN person.grid_aliases; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person.grid_aliases IS 'Additional spellings the staff schedule sheet uses for this person, beyond grid_name. Read only by the sheet schedule importer.';


--
-- Name: person_asset; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_asset (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    asset_name text NOT NULL,
    asset_type text,
    identifier text,
    assigned_date date,
    returned_date date,
    status text DEFAULT 'assigned'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_compliance_entry; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_compliance_entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    compliance_key text NOT NULL,
    label text NOT NULL,
    completed_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_disciplinary_action; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_disciplinary_action (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    incident_date date,
    reported_by text,
    employee_position text,
    violation_type text,
    nature text,
    action_taken text,
    witnesses text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_document; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    title text NOT NULL,
    category text,
    storage_path text NOT NULL,
    file_name text,
    mime_type text,
    size_bytes bigint,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text
);


--
-- Name: person_employment; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_employment (
    person_id uuid NOT NULL,
    position_id uuid,
    location_id uuid,
    offer_title text,
    adp_job_title text,
    flsa_status greendogops.flsa_status,
    work_schedule greendogops.work_schedule,
    days_per_week numeric(3,1),
    hire_date date,
    original_hire_date date,
    pay_type text,
    current_rate numeric(12,2),
    previous_rate numeric(12,2),
    latest_wage_change_date date,
    biweekly_wage numeric(12,2),
    annual_wages numeric(12,2),
    pto_allotment text,
    pto_policy_allotment numeric(6,2),
    pto_used numeric(6,2),
    pto_available numeric(6,2),
    pto_notes text,
    ce_budget numeric(12,2),
    ce_used numeric(12,2),
    ce_remaining numeric(12,2),
    benefits_enrolled boolean,
    benefits_monthly numeric(12,2),
    benefits_annual numeric(12,2),
    last_review_date date,
    compliance jsonb DEFAULT '{}'::jsonb NOT NULL,
    separation_date date,
    separation_type greendogops.separation_type,
    separation_letter_signed boolean,
    separation_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule_type text,
    preferred_location_id uuid,
    CONSTRAINT person_employment_pay_type_check CHECK ((pay_type = ANY (ARRAY['hourly'::text, 'salary'::text, 'day_rate'::text, 'contract'::text])))
);


--
-- Name: COLUMN person_employment.preferred_location_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_employment.preferred_location_id IS 'Location the employee has designated as their preferred work location. Set on the HR roster and mirrored in Schedule → Setup → Employees.';


--
-- Name: person_interview; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_interview (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    interview_date date,
    interview_type text,
    interviewer text,
    location text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    overall_grade text,
    recommendation text,
    summary text,
    responses jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    host_user_id uuid,
    invite_id uuid,
    google_event_id text,
    guide_id uuid,
    guide_name text
);


--
-- Name: COLUMN person_interview.responses; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_interview.responses IS '[{ id?, question, answer, type?, options?, description? }] — guide question snapshot; older rows have question/answer only';


--
-- Name: COLUMN person_interview.guide_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_interview.guide_id IS 'Interview guide (recruiting_form kind = interview) the responses came from';


--
-- Name: COLUMN person_interview.guide_name; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_interview.guide_name IS 'Guide name when the interview was logged';


--
-- Name: person_license; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_license (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    name text NOT NULL,
    license_number text,
    issuing_authority text,
    issued_date date,
    expiration_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_onboarding_item; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_onboarding_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    item_key text NOT NULL,
    provided boolean DEFAULT false NOT NULL,
    provided_date date,
    completed boolean DEFAULT false NOT NULL,
    completed_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_pto_day; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_pto_day (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    pto_date date NOT NULL,
    hours numeric,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE person_pto_day; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.person_pto_day IS 'Itemized PTO days per employee, shown on the HR Attendance tab.';


--
-- Name: person_recruiting; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_recruiting (
    person_id uuid NOT NULL,
    target_position_id uuid,
    pipeline text,
    stage text,
    status_notes text,
    source text,
    interview_date date,
    score numeric(3,1),
    resume_url text,
    keep_for_future boolean,
    follow_up_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_title text,
    review_status text DEFAULT 'accepted'::text NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    application_date date,
    candidate_location text,
    relevant_experience text,
    education text,
    job_location text,
    interest_level text,
    external_status text,
    source_detail text,
    screening_answers jsonb DEFAULT '[]'::jsonb NOT NULL,
    application_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    slack_announce_ts text,
    slack_announce_channel text,
    announced_at timestamp with time zone,
    announced_by uuid,
    application jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT person_recruiting_interest_level_check CHECK (((interest_level IS NULL) OR (interest_level = ANY (ARRAY['Yes'::text, 'Maybe'::text, 'Reject'::text])))),
    CONSTRAINT person_recruiting_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))),
    CONSTRAINT person_recruiting_score_check CHECK (((score IS NULL) OR ((score >= (0)::numeric) AND (score <= (10)::numeric))))
);


--
-- Name: COLUMN person_recruiting.score; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.score IS 'Candidate Score, 0–10 (one decimal). Changes are logged in recruiting_score_change.';


--
-- Name: COLUMN person_recruiting.review_status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.review_status IS 'Intake triage state: pending (awaiting accept/reject), accepted (active lead), or declined (rejected but retained for re-apply detection).';


--
-- Name: COLUMN person_recruiting.reviewed_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.reviewed_at IS 'When the pending applicant was accepted or rejected.';


--
-- Name: COLUMN person_recruiting.reviewed_by; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.reviewed_by IS 'auth.uid() of the recruiter who accepted or rejected the applicant.';


--
-- Name: COLUMN person_recruiting.application_date; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.application_date IS 'Date the candidate applied / their resume was received. Defaults to the upload date at intake; editable on the candidate profile.';


--
-- Name: COLUMN person_recruiting.candidate_location; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.candidate_location IS 'Where the candidate lives, as reported on their application (e.g. "Reseda, CA").';


--
-- Name: COLUMN person_recruiting.relevant_experience; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.relevant_experience IS 'Most relevant prior role/experience summarized from the application or resume.';


--
-- Name: COLUMN person_recruiting.education; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.education IS 'Highest level of education reported by the candidate.';


--
-- Name: COLUMN person_recruiting.job_location; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.job_location IS 'Green Dog posting location the candidate applied to (e.g. "Van Nuys, CA 91411").';


--
-- Name: COLUMN person_recruiting.interest_level; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.interest_level IS 'Recruiter interest rating carried from the job board: Yes, Maybe, or Reject.';


--
-- Name: COLUMN person_recruiting.external_status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.external_status IS 'Status in the originating job board''s own ATS (e.g. Indeed: Awaiting Review, Reviewed, Contacting, Hired, Rejected). Kept for reconciliation with the board.';


--
-- Name: COLUMN person_recruiting.source_detail; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.source_detail IS 'Sub-source within `source` (e.g. Indeed "Sponsored Job Link" vs organic "Indeed").';


--
-- Name: COLUMN person_recruiting.screening_answers; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.screening_answers IS 'Answers to the posting''s screening questions: [{"question":text,"answer":text,"match":"Yes"|"No"|"N/A"}], newest application.';


--
-- Name: COLUMN person_recruiting.application_history; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.application_history IS 'Every application this person has submitted, newest first: [{"date":"YYYY-MM-DD","job_title":text,"job_location":text,"status":text,"interest_level":text,"source":text}]. The scalar columns mirror entry 0.';


--
-- Name: COLUMN person_recruiting.slack_announce_ts; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.slack_announce_ts IS 'Slack ts of the candidate announcement post; later updates reply in its thread.';


--
-- Name: COLUMN person_recruiting.slack_announce_channel; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.slack_announce_channel IS 'Slack channel id the announcement was posted to.';


--
-- Name: COLUMN person_recruiting.application; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_recruiting.application IS 'Full website application, keyed by src/lib/ats/application.ts: {"answers":{key:text|text[]},"employment":[{...}],"references":[{...}],"languages":[{"language":text,"fluency":text}],"skills":{key:level},"extra":[{"label":text,"value":text}],"received_at":timestamptz}. Empty object when the candidate did not apply through the website form.';


--
-- Name: person_recruiting_cleanup_0220; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_recruiting_cleanup_0220 (
    person_id uuid,
    target_title text,
    stage text,
    source text,
    source_detail text,
    job_location text,
    pipeline text,
    status_notes text,
    backed_up_at timestamp with time zone
);


--
-- Name: person_recruiting_score_backup_0225; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_recruiting_score_backup_0225 (
    person_id uuid,
    score numeric(4,1)
);


--
-- Name: person_review; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    review_date date,
    review_type text,
    reviewer text,
    rating text,
    summary text,
    next_review_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_slack_link; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_slack_link (
    person_id uuid NOT NULL,
    status text DEFAULT 'not_found'::text NOT NULL,
    slack_team_id text,
    slack_user_id text,
    slack_email text,
    slack_display_name text,
    slack_real_name text,
    match_method text,
    matched_by uuid,
    connected_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_slack_link_connected_has_user CHECK (((status <> 'connected'::text) OR (slack_user_id IS NOT NULL))),
    CONSTRAINT person_slack_link_match_method_check CHECK ((match_method = ANY (ARRAY['email'::text, 'manual'::text]))),
    CONSTRAINT person_slack_link_slack_user_id_check CHECK (((slack_user_id IS NULL) OR (slack_user_id ~ '^[UW][A-Z0-9]+$'::text))),
    CONSTRAINT person_slack_link_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'not_found'::text, 'ambiguous'::text, 'inactive'::text, 'disconnected'::text])))
);


--
-- Name: TABLE person_slack_link; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.person_slack_link IS 'Ops person -> Slack user. slack_user_id is the permanent id; email only finds it. Service role only.';


--
-- Name: COLUMN person_slack_link.status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_slack_link.status IS 'connected | not_found (no Slack account with their email) | ambiguous (several) | inactive (Slack account deactivated/removed) | disconnected (admin unlinked; never auto-rematched)';


--
-- Name: COLUMN person_slack_link.match_method; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_slack_link.match_method IS 'email = matched automatically; manual = an admin picked the Slack user (emails need not agree)';


--
-- Name: person_time_off; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.person_time_off (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    kind greendogops.time_off_kind DEFAULT 'pto'::greendogops.time_off_kind NOT NULL,
    status greendogops.time_off_status DEFAULT 'requested'::greendogops.time_off_status NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    note text,
    requested_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    external_id text,
    CONSTRAINT person_time_off_range_ck CHECK ((end_date >= start_date))
);


--
-- Name: TABLE person_time_off; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.person_time_off IS 'Employee-entered PTO / Vacation / Time-off requests. Approval status drives scheduler color coding (requested=amber, approved=green).';


--
-- Name: COLUMN person_time_off.source; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_time_off.source IS 'Origin of the request: manual (HR profile) or wheniwork (API sync).';


--
-- Name: COLUMN person_time_off.external_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.person_time_off.external_id IS 'Stable id from the source system (e.g. When I Work request id); NULL when manual.';


--
-- Name: planning_capacity_rule; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.planning_capacity_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid,
    department_id uuid NOT NULL,
    label text,
    weekdays smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    dvm_count smallint,
    tech_count smallint,
    lead_count smallint,
    dental_count smallint,
    da_count smallint,
    float_count smallint,
    appointment_capacity integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planning_capacity_rule_appointment_capacity_check CHECK ((appointment_capacity >= 0)),
    CONSTRAINT planning_capacity_rule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE planning_capacity_rule; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.planning_capacity_rule IS 'Condition -> appointment-capacity rules per schedule area, managed on the Daily Capacity page; drives the displayed capacity and planning-guide assumptions.';


--
-- Name: COLUMN planning_capacity_rule.location_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_capacity_rule.location_id IS 'Location the rule applies to; NULL = any location for this area.';


--
-- Name: COLUMN planning_capacity_rule.appointment_capacity; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_capacity_rule.appointment_capacity IS 'Total bookable appointments this area can render when the staffing condition matches.';


--
-- Name: planning_guide; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.planning_guide (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    location_id uuid,
    department_id uuid,
    service_label text,
    day_model text,
    weekdays smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    start_minute integer DEFAULT 540 NOT NULL,
    end_minute integer DEFAULT 1020 NOT NULL,
    slot_minutes integer DEFAULT 30 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dvm_count smallint,
    tech_count smallint,
    lead_count smallint,
    dental_count smallint,
    da_count smallint,
    float_count smallint,
    source_week_id uuid,
    auto_generated boolean DEFAULT false NOT NULL,
    target_appointments integer,
    CONSTRAINT planning_guide_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: COLUMN planning_guide.dvm_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.dvm_count IS 'Number of DVMs this guide''s appointment capacity is designed for. The schedule resolver matches the DVMs actually staffed in a (location, department, day) against this value. NULL = manual selection only.';


--
-- Name: COLUMN planning_guide.tech_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.tech_count IS 'Target number of Techs for this guide''s staffing key; NULL = wildcard.';


--
-- Name: COLUMN planning_guide.lead_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.lead_count IS 'Target number of Leads for this guide''s staffing key; NULL = wildcard.';


--
-- Name: COLUMN planning_guide.dental_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.dental_count IS 'Target number of Dentals for this guide''s staffing key; NULL = wildcard.';


--
-- Name: COLUMN planning_guide.da_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.da_count IS 'Target number of DAs for this guide''s staffing key; NULL = wildcard.';


--
-- Name: COLUMN planning_guide.float_count; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.float_count IS 'Target number of Floats for this guide''s staffing key; NULL = wildcard.';


--
-- Name: COLUMN planning_guide.source_week_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.source_week_id IS 'Schedule week this guide was auto-generated for; NULL = reusable template shown on every week.';


--
-- Name: COLUMN planning_guide.auto_generated; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.auto_generated IS 'True when the guide was auto-generated from a Daily Capacity tile.';


--
-- Name: COLUMN planning_guide.target_appointments; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.planning_guide.target_appointments IS 'Appointment count the auto-generated guide was sized to (the matched capacity rule number).';


--
-- Name: planning_guide_column; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.planning_guide_column (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guide_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#64748b'::text NOT NULL,
    capacity_note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: planning_guide_slot; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.planning_guide_slot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guide_id uuid NOT NULL,
    column_id uuid NOT NULL,
    start_minute integer NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    type_code text DEFAULT 'open'::text NOT NULL,
    label text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: position; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops."position" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location text,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    openings integer DEFAULT 1 NOT NULL,
    notes text,
    employment_type text,
    days_needed smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    shift_start time without time zone,
    shift_end time without time zone,
    hours_per_week numeric(5,2),
    work_location_type text,
    pay_min numeric(10,2),
    pay_max numeric(10,2),
    pay_type text,
    target_start_date date,
    description text,
    requirements text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    close_reason text,
    CONSTRAINT position_close_reason_check CHECK (((close_reason IS NULL) OR (close_reason = ANY (ARRAY['filled'::text, 'cancelled'::text, 'on_hold'::text])))),
    CONSTRAINT position_days_needed_check CHECK ((days_needed <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint])),
    CONSTRAINT position_employment_type_check CHECK (((employment_type IS NULL) OR (employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'per_diem'::text, 'contractor'::text])))),
    CONSTRAINT position_hours_per_week_check CHECK (((hours_per_week IS NULL) OR ((hours_per_week > (0)::numeric) AND (hours_per_week <= (80)::numeric)))),
    CONSTRAINT position_pay_range_check CHECK ((((pay_min IS NULL) OR (pay_min >= (0)::numeric)) AND ((pay_max IS NULL) OR (pay_max >= (0)::numeric)) AND ((pay_min IS NULL) OR (pay_max IS NULL) OR (pay_min <= pay_max)))),
    CONSTRAINT position_pay_type_check CHECK (((pay_type IS NULL) OR (pay_type = ANY (ARRAY['hourly'::text, 'salary'::text])))),
    CONSTRAINT position_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    CONSTRAINT position_work_location_type_check CHECK (((work_location_type IS NULL) OR (work_location_type = ANY (ARRAY['in_house'::text, 'remote'::text, 'hybrid'::text]))))
);


--
-- Name: COLUMN "position".priority; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".priority IS 'high | normal | low';


--
-- Name: COLUMN "position".status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".status IS 'open | closed (recruiting job status)';


--
-- Name: COLUMN "position".employment_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".employment_type IS 'full_time | part_time | per_diem | contractor';


--
-- Name: COLUMN "position".days_needed; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".days_needed IS 'Weekdays that must be covered, 0=Sun..6=Sat; empty = flexible';


--
-- Name: COLUMN "position".work_location_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".work_location_type IS 'in_house | remote | hybrid';


--
-- Name: COLUMN "position".pay_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".pay_type IS 'hourly | salary — unit for pay_min / pay_max';


--
-- Name: COLUMN "position".description; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".description IS 'Role summary and duties';


--
-- Name: COLUMN "position".requirements; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".requirements IS 'Licenses, certifications, experience and skills to screen for';


--
-- Name: COLUMN "position".opened_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".opened_at IS 'When the job was last opened (reopening resets it)';


--
-- Name: COLUMN "position".closed_at; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".closed_at IS 'When the job was closed; null while open';


--
-- Name: COLUMN "position".close_reason; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops."position".close_reason IS 'filled | cancelled | on_hold — why a closed job was closed';


--
-- Name: profile_transition_log; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.profile_transition_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    contact_id uuid,
    event_type text NOT NULL,
    from_stage text,
    to_stage text,
    detail text,
    actor_id uuid,
    actor_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: qr_code; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.qr_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text DEFAULT greendogops.new_qr_token() NOT NULL,
    label text NOT NULL,
    code_type text DEFAULT 'event'::text NOT NULL,
    event_id uuid,
    promotion_id uuid,
    org_id uuid,
    form_id uuid,
    target_url text,
    active boolean DEFAULT true NOT NULL,
    notes text,
    scan_count integer DEFAULT 0 NOT NULL,
    last_scanned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ce_event_id uuid,
    referral_partner_id uuid,
    influencer_id uuid
);


--
-- Name: TABLE qr_code; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.qr_code IS 'Every generated QR code. token is the public, non-enumerable handle in /q/<token>.';


--
-- Name: COLUMN qr_code.ce_event_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_code.ce_event_id IS 'CE course this code belongs to (crm_ce_event). Mutually exclusive with event_id in practice; code_type = ''ce''.';


--
-- Name: COLUMN qr_code.referral_partner_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_code.referral_partner_id IS 'Referral clinic this code belongs to. code_type = ''referral''.';


--
-- Name: COLUMN qr_code.influencer_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_code.influencer_id IS 'Influencer this code belongs to. code_type = ''influencer''.';


--
-- Name: qr_form; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.qr_form (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    headline text,
    intro text,
    success_message text,
    collect_pet_name boolean DEFAULT true NOT NULL,
    collect_zip boolean DEFAULT false NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    theme text DEFAULT 'emerald'::text NOT NULL,
    banner_url text,
    post_submit_heading text,
    show_confirmation boolean DEFAULT false NOT NULL,
    confirmation_note text
);


--
-- Name: TABLE qr_form; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.qr_form IS 'Reusable public intake form rendered at /q/<token>. `fields` holds the custom questions; answers land in qr_lead.answers.';


--
-- Name: COLUMN qr_form.success_message; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.success_message IS 'The single message on the confirmation screen, e.g. "Show this screen to spin the prize wheel!". Rendered large and in the form''s accent colour, never as HTML.';


--
-- Name: COLUMN qr_form.theme; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.theme IS 'Colour scheme key rendered on the public form. Validated against QR_FORM_THEMES in src/lib/marketing/qr.ts — never interpolated into CSS.';


--
-- Name: COLUMN qr_form.banner_url; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.banner_url IS 'Public URL of the header image in the qr-form-banners bucket. Null = no banner.';


--
-- Name: COLUMN qr_form.post_submit_heading; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.post_submit_heading IS 'Large heading on the success screen. Null falls back to "Thanks — you''re all set!".';


--
-- Name: COLUMN qr_form.show_confirmation; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.show_confirmation IS 'When true the success screen renders the verification ticket: confirmation code, submitter name and a live submitted-at clock.';


--
-- Name: COLUMN qr_form.confirmation_note; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_form.confirmation_note IS 'Small print under the ticket, e.g. "One spin per household."';


--
-- Name: qr_lead; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.qr_lead (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    qr_code_id uuid NOT NULL,
    event_id uuid,
    org_id uuid,
    full_name text NOT NULL,
    email text,
    phone text,
    pet_name text,
    zip text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    source text DEFAULT 'qr_scan'::text NOT NULL,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ce_event_id uuid,
    referral_partner_id uuid,
    influencer_id uuid,
    confirmation_code text DEFAULT greendogops.new_confirmation_code() NOT NULL
);


--
-- Name: TABLE qr_lead; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.qr_lead IS 'A person who scanned a QR code and submitted its form. Event codes surface these as the Event Leads tab.';


--
-- Name: COLUMN qr_lead.ce_event_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_lead.ce_event_id IS 'Denormalized from the scanned code so the Event Leads tab can filter CE courses without a join.';


--
-- Name: COLUMN qr_lead.influencer_id; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_lead.influencer_id IS 'Influencer whose code captured this lead (denormalized from qr_code).';


--
-- Name: COLUMN qr_lead.confirmation_code; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.qr_lead.confirmation_code IS 'Shown to the scanner on the success screen so staff can verify a submission on the spot. Search it in Event Leads to settle a dispute.';


--
-- Name: rate_limit_bucket; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.rate_limit_bucket (
    bucket_key text NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    hits integer DEFAULT 0 NOT NULL
);


--
-- Name: recruiter_google_token; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiter_google_token (
    user_id uuid NOT NULL,
    google_email text,
    refresh_token text NOT NULL,
    scope text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE recruiter_google_token; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.recruiter_google_token IS 'Per-user Google Calendar OAuth refresh tokens. Service role only.';


--
-- Name: recruiter_schedule; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiter_schedule (
    user_id uuid NOT NULL,
    timezone text DEFAULT 'America/Los_Angeles'::text NOT NULL,
    weekly_hours jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_duration integer DEFAULT 30 NOT NULL,
    buffer_minutes integer DEFAULT 15 NOT NULL,
    min_notice_hours integer DEFAULT 12 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    google_email text,
    google_connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recruiter_schedule_buffer_minutes_check CHECK (((buffer_minutes >= 0) AND (buffer_minutes <= 120))),
    CONSTRAINT recruiter_schedule_default_duration_check CHECK (((default_duration >= 10) AND (default_duration <= 240))),
    CONSTRAINT recruiter_schedule_min_notice_hours_check CHECK (((min_notice_hours >= 0) AND (min_notice_hours <= 336)))
);


--
-- Name: COLUMN recruiter_schedule.weekly_hours; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiter_schedule.weekly_hours IS '[{day: 0=Sun..6=Sat, start: "HH:MM", end: "HH:MM"}] in timezone';


--
-- Name: recruiting_activity; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    activity_type text DEFAULT 'note'::text NOT NULL,
    body text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN recruiting_activity.activity_type; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_activity.activity_type IS 'call | text | email | note';


--
-- Name: recruiting_email_template; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_email_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text DEFAULT 'rejection'::text NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recruiting_email_template_kind_check CHECK ((kind = 'rejection'::text))
);


--
-- Name: COLUMN recruiting_email_template.body; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_email_template.body IS 'Plain text; {first_name}, {full_name}, {role} are filled in when sent';


--
-- Name: recruiting_form; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_form (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    description text,
    intro text,
    success_message text,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    job_titles text[] DEFAULT '{}'::text[] NOT NULL,
    slug text,
    is_default boolean DEFAULT false NOT NULL,
    require_resume boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    interview_types text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT recruiting_form_default_check CHECK (((NOT is_default) OR (kind = 'application'::text))),
    CONSTRAINT recruiting_form_kind_check CHECK ((kind = ANY (ARRAY['application'::text, 'screening'::text, 'interview'::text]))),
    CONSTRAINT recruiting_form_slug_check CHECK (((slug IS NULL) OR (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))
);


--
-- Name: TABLE recruiting_form; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.recruiting_form IS 'Recruiting forms: the public Standard Application, role-specific screening questionnaires, and interviewer-facing interview guides';


--
-- Name: COLUMN recruiting_form.fields; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form.fields IS 'Questions (src/lib/ats/forms.ts RecruitingFormField[])';


--
-- Name: COLUMN recruiting_form.job_titles; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form.job_titles IS 'Role titles this form is for (e.g. CSR); suggested first when sending';


--
-- Name: COLUMN recruiting_form.slug; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form.slug IS 'Application forms: public URL /apply/<slug>';


--
-- Name: COLUMN recruiting_form.is_default; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form.is_default IS 'The application served at /apply';


--
-- Name: COLUMN recruiting_form.interview_types; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form.interview_types IS 'Interview guides: person_interview.interview_type values the guide loads for (empty = any)';


--
-- Name: recruiting_form_request; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_form_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    form_id uuid NOT NULL,
    person_id uuid NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    sent_to text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_by uuid,
    sent_by_name text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by_name text,
    CONSTRAINT recruiting_form_request_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: recruiting_form_response; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_form_response (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_id uuid,
    request_id uuid,
    person_id uuid NOT NULL,
    form_name text NOT NULL,
    form_kind text NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN recruiting_form_response.fields; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form_response.fields IS 'The questions as they were when submitted';


--
-- Name: COLUMN recruiting_form_response.answers; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_form_response.answers IS 'Answers keyed by question id; file answers hold person_document ids';


--
-- Name: recruiting_rejection; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_rejection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    rejected_from text NOT NULL,
    prev_stage text,
    prev_review_status text,
    rejected_stage text,
    rejected_by uuid,
    rejected_by_name text,
    rejected_at timestamp with time zone DEFAULT now() NOT NULL,
    send_email boolean DEFAULT true NOT NULL,
    template_id uuid,
    template_name text,
    email_to text,
    email_scheduled_for timestamp with time zone,
    email_status text DEFAULT 'scheduled'::text NOT NULL,
    email_sent_at timestamp with time zone,
    email_error text,
    undone_at timestamp with time zone,
    undone_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recruiting_rejection_email_status_check CHECK ((email_status = ANY (ARRAY['scheduled'::text, 'sending'::text, 'sent'::text, 'cancelled'::text, 'not_sending'::text, 'failed'::text])))
);


--
-- Name: COLUMN recruiting_rejection.rejected_from; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_rejection.rejected_from IS 'review | forms | interviews | profile';


--
-- Name: COLUMN recruiting_rejection.email_status; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.recruiting_rejection.email_status IS 'scheduled (48h window) | sending | sent | cancelled | not_sending (opted out / no email) | failed';


--
-- Name: recruiting_score_change; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_score_change (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    old_score numeric(3,1),
    new_score numeric(3,1),
    note text,
    changed_by uuid,
    changed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recruiting_task; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.recruiting_task (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    title text NOT NULL,
    details text,
    due_date date,
    is_done boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: referral_revenue_line_items; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.referral_revenue_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid,
    transaction_date text NOT NULL,
    csv_clinic_name text NOT NULL,
    referring_vet text,
    client_name text,
    animal_name text,
    division text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    dedup_hash text NOT NULL,
    upload_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    row_index integer,
    invoice_line_id text,
    CONSTRAINT referral_revenue_line_items_transaction_date_iso_chk CHECK ((transaction_date ~ '^\d{4}-\d{2}-\d{2}$'::text))
);


--
-- Name: referral_sync_history; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.referral_sync_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    upload_date timestamp with time zone DEFAULT now() NOT NULL,
    date_range_start date,
    date_range_end date,
    total_rows_parsed integer DEFAULT 0,
    total_rows_matched integer DEFAULT 0,
    total_rows_skipped integer DEFAULT 0,
    total_revenue_added numeric(12,2) DEFAULT 0,
    uploaded_by uuid,
    sync_details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text,
    report_type text,
    data_source text DEFAULT 'csv_upload'::text
);


--
-- Name: reminder_ack; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.reminder_ack (
    rule_id uuid NOT NULL,
    user_id uuid NOT NULL,
    occurrence_date date NOT NULL,
    acked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE reminder_ack; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.reminder_ack IS 'A user marked one occurrence of a reminder done. Service role only.';


--
-- Name: reminder_rule; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.reminder_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    details text,
    href text,
    module text,
    cadence text NOT NULL,
    weekdays smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    month_day smallint,
    week_of_month smallint,
    month smallint,
    audience_roles text[] DEFAULT '{}'::text[] NOT NULL,
    owner_user_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    starts_on date DEFAULT CURRENT_DATE NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reminder_rule_audience_roles_check CHECK ((audience_roles <@ ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text, 'schedule_admin'::text, 'marketing_admin'::text, 'staff'::text])),
    CONSTRAINT reminder_rule_cadence_check CHECK ((cadence = ANY (ARRAY['weekly'::text, 'monthly_day'::text, 'monthly_weekday'::text, 'monthly_business_day'::text, 'yearly'::text]))),
    CONSTRAINT reminder_rule_cadence_fields CHECK (
CASE cadence
    WHEN 'weekly'::text THEN (cardinality(weekdays) > 0)
    WHEN 'monthly_day'::text THEN (month_day IS NOT NULL)
    WHEN 'monthly_business_day'::text THEN ((month_day IS NOT NULL) AND ((month_day = '-1'::integer) OR (month_day <= 23)))
    WHEN 'monthly_weekday'::text THEN ((cardinality(weekdays) = 1) AND (week_of_month IS NOT NULL))
    WHEN 'yearly'::text THEN ((month IS NOT NULL) AND (month_day IS NOT NULL))
    ELSE NULL::boolean
END),
    CONSTRAINT reminder_rule_details_check CHECK (((details IS NULL) OR (length(details) <= 2000))),
    CONSTRAINT reminder_rule_href_check CHECK (((href IS NULL) OR (href ~ '^/([^/\\]|$)'::text) OR (href ~ '^https://([a-z0-9-]+\.)*slack\.com/'::text))),
    CONSTRAINT reminder_rule_module_check CHECK (((module IS NULL) OR (module ~ '^[a-z_]+$'::text))),
    CONSTRAINT reminder_rule_month_check CHECK (((month IS NULL) OR ((month >= 1) AND (month <= 12)))),
    CONSTRAINT reminder_rule_month_day_check CHECK (((month_day IS NULL) OR (month_day = '-1'::integer) OR ((month_day >= 1) AND (month_day <= 31)))),
    CONSTRAINT reminder_rule_personal_has_no_audience CHECK (((owner_user_id IS NULL) OR (cardinality(audience_roles) = 0))),
    CONSTRAINT reminder_rule_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 200))),
    CONSTRAINT reminder_rule_week_of_month_check CHECK (((week_of_month IS NULL) OR (week_of_month = '-1'::integer) OR ((week_of_month >= 1) AND (week_of_month <= 5)))),
    CONSTRAINT reminder_rule_weekdays_check CHECK ((weekdays <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]))
);


--
-- Name: TABLE reminder_rule; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.reminder_rule IS 'Recurring reminders. owner_user_id null = admin-managed (audience_roles + module gate); set = personal. Occurrences are computed in src/lib/worklist/reminders.ts. Service role only.';


--
-- Name: report_animal_summary; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_animal_summary AS
 SELECT (count(*))::integer AS total_animals,
    (count(*) FILTER (WHERE is_active))::integer AS active_animals,
    (count(*) FILTER (WHERE has_passed_away))::integer AS deceased_animals,
    (count(DISTINCT owner_contact_code))::integer AS owners
   FROM greendogops.ezyvet_animal;


--
-- Name: report_animals_by_species; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_animals_by_species AS
 SELECT COALESCE(NULLIF(species, ''::text), 'Unknown'::text) AS species,
    (count(*))::integer AS patients
   FROM greendogops.ezyvet_animal
  GROUP BY COALESCE(NULLIF(species, ''::text), 'Unknown'::text)
  ORDER BY ((count(*))::integer) DESC;


--
-- Name: report_appointment_detail; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_appointment_detail AS
 SELECT r.id,
    r.appt_date,
    r.start_time,
    r.end_time,
        CASE
            WHEN (r.start_time ~ '^\d{1,2}:\d{2}\s*[AP]M$'::text) THEN ((((r.appt_date)::text || ' '::text) || r.start_time))::timestamp without time zone
            ELSE NULL::timestamp without time zone
        END AS appt_start,
    r.location_key,
    r.division,
    r.resource,
    r.appointment_type,
    r.appointment_group,
    r.description AS booking_note,
    r.client_code,
    r.client_name,
    r.client_email,
    r.client_mobile,
    r.pet_code,
    r.pet_name,
    ((NULLIF(r.client_code, ''::text) IS NOT NULL) OR (NULLIF(r.pet_code, ''::text) IS NOT NULL)) AS is_booking,
    a.id AS animal_id,
    a.species,
    a.breed,
    a.sex,
    a.date_of_birth,
    a.master_problems,
    a.animal_notes,
    a.is_active AS pet_is_active,
    a.has_passed_away,
    c.id AS contact_id,
    c.notes AS client_notes,
    c.customer_group,
    c.ezyvet_created_at AS client_since,
    COALESCE(r.clinical_referring_clinic, r.animal_referring_clinic) AS referring_clinic,
    COALESCE(r.clinical_referring_vet, r.animal_referring_vet) AS referring_vet
   FROM ((greendogops.ezyvet_appointment_record r
     LEFT JOIN greendogops.ezyvet_animal a ON (((NULLIF(r.pet_code, ''::text) IS NOT NULL) AND (a.animal_code = r.pet_code))))
     LEFT JOIN greendogops.ezyvet_contact c ON (((NULLIF(r.client_code, ''::text) IS NOT NULL) AND (c.contact_code = r.client_code))));


--
-- Name: VIEW report_appointment_detail; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_appointment_detail IS 'One row per appointment joined to its patient (ezyvet_animal, incl. species, breed, master_problems, animal_notes) and its client (ezyvet_contact, incl. notes). appt_start combines appt_date with the "07:00AM" start_time. Filter is_booking to exclude calendar blocks and internal columns, which have no client or pet.';


--
-- Name: report_appointment_flow; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_appointment_flow AS
 SELECT appt_date,
    location_key,
    count(*) AS appointments,
    round(avg(mins_in_waiting_room), 1) AS avg_wait_minutes,
    round(avg(mins_in_consultation), 1) AS avg_consult_minutes,
    round(avg(mins_in_hospital), 1) AS avg_hospital_minutes,
    round(avg(mins_to_complete), 1) AS avg_minutes_to_complete,
    count(*) FILTER (WHERE (mins_to_complete IS NULL)) AS never_completed
   FROM greendogops.ezyvet_appointment_status
  WHERE (appt_date IS NOT NULL)
  GROUP BY appt_date, location_key;


--
-- Name: report_appointment_type_by_species; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_appointment_type_by_species AS
 SELECT appt_date,
    (date_trunc('month'::text, (appt_date)::timestamp with time zone))::date AS month,
    location_key,
    COALESCE(NULLIF(appointment_type, ''::text), 'Unspecified'::text) AS appointment_type,
    COALESCE(NULLIF(species, ''::text), 'Unknown'::text) AS species,
    count(*) AS appointments
   FROM greendogops.report_appointment_detail d
  WHERE ((appt_date IS NOT NULL) AND is_booking)
  GROUP BY appt_date, ((date_trunc('month'::text, (appt_date)::timestamp with time zone))::date), location_key, COALESCE(NULLIF(appointment_type, ''::text), 'Unspecified'::text), COALESCE(NULLIF(species, ''::text), 'Unknown'::text);


--
-- Name: VIEW report_appointment_type_by_species; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_appointment_type_by_species IS 'Booked appointments per day, hospital, appointment type and patient species (species comes from ezyvet_animal via pet_code, so it is null-bucketed as Unknown when the pet has not been matched).';


--
-- Name: report_appointment_type_volume; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_appointment_type_volume AS
 SELECT appt_date,
    (date_trunc('month'::text, (appt_date)::timestamp with time zone))::date AS month,
    TRIM(BOTH FROM to_char((appt_date)::timestamp with time zone, 'Day'::text)) AS day_of_week,
    location_key,
    COALESCE(NULLIF(appointment_type, ''::text), 'Unspecified'::text) AS appointment_type,
    count(*) AS appointments,
    count(DISTINCT NULLIF(pet_code, ''::text)) AS patients,
    count(DISTINCT NULLIF(client_code, ''::text)) AS clients
   FROM greendogops.ezyvet_appointment_record
  WHERE ((appt_date IS NOT NULL) AND ((NULLIF(client_code, ''::text) IS NOT NULL) OR (NULLIF(pet_code, ''::text) IS NOT NULL)))
  GROUP BY appt_date, ((date_trunc('month'::text, (appt_date)::timestamp with time zone))::date), (TRIM(BOTH FROM to_char((appt_date)::timestamp with time zone, 'Day'::text))), location_key, COALESCE(NULLIF(appointment_type, ''::text), 'Unspecified'::text);


--
-- Name: VIEW report_appointment_type_volume; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_appointment_type_volume IS 'Booked appointments per day, hospital and appointment type (calendar blocks excluded). Use for appointment-type mix, demand forecasting and sizing scheduling templates. Covers past AND future dates, because the export is run over whatever window was requested.';


--
-- Name: report_ar_aging_current; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_ar_aging_current AS
 SELECT r.id,
    r.contact_code,
    r.title,
    r.client,
    r.first_name,
    r.contact_tags,
    r.email,
    r.total_due,
    r.last_30_days_payments,
    r.bucket_current,
    r.bucket_30,
    r.bucket_60,
    r.bucket_90_plus,
    r.snapshot_date,
    r.period_start,
    r.period_end,
    r.created_at
   FROM (greendogops.ezyvet_aged_receivable r
     JOIN ( SELECT max(ezyvet_aged_receivable.snapshot_date) AS d
           FROM greendogops.ezyvet_aged_receivable) m ON ((r.snapshot_date = m.d)));


--
-- Name: report_ar_aging_trend; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_ar_aging_trend AS
 SELECT snapshot_date,
    count(*) AS clients_owing,
    sum(total_due) AS total_due,
    sum(bucket_current) AS due_current,
    sum(bucket_30) AS due_30,
    sum(bucket_60) AS due_60,
    sum(bucket_90_plus) AS due_90_plus
   FROM greendogops.ezyvet_aged_receivable
  GROUP BY snapshot_date;


--
-- Name: report_by_case_owner; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_by_case_owner AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) AS staff_member,
    bool_or((((case_owner IS NOT NULL) AND (case_owner <> ''::text)) OR COALESCE(salesperson_is_vet, false))) AS is_vet,
    (count(*))::integer AS line_count,
    (count(DISTINCT ((client_contact_code || '|'::text) || (line_date)::text)) FILTER (WHERE greendogops.is_appt_line(product_name, product_group)))::integer AS appointments,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) IS NOT NULL) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text))
  WITH NO DATA;


--
-- Name: report_by_location; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_by_location AS
 SELECT (EXTRACT(year FROM service_date))::integer AS year,
    location_key,
    max(location_label) AS location_label,
    (count(*))::integer AS appointments,
    COALESCE(sum(revenue), (0)::numeric) AS revenue,
    (count(DISTINCT client_contact_code))::integer AS unique_clients,
    COALESCE(avg(revenue), (0)::numeric) AS avg_appointment_value
   FROM greendogops.ezyvet_appointment
  GROUP BY ((EXTRACT(year FROM service_date))::integer), location_key
  ORDER BY ((count(*))::integer) DESC;


--
-- Name: report_by_species; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_by_species AS
 SELECT (EXTRACT(year FROM service_date))::integer AS year,
    COALESCE(NULLIF(species_group, ''::text), 'Unknown'::text) AS species_group,
    (count(*))::integer AS appointments,
    COALESCE(sum(revenue), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_appointment
  GROUP BY ((EXTRACT(year FROM service_date))::integer), COALESCE(NULLIF(species_group, ''::text), 'Unknown'::text)
  ORDER BY ((count(*))::integer) DESC;


--
-- Name: report_by_staff; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_by_staff AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text) AS staff_member,
    bool_or(COALESCE(salesperson_is_vet, false)) AS is_vet,
    (count(*))::integer AS line_count,
    (count(DISTINCT NULLIF(consult_id, ''::text)))::integer AS consults,
    (count(DISTINCT ((client_contact_code || '|'::text) || (line_date)::text)) FILTER (WHERE greendogops.is_appt_line(product_name, product_group)))::integer AS appointments,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((staff_member IS NOT NULL) AND (staff_member <> ''::text) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text)
  WITH NO DATA;


--
-- Name: report_capacity_override; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.report_capacity_override (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    track text NOT NULL,
    appt_date date NOT NULL,
    capacity integer DEFAULT 0 NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_capacity_override_capacity_check CHECK (((capacity >= 0) AND (capacity <= 200))),
    CONSTRAINT report_capacity_override_track_check CHECK ((track = ANY (ARRAY['dental'::text, 've'::text, 'ap'::text])))
);


--
-- Name: TABLE report_capacity_override; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.report_capacity_override IS 'One-off capacity for a single date (closures, student days, extra doctors); wins over report_capacity_target.';


--
-- Name: report_capacity_target; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.report_capacity_target (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    track text NOT NULL,
    weekday smallint NOT NULL,
    capacity integer DEFAULT 0 NOT NULL,
    note text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_capacity_target_capacity_check CHECK (((capacity >= 0) AND (capacity <= 200))),
    CONSTRAINT report_capacity_target_track_check CHECK ((track = ANY (ARRAY['dental'::text, 've'::text, 'ap'::text]))),
    CONSTRAINT report_capacity_target_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: TABLE report_capacity_target; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.report_capacity_target IS 'Recurring per-weekday slot counts per clinic and report track; the denominator on the upcoming-appointments Slack report.';


--
-- Name: report_case_owner_by_month; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_case_owner_by_month AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) AS case_owner,
    (date_trunc('month'::text, (line_date)::timestamp with time zone))::date AS month,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) IS NOT NULL) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)), ((date_trunc('month'::text, (line_date)::timestamp with time zone))::date)
  WITH NO DATA;


--
-- Name: report_case_owner_product; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_case_owner_product AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) AS staff_member,
    COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text) AS product_name,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(qty), (0)::numeric) AS qty,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) IS NOT NULL) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)), COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_case_owner_product_group; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_case_owner_product_group AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) AS staff_member,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) IS NOT NULL) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_client_summary; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_client_summary AS
 SELECT (count(*))::integer AS total_contacts,
    (count(*) FILTER (WHERE is_active))::integer AS active_contacts,
    (count(*) FILTER (WHERE is_customer))::integer AS customers,
    (count(*) FILTER (WHERE is_business))::integer AS businesses,
    COALESCE(sum(revenue_spend_ytd), (0)::numeric) AS total_revenue_ytd,
    COALESCE(avg(NULLIF(revenue_spend_ytd, (0)::numeric)), (0)::numeric) AS avg_revenue_ytd
   FROM greendogops.ezyvet_contact;


--
-- Name: report_clients_by_division; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clients_by_division AS
 SELECT COALESCE(NULLIF(division, ''::text), 'Unassigned'::text) AS division,
    (count(*))::integer AS contacts,
    COALESCE(sum(revenue_spend_ytd), (0)::numeric) AS revenue_ytd
   FROM greendogops.ezyvet_contact
  GROUP BY COALESCE(NULLIF(division, ''::text), 'Unassigned'::text)
  ORDER BY COALESCE(sum(revenue_spend_ytd), (0)::numeric) DESC;


--
-- Name: report_clients_by_group; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clients_by_group AS
 SELECT COALESCE(NULLIF(customer_group, ''::text), 'Ungrouped'::text) AS customer_group,
    (count(*))::integer AS contacts,
    COALESCE(sum(revenue_spend_ytd), (0)::numeric) AS revenue_ytd
   FROM greendogops.ezyvet_contact
  GROUP BY COALESCE(NULLIF(customer_group, ''::text), 'Ungrouped'::text)
  ORDER BY ((count(*))::integer) DESC;


--
-- Name: report_clients_by_month; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clients_by_month AS
 SELECT (date_trunc('month'::text, ezyvet_created_at))::date AS month,
    (count(*))::integer AS new_clients
   FROM greendogops.ezyvet_contact
  WHERE (ezyvet_created_at IS NOT NULL)
  GROUP BY ((date_trunc('month'::text, ezyvet_created_at))::date)
  ORDER BY ((date_trunc('month'::text, ezyvet_created_at))::date);


--
-- Name: report_clients_by_recency; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clients_by_recency AS
 WITH classified AS (
         SELECT ezyvet_contact.revenue_spend_ytd,
                CASE
                    WHEN ((ezyvet_contact.last_invoiced IS NULL) AND (COALESCE(ezyvet_contact.revenue_spend_ytd, (0)::numeric) = (0)::numeric)) THEN 6
                    WHEN (ezyvet_contact.last_invoiced >= (CURRENT_DATE - '6 mons'::interval)) THEN 1
                    WHEN (ezyvet_contact.last_invoiced >= (CURRENT_DATE - '1 year'::interval)) THEN 2
                    WHEN (ezyvet_contact.last_invoiced >= (CURRENT_DATE - '2 years'::interval)) THEN 3
                    WHEN (ezyvet_contact.last_invoiced >= (CURRENT_DATE - '3 years'::interval)) THEN 4
                    ELSE 5
                END AS sort_order
           FROM greendogops.ezyvet_contact
        ), buckets(sort_order, bucket, label) AS (
         VALUES (1,'m6'::text,'6 Mo'::text), (2,'m12'::text,'12 Mo'::text), (3,'m24'::text,'24 Mo'::text), (4,'m36'::text,'36 Mo'::text), (5,'m48'::text,'48 Mo+'::text), (6,'non'::text,'Non-Clients'::text)
        )
 SELECT b.sort_order,
    b.bucket,
    b.label,
    (count(c.sort_order))::integer AS contacts,
    COALESCE(sum(c.revenue_spend_ytd), (0)::numeric) AS revenue_ytd
   FROM (buckets b
     LEFT JOIN classified c ON ((c.sort_order = b.sort_order)))
  GROUP BY b.sort_order, b.bucket, b.label
  ORDER BY b.sort_order;


--
-- Name: report_clients_by_recency_location; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clients_by_recency_location AS
 WITH client_last AS (
         SELECT DISTINCT ON (ezyvet_invoice_line.client_contact_code) ezyvet_invoice_line.client_contact_code,
            COALESCE(NULLIF(ezyvet_invoice_line.location_key, ''::text), 'other'::text) AS location_key,
            ezyvet_invoice_line.line_date
           FROM greendogops.ezyvet_invoice_line
          WHERE ((ezyvet_invoice_line.client_contact_code IS NOT NULL) AND (ezyvet_invoice_line.client_contact_code <> ''::text) AND (ezyvet_invoice_line.line_date IS NOT NULL))
          ORDER BY ezyvet_invoice_line.client_contact_code, ezyvet_invoice_line.line_date DESC
        ), classified AS (
         SELECT cl.client_contact_code,
            cl.location_key,
            COALESCE(c_1.revenue_spend_ytd, (0)::numeric) AS revenue_ytd,
                CASE
                    WHEN (cl.line_date >= (CURRENT_DATE - '6 mons'::interval)) THEN 1
                    WHEN (cl.line_date >= (CURRENT_DATE - '1 year'::interval)) THEN 2
                    WHEN (cl.line_date >= (CURRENT_DATE - '2 years'::interval)) THEN 3
                    WHEN (cl.line_date >= (CURRENT_DATE - '3 years'::interval)) THEN 4
                    ELSE 5
                END AS sort_order
           FROM (client_last cl
             LEFT JOIN greendogops.ezyvet_contact c_1 ON ((c_1.contact_code = cl.client_contact_code)))
        ), buckets(sort_order, bucket, label) AS (
         VALUES (1,'m6'::text,'6 Mo'::text), (2,'m12'::text,'12 Mo'::text), (3,'m24'::text,'24 Mo'::text), (4,'m36'::text,'36 Mo'::text), (5,'m48'::text,'48 Mo+'::text)
        ), location_dim(location_key, location_label, location_order) AS (
         VALUES ('sherman_oaks'::text,'Sherman Oaks'::text,1), ('van_nuys'::text,'Van Nuys'::text,2), ('venice'::text,'Venice'::text,3), ('other'::text,'Other'::text,4)
        )
 SELECT d.location_key,
    d.location_label,
    d.location_order,
    b.sort_order,
    b.bucket,
    b.label,
    (count(c.client_contact_code))::integer AS contacts,
    COALESCE(sum(c.revenue_ytd), (0)::numeric) AS revenue_ytd
   FROM ((location_dim d
     CROSS JOIN buckets b)
     LEFT JOIN classified c ON (((c.location_key = d.location_key) AND (c.sort_order = b.sort_order))))
  GROUP BY d.location_key, d.location_label, d.location_order, b.sort_order, b.bucket, b.label
  ORDER BY d.location_order, b.sort_order;


--
-- Name: report_clinical_note_backlog; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_clinical_note_backlog AS
 SELECT COALESCE(NULLIF(case_owner, ''::text), NULLIF(note_created_by, ''::text), 'Unassigned'::text) AS clinician,
    location_key,
    count(*) FILTER (WHERE (approved_by IS NULL)) AS unapproved_notes,
    count(*) AS total_notes,
    min(note_created_date) FILTER (WHERE (approved_by IS NULL)) AS oldest_unapproved
   FROM greendogops.ezyvet_clinical_note
  GROUP BY COALESCE(NULLIF(case_owner, ''::text), NULLIF(note_created_by, ''::text), 'Unassigned'::text), location_key;


--
-- Name: report_record_tag_current; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_record_tag_current AS
 SELECT rt.tag_key,
    t.tag_label,
    t.tag_type,
    t.tag_group,
    rt.record_type,
    rt.record_code,
    rt.record_name,
    rt.email,
    COALESCE(rt.contact_code, a.owner_contact_code) AS contact_code,
    rt.first_seen_on,
    rt.last_confirmed_on,
    t.backfilled_on
   FROM ((greendogops.ezyvet_record_tag rt
     JOIN greendogops.ezyvet_tag t ON ((t.tag_key = rt.tag_key)))
     LEFT JOIN greendogops.ezyvet_animal a ON (((rt.record_type = 'animal'::text) AND (a.animal_code = rt.record_code))))
  WHERE (rt.removed_on IS NULL);


--
-- Name: VIEW report_record_tag_current; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_record_tag_current IS 'Who currently carries each ezyVet tag, pet tags resolved to the pet''s owner.';


--
-- Name: report_contact_tag; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_contact_tag AS
 WITH latest_ar AS (
         SELECT DISTINCT ON (r.contact_code) r.contact_code,
            r.contact_tags,
            r.snapshot_date
           FROM greendogops.ezyvet_aged_receivable r
          WHERE (NULLIF(btrim(r.contact_tags), ''::text) IS NOT NULL)
          ORDER BY r.contact_code, r.snapshot_date DESC
        ), tagged AS (
         SELECT c.ezyvet_contact_id,
            c.contact_code,
            c.full_name,
            c.business_name,
            c.email,
            c.phone,
            c.mobile,
            c.is_customer,
            c.is_active,
            c.customer_group,
            c.hear_about,
            c.last_invoiced,
            COALESCE(NULLIF(btrim(c.contact_tags), ''::text), a.contact_tags) AS tag_list,
                CASE
                    WHEN (NULLIF(btrim(c.contact_tags), ''::text) IS NOT NULL) THEN 'contacts_export'::text
                    ELSE 'aged_receivable'::text
                END AS tag_source,
                CASE
                    WHEN (NULLIF(btrim(c.contact_tags), ''::text) IS NOT NULL) THEN NULL::date
                    ELSE a.snapshot_date
                END AS tag_as_of
           FROM (greendogops.ezyvet_contact c
             LEFT JOIN latest_ar a ON ((a.contact_code = c.contact_code)))
        )
 SELECT t.ezyvet_contact_id,
    t.contact_code,
    t.full_name,
    t.business_name,
    t.email,
    t.phone,
    t.mobile,
    t.is_customer,
    t.is_active,
    t.customer_group,
    t.hear_about,
    t.last_invoiced,
    btrim(x.tag) AS tag,
    lower(btrim(x.tag)) AS tag_norm,
    'contact_tag'::text AS tag_type,
    NULL::text AS tag_group,
    t.tag_source,
    t.tag_as_of,
    true AS in_contact_mirror
   FROM (tagged t
     CROSS JOIN LATERAL unnest(greendogops.split_tag_list(t.tag_list)) x(tag))
  WHERE (NULLIF(btrim(x.tag), ''::text) IS NOT NULL)
UNION ALL
 SELECT c.ezyvet_contact_id,
    rt.contact_code,
    COALESCE(c.full_name, rt.record_name) AS full_name,
    c.business_name,
    COALESCE(c.email, rt.email) AS email,
    c.phone,
    c.mobile,
    c.is_customer,
    c.is_active,
    c.customer_group,
    c.hear_about,
    c.last_invoiced,
    rt.tag_label AS tag,
    lower(rt.tag_label) AS tag_norm,
    rt.tag_type,
    rt.tag_group,
    'records_dashboard'::text AS tag_source,
    rt.last_confirmed_on AS tag_as_of,
    (c.contact_code IS NOT NULL) AS in_contact_mirror
   FROM (greendogops.report_record_tag_current rt
     LEFT JOIN greendogops.ezyvet_contact c ON ((c.contact_code = rt.contact_code)));


--
-- Name: VIEW report_contact_tag; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_contact_tag IS 'One row per contact per ezyVet tag, with the client''s name and contact details. Filter on tag_norm. tag_type: contact_tag (on the client record) or pet_tag (on one of their pets, reported against the owner). in_contact_mirror = false means the tag export knows this client but ezyvet_contact does not, so only name/email are available for them.';


--
-- Name: report_contact_tag_summary; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_contact_tag_summary AS
 SELECT tag_norm,
    min(tag) AS tag,
    min(tag_type) AS tag_type,
    min(tag_group) AS tag_group,
    count(DISTINCT contact_code) AS contacts,
    count(DISTINCT contact_code) FILTER (WHERE is_customer) AS customers,
    count(DISTINCT contact_code) FILTER (WHERE is_active) AS active_contacts,
    count(DISTINCT contact_code) FILTER (WHERE (NOT in_contact_mirror)) AS unmatched_contacts,
    max(last_invoiced) AS last_visit,
    bool_or((tag_source = ANY (ARRAY['contacts_export'::text, 'records_dashboard'::text]))) AS fully_covered,
    max(tag_as_of) AS tag_as_of
   FROM greendogops.report_contact_tag
  GROUP BY tag_norm;


--
-- Name: VIEW report_contact_tag_summary; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_contact_tag_summary IS 'Every ezyVet tag in use with how many clients carry it. Query this first to find the exact spelling of a tag, then filter report_contact_tag on tag_norm. unmatched_contacts are tagged clients absent from ezyvet_contact, so is_customer/is_active/last_visit are unknown for them.';


--
-- Name: report_daily_collections; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_daily_collections AS
 SELECT payment_date,
    location_key,
    COALESCE(NULLIF(payment_method, ''::text), 'Unknown'::text) AS payment_method,
    count(*) AS payment_count,
    sum(amount) AS collected,
    sum(surcharge) AS surcharge
   FROM greendogops.ezyvet_payment
  WHERE (payment_date IS NOT NULL)
  GROUP BY payment_date, location_key, COALESCE(NULLIF(payment_method, ''::text), 'Unknown'::text);


--
-- Name: sched_assignment; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    line_id uuid NOT NULL,
    location_id uuid NOT NULL,
    person_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    work_date date NOT NULL,
    attendance_status greendogops.attendance_status DEFAULT 'scheduled'::greendogops.attendance_status NOT NULL,
    attendance_note text,
    attendance_marked_by uuid,
    attendance_marked_at timestamp with time zone,
    added_post_publish boolean DEFAULT false NOT NULL,
    removed_post_publish boolean DEFAULT false NOT NULL,
    auto_absent boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_after_approval boolean DEFAULT false NOT NULL,
    source text,
    CONSTRAINT sched_assignment_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: COLUMN sched_assignment.source; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sched_assignment.source IS 'Origin of the placement. ''sheet'' = imported from the staff schedule Google Sheet and replaced on every nightly run; null = entered in the app.';


--
-- Name: sched_department; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_department (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text,
    color text DEFAULT '#64748b'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    show_in_planning boolean DEFAULT false NOT NULL
);


--
-- Name: sched_role; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sched_week; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_week (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_start date NOT NULL,
    title text,
    status greendogops.schedule_status DEFAULT 'draft'::greendogops.schedule_status NOT NULL,
    notes text,
    created_by uuid,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_by uuid,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_template boolean DEFAULT false NOT NULL,
    CONSTRAINT sched_week_template_needs_title CHECK (((NOT is_template) OR (COALESCE(btrim(title), ''::text) <> ''::text)))
);


--
-- Name: sched_week_line; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_week_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    template_id uuid,
    department_id uuid NOT NULL,
    role_id uuid,
    label text,
    start_time time without time zone,
    end_time time without time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    is_adhoc boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_dvm_by_dept; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_dvm_by_dept AS
 WITH dvm_days AS (
         SELECT a.person_id,
            p.full_name,
            a.work_date,
            wl.department_id,
            d.name AS department_name,
            d.color AS department_color,
            d.sort_order AS department_sort
           FROM (((((greendogops.sched_assignment a
             JOIN greendogops.sched_week w ON (((w.id = a.week_id) AND (w.status = 'published'::greendogops.schedule_status))))
             JOIN greendogops.sched_week_line wl ON ((wl.id = a.line_id)))
             JOIN greendogops.sched_department d ON ((d.id = wl.department_id)))
             JOIN greendogops.sched_role r ON (((r.id = wl.role_id) AND (r.name ~~* '%dvm%'::text))))
             JOIN greendogops.person p ON ((p.id = a.person_id)))
          WHERE (a.removed_post_publish = false)
          GROUP BY a.person_id, p.full_name, a.work_date, wl.department_id, d.name, d.color, d.sort_order
        ), day_weights AS (
         SELECT dvm_days.person_id,
            dvm_days.work_date,
            (count(*))::numeric AS dept_count
           FROM dvm_days
          GROUP BY dvm_days.person_id, dvm_days.work_date
        ), dvm_people AS (
         SELECT DISTINCT dvm_days.person_id,
            dvm_days.full_name,
            greendogops.name_tokens(dvm_days.full_name) AS tok
           FROM dvm_days
        ), inv AS (
         SELECT ezyvet_invoice_line.case_owner,
            ezyvet_invoice_line.line_date,
            greendogops.name_tokens(ezyvet_invoice_line.case_owner) AS tok,
            COALESCE(sum(ezyvet_invoice_line.total_incl), (0)::numeric) AS revenue,
            count(DISTINCT ezyvet_invoice_line.client_contact_code) FILTER (WHERE greendogops.is_appt_line(ezyvet_invoice_line.product_name, ezyvet_invoice_line.product_group)) AS appointments
           FROM greendogops.ezyvet_invoice_line
          WHERE ((ezyvet_invoice_line.case_owner IS NOT NULL) AND (ezyvet_invoice_line.case_owner <> ''::text) AND (ezyvet_invoice_line.line_date IS NOT NULL))
          GROUP BY ezyvet_invoice_line.case_owner, ezyvet_invoice_line.line_date
        )
 SELECT (EXTRACT(year FROM dd.work_date))::integer AS year,
    dd.full_name AS doctor,
    dd.department_name,
    dd.department_color,
    dd.department_sort,
    (count(DISTINCT dd.work_date))::integer AS days_worked,
    (round(sum(((inv.appointments)::numeric / dw.dept_count))))::integer AS appointments,
    round(sum((inv.revenue / dw.dept_count)), 2) AS revenue
   FROM (((dvm_days dd
     JOIN day_weights dw ON (((dw.person_id = dd.person_id) AND (dw.work_date = dd.work_date))))
     JOIN dvm_people dp ON ((dp.person_id = dd.person_id)))
     JOIN inv ON (((inv.line_date = dd.work_date) AND ((dp.tok <@ inv.tok) OR (inv.tok <@ dp.tok)))))
  GROUP BY ((EXTRACT(year FROM dd.work_date))::integer), dd.full_name, dd.department_name, dd.department_color, dd.department_sort
  WITH NO DATA;


--
-- Name: report_estimate_conversion; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_estimate_conversion AS
 SELECT (date_trunc('month'::text, (COALESCE(date_sent, period_end))::timestamp with time zone))::date AS month,
    status,
    count(*) AS estimates,
    sum(total_value) AS total_value
   FROM greendogops.ezyvet_estimate
  GROUP BY ((date_trunc('month'::text, (COALESCE(date_sent, period_end))::timestamp with time zone))::date), status;


--
-- Name: report_inventory_on_hand; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_inventory_on_hand AS
 SELECT v.id,
    v.product_code,
    v.product_name,
    v.product_group,
    v.current_unit_cost,
    v.weighted_avg_unit_cost,
    v.qty_in_inventory,
    v.total_inventory_value,
    v.snapshot_date,
    v.period_start,
    v.period_end,
    v.created_at
   FROM (greendogops.ezyvet_inventory_value v
     JOIN ( SELECT max(ezyvet_inventory_value.snapshot_date) AS d
           FROM greendogops.ezyvet_inventory_value) m ON ((v.snapshot_date = m.d)));


--
-- Name: report_inventory_value_trend; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_inventory_value_trend AS
 SELECT snapshot_date,
    count(*) AS products,
    sum(total_inventory_value) AS inventory_value
   FROM greendogops.ezyvet_inventory_value
  GROUP BY snapshot_date;


--
-- Name: report_location_monthly; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_location_monthly AS
 SELECT (EXTRACT(year FROM service_date))::integer AS year,
    (date_trunc('month'::text, (service_date)::timestamp with time zone))::date AS month,
    location_key,
    max(location_label) AS location_label,
    (count(*))::integer AS appointments,
    COALESCE(sum(revenue), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_appointment
  GROUP BY ((EXTRACT(year FROM service_date))::integer), ((date_trunc('month'::text, (service_date)::timestamp with time zone))::date), location_key
  ORDER BY ((date_trunc('month'::text, (service_date)::timestamp with time zone))::date);


--
-- Name: report_monthly; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_monthly AS
 SELECT (EXTRACT(year FROM service_date))::integer AS year,
    (date_trunc('month'::text, (service_date)::timestamp with time zone))::date AS month,
    (count(*))::integer AS appointments,
    COALESCE(sum(revenue), (0)::numeric) AS revenue,
    (COALESCE(sum(line_count), (0)::bigint))::integer AS line_count,
    (COALESCE(sum(pet_count), (0)::bigint))::integer AS pet_count,
    (count(DISTINCT client_contact_code))::integer AS unique_clients
   FROM greendogops.ezyvet_appointment
  GROUP BY ((EXTRACT(year FROM service_date))::integer), ((date_trunc('month'::text, (service_date)::timestamp with time zone))::date)
  ORDER BY ((date_trunc('month'::text, (service_date)::timestamp with time zone))::date);


--
-- Name: report_new_clients_by_location_month; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_new_clients_by_location_month AS
 WITH first_visit AS (
         SELECT DISTINCT ON (ezyvet_invoice_line.client_contact_code) ezyvet_invoice_line.client_contact_code,
            COALESCE(NULLIF(ezyvet_invoice_line.location_key, ''::text), 'other'::text) AS first_location
           FROM greendogops.ezyvet_invoice_line
          WHERE ((ezyvet_invoice_line.client_contact_code IS NOT NULL) AND (ezyvet_invoice_line.client_contact_code <> ''::text) AND (ezyvet_invoice_line.line_date IS NOT NULL))
          ORDER BY ezyvet_invoice_line.client_contact_code, ezyvet_invoice_line.line_date
        )
 SELECT (date_trunc('month'::text, c.ezyvet_created_at))::date AS month,
    COALESCE(fv.first_location, 'no_visit_yet'::text) AS location_key,
        CASE COALESCE(fv.first_location, 'no_visit_yet'::text)
            WHEN 'sherman_oaks'::text THEN 'Sherman Oaks'::text
            WHEN 'van_nuys'::text THEN 'Van Nuys'::text
            WHEN 'venice'::text THEN 'Venice'::text
            WHEN 'other'::text THEN 'Other'::text
            ELSE 'No billed visit yet'::text
        END AS location_label,
    (count(*))::integer AS new_clients,
    (count(*) FILTER (WHERE c.is_customer))::integer AS new_customers
   FROM (greendogops.ezyvet_contact c
     LEFT JOIN first_visit fv ON ((fv.client_contact_code = c.contact_code)))
  WHERE (c.ezyvet_created_at IS NOT NULL)
  GROUP BY ((date_trunc('month'::text, c.ezyvet_created_at))::date), COALESCE(fv.first_location, 'no_visit_yet'::text),
        CASE COALESCE(fv.first_location, 'no_visit_yet'::text)
            WHEN 'sherman_oaks'::text THEN 'Sherman Oaks'::text
            WHEN 'van_nuys'::text THEN 'Van Nuys'::text
            WHEN 'venice'::text THEN 'Venice'::text
            WHEN 'other'::text THEN 'Other'::text
            ELSE 'No billed visit yet'::text
        END
  ORDER BY ((date_trunc('month'::text, c.ezyvet_created_at))::date), COALESCE(fv.first_location, 'no_visit_yet'::text);


--
-- Name: VIEW report_new_clients_by_location_month; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON VIEW greendogops.report_new_clients_by_location_month IS 'New client records per month (ezyvet_created_at) split by the hospital of their first billed invoice line. Clients with no billed visit yet are location_key = ''no_visit_yet''. Totals per month match report_clients_by_month. Invoice lines only start 2025-01-02, so location attribution is unreliable for clients created before 2025.';


--
-- Name: report_overview; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_overview AS
 SELECT (EXTRACT(year FROM service_date))::integer AS year,
    (count(*))::integer AS total_appointments,
    (COALESCE(sum(line_count), (0)::bigint))::integer AS total_lines,
    COALESCE(sum(revenue), (0)::numeric) AS total_revenue,
    min(service_date) AS first_date,
    max(service_date) AS last_date,
    (count(DISTINCT client_contact_code))::integer AS unique_clients
   FROM greendogops.ezyvet_appointment
  GROUP BY ((EXTRACT(year FROM service_date))::integer);


--
-- Name: report_patients_by_species; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_patients_by_species AS
 SELECT COALESCE(NULLIF(species_group, ''::text), 'Unknown'::text) AS species_group,
    (count(DISTINCT animal_code))::integer AS patients,
    (count(DISTINCT NULLIF(client_contact_code, ''::text)))::integer AS clients,
    max(line_date) AS last_visit
   FROM greendogops.ezyvet_invoice_line
  WHERE ((animal_code IS NOT NULL) AND (animal_code <> ''::text))
  GROUP BY COALESCE(NULLIF(species_group, ''::text), 'Unknown'::text)
  ORDER BY ((count(DISTINCT animal_code))::integer) DESC;


--
-- Name: report_product_by_location; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_product_by_location AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    location_key,
    max(location_label) AS location_label,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE (line_date IS NOT NULL)
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text), location_key
  WITH NO DATA;


--
-- Name: report_product_price_list; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_product_price_list AS
 SELECT p.ezyvet_product_id,
    p.product_code,
    COALESCE(NULLIF(p.product_name, ''::text), pr.product_name) AS product_name,
    COALESCE(NULLIF(p.product_group, ''::text), pr.product_group) AS product_group,
    p.product_type,
    p.clinical_type,
    p.is_active,
    p.is_sold,
    p.requires_prescription,
    p.supplier,
    pr.division,
    pr.cost,
    pr.sell_price_excl,
    pr.sell_price_incl,
    pr.markup,
        CASE
            WHEN ((pr.cost > (0)::numeric) AND (pr.sell_price_excl IS NOT NULL)) THEN round((pr.sell_price_excl - pr.cost), 2)
            ELSE NULL::numeric
        END AS margin_dollars,
    p.last_invoiced_date
   FROM (greendogops.ezyvet_product_price pr
     LEFT JOIN greendogops.ezyvet_product p ON ((p.product_code = pr.product_code)));


--
-- Name: report_product_summary; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_product_summary AS
 SELECT (count(*))::integer AS total_products,
    (count(*) FILTER (WHERE is_active))::integer AS active_products,
    (count(*) FILTER (WHERE is_sold))::integer AS sellable_products,
    (count(*) FILTER (WHERE requires_prescription))::integer AS prescription_products,
    (count(DISTINCT product_group))::integer AS product_groups,
    max(last_invoiced_date) AS last_invoiced_date
   FROM greendogops.ezyvet_product;


--
-- Name: report_products_by_group; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_products_by_group AS
 SELECT COALESCE(NULLIF(p.product_group, ''::text), 'Unknown'::text) AS product_group,
    (count(*))::integer AS products,
    (count(*) FILTER (WHERE p.is_sold))::integer AS sellable,
    round(avg(pr.sell_price_incl), 2) AS avg_price_incl
   FROM (greendogops.ezyvet_product p
     LEFT JOIN greendogops.ezyvet_product_price pr ON ((pr.product_code = p.product_code)))
  GROUP BY COALESCE(NULLIF(p.product_group, ''::text), 'Unknown'::text)
  ORDER BY ((count(*))::integer) DESC;


--
-- Name: report_record_tag_runs; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_record_tag_runs AS
 SELECT r.tag_key,
    t.tag_label,
    r.mode,
    r.activity_from,
    r.matched,
    r.added,
    r.removed,
    r.ran_on,
    r.ran_at
   FROM (greendogops.ezyvet_record_tag_run r
     LEFT JOIN greendogops.ezyvet_tag t ON ((t.tag_key = r.tag_key)));


--
-- Name: report_reorder_list; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_reorder_list AS
 SELECT o.product_code,
    o.product_name,
    o.in_inventory,
    o.available,
    o.ordered,
    o.short,
    o.to_order,
    o.turn_last_month,
    o.turn_last_12_months,
    o.avg_monthly_turn,
    o.snapshot_date
   FROM (greendogops.ezyvet_inventory_ordering o
     JOIN ( SELECT max(ezyvet_inventory_ordering.snapshot_date) AS d
           FROM greendogops.ezyvet_inventory_ordering) m ON ((o.snapshot_date = m.d)))
  WHERE (o.to_order > (0)::numeric);


--
-- Name: report_soc_overdue_current; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_soc_overdue_current AS
 SELECT s.id,
    s.animal_number,
    s.animal_name,
    s.species,
    s.breed,
    s.owner_first_name,
    s.owner_last_name,
    s.phone_numbers,
    s.mobile_numbers,
    s.email_addresses,
    s.soc_treatment,
    s.soc_type,
    s.soc_due_date,
    s.days_overdue,
    s.last_fulfilled_date,
    s.appt_date,
    s.days_until_appt,
    s.appt_duration_minutes,
    s.appt_reason,
    s.appt_status,
    s.appt_type,
    s.soc_created_date,
    s.department,
    s.location_key,
    s.snapshot_date,
    s.period_start,
    s.period_end,
    s.created_at
   FROM (greendogops.ezyvet_soc_overdue s
     JOIN ( SELECT max(ezyvet_soc_overdue.snapshot_date) AS d
           FROM greendogops.ezyvet_soc_overdue) m ON ((s.snapshot_date = m.d)));


--
-- Name: report_species_by_recency; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_species_by_recency AS
 WITH patient_last AS (
         SELECT DISTINCT ON (ezyvet_invoice_line.animal_code) ezyvet_invoice_line.animal_code,
            COALESCE(NULLIF(ezyvet_invoice_line.species_group, ''::text), 'Unknown'::text) AS species_group,
            NULLIF(ezyvet_invoice_line.client_contact_code, ''::text) AS client_contact_code,
            ezyvet_invoice_line.line_date
           FROM greendogops.ezyvet_invoice_line
          WHERE ((ezyvet_invoice_line.animal_code IS NOT NULL) AND (ezyvet_invoice_line.animal_code <> ''::text) AND (ezyvet_invoice_line.line_date IS NOT NULL))
          ORDER BY ezyvet_invoice_line.animal_code, ezyvet_invoice_line.line_date DESC
        ), classified AS (
         SELECT patient_last.species_group,
            patient_last.client_contact_code,
            patient_last.animal_code,
                CASE
                    WHEN (patient_last.line_date >= (CURRENT_DATE - '1 mon'::interval)) THEN 1
                    WHEN (patient_last.line_date >= (CURRENT_DATE - '3 mons'::interval)) THEN 2
                    WHEN (patient_last.line_date >= (CURRENT_DATE - '6 mons'::interval)) THEN 3
                    ELSE 4
                END AS sort_order
           FROM patient_last
        ), buckets(sort_order, bucket, label) AS (
         VALUES (1,'m1'::text,'≤1 Mo'::text), (2,'m3'::text,'1–3 Mo'::text), (3,'m6'::text,'3–6 Mo'::text), (4,'m6p'::text,'6 Mo+'::text)
        ), species_dim(species_group) AS (
         VALUES ('Dog'::text), ('Cat'::text), ('Exotic'::text), ('Unknown'::text)
        )
 SELECT s.species_group,
    b.sort_order,
    b.bucket,
    b.label,
    (count(c.animal_code))::integer AS patients,
    (count(DISTINCT c.client_contact_code))::integer AS clients
   FROM ((species_dim s
     CROSS JOIN buckets b)
     LEFT JOIN classified c ON (((c.species_group = s.species_group) AND (c.sort_order = b.sort_order))))
  GROUP BY s.species_group, b.sort_order, b.bucket, b.label
  ORDER BY s.species_group, b.sort_order;


--
-- Name: report_staff_by_location; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_staff_by_location AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) AS staff_member,
    location_key,
    max(location_label) AS location_label,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)) IS NOT NULL) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(case_owner, ''::text), NULLIF(staff_member, ''::text)), location_key
  WITH NO DATA;


--
-- Name: report_staff_product; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_staff_product AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text) AS staff_member,
    COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text) AS product_name,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(qty), (0)::numeric) AS qty,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((staff_member IS NOT NULL) AND (staff_member <> ''::text) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text), COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_staff_product_group; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_staff_product_group AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text) AS staff_member,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE ((staff_member IS NOT NULL) AND (staff_member <> ''::text) AND (line_date IS NOT NULL))
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(staff_member, ''::text), 'Unassigned'::text), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_top_product; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_top_product AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text) AS product_name,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(qty), (0)::numeric) AS qty,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE (line_date IS NOT NULL)
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(product_name, ''::text), 'Unnamed'::text), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_top_product_group; Type: MATERIALIZED VIEW; Schema: greendogops; Owner: -
--

CREATE MATERIALIZED VIEW greendogops.report_top_product_group AS
 SELECT (EXTRACT(year FROM line_date))::integer AS year,
    COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text) AS product_group,
    (count(*))::integer AS line_count,
    COALESCE(sum(total_incl), (0)::numeric) AS revenue
   FROM greendogops.ezyvet_invoice_line
  WHERE (line_date IS NOT NULL)
  GROUP BY ((EXTRACT(year FROM line_date))::integer), COALESCE(NULLIF(product_group, ''::text), 'Uncategorized'::text)
  WITH NO DATA;


--
-- Name: report_unbilled_consults_current; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_unbilled_consults_current AS
 SELECT c.id,
    c.appt_at,
    c.appt_date,
    c.client_contact_code,
    c.business_name,
    c.first_name,
    c.last_name,
    c.pet_name,
    c.consult_number,
    c.appt_type,
    c.consult_division,
    c.reason,
    c.location_key,
    c.snapshot_date,
    c.period_start,
    c.period_end,
    c.created_at
   FROM (greendogops.ezyvet_unbilled_consult c
     JOIN ( SELECT max(ezyvet_unbilled_consult.snapshot_date) AS d
           FROM greendogops.ezyvet_unbilled_consult) m ON ((c.snapshot_date = m.d)));


--
-- Name: report_wellness_plan_current; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_wellness_plan_current AS
 SELECT w.id,
    w.unique_id,
    w.customer_code,
    w.customer_name,
    w.pet_code,
    w.pet_name,
    w.plan,
    w.department,
    w.term_start_date,
    w.benefit,
    w.benefit_type,
    w.saved,
    w.allocated,
    w.used,
    w.available,
    w.location_key,
    w.snapshot_date,
    w.period_start,
    w.period_end,
    w.created_at
   FROM (greendogops.ezyvet_wellness_plan_use w
     JOIN ( SELECT max(ezyvet_wellness_plan_use.snapshot_date) AS d
           FROM greendogops.ezyvet_wellness_plan_use) m ON ((w.snapshot_date = m.d)));


--
-- Name: report_years; Type: VIEW; Schema: greendogops; Owner: -
--

CREATE VIEW greendogops.report_years AS
 SELECT DISTINCT (EXTRACT(year FROM service_date))::integer AS year
   FROM greendogops.ezyvet_appointment
  WHERE (service_date IS NOT NULL)
  ORDER BY ((EXTRACT(year FROM service_date))::integer) DESC;


--
-- Name: reporting_refresh_state; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.reporting_refresh_state (
    id boolean DEFAULT true NOT NULL,
    requested_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT reporting_refresh_state_id_check CHECK (id)
);


--
-- Name: resource_category; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.resource_category (
    key text NOT NULL,
    label text NOT NULL,
    icon text DEFAULT '📄'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resource_document; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.resource_document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    description text,
    storage_path text,
    file_name text,
    mime_type text DEFAULT 'application/pdf'::text,
    size_bytes bigint,
    source_url text,
    staff_only boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    google_file_id text,
    content_synced_at timestamp with time zone,
    CONSTRAINT resource_document_has_target CHECK (((storage_path IS NOT NULL) OR (source_url IS NOT NULL)))
);


--
-- Name: resource_document_chunk; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.resource_document_chunk (
    id bigint NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, content)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE resource_document_chunk; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.resource_document_chunk IS 'Extracted text of resource_document rows, chunked for full-text retrieval.';


--
-- Name: resource_document_chunk_id_seq; Type: SEQUENCE; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.resource_document_chunk ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME greendogops.resource_document_chunk_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sched_change_log; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    assignment_id uuid,
    person_id uuid,
    action text NOT NULL,
    detail text,
    actor_id uuid,
    actor_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sched_closure; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_closure (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    location_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sched_closure_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: sched_employee_setting; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_employee_setting (
    person_id uuid NOT NULL,
    weekly_shift_target integer DEFAULT 5 NOT NULL,
    is_schedulable boolean DEFAULT false NOT NULL,
    default_location_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    eligible_location_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    available_days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    is_student_mentor boolean DEFAULT false NOT NULL,
    is_student_coordinator boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN sched_employee_setting.is_schedulable; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sched_employee_setting.is_schedulable IS 'Scheduling Active. Only people flagged here appear in the schedule grid, the eligibility matrix, and shift pickers. Employees default to active; every other person status defaults to inactive. Edited from HR / Roster.';


--
-- Name: COLUMN sched_employee_setting.eligible_location_ids; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sched_employee_setting.eligible_location_ids IS 'Locations this employee may be scheduled at; empty = all locations.';


--
-- Name: COLUMN sched_employee_setting.available_days; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sched_employee_setting.available_days IS 'Weekdays this employee is available, 0=Sun..6=Sat; empty = any day.';


--
-- Name: sched_event; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    location_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sched_event_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: sched_role_member; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_role_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    person_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sched_shift_template; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_shift_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    role_id uuid,
    label text,
    start_time time without time zone,
    end_time time without time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sched_week_location; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sched_week_location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_id uuid NOT NULL,
    location_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sheet_sync_issue; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sheet_sync_issue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    run_id uuid,
    kind text NOT NULL,
    subject text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sheet_sync_issue_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text])))
);


--
-- Name: TABLE sheet_sync_issue; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.sheet_sync_issue IS 'Review queue for spreadsheet rows the nightly sync would not apply automatically.';


--
-- Name: sheet_sync_source; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sheet_sync_source (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    spreadsheet_id text NOT NULL,
    spreadsheet_url text,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_modified_time timestamp with time zone,
    last_synced_at timestamp with time zone,
    last_status text,
    last_error text,
    last_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE sheet_sync_source; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.sheet_sync_source IS 'Google Sheets / workbooks pulled automatically every night by the sheet sync agents.';


--
-- Name: smart_glossary; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.smart_glossary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    term text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    definition text NOT NULL,
    sql_hint text,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_note text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smart_glossary_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'suggested'::text]))),
    CONSTRAINT smart_glossary_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: TABLE smart_glossary; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.smart_glossary IS 'Shared business vocabulary for Smart Report: a phrase, the other ways people say it, what it means and how to express it in SQL. Matched terms are injected into the prompt.';


--
-- Name: smart_question_log; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.smart_question_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_user_id uuid,
    user_email text,
    user_role text,
    question text NOT NULL,
    sql text,
    ok boolean DEFAULT false NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    answer text,
    error text,
    attempts jsonb DEFAULT '[]'::jsonb NOT NULL,
    provider text,
    duration_ms integer,
    feedback smallint,
    feedback_note text,
    verified boolean DEFAULT false NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smart_question_log_feedback_ck CHECK (((feedback IS NULL) OR (feedback = ANY (ARRAY['-1'::integer, 1]))))
);


--
-- Name: TABLE smart_question_log; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.smart_question_log IS 'Every Smart Report question: the SQL it produced, how it went, and whether a human confirmed the answer. Private history per user; verified rows train the prompt.';


--
-- Name: sms_consent; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sms_consent (
    person_id uuid NOT NULL,
    source text NOT NULL,
    consented_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by uuid,
    recorded_by_name text
);


--
-- Name: TABLE sms_consent; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.sms_consent IS 'Texting consent recorded by staff (how it was given in source). Service role only.';


--
-- Name: sms_message; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sms_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    direction text NOT NULL,
    phone text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    twilio_sid text,
    error_code text,
    error_message text,
    sent_by uuid,
    sent_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_message_direction_check CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text]))),
    CONSTRAINT sms_message_phone_check CHECK ((phone ~ '^\+[1-9][0-9]{6,14}$'::text)),
    CONSTRAINT sms_message_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'undelivered'::text, 'failed'::text, 'received'::text])))
);


--
-- Name: TABLE sms_message; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.sms_message IS 'Texts sent to / received from candidates and employees via Twilio. Service role only.';


--
-- Name: COLUMN sms_message.phone; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sms_message.phone IS 'The other party, E.164 (+13105551234)';


--
-- Name: COLUMN sms_message.twilio_sid; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON COLUMN greendogops.sms_message.twilio_sid IS 'Twilio Message SID (SM…); unique so webhook retries are idempotent';


--
-- Name: sms_opt_out; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.sms_opt_out (
    phone text NOT NULL,
    keyword text,
    opted_out_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_opt_out_phone_check CHECK ((phone ~ '^\+[1-9][0-9]{6,14}$'::text))
);


--
-- Name: TABLE sms_opt_out; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.sms_opt_out IS 'Numbers that replied STOP. Never text these until they reply START. Service role only.';


--
-- Name: user_notification; Type: TABLE; Schema: greendogops; Owner: -
--

CREATE TABLE greendogops.user_notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    href text,
    module text,
    severity text DEFAULT 'info'::text NOT NULL,
    actor_user_id uuid,
    task_id uuid,
    dedupe_key text,
    read_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_notification_body_check CHECK (((body IS NULL) OR (length(body) <= 2000))),
    CONSTRAINT user_notification_dedupe_key_check CHECK (((dedupe_key IS NULL) OR (length(dedupe_key) <= 200))),
    CONSTRAINT user_notification_href_check CHECK (((href IS NULL) OR (href ~ '^/([^/\\]|$)'::text) OR (href ~ '^https://([a-z0-9-]+\.)*slack\.com/'::text))),
    CONSTRAINT user_notification_kind_check CHECK ((kind ~ '^[a-z_]+(\.[a-z_]+)*$'::text)),
    CONSTRAINT user_notification_module_check CHECK (((module IS NULL) OR (module ~ '^[a-z_]+$'::text))),
    CONSTRAINT user_notification_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'action'::text, 'warning'::text]))),
    CONSTRAINT user_notification_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 200)))
);


--
-- Name: TABLE user_notification; Type: COMMENT; Schema: greendogops; Owner: -
--

COMMENT ON TABLE greendogops.user_notification IS 'In-app notification feed per Ops login. kind is a dotted event name (task.assigned). Never holds compensation or HR-file content. Service role only.';


--
-- Name: agent agent_key_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent
    ADD CONSTRAINT agent_key_key UNIQUE (key);


--
-- Name: agent agent_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent
    ADD CONSTRAINT agent_pkey PRIMARY KEY (id);


--
-- Name: agent_report agent_report_agent_id_key_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_report
    ADD CONSTRAINT agent_report_agent_id_key_key UNIQUE (agent_id, key);


--
-- Name: agent_report agent_report_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_report
    ADD CONSTRAINT agent_report_pkey PRIMARY KEY (id);


--
-- Name: agent_run_log agent_run_log_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_run_log
    ADD CONSTRAINT agent_run_log_pkey PRIMARY KEY (id);


--
-- Name: agent_run agent_run_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_run
    ADD CONSTRAINT agent_run_pkey PRIMARY KEY (id);


--
-- Name: app_setting app_setting_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.app_setting
    ADD CONSTRAINT app_setting_pkey PRIMARY KEY (key);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: ats_hr_merge_backup_0032 ats_hr_merge_backup_0032_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ats_hr_merge_backup_0032
    ADD CONSTRAINT ats_hr_merge_backup_0032_pkey PRIMARY KEY (ats_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bizdev_appt_type bizdev_appt_type_location_id_appt_type_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.bizdev_appt_type
    ADD CONSTRAINT bizdev_appt_type_location_id_appt_type_key UNIQUE (location_id, appt_type);


--
-- Name: bizdev_appt_type bizdev_appt_type_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.bizdev_appt_type
    ADD CONSTRAINT bizdev_appt_type_pkey PRIMARY KEY (id);


--
-- Name: bizdev_location_config bizdev_location_config_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.bizdev_location_config
    ADD CONSTRAINT bizdev_location_config_pkey PRIMARY KEY (location_id);


--
-- Name: calendar_event calendar_event_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_event
    ADD CONSTRAINT calendar_event_pkey PRIMARY KEY (id);


--
-- Name: calendar_notification calendar_notification_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_notification
    ADD CONSTRAINT calendar_notification_pkey PRIMARY KEY (id);


--
-- Name: calendar_schedule_pin calendar_schedule_pin_person_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_schedule_pin
    ADD CONSTRAINT calendar_schedule_pin_person_id_key UNIQUE (person_id);


--
-- Name: calendar_schedule_pin calendar_schedule_pin_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_schedule_pin
    ADD CONSTRAINT calendar_schedule_pin_pkey PRIMARY KEY (id);


--
-- Name: calendar_sync_state calendar_sync_state_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_sync_state
    ADD CONSTRAINT calendar_sync_state_pkey PRIMARY KEY (google_calendar_id);


--
-- Name: clinic_visits clinic_visits_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.clinic_visits
    ADD CONSTRAINT clinic_visits_pkey PRIMARY KEY (id);


--
-- Name: credential credential_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.credential
    ADD CONSTRAINT credential_pkey PRIMARY KEY (id);


--
-- Name: crm_ce_attendance crm_ce_attendance_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_ce_attendance
    ADD CONSTRAINT crm_ce_attendance_pkey PRIMARY KEY (id);


--
-- Name: crm_ce_event crm_ce_event_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_ce_event
    ADD CONSTRAINT crm_ce_event_pkey PRIMARY KEY (id);


--
-- Name: crm_contact_document crm_contact_document_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_contact_document
    ADD CONSTRAINT crm_contact_document_pkey PRIMARY KEY (id);


--
-- Name: crm_contact crm_contact_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_contact
    ADD CONSTRAINT crm_contact_pkey PRIMARY KEY (id);


--
-- Name: crm_org_document crm_org_document_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_org_document
    ADD CONSTRAINT crm_org_document_pkey PRIMARY KEY (id);


--
-- Name: crm_org_visit crm_org_visit_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_org_visit
    ADD CONSTRAINT crm_org_visit_pkey PRIMARY KEY (id);


--
-- Name: crm_organization crm_organization_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_organization
    ADD CONSTRAINT crm_organization_pkey PRIMARY KEY (id);


--
-- Name: crm_program_name crm_program_name_name_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_program_name
    ADD CONSTRAINT crm_program_name_name_key UNIQUE (name);


--
-- Name: crm_program_name crm_program_name_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_program_name
    ADD CONSTRAINT crm_program_name_pkey PRIMARY KEY (id);


--
-- Name: crm_retail_lead crm_retail_lead_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_retail_lead
    ADD CONSTRAINT crm_retail_lead_pkey PRIMARY KEY (id);


--
-- Name: email_event email_event_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.email_event
    ADD CONSTRAINT email_event_pkey PRIMARY KEY (id);


--
-- Name: email_event email_event_resend_event_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.email_event
    ADD CONSTRAINT email_event_resend_event_id_key UNIQUE (resend_event_id);


--
-- Name: email_template email_template_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.email_template
    ADD CONSTRAINT email_template_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_aged_receivable ezyvet_aged_receivable_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_aged_receivable
    ADD CONSTRAINT ezyvet_aged_receivable_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_agenda_appt_snapshot ezyvet_agenda_appt_snapshot_location_id_appt_date_departmen_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_appt_snapshot
    ADD CONSTRAINT ezyvet_agenda_appt_snapshot_location_id_appt_date_departmen_key UNIQUE (location_id, appt_date, department_id, snapshot_date, appt_key);


--
-- Name: ezyvet_agenda_appt_snapshot ezyvet_agenda_appt_snapshot_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_appt_snapshot
    ADD CONSTRAINT ezyvet_agenda_appt_snapshot_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_agenda_count ezyvet_agenda_count_location_id_appt_date_department_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_count
    ADD CONSTRAINT ezyvet_agenda_count_location_id_appt_date_department_id_key UNIQUE (location_id, appt_date, department_id);


--
-- Name: ezyvet_agenda_count ezyvet_agenda_count_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_count
    ADD CONSTRAINT ezyvet_agenda_count_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_agenda_dept_map ezyvet_agenda_dept_map_ezyvet_label_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_dept_map
    ADD CONSTRAINT ezyvet_agenda_dept_map_ezyvet_label_key UNIQUE (ezyvet_label);


--
-- Name: ezyvet_agenda_dept_map ezyvet_agenda_dept_map_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_dept_map
    ADD CONSTRAINT ezyvet_agenda_dept_map_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_agenda_snapshot ezyvet_agenda_snapshot_location_id_appt_date_department_id__key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_snapshot
    ADD CONSTRAINT ezyvet_agenda_snapshot_location_id_appt_date_department_id__key UNIQUE (location_id, appt_date, department_id, snapshot_date);


--
-- Name: ezyvet_agenda_snapshot ezyvet_agenda_snapshot_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_snapshot
    ADD CONSTRAINT ezyvet_agenda_snapshot_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_animal ezyvet_animal_ezyvet_animal_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_animal
    ADD CONSTRAINT ezyvet_animal_ezyvet_animal_id_key UNIQUE (ezyvet_animal_id);


--
-- Name: ezyvet_animal_import ezyvet_animal_import_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_animal_import
    ADD CONSTRAINT ezyvet_animal_import_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_animal ezyvet_animal_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_animal
    ADD CONSTRAINT ezyvet_animal_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_appointment_record ezyvet_appointment_record_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appointment_record
    ADD CONSTRAINT ezyvet_appointment_record_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_appointment_status ezyvet_appointment_status_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appointment_status
    ADD CONSTRAINT ezyvet_appointment_status_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_appointment_type_stat ezyvet_appointment_type_stat_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appointment_type_stat
    ADD CONSTRAINT ezyvet_appointment_type_stat_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_appt_type_dept_map ezyvet_appt_type_dept_map_appt_type_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appt_type_dept_map
    ADD CONSTRAINT ezyvet_appt_type_dept_map_appt_type_key UNIQUE (appt_type);


--
-- Name: ezyvet_appt_type_dept_map ezyvet_appt_type_dept_map_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appt_type_dept_map
    ADD CONSTRAINT ezyvet_appt_type_dept_map_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_cancelled_appointment ezyvet_cancelled_appointment_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_cancelled_appointment
    ADD CONSTRAINT ezyvet_cancelled_appointment_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_clinical_note ezyvet_clinical_note_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_clinical_note
    ADD CONSTRAINT ezyvet_clinical_note_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_consult_metric ezyvet_consult_metric_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_consult_metric
    ADD CONSTRAINT ezyvet_consult_metric_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_contact_change ezyvet_contact_change_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_contact_change
    ADD CONSTRAINT ezyvet_contact_change_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_contact ezyvet_contact_ezyvet_contact_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_contact
    ADD CONSTRAINT ezyvet_contact_ezyvet_contact_id_key UNIQUE (ezyvet_contact_id);


--
-- Name: ezyvet_contact_import ezyvet_contact_import_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_contact_import
    ADD CONSTRAINT ezyvet_contact_import_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_contact ezyvet_contact_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_contact
    ADD CONSTRAINT ezyvet_contact_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_controlled_drug ezyvet_controlled_drug_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_controlled_drug
    ADD CONSTRAINT ezyvet_controlled_drug_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_customer_invoice_stat ezyvet_customer_invoice_stat_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_customer_invoice_stat
    ADD CONSTRAINT ezyvet_customer_invoice_stat_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_disabled_record ezyvet_disabled_record_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_disabled_record
    ADD CONSTRAINT ezyvet_disabled_record_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_end_of_day ezyvet_end_of_day_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_end_of_day
    ADD CONSTRAINT ezyvet_end_of_day_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_estimate ezyvet_estimate_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_estimate
    ADD CONSTRAINT ezyvet_estimate_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_expired_inventory ezyvet_expired_inventory_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_expired_inventory
    ADD CONSTRAINT ezyvet_expired_inventory_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_expiring_inventory ezyvet_expiring_inventory_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_expiring_inventory
    ADD CONSTRAINT ezyvet_expiring_inventory_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_inventory_ordering ezyvet_inventory_ordering_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_inventory_ordering
    ADD CONSTRAINT ezyvet_inventory_ordering_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_inventory_transfer ezyvet_inventory_transfer_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_inventory_transfer
    ADD CONSTRAINT ezyvet_inventory_transfer_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_inventory_value ezyvet_inventory_value_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_inventory_value
    ADD CONSTRAINT ezyvet_inventory_value_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_invoice_import ezyvet_invoice_import_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_invoice_import
    ADD CONSTRAINT ezyvet_invoice_import_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_invoice_line ezyvet_invoice_line_invoice_line_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_invoice_line
    ADD CONSTRAINT ezyvet_invoice_line_invoice_line_id_key UNIQUE (invoice_line_id);


--
-- Name: ezyvet_invoice_line ezyvet_invoice_line_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_invoice_line
    ADD CONSTRAINT ezyvet_invoice_line_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_invoice_summary ezyvet_invoice_summary_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_invoice_summary
    ADD CONSTRAINT ezyvet_invoice_summary_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_payment_allocation ezyvet_payment_allocation_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_payment_allocation
    ADD CONSTRAINT ezyvet_payment_allocation_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_payment ezyvet_payment_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_payment
    ADD CONSTRAINT ezyvet_payment_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_product ezyvet_product_ezyvet_product_id_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_product
    ADD CONSTRAINT ezyvet_product_ezyvet_product_id_key UNIQUE (ezyvet_product_id);


--
-- Name: ezyvet_product_import ezyvet_product_import_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_product_import
    ADD CONSTRAINT ezyvet_product_import_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_product ezyvet_product_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_product
    ADD CONSTRAINT ezyvet_product_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_product_price ezyvet_product_price_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_product_price
    ADD CONSTRAINT ezyvet_product_price_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_product_price ezyvet_product_price_product_code_division_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_product_price
    ADD CONSTRAINT ezyvet_product_price_product_code_division_key UNIQUE (product_code, division);


--
-- Name: ezyvet_purchase ezyvet_purchase_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_purchase
    ADD CONSTRAINT ezyvet_purchase_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_record_tag ezyvet_record_tag_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_record_tag
    ADD CONSTRAINT ezyvet_record_tag_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_record_tag_run ezyvet_record_tag_run_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_record_tag_run
    ADD CONSTRAINT ezyvet_record_tag_run_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_soc_overdue ezyvet_soc_overdue_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_soc_overdue
    ADD CONSTRAINT ezyvet_soc_overdue_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_staff_sale ezyvet_staff_sale_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_staff_sale
    ADD CONSTRAINT ezyvet_staff_sale_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_tag ezyvet_tag_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_tag
    ADD CONSTRAINT ezyvet_tag_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_tag ezyvet_tag_tag_key_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_tag
    ADD CONSTRAINT ezyvet_tag_tag_key_key UNIQUE (tag_key);


--
-- Name: ezyvet_taxable_sales ezyvet_taxable_sales_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_taxable_sales
    ADD CONSTRAINT ezyvet_taxable_sales_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_unapplied_payment ezyvet_unapplied_payment_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_unapplied_payment
    ADD CONSTRAINT ezyvet_unapplied_payment_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_unbilled_consult ezyvet_unbilled_consult_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_unbilled_consult
    ADD CONSTRAINT ezyvet_unbilled_consult_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_vaccination ezyvet_vaccination_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_vaccination
    ADD CONSTRAINT ezyvet_vaccination_pkey PRIMARY KEY (id);


--
-- Name: ezyvet_wellness_plan_use ezyvet_wellness_plan_use_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_wellness_plan_use
    ADD CONSTRAINT ezyvet_wellness_plan_use_pkey PRIMARY KEY (id);


--
-- Name: interview_invite interview_invite_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.interview_invite
    ADD CONSTRAINT interview_invite_pkey PRIMARY KEY (id);


--
-- Name: interview_invite interview_invite_token_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.interview_invite
    ADD CONSTRAINT interview_invite_token_key UNIQUE (token);


--
-- Name: location location_code_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.location
    ADD CONSTRAINT location_code_key UNIQUE (code);


--
-- Name: location location_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);


--
-- Name: marketing_activity marketing_activity_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_activity
    ADD CONSTRAINT marketing_activity_pkey PRIMARY KEY (id);


--
-- Name: marketing_budget_entry marketing_budget_entry_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_budget_entry
    ADD CONSTRAINT marketing_budget_entry_pkey PRIMARY KEY (id);


--
-- Name: marketing_budget_period marketing_budget_period_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_budget_period
    ADD CONSTRAINT marketing_budget_period_pkey PRIMARY KEY (id);


--
-- Name: marketing_budget_period marketing_budget_period_year_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_budget_period
    ADD CONSTRAINT marketing_budget_period_year_key UNIQUE (year);


--
-- Name: marketing_event_attendee marketing_event_attendee_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event_attendee
    ADD CONSTRAINT marketing_event_attendee_pkey PRIMARY KEY (id);


--
-- Name: marketing_event marketing_event_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event
    ADD CONSTRAINT marketing_event_pkey PRIMARY KEY (id);


--
-- Name: marketing_event_source marketing_event_source_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event_source
    ADD CONSTRAINT marketing_event_source_pkey PRIMARY KEY (id);


--
-- Name: marketing_goal marketing_goal_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_goal
    ADD CONSTRAINT marketing_goal_pkey PRIMARY KEY (id);


--
-- Name: marketing_influencers marketing_influencers_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_influencers
    ADD CONSTRAINT marketing_influencers_pkey PRIMARY KEY (id);


--
-- Name: marketing_initiative marketing_initiative_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_initiative
    ADD CONSTRAINT marketing_initiative_pkey PRIMARY KEY (id);


--
-- Name: marketing_promotion marketing_promotion_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_promotion
    ADD CONSTRAINT marketing_promotion_pkey PRIMARY KEY (id);


--
-- Name: marketing_resource marketing_resource_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_resource
    ADD CONSTRAINT marketing_resource_pkey PRIMARY KEY (id);


--
-- Name: marketing_tree_node marketing_tree_node_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_tree_node
    ADD CONSTRAINT marketing_tree_node_pkey PRIMARY KEY (id);


--
-- Name: medical_board_day medical_board_day_location_id_board_date_board_type_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_day
    ADD CONSTRAINT medical_board_day_location_id_board_date_board_type_key UNIQUE (location_id, board_date, board_type);


--
-- Name: medical_board_day medical_board_day_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_day
    ADD CONSTRAINT medical_board_day_pkey PRIMARY KEY (id);


--
-- Name: medical_board_row medical_board_row_location_id_board_date_board_type_appt_ke_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_row
    ADD CONSTRAINT medical_board_row_location_id_board_date_board_type_appt_ke_key UNIQUE (location_id, board_date, board_type, appt_key);


--
-- Name: medical_board_row medical_board_row_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_row
    ADD CONSTRAINT medical_board_row_pkey PRIMARY KEY (id);


--
-- Name: medical_board_type medical_board_type_dept_code_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_type
    ADD CONSTRAINT medical_board_type_dept_code_key UNIQUE (dept_code);


--
-- Name: medical_board_type medical_board_type_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_type
    ADD CONSTRAINT medical_board_type_pkey PRIMARY KEY (key);


--
-- Name: notification_delivery notification_delivery_notification_id_channel_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.notification_delivery
    ADD CONSTRAINT notification_delivery_notification_id_channel_key UNIQUE (notification_id, channel);


--
-- Name: notification_delivery notification_delivery_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.notification_delivery
    ADD CONSTRAINT notification_delivery_pkey PRIMARY KEY (id);


--
-- Name: ops_task ops_task_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ops_task
    ADD CONSTRAINT ops_task_pkey PRIMARY KEY (id);


--
-- Name: partner_contacts partner_contacts_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.partner_contacts
    ADD CONSTRAINT partner_contacts_pkey PRIMARY KEY (id);


--
-- Name: partner_notes partner_notes_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.partner_notes
    ADD CONSTRAINT partner_notes_pkey PRIMARY KEY (id);


--
-- Name: person_asset person_asset_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_asset
    ADD CONSTRAINT person_asset_pkey PRIMARY KEY (id);


--
-- Name: person_compliance_entry person_compliance_entry_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_compliance_entry
    ADD CONSTRAINT person_compliance_entry_pkey PRIMARY KEY (id);


--
-- Name: person_disciplinary_action person_disciplinary_action_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_disciplinary_action
    ADD CONSTRAINT person_disciplinary_action_pkey PRIMARY KEY (id);


--
-- Name: person_document person_document_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_document
    ADD CONSTRAINT person_document_pkey PRIMARY KEY (id);


--
-- Name: person_employment person_employment_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_employment
    ADD CONSTRAINT person_employment_pkey PRIMARY KEY (person_id);


--
-- Name: person_interview person_interview_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_interview
    ADD CONSTRAINT person_interview_pkey PRIMARY KEY (id);


--
-- Name: person_license person_license_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_license
    ADD CONSTRAINT person_license_pkey PRIMARY KEY (id);


--
-- Name: person_onboarding_item person_onboarding_item_person_id_item_key_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_onboarding_item
    ADD CONSTRAINT person_onboarding_item_person_id_item_key_key UNIQUE (person_id, item_key);


--
-- Name: person_onboarding_item person_onboarding_item_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_onboarding_item
    ADD CONSTRAINT person_onboarding_item_pkey PRIMARY KEY (id);


--
-- Name: person person_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person
    ADD CONSTRAINT person_pkey PRIMARY KEY (id);


--
-- Name: person_pto_day person_pto_day_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_pto_day
    ADD CONSTRAINT person_pto_day_pkey PRIMARY KEY (id);


--
-- Name: person_recruiting person_recruiting_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_recruiting
    ADD CONSTRAINT person_recruiting_pkey PRIMARY KEY (person_id);


--
-- Name: person_review person_review_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_review
    ADD CONSTRAINT person_review_pkey PRIMARY KEY (id);


--
-- Name: person_slack_link person_slack_link_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_slack_link
    ADD CONSTRAINT person_slack_link_pkey PRIMARY KEY (person_id);


--
-- Name: person_time_off person_time_off_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_time_off
    ADD CONSTRAINT person_time_off_pkey PRIMARY KEY (id);


--
-- Name: planning_capacity_rule planning_capacity_rule_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_capacity_rule
    ADD CONSTRAINT planning_capacity_rule_pkey PRIMARY KEY (id);


--
-- Name: planning_guide_column planning_guide_column_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide_column
    ADD CONSTRAINT planning_guide_column_pkey PRIMARY KEY (id);


--
-- Name: planning_guide planning_guide_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide
    ADD CONSTRAINT planning_guide_pkey PRIMARY KEY (id);


--
-- Name: planning_guide_slot planning_guide_slot_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide_slot
    ADD CONSTRAINT planning_guide_slot_pkey PRIMARY KEY (id);


--
-- Name: position position_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops."position"
    ADD CONSTRAINT position_pkey PRIMARY KEY (id);


--
-- Name: profile_transition_log profile_transition_log_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.profile_transition_log
    ADD CONSTRAINT profile_transition_log_pkey PRIMARY KEY (id);


--
-- Name: qr_code qr_code_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_pkey PRIMARY KEY (id);


--
-- Name: qr_form qr_form_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_form
    ADD CONSTRAINT qr_form_pkey PRIMARY KEY (id);


--
-- Name: qr_lead qr_lead_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_bucket rate_limit_bucket_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.rate_limit_bucket
    ADD CONSTRAINT rate_limit_bucket_pkey PRIMARY KEY (bucket_key);


--
-- Name: recruiter_google_token recruiter_google_token_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiter_google_token
    ADD CONSTRAINT recruiter_google_token_pkey PRIMARY KEY (user_id);


--
-- Name: recruiter_schedule recruiter_schedule_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiter_schedule
    ADD CONSTRAINT recruiter_schedule_pkey PRIMARY KEY (user_id);


--
-- Name: recruiting_activity recruiting_activity_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_activity
    ADD CONSTRAINT recruiting_activity_pkey PRIMARY KEY (id);


--
-- Name: recruiting_email_template recruiting_email_template_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_email_template
    ADD CONSTRAINT recruiting_email_template_pkey PRIMARY KEY (id);


--
-- Name: recruiting_form recruiting_form_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form
    ADD CONSTRAINT recruiting_form_pkey PRIMARY KEY (id);


--
-- Name: recruiting_form_request recruiting_form_request_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_request
    ADD CONSTRAINT recruiting_form_request_pkey PRIMARY KEY (id);


--
-- Name: recruiting_form_request recruiting_form_request_token_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_request
    ADD CONSTRAINT recruiting_form_request_token_key UNIQUE (token);


--
-- Name: recruiting_form_response recruiting_form_response_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_response
    ADD CONSTRAINT recruiting_form_response_pkey PRIMARY KEY (id);


--
-- Name: recruiting_rejection recruiting_rejection_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_rejection
    ADD CONSTRAINT recruiting_rejection_pkey PRIMARY KEY (id);


--
-- Name: recruiting_score_change recruiting_score_change_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_score_change
    ADD CONSTRAINT recruiting_score_change_pkey PRIMARY KEY (id);


--
-- Name: recruiting_task recruiting_task_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_task
    ADD CONSTRAINT recruiting_task_pkey PRIMARY KEY (id);


--
-- Name: referral_partners referral_partners_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.referral_partners
    ADD CONSTRAINT referral_partners_pkey PRIMARY KEY (id);


--
-- Name: referral_revenue_line_items referral_revenue_line_items_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.referral_revenue_line_items
    ADD CONSTRAINT referral_revenue_line_items_pkey PRIMARY KEY (id);


--
-- Name: referral_sync_history referral_sync_history_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.referral_sync_history
    ADD CONSTRAINT referral_sync_history_pkey PRIMARY KEY (id);


--
-- Name: reminder_ack reminder_ack_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_ack
    ADD CONSTRAINT reminder_ack_pkey PRIMARY KEY (rule_id, user_id, occurrence_date);


--
-- Name: reminder_rule reminder_rule_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_rule
    ADD CONSTRAINT reminder_rule_pkey PRIMARY KEY (id);


--
-- Name: report_capacity_override report_capacity_override_location_id_track_appt_date_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_override
    ADD CONSTRAINT report_capacity_override_location_id_track_appt_date_key UNIQUE (location_id, track, appt_date);


--
-- Name: report_capacity_override report_capacity_override_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_override
    ADD CONSTRAINT report_capacity_override_pkey PRIMARY KEY (id);


--
-- Name: report_capacity_target report_capacity_target_location_id_track_weekday_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_target
    ADD CONSTRAINT report_capacity_target_location_id_track_weekday_key UNIQUE (location_id, track, weekday);


--
-- Name: report_capacity_target report_capacity_target_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_target
    ADD CONSTRAINT report_capacity_target_pkey PRIMARY KEY (id);


--
-- Name: reporting_refresh_state reporting_refresh_state_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reporting_refresh_state
    ADD CONSTRAINT reporting_refresh_state_pkey PRIMARY KEY (id);


--
-- Name: resource_category resource_category_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.resource_category
    ADD CONSTRAINT resource_category_pkey PRIMARY KEY (key);


--
-- Name: resource_document_chunk resource_document_chunk_document_id_chunk_index_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.resource_document_chunk
    ADD CONSTRAINT resource_document_chunk_document_id_chunk_index_key UNIQUE (document_id, chunk_index);


--
-- Name: resource_document_chunk resource_document_chunk_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.resource_document_chunk
    ADD CONSTRAINT resource_document_chunk_pkey PRIMARY KEY (id);


--
-- Name: resource_document resource_document_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.resource_document
    ADD CONSTRAINT resource_document_pkey PRIMARY KEY (id);


--
-- Name: sched_assignment sched_assignment_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_assignment
    ADD CONSTRAINT sched_assignment_pkey PRIMARY KEY (id);


--
-- Name: sched_change_log sched_change_log_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_change_log
    ADD CONSTRAINT sched_change_log_pkey PRIMARY KEY (id);


--
-- Name: sched_closure sched_closure_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_closure
    ADD CONSTRAINT sched_closure_pkey PRIMARY KEY (id);


--
-- Name: sched_department sched_department_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_department
    ADD CONSTRAINT sched_department_pkey PRIMARY KEY (id);


--
-- Name: sched_employee_setting sched_employee_setting_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_employee_setting
    ADD CONSTRAINT sched_employee_setting_pkey PRIMARY KEY (person_id);


--
-- Name: sched_event sched_event_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_event
    ADD CONSTRAINT sched_event_pkey PRIMARY KEY (id);


--
-- Name: sched_role_member sched_role_member_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_role_member
    ADD CONSTRAINT sched_role_member_pkey PRIMARY KEY (id);


--
-- Name: sched_role sched_role_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_role
    ADD CONSTRAINT sched_role_pkey PRIMARY KEY (id);


--
-- Name: sched_shift_template sched_shift_template_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_shift_template
    ADD CONSTRAINT sched_shift_template_pkey PRIMARY KEY (id);


--
-- Name: sched_week_line sched_week_line_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_line
    ADD CONSTRAINT sched_week_line_pkey PRIMARY KEY (id);


--
-- Name: sched_week_location sched_week_location_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_location
    ADD CONSTRAINT sched_week_location_pkey PRIMARY KEY (id);


--
-- Name: sched_week sched_week_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week
    ADD CONSTRAINT sched_week_pkey PRIMARY KEY (id);


--
-- Name: sheet_sync_issue sheet_sync_issue_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sheet_sync_issue
    ADD CONSTRAINT sheet_sync_issue_pkey PRIMARY KEY (id);


--
-- Name: sheet_sync_issue sheet_sync_issue_source_key_kind_subject_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sheet_sync_issue
    ADD CONSTRAINT sheet_sync_issue_source_key_kind_subject_key UNIQUE (source_key, kind, subject);


--
-- Name: sheet_sync_source sheet_sync_source_key_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sheet_sync_source
    ADD CONSTRAINT sheet_sync_source_key_key UNIQUE (key);


--
-- Name: sheet_sync_source sheet_sync_source_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sheet_sync_source
    ADD CONSTRAINT sheet_sync_source_pkey PRIMARY KEY (id);


--
-- Name: smart_glossary smart_glossary_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_glossary
    ADD CONSTRAINT smart_glossary_pkey PRIMARY KEY (id);


--
-- Name: smart_question_log smart_question_log_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_question_log
    ADD CONSTRAINT smart_question_log_pkey PRIMARY KEY (id);


--
-- Name: sms_consent sms_consent_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_consent
    ADD CONSTRAINT sms_consent_pkey PRIMARY KEY (person_id);


--
-- Name: sms_message sms_message_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_message
    ADD CONSTRAINT sms_message_pkey PRIMARY KEY (id);


--
-- Name: sms_message sms_message_twilio_sid_key; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_message
    ADD CONSTRAINT sms_message_twilio_sid_key UNIQUE (twilio_sid);


--
-- Name: sms_opt_out sms_opt_out_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_opt_out
    ADD CONSTRAINT sms_opt_out_pkey PRIMARY KEY (phone);


--
-- Name: user_notification user_notification_pkey; Type: CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.user_notification
    ADD CONSTRAINT user_notification_pkey PRIMARY KEY (id);


--
-- Name: agent_run_agent_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX agent_run_agent_idx ON greendogops.agent_run USING btree (agent_id, created_at DESC);


--
-- Name: agent_run_log_run_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX agent_run_log_run_idx ON greendogops.agent_run_log USING btree (run_id, ts);


--
-- Name: agent_run_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX agent_run_status_idx ON greendogops.agent_run USING btree (status);


--
-- Name: app_user_email_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX app_user_email_idx ON greendogops.app_user USING btree (lower(email));


--
-- Name: app_user_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX app_user_person_idx ON greendogops.app_user USING btree (person_id) WHERE (person_id IS NOT NULL);


--
-- Name: app_user_role_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX app_user_role_idx ON greendogops.app_user USING btree (role);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX audit_log_actor_idx ON greendogops.audit_log USING btree (actor_id);


--
-- Name: audit_log_created_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX audit_log_created_idx ON greendogops.audit_log USING btree (created_at DESC);


--
-- Name: bizdev_appt_type_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX bizdev_appt_type_location_idx ON greendogops.bizdev_appt_type USING btree (location_id);


--
-- Name: calendar_event_google_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX calendar_event_google_uq ON greendogops.calendar_event USING btree (google_event_id) WHERE (google_event_id IS NOT NULL);


--
-- Name: calendar_event_range_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX calendar_event_range_idx ON greendogops.calendar_event USING btree (starts_at, ends_at);


--
-- Name: calendar_event_source_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX calendar_event_source_idx ON greendogops.calendar_event USING btree (source);


--
-- Name: calendar_notification_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX calendar_notification_event_idx ON greendogops.calendar_notification USING btree (event_id);


--
-- Name: calendar_notification_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX calendar_notification_uq ON greendogops.calendar_notification USING btree (source_key, channel, offset_minutes, recipient);


--
-- Name: calendar_schedule_pin_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX calendar_schedule_pin_person_idx ON greendogops.calendar_schedule_pin USING btree (person_id);


--
-- Name: clinic_visits_clinic_name_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_clinic_name_idx ON greendogops.clinic_visits USING btree (clinic_name);


--
-- Name: clinic_visits_created_at_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_created_at_idx ON greendogops.clinic_visits USING btree (created_at DESC);


--
-- Name: clinic_visits_items_discussed_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_items_discussed_idx ON greendogops.clinic_visits USING gin (items_discussed);


--
-- Name: clinic_visits_partner_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_partner_id_idx ON greendogops.clinic_visits USING btree (partner_id);


--
-- Name: clinic_visits_profile_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_profile_id_idx ON greendogops.clinic_visits USING btree (profile_id);


--
-- Name: clinic_visits_user_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_user_id_idx ON greendogops.clinic_visits USING btree (user_id);


--
-- Name: clinic_visits_visit_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX clinic_visits_visit_date_idx ON greendogops.clinic_visits USING btree (visit_date DESC);


--
-- Name: credential_category_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX credential_category_idx ON greendogops.credential USING btree (category);


--
-- Name: credential_external_ref_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX credential_external_ref_idx ON greendogops.credential USING btree (external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: credential_label_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX credential_label_idx ON greendogops.credential USING btree (lower(label));


--
-- Name: credential_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX credential_org_idx ON greendogops.credential USING btree (org_id);


--
-- Name: crm_ce_attendance_contact_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_ce_attendance_contact_idx ON greendogops.crm_ce_attendance USING btree (contact_id);


--
-- Name: crm_ce_attendance_event_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_ce_attendance_event_id_idx ON greendogops.crm_ce_attendance USING btree (ce_event_id);


--
-- Name: crm_ce_attendance_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_ce_attendance_event_idx ON greendogops.crm_ce_attendance USING btree (ce_name, ce_date DESC);


--
-- Name: crm_ce_event_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_ce_event_date_idx ON greendogops.crm_ce_event USING btree (event_date DESC);


--
-- Name: crm_contact_document_contact_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_contact_document_contact_idx ON greendogops.crm_contact_document USING btree (contact_id, uploaded_at DESC);


--
-- Name: crm_contact_promoted_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_contact_promoted_person_idx ON greendogops.crm_contact USING btree (promoted_person_id) WHERE (promoted_person_id IS NOT NULL);


--
-- Name: crm_contact_source_external_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX crm_contact_source_external_idx ON greendogops.crm_contact USING btree (source, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: crm_contact_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_contact_type_idx ON greendogops.crm_contact USING btree (contact_type);


--
-- Name: crm_org_document_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_org_document_org_idx ON greendogops.crm_org_document USING btree (org_id, uploaded_at DESC);


--
-- Name: crm_org_visit_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_org_visit_date_idx ON greendogops.crm_org_visit USING btree (visit_date DESC);


--
-- Name: crm_org_visit_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_org_visit_org_idx ON greendogops.crm_org_visit USING btree (org_id, visit_date DESC);


--
-- Name: crm_organization_category_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_organization_category_idx ON greendogops.crm_organization USING btree (category);


--
-- Name: crm_organization_org_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_organization_org_type_idx ON greendogops.crm_organization USING btree (org_type);


--
-- Name: crm_organization_qr_token_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX crm_organization_qr_token_key ON greendogops.crm_organization USING btree (qr_token);


--
-- Name: crm_organization_source_external_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX crm_organization_source_external_idx ON greendogops.crm_organization USING btree (source, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: crm_organization_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_organization_status_idx ON greendogops.crm_organization USING btree (status);


--
-- Name: crm_retail_lead_confirmation_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_retail_lead_confirmation_idx ON greendogops.crm_retail_lead USING btree (confirmation_code);


--
-- Name: crm_retail_lead_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_retail_lead_org_idx ON greendogops.crm_retail_lead USING btree (org_id, scanned_at DESC);


--
-- Name: crm_retail_lead_scanned_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_retail_lead_scanned_idx ON greendogops.crm_retail_lead USING btree (scanned_at DESC);


--
-- Name: crm_retail_lead_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX crm_retail_lead_status_idx ON greendogops.crm_retail_lead USING btree (status);


--
-- Name: email_event_email_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX email_event_email_id_idx ON greendogops.email_event USING btree (email_id);


--
-- Name: email_event_occurred_at_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX email_event_occurred_at_idx ON greendogops.email_event USING btree (occurred_at DESC);


--
-- Name: email_event_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX email_event_type_idx ON greendogops.email_event USING btree (event_type);


--
-- Name: email_template_active_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX email_template_active_idx ON greendogops.email_template USING btree (is_active);


--
-- Name: email_template_category_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX email_template_category_idx ON greendogops.email_template USING btree (category);


--
-- Name: ezyvet_aged_receivable_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_aged_receivable_key_idx ON greendogops.ezyvet_aged_receivable USING btree (contact_code, snapshot_date);


--
-- Name: ezyvet_aged_receivable_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_aged_receivable_snapshot_idx ON greendogops.ezyvet_aged_receivable USING btree (snapshot_date);


--
-- Name: ezyvet_agenda_appt_snapshot_cell_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_appt_snapshot_cell_idx ON greendogops.ezyvet_agenda_appt_snapshot USING btree (location_id, appt_date, department_id);


--
-- Name: ezyvet_agenda_appt_snapshot_snapshot_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_appt_snapshot_snapshot_date_idx ON greendogops.ezyvet_agenda_appt_snapshot USING btree (snapshot_date);


--
-- Name: ezyvet_agenda_count_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_count_date_idx ON greendogops.ezyvet_agenda_count USING btree (appt_date);


--
-- Name: ezyvet_agenda_count_loc_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_count_loc_date_idx ON greendogops.ezyvet_agenda_count USING btree (location_id, appt_date);


--
-- Name: ezyvet_agenda_snapshot_appt_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_snapshot_appt_date_idx ON greendogops.ezyvet_agenda_snapshot USING btree (appt_date);


--
-- Name: ezyvet_agenda_snapshot_cell_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_snapshot_cell_idx ON greendogops.ezyvet_agenda_snapshot USING btree (location_id, appt_date, department_id);


--
-- Name: ezyvet_agenda_snapshot_snapshot_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_agenda_snapshot_snapshot_date_idx ON greendogops.ezyvet_agenda_snapshot USING btree (snapshot_date);


--
-- Name: ezyvet_appointment_record_client_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_client_idx ON greendogops.ezyvet_appointment_record USING btree (client_code);


--
-- Name: ezyvet_appointment_record_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_date_idx ON greendogops.ezyvet_appointment_record USING btree (appt_date);


--
-- Name: ezyvet_appointment_record_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_location_idx ON greendogops.ezyvet_appointment_record USING btree (location_key);


--
-- Name: ezyvet_appointment_record_pet_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_pet_idx ON greendogops.ezyvet_appointment_record USING btree (pet_code);


--
-- Name: ezyvet_appointment_record_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_snapshot_idx ON greendogops.ezyvet_appointment_record USING btree (snapshot_date);


--
-- Name: ezyvet_appointment_record_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_record_type_idx ON greendogops.ezyvet_appointment_record USING btree (appointment_type);


--
-- Name: ezyvet_appointment_status_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_status_date_idx ON greendogops.ezyvet_appointment_status USING btree (appt_date);


--
-- Name: ezyvet_appointment_status_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_status_location_idx ON greendogops.ezyvet_appointment_status USING btree (location_key);


--
-- Name: ezyvet_appointment_status_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_status_snapshot_idx ON greendogops.ezyvet_appointment_status USING btree (snapshot_date);


--
-- Name: ezyvet_appointment_type_stat_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_type_stat_location_idx ON greendogops.ezyvet_appointment_type_stat USING btree (location_key);


--
-- Name: ezyvet_appointment_type_stat_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_appointment_type_stat_snapshot_idx ON greendogops.ezyvet_appointment_type_stat USING btree (snapshot_date);


--
-- Name: ezyvet_cancelled_appointment_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_cancelled_appointment_date_idx ON greendogops.ezyvet_cancelled_appointment USING btree (appt_date);


--
-- Name: ezyvet_cancelled_appointment_loc_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_cancelled_appointment_loc_idx ON greendogops.ezyvet_cancelled_appointment USING btree (location_id);


--
-- Name: ezyvet_cancelled_appointment_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_cancelled_appointment_type_idx ON greendogops.ezyvet_cancelled_appointment USING btree (appt_type);


--
-- Name: ezyvet_clinical_note_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_clinical_note_date_idx ON greendogops.ezyvet_clinical_note USING btree (note_created_date);


--
-- Name: ezyvet_clinical_note_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_clinical_note_location_idx ON greendogops.ezyvet_clinical_note USING btree (location_key);


--
-- Name: ezyvet_clinical_note_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_clinical_note_snapshot_idx ON greendogops.ezyvet_clinical_note USING btree (snapshot_date);


--
-- Name: ezyvet_consult_metric_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_consult_metric_date_idx ON greendogops.ezyvet_consult_metric USING btree (created_date);


--
-- Name: ezyvet_consult_metric_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_consult_metric_key_idx ON greendogops.ezyvet_consult_metric USING btree (consult_number);


--
-- Name: ezyvet_consult_metric_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_consult_metric_snapshot_idx ON greendogops.ezyvet_consult_metric USING btree (snapshot_date);


--
-- Name: ezyvet_controlled_drug_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_controlled_drug_date_idx ON greendogops.ezyvet_controlled_drug USING btree (dispensed_date);


--
-- Name: ezyvet_controlled_drug_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_controlled_drug_location_idx ON greendogops.ezyvet_controlled_drug USING btree (location_key);


--
-- Name: ezyvet_controlled_drug_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_controlled_drug_snapshot_idx ON greendogops.ezyvet_controlled_drug USING btree (snapshot_date);


--
-- Name: ezyvet_customer_invoice_stat_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_customer_invoice_stat_snapshot_idx ON greendogops.ezyvet_customer_invoice_stat USING btree (snapshot_date);


--
-- Name: ezyvet_disabled_record_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_disabled_record_date_idx ON greendogops.ezyvet_disabled_record USING btree (disabled_date);


--
-- Name: ezyvet_disabled_record_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_disabled_record_snapshot_idx ON greendogops.ezyvet_disabled_record USING btree (snapshot_date);


--
-- Name: ezyvet_end_of_day_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_end_of_day_key_idx ON greendogops.ezyvet_end_of_day USING btree (metric, snapshot_date);


--
-- Name: ezyvet_end_of_day_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_end_of_day_snapshot_idx ON greendogops.ezyvet_end_of_day USING btree (snapshot_date);


--
-- Name: ezyvet_estimate_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_estimate_date_idx ON greendogops.ezyvet_estimate USING btree (date_sent);


--
-- Name: ezyvet_estimate_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_estimate_key_idx ON greendogops.ezyvet_estimate USING btree (estimate_number);


--
-- Name: ezyvet_estimate_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_estimate_snapshot_idx ON greendogops.ezyvet_estimate USING btree (snapshot_date);


--
-- Name: ezyvet_expired_inventory_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_expired_inventory_snapshot_idx ON greendogops.ezyvet_expired_inventory USING btree (snapshot_date);


--
-- Name: ezyvet_expiring_inventory_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_expiring_inventory_snapshot_idx ON greendogops.ezyvet_expiring_inventory USING btree (snapshot_date);


--
-- Name: ezyvet_inventory_ordering_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_inventory_ordering_key_idx ON greendogops.ezyvet_inventory_ordering USING btree (product_code, snapshot_date);


--
-- Name: ezyvet_inventory_ordering_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_inventory_ordering_snapshot_idx ON greendogops.ezyvet_inventory_ordering USING btree (snapshot_date);


--
-- Name: ezyvet_inventory_transfer_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_inventory_transfer_date_idx ON greendogops.ezyvet_inventory_transfer USING btree (transfer_date);


--
-- Name: ezyvet_inventory_transfer_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_inventory_transfer_location_idx ON greendogops.ezyvet_inventory_transfer USING btree (location_key);


--
-- Name: ezyvet_inventory_transfer_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_inventory_transfer_snapshot_idx ON greendogops.ezyvet_inventory_transfer USING btree (snapshot_date);


--
-- Name: ezyvet_inventory_value_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_inventory_value_key_idx ON greendogops.ezyvet_inventory_value USING btree (product_code, snapshot_date);


--
-- Name: ezyvet_inventory_value_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_inventory_value_snapshot_idx ON greendogops.ezyvet_inventory_value USING btree (snapshot_date);


--
-- Name: ezyvet_invoice_summary_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_invoice_summary_date_idx ON greendogops.ezyvet_invoice_summary USING btree (invoice_date);


--
-- Name: ezyvet_invoice_summary_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_invoice_summary_key_idx ON greendogops.ezyvet_invoice_summary USING btree (invoice_number);


--
-- Name: ezyvet_invoice_summary_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_invoice_summary_location_idx ON greendogops.ezyvet_invoice_summary USING btree (location_key);


--
-- Name: ezyvet_invoice_summary_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_invoice_summary_snapshot_idx ON greendogops.ezyvet_invoice_summary USING btree (snapshot_date);


--
-- Name: ezyvet_payment_allocation_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_allocation_date_idx ON greendogops.ezyvet_payment_allocation USING btree (allocation_date);


--
-- Name: ezyvet_payment_allocation_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_allocation_location_idx ON greendogops.ezyvet_payment_allocation USING btree (location_key);


--
-- Name: ezyvet_payment_allocation_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_allocation_snapshot_idx ON greendogops.ezyvet_payment_allocation USING btree (snapshot_date);


--
-- Name: ezyvet_payment_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_date_idx ON greendogops.ezyvet_payment USING btree (payment_date);


--
-- Name: ezyvet_payment_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_location_idx ON greendogops.ezyvet_payment USING btree (location_key);


--
-- Name: ezyvet_payment_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_payment_snapshot_idx ON greendogops.ezyvet_payment USING btree (snapshot_date);


--
-- Name: ezyvet_purchase_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_purchase_date_idx ON greendogops.ezyvet_purchase USING btree (purchase_date);


--
-- Name: ezyvet_purchase_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_purchase_location_idx ON greendogops.ezyvet_purchase USING btree (location_key);


--
-- Name: ezyvet_purchase_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_purchase_snapshot_idx ON greendogops.ezyvet_purchase USING btree (snapshot_date);


--
-- Name: ezyvet_record_tag_contact_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_record_tag_contact_idx ON greendogops.ezyvet_record_tag USING btree (contact_code) WHERE (removed_on IS NULL);


--
-- Name: ezyvet_record_tag_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_record_tag_key ON greendogops.ezyvet_record_tag USING btree (tag_key, record_type, record_code);


--
-- Name: ezyvet_record_tag_live_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_record_tag_live_idx ON greendogops.ezyvet_record_tag USING btree (tag_key) WHERE (removed_on IS NULL);


--
-- Name: ezyvet_record_tag_run_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_record_tag_run_idx ON greendogops.ezyvet_record_tag_run USING btree (tag_key, ran_at DESC);


--
-- Name: ezyvet_soc_overdue_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_soc_overdue_location_idx ON greendogops.ezyvet_soc_overdue USING btree (location_key);


--
-- Name: ezyvet_soc_overdue_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_soc_overdue_snapshot_idx ON greendogops.ezyvet_soc_overdue USING btree (snapshot_date);


--
-- Name: ezyvet_staff_sale_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_staff_sale_date_idx ON greendogops.ezyvet_staff_sale USING btree (invoice_date);


--
-- Name: ezyvet_staff_sale_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_staff_sale_snapshot_idx ON greendogops.ezyvet_staff_sale USING btree (snapshot_date);


--
-- Name: ezyvet_tag_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_tag_type_idx ON greendogops.ezyvet_tag USING btree (tag_type, is_active);


--
-- Name: ezyvet_taxable_sales_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_taxable_sales_location_idx ON greendogops.ezyvet_taxable_sales USING btree (location_key);


--
-- Name: ezyvet_taxable_sales_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_taxable_sales_snapshot_idx ON greendogops.ezyvet_taxable_sales USING btree (snapshot_date);


--
-- Name: ezyvet_unapplied_payment_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_unapplied_payment_date_idx ON greendogops.ezyvet_unapplied_payment USING btree (payment_date);


--
-- Name: ezyvet_unapplied_payment_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_unapplied_payment_snapshot_idx ON greendogops.ezyvet_unapplied_payment USING btree (snapshot_date);


--
-- Name: ezyvet_unbilled_consult_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_unbilled_consult_date_idx ON greendogops.ezyvet_unbilled_consult USING btree (appt_date);


--
-- Name: ezyvet_unbilled_consult_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_unbilled_consult_location_idx ON greendogops.ezyvet_unbilled_consult USING btree (location_key);


--
-- Name: ezyvet_unbilled_consult_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_unbilled_consult_snapshot_idx ON greendogops.ezyvet_unbilled_consult USING btree (snapshot_date);


--
-- Name: ezyvet_vaccination_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_vaccination_date_idx ON greendogops.ezyvet_vaccination USING btree (vaccination_date);


--
-- Name: ezyvet_vaccination_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_vaccination_key_idx ON greendogops.ezyvet_vaccination USING btree (vaccination_id);


--
-- Name: ezyvet_vaccination_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_vaccination_snapshot_idx ON greendogops.ezyvet_vaccination USING btree (snapshot_date);


--
-- Name: ezyvet_wellness_plan_use_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ezyvet_wellness_plan_use_key_idx ON greendogops.ezyvet_wellness_plan_use USING btree (unique_id, snapshot_date);


--
-- Name: ezyvet_wellness_plan_use_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_wellness_plan_use_location_idx ON greendogops.ezyvet_wellness_plan_use USING btree (location_key);


--
-- Name: ezyvet_wellness_plan_use_snapshot_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ezyvet_wellness_plan_use_snapshot_idx ON greendogops.ezyvet_wellness_plan_use USING btree (snapshot_date);


--
-- Name: idx_crm_org_ezyvet_contact; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_crm_org_ezyvet_contact ON greendogops.crm_organization USING btree (ezyvet_contact_id) WHERE (ezyvet_contact_id IS NOT NULL);


--
-- Name: idx_ezv_animal_active; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_active ON greendogops.ezyvet_animal USING btree (is_active);


--
-- Name: idx_ezv_animal_division; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_division ON greendogops.ezyvet_animal USING btree (division);


--
-- Name: idx_ezv_animal_import_created; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_import_created ON greendogops.ezyvet_animal_import USING btree (created_at DESC);


--
-- Name: idx_ezv_animal_name; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_name ON greendogops.ezyvet_animal USING btree (animal_name);


--
-- Name: idx_ezv_animal_owner; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_owner ON greendogops.ezyvet_animal USING btree (owner_contact_code);


--
-- Name: idx_ezv_animal_species; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_species ON greendogops.ezyvet_animal USING btree (species);


--
-- Name: idx_ezv_animal_visit; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_animal_visit ON greendogops.ezyvet_animal USING btree (last_visit);


--
-- Name: idx_ezv_appointment_service_date; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_appointment_service_date ON greendogops.ezyvet_appointment USING btree (service_date);


--
-- Name: idx_ezv_change_contact; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_change_contact ON greendogops.ezyvet_contact_change USING btree (ezyvet_contact_id);


--
-- Name: idx_ezv_change_created; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_change_created ON greendogops.ezyvet_contact_change USING btree (created_at);


--
-- Name: idx_ezv_contact_created; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_contact_created ON greendogops.ezyvet_contact USING btree (ezyvet_created_at);


--
-- Name: idx_ezv_contact_customer; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_contact_customer ON greendogops.ezyvet_contact USING btree (is_customer);


--
-- Name: idx_ezv_contact_division; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_contact_division ON greendogops.ezyvet_contact USING btree (division);


--
-- Name: idx_ezv_contact_group; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_contact_group ON greendogops.ezyvet_contact USING btree (customer_group);


--
-- Name: idx_ezv_line_contact; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_line_contact ON greendogops.ezyvet_invoice_line USING btree (client_contact_code);


--
-- Name: idx_ezv_line_date; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_line_date ON greendogops.ezyvet_invoice_line USING btree (line_date);


--
-- Name: idx_ezv_line_import; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_line_import ON greendogops.ezyvet_invoice_line USING btree (import_id);


--
-- Name: idx_ezv_line_location; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_line_location ON greendogops.ezyvet_invoice_line USING btree (location_key);


--
-- Name: idx_ezv_line_species; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_line_species ON greendogops.ezyvet_invoice_line USING btree (species_group);


--
-- Name: idx_ezv_product_active; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_active ON greendogops.ezyvet_product USING btree (is_active);


--
-- Name: idx_ezv_product_code; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_code ON greendogops.ezyvet_product USING btree (product_code);


--
-- Name: idx_ezv_product_group; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_group ON greendogops.ezyvet_product USING btree (product_group);


--
-- Name: idx_ezv_product_import_created; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_import_created ON greendogops.ezyvet_product_import USING btree (created_at DESC);


--
-- Name: idx_ezv_product_name; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_name ON greendogops.ezyvet_product USING btree (product_name);


--
-- Name: idx_ezv_product_price_code; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_price_code ON greendogops.ezyvet_product_price USING btree (product_code);


--
-- Name: idx_ezv_product_price_div; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_price_div ON greendogops.ezyvet_product_price USING btree (division);


--
-- Name: idx_ezv_product_type; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_ezv_product_type ON greendogops.ezyvet_product USING btree (product_type);


--
-- Name: idx_marketing_resource_crm_org; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_marketing_resource_crm_org ON greendogops.marketing_resource USING btree (crm_organization_id);


--
-- Name: idx_rbco_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rbco_year ON greendogops.report_by_case_owner USING btree (year);


--
-- Name: idx_rbs_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rbs_year ON greendogops.report_by_staff USING btree (year);


--
-- Name: idx_rcobm_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rcobm_year ON greendogops.report_case_owner_by_month USING btree (year, case_owner);


--
-- Name: idx_rcop_year_owner; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rcop_year_owner ON greendogops.report_case_owner_product USING btree (year, staff_member);


--
-- Name: idx_rcopg_year_owner; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rcopg_year_owner ON greendogops.report_case_owner_product_group USING btree (year, staff_member);


--
-- Name: idx_rdbd_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rdbd_year ON greendogops.report_dvm_by_dept USING btree (year, doctor);


--
-- Name: idx_rpbl_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rpbl_year ON greendogops.report_product_by_location USING btree (year);


--
-- Name: idx_rsbl_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rsbl_year ON greendogops.report_staff_by_location USING btree (year, staff_member);


--
-- Name: idx_rsp_year_staff; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rsp_year_staff ON greendogops.report_staff_product USING btree (year, staff_member);


--
-- Name: idx_rspg_year_staff; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rspg_year_staff ON greendogops.report_staff_product_group USING btree (year, staff_member);


--
-- Name: idx_rtp_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rtp_year ON greendogops.report_top_product USING btree (year);


--
-- Name: idx_rtpg_year; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX idx_rtpg_year ON greendogops.report_top_product_group USING btree (year);


--
-- Name: interview_invite_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX interview_invite_person_idx ON greendogops.interview_invite USING btree (person_id, created_at DESC);


--
-- Name: marketing_activity_created_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_activity_created_idx ON greendogops.marketing_activity USING btree (created_at DESC);


--
-- Name: marketing_budget_entry_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_budget_entry_date_idx ON greendogops.marketing_budget_entry USING btree (entry_date DESC);


--
-- Name: marketing_event_attendee_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_event_attendee_event_idx ON greendogops.marketing_event_attendee USING btree (event_id);


--
-- Name: marketing_event_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_event_date_idx ON greendogops.marketing_event USING btree (starts_on);


--
-- Name: marketing_event_source_crm_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_event_source_crm_org_idx ON greendogops.marketing_event_source USING btree (crm_organization_id);


--
-- Name: marketing_event_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_event_status_idx ON greendogops.marketing_event USING btree (status);


--
-- Name: marketing_goal_node_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_goal_node_idx ON greendogops.marketing_goal USING btree (node_id);


--
-- Name: marketing_influencers_content_niche_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_content_niche_idx ON greendogops.marketing_influencers USING btree (content_niche) WHERE (content_niche IS NOT NULL);


--
-- Name: marketing_influencers_needs_followup_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_needs_followup_idx ON greendogops.marketing_influencers USING btree (needs_followup) WHERE (needs_followup = true);


--
-- Name: marketing_influencers_next_followup_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_next_followup_date_idx ON greendogops.marketing_influencers USING btree (next_followup_date) WHERE (next_followup_date IS NOT NULL);


--
-- Name: marketing_influencers_priority_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_priority_idx ON greendogops.marketing_influencers USING btree (priority);


--
-- Name: marketing_influencers_relationship_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_relationship_status_idx ON greendogops.marketing_influencers USING btree (relationship_status);


--
-- Name: marketing_influencers_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_status_idx ON greendogops.marketing_influencers USING btree (status);


--
-- Name: marketing_influencers_status_idx1; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_status_idx1 ON greendogops.marketing_influencers USING btree (status);


--
-- Name: marketing_influencers_tier_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_influencers_tier_idx ON greendogops.marketing_influencers USING btree (tier);


--
-- Name: marketing_initiative_due_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_initiative_due_idx ON greendogops.marketing_initiative USING btree (due_date);


--
-- Name: marketing_initiative_node_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_initiative_node_idx ON greendogops.marketing_initiative USING btree (node_id);


--
-- Name: marketing_initiative_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_initiative_status_idx ON greendogops.marketing_initiative USING btree (status);


--
-- Name: marketing_promotion_source_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_promotion_source_event_idx ON greendogops.marketing_promotion USING btree (source_event_id);


--
-- Name: marketing_promotion_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_promotion_status_idx ON greendogops.marketing_promotion USING btree (status);


--
-- Name: marketing_tree_node_parent_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_tree_node_parent_idx ON greendogops.marketing_tree_node USING btree (parent_id);


--
-- Name: marketing_tree_node_zone_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX marketing_tree_node_zone_idx ON greendogops.marketing_tree_node USING btree (zone);


--
-- Name: medical_board_day_lookup_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX medical_board_day_lookup_idx ON greendogops.medical_board_day USING btree (board_date, location_id, board_type);


--
-- Name: medical_board_day_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX medical_board_day_status_idx ON greendogops.medical_board_day USING btree (status, board_date);


--
-- Name: medical_board_row_board_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX medical_board_row_board_idx ON greendogops.medical_board_row USING btree (location_id, board_date, board_type);


--
-- Name: medical_board_row_board_key_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX medical_board_row_board_key_idx ON greendogops.medical_board_row USING btree (board_key);


--
-- Name: notification_delivery_queue_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX notification_delivery_queue_idx ON greendogops.notification_delivery USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'sending'::text]));


--
-- Name: ops_task_assignee_open_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ops_task_assignee_open_idx ON greendogops.ops_task USING btree (assignee_user_id, due_date) WHERE (status = 'open'::text);


--
-- Name: ops_task_creator_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX ops_task_creator_idx ON greendogops.ops_task USING btree (created_by_user_id, status);


--
-- Name: ops_task_source_ref_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ops_task_source_ref_uq ON greendogops.ops_task USING btree (source, external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: partner_contacts_partner_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX partner_contacts_partner_id_idx ON greendogops.partner_contacts USING btree (partner_id);


--
-- Name: partner_notes_created_at_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX partner_notes_created_at_idx ON greendogops.partner_notes USING btree (created_at DESC);


--
-- Name: partner_notes_is_pinned_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX partner_notes_is_pinned_idx ON greendogops.partner_notes USING btree (is_pinned);


--
-- Name: partner_notes_partner_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX partner_notes_partner_id_idx ON greendogops.partner_notes USING btree (partner_id);


--
-- Name: person_asset_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_asset_person_idx ON greendogops.person_asset USING btree (person_id, status);


--
-- Name: person_compliance_entry_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_compliance_entry_person_idx ON greendogops.person_compliance_entry USING btree (person_id);


--
-- Name: person_disciplinary_action_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_disciplinary_action_person_idx ON greendogops.person_disciplinary_action USING btree (person_id, incident_date DESC);


--
-- Name: person_document_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_document_person_idx ON greendogops.person_document USING btree (person_id, uploaded_at DESC);


--
-- Name: person_interview_guide_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_interview_guide_idx ON greendogops.person_interview USING btree (guide_id) WHERE (guide_id IS NOT NULL);


--
-- Name: person_interview_host_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_interview_host_idx ON greendogops.person_interview USING btree (host_user_id, interview_date) WHERE (host_user_id IS NOT NULL);


--
-- Name: person_interview_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_interview_person_idx ON greendogops.person_interview USING btree (person_id, interview_date DESC);


--
-- Name: person_license_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_license_person_idx ON greendogops.person_license USING btree (person_id);


--
-- Name: person_name_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_name_idx ON greendogops.person USING btree (last_name, first_name);


--
-- Name: person_onboarding_item_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_onboarding_item_person_idx ON greendogops.person_onboarding_item USING btree (person_id);


--
-- Name: person_pto_day_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_pto_day_person_idx ON greendogops.person_pto_day USING btree (person_id, pto_date DESC);


--
-- Name: person_recruiting_interest_level_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_recruiting_interest_level_idx ON greendogops.person_recruiting USING btree (interest_level);


--
-- Name: person_recruiting_job_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_recruiting_job_location_idx ON greendogops.person_recruiting USING btree (job_location);


--
-- Name: person_recruiting_review_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_recruiting_review_status_idx ON greendogops.person_recruiting USING btree (review_status);


--
-- Name: person_recruiting_target_position_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_recruiting_target_position_idx ON greendogops.person_recruiting USING btree (target_position_id);


--
-- Name: person_review_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_review_person_idx ON greendogops.person_review USING btree (person_id, review_date DESC);


--
-- Name: person_slack_link_connected_user_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX person_slack_link_connected_user_uq ON greendogops.person_slack_link USING btree (slack_team_id, slack_user_id) WHERE (status = 'connected'::text);


--
-- Name: person_slack_link_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_slack_link_status_idx ON greendogops.person_slack_link USING btree (status);


--
-- Name: person_source_contact_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_source_contact_idx ON greendogops.person USING btree (source_contact_id) WHERE (source_contact_id IS NOT NULL);


--
-- Name: person_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_status_idx ON greendogops.person USING btree (status);


--
-- Name: person_time_off_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_time_off_person_idx ON greendogops.person_time_off USING btree (person_id, start_date DESC);


--
-- Name: person_time_off_range_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX person_time_off_range_idx ON greendogops.person_time_off USING btree (start_date, end_date);


--
-- Name: person_time_off_source_external_uk; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX person_time_off_source_external_uk ON greendogops.person_time_off USING btree (source, external_id);


--
-- Name: planning_capacity_rule_department_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_capacity_rule_department_idx ON greendogops.planning_capacity_rule USING btree (department_id);


--
-- Name: planning_capacity_rule_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_capacity_rule_location_idx ON greendogops.planning_capacity_rule USING btree (location_id);


--
-- Name: planning_guide_column_guide_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_column_guide_idx ON greendogops.planning_guide_column USING btree (guide_id);


--
-- Name: planning_guide_department_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_department_idx ON greendogops.planning_guide USING btree (department_id);


--
-- Name: planning_guide_location_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_location_idx ON greendogops.planning_guide USING btree (location_id);


--
-- Name: planning_guide_slot_cell_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_slot_cell_idx ON greendogops.planning_guide_slot USING btree (column_id, start_minute);


--
-- Name: planning_guide_slot_guide_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_slot_guide_idx ON greendogops.planning_guide_slot USING btree (guide_id);


--
-- Name: planning_guide_source_week_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX planning_guide_source_week_idx ON greendogops.planning_guide USING btree (source_week_id);


--
-- Name: position_title_location_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX position_title_location_key ON greendogops."position" USING btree (title, COALESCE(location, ''::text));


--
-- Name: profile_transition_log_contact_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX profile_transition_log_contact_idx ON greendogops.profile_transition_log USING btree (contact_id, created_at DESC);


--
-- Name: profile_transition_log_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX profile_transition_log_person_idx ON greendogops.profile_transition_log USING btree (person_id, created_at DESC);


--
-- Name: qr_code_active_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_active_idx ON greendogops.qr_code USING btree (active);


--
-- Name: qr_code_ce_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_ce_event_idx ON greendogops.qr_code USING btree (ce_event_id);


--
-- Name: qr_code_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_event_idx ON greendogops.qr_code USING btree (event_id);


--
-- Name: qr_code_influencer_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_influencer_idx ON greendogops.qr_code USING btree (influencer_id);


--
-- Name: qr_code_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_org_idx ON greendogops.qr_code USING btree (org_id);


--
-- Name: qr_code_promotion_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_promotion_idx ON greendogops.qr_code USING btree (promotion_id);


--
-- Name: qr_code_referral_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_code_referral_idx ON greendogops.qr_code USING btree (referral_partner_id);


--
-- Name: qr_code_token_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX qr_code_token_key ON greendogops.qr_code USING btree (token);


--
-- Name: qr_lead_ce_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_ce_event_idx ON greendogops.qr_lead USING btree (ce_event_id, scanned_at DESC);


--
-- Name: qr_lead_code_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_code_idx ON greendogops.qr_lead USING btree (qr_code_id, scanned_at DESC);


--
-- Name: qr_lead_confirmation_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_confirmation_idx ON greendogops.qr_lead USING btree (confirmation_code);


--
-- Name: qr_lead_event_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_event_idx ON greendogops.qr_lead USING btree (event_id, scanned_at DESC);


--
-- Name: qr_lead_influencer_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_influencer_idx ON greendogops.qr_lead USING btree (influencer_id, scanned_at DESC);


--
-- Name: qr_lead_org_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_org_idx ON greendogops.qr_lead USING btree (org_id, scanned_at DESC);


--
-- Name: qr_lead_referral_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_referral_idx ON greendogops.qr_lead USING btree (referral_partner_id, scanned_at DESC);


--
-- Name: qr_lead_scanned_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_scanned_idx ON greendogops.qr_lead USING btree (scanned_at DESC);


--
-- Name: qr_lead_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX qr_lead_status_idx ON greendogops.qr_lead USING btree (status);


--
-- Name: recruiting_activity_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_activity_person_idx ON greendogops.recruiting_activity USING btree (person_id, occurred_at DESC);


--
-- Name: recruiting_form_one_default; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX recruiting_form_one_default ON greendogops.recruiting_form USING btree ((true)) WHERE is_default;


--
-- Name: recruiting_form_request_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_form_request_person_idx ON greendogops.recruiting_form_request USING btree (person_id, sent_at DESC);


--
-- Name: recruiting_form_response_form_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_form_response_form_idx ON greendogops.recruiting_form_response USING btree (form_id);


--
-- Name: recruiting_form_response_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_form_response_person_idx ON greendogops.recruiting_form_response USING btree (person_id, submitted_at DESC);


--
-- Name: recruiting_form_slug_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX recruiting_form_slug_key ON greendogops.recruiting_form USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: recruiting_rejection_due_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_rejection_due_idx ON greendogops.recruiting_rejection USING btree (email_scheduled_for) WHERE ((email_status = 'scheduled'::text) AND (undone_at IS NULL));


--
-- Name: recruiting_rejection_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_rejection_person_idx ON greendogops.recruiting_rejection USING btree (person_id, rejected_at DESC);


--
-- Name: recruiting_score_change_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_score_change_person_idx ON greendogops.recruiting_score_change USING btree (person_id, created_at DESC);


--
-- Name: recruiting_task_open_due_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_task_open_due_idx ON greendogops.recruiting_task USING btree (due_date) WHERE (NOT is_done);


--
-- Name: recruiting_task_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX recruiting_task_person_idx ON greendogops.recruiting_task USING btree (person_id);


--
-- Name: referral_partners_category_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_category_idx ON greendogops.referral_partners USING btree (category);


--
-- Name: referral_partners_is_active_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_is_active_idx ON greendogops.referral_partners USING btree (is_active);


--
-- Name: referral_partners_last_referral_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_last_referral_date_idx ON greendogops.referral_partners USING btree (last_referral_date);


--
-- Name: referral_partners_last_visit_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_last_visit_date_idx ON greendogops.referral_partners USING btree (last_visit_date);


--
-- Name: referral_partners_latitude_longitude_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_latitude_longitude_idx ON greendogops.referral_partners USING btree (latitude, longitude) WHERE (latitude IS NOT NULL);


--
-- Name: referral_partners_name_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_name_idx ON greendogops.referral_partners USING btree (name);


--
-- Name: referral_partners_needs_followup_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_needs_followup_idx ON greendogops.referral_partners USING btree (needs_followup);


--
-- Name: referral_partners_next_followup_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_next_followup_date_idx ON greendogops.referral_partners USING btree (next_followup_date);


--
-- Name: referral_partners_partner_type_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_partner_type_idx ON greendogops.referral_partners USING btree (partner_type);


--
-- Name: referral_partners_partner_type_idx1; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_partner_type_idx1 ON greendogops.referral_partners USING btree (partner_type);


--
-- Name: referral_partners_priority_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_priority_idx ON greendogops.referral_partners USING btree (priority);


--
-- Name: referral_partners_relationship_score_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_relationship_score_idx ON greendogops.referral_partners USING btree (relationship_score);


--
-- Name: referral_partners_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_status_idx ON greendogops.referral_partners USING btree (status);


--
-- Name: referral_partners_tier_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_tier_idx ON greendogops.referral_partners USING btree (tier);


--
-- Name: referral_partners_total_referrals_all_time_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_total_referrals_all_time_idx ON greendogops.referral_partners USING btree (total_referrals_all_time DESC);


--
-- Name: referral_partners_total_revenue_all_time_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_total_revenue_all_time_idx ON greendogops.referral_partners USING btree (total_revenue_all_time DESC);


--
-- Name: referral_partners_zone_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_partners_zone_idx ON greendogops.referral_partners USING btree (zone);


--
-- Name: referral_revenue_line_items_dedup_hash_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX referral_revenue_line_items_dedup_hash_idx ON greendogops.referral_revenue_line_items USING btree (dedup_hash);


--
-- Name: referral_revenue_line_items_partner_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_revenue_line_items_partner_id_idx ON greendogops.referral_revenue_line_items USING btree (partner_id);


--
-- Name: referral_revenue_line_items_partner_id_transaction_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_revenue_line_items_partner_id_transaction_date_idx ON greendogops.referral_revenue_line_items USING btree (partner_id, transaction_date);


--
-- Name: referral_revenue_line_items_transaction_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_revenue_line_items_transaction_date_idx ON greendogops.referral_revenue_line_items USING btree (transaction_date);


--
-- Name: referral_revenue_line_items_upload_id_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX referral_revenue_line_items_upload_id_idx ON greendogops.referral_revenue_line_items USING btree (upload_id);


--
-- Name: reminder_ack_user_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX reminder_ack_user_idx ON greendogops.reminder_ack USING btree (user_id, occurrence_date);


--
-- Name: reminder_rule_owner_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX reminder_rule_owner_idx ON greendogops.reminder_rule USING btree (owner_user_id) WHERE is_active;


--
-- Name: report_by_case_owner_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_by_case_owner_grain_idx ON greendogops.report_by_case_owner USING btree (year, staff_member);


--
-- Name: report_by_staff_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_by_staff_grain_idx ON greendogops.report_by_staff USING btree (year, staff_member);


--
-- Name: report_capacity_override_date_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX report_capacity_override_date_idx ON greendogops.report_capacity_override USING btree (appt_date);


--
-- Name: report_case_owner_by_month_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_case_owner_by_month_grain_idx ON greendogops.report_case_owner_by_month USING btree (year, case_owner, month);


--
-- Name: report_case_owner_product_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_case_owner_product_grain_idx ON greendogops.report_case_owner_product USING btree (year, staff_member, product_name, product_group);


--
-- Name: report_case_owner_product_group_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_case_owner_product_group_grain_idx ON greendogops.report_case_owner_product_group USING btree (year, staff_member, product_group);


--
-- Name: report_dvm_by_dept_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_dvm_by_dept_grain_idx ON greendogops.report_dvm_by_dept USING btree (year, doctor, department_name);


--
-- Name: report_product_by_location_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_product_by_location_grain_idx ON greendogops.report_product_by_location USING btree (year, product_group, location_key);


--
-- Name: report_staff_by_location_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_staff_by_location_grain_idx ON greendogops.report_staff_by_location USING btree (year, staff_member, location_key);


--
-- Name: report_staff_product_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_staff_product_grain_idx ON greendogops.report_staff_product USING btree (year, staff_member, product_name, product_group);


--
-- Name: report_staff_product_group_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_staff_product_group_grain_idx ON greendogops.report_staff_product_group USING btree (year, staff_member, product_group);


--
-- Name: report_top_product_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_top_product_grain_idx ON greendogops.report_top_product USING btree (year, product_name, product_group);


--
-- Name: report_top_product_group_grain_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX report_top_product_group_grain_idx ON greendogops.report_top_product_group USING btree (year, product_group);


--
-- Name: resource_document_category_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX resource_document_category_idx ON greendogops.resource_document USING btree (category, sort_order, title);


--
-- Name: resource_document_chunk_document_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX resource_document_chunk_document_idx ON greendogops.resource_document_chunk USING btree (document_id);


--
-- Name: resource_document_chunk_tsv_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX resource_document_chunk_tsv_idx ON greendogops.resource_document_chunk USING gin (tsv);


--
-- Name: resource_document_google_file_id_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX resource_document_google_file_id_key ON greendogops.resource_document USING btree (google_file_id) WHERE (google_file_id IS NOT NULL);


--
-- Name: sched_assignment_cell_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_assignment_cell_idx ON greendogops.sched_assignment USING btree (line_id, location_id, day_of_week);


--
-- Name: sched_assignment_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_assignment_person_idx ON greendogops.sched_assignment USING btree (person_id, work_date);


--
-- Name: sched_assignment_source_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_assignment_source_idx ON greendogops.sched_assignment USING btree (week_id, source);


--
-- Name: sched_assignment_week_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_assignment_week_idx ON greendogops.sched_assignment USING btree (week_id);


--
-- Name: sched_change_log_week_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_change_log_week_idx ON greendogops.sched_change_log USING btree (week_id, created_at DESC);


--
-- Name: sched_closure_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_closure_uq ON greendogops.sched_closure USING btree (week_id, location_id, day_of_week);


--
-- Name: sched_department_code_uniq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_department_code_uniq ON greendogops.sched_department USING btree (upper(code)) WHERE (code IS NOT NULL);


--
-- Name: sched_department_name_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_department_name_idx ON greendogops.sched_department USING btree (lower(name));


--
-- Name: sched_event_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_event_uq ON greendogops.sched_event USING btree (week_id, location_id, day_of_week);


--
-- Name: sched_event_week_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_event_week_idx ON greendogops.sched_event USING btree (week_id);


--
-- Name: sched_role_dept_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_role_dept_idx ON greendogops.sched_role USING btree (department_id);


--
-- Name: sched_role_member_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_role_member_person_idx ON greendogops.sched_role_member USING btree (person_id);


--
-- Name: sched_role_member_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_role_member_uq ON greendogops.sched_role_member USING btree (role_id, person_id);


--
-- Name: sched_shift_template_dept_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_shift_template_dept_idx ON greendogops.sched_shift_template USING btree (department_id);


--
-- Name: sched_week_line_week_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sched_week_line_week_idx ON greendogops.sched_week_line USING btree (week_id);


--
-- Name: sched_week_location_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_week_location_uq ON greendogops.sched_week_location USING btree (week_id, location_id);


--
-- Name: sched_week_start_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_week_start_idx ON greendogops.sched_week USING btree (week_start) WHERE (NOT is_template);


--
-- Name: sched_week_template_title_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX sched_week_template_title_idx ON greendogops.sched_week USING btree (lower(btrim(title))) WHERE is_template;


--
-- Name: sheet_sync_issue_open_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sheet_sync_issue_open_idx ON greendogops.sheet_sync_issue USING btree (source_key, status, last_seen_at DESC);


--
-- Name: smart_glossary_status_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX smart_glossary_status_idx ON greendogops.smart_glossary USING btree (status, term);


--
-- Name: smart_glossary_term_key; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX smart_glossary_term_key ON greendogops.smart_glossary USING btree (lower(term));


--
-- Name: smart_question_log_created_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX smart_question_log_created_idx ON greendogops.smart_question_log USING btree (created_at DESC);


--
-- Name: smart_question_log_user_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX smart_question_log_user_idx ON greendogops.smart_question_log USING btree (app_user_id, created_at DESC);


--
-- Name: smart_question_log_verified_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX smart_question_log_verified_idx ON greendogops.smart_question_log USING gin (to_tsvector('english'::regconfig, question)) WHERE verified;


--
-- Name: sms_message_person_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sms_message_person_idx ON greendogops.sms_message USING btree (person_id, created_at DESC);


--
-- Name: sms_message_phone_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX sms_message_phone_idx ON greendogops.sms_message USING btree (phone, created_at DESC);


--
-- Name: user_notification_dedupe_uq; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX user_notification_dedupe_uq ON greendogops.user_notification USING btree (recipient_user_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: user_notification_feed_idx; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE INDEX user_notification_feed_idx ON greendogops.user_notification USING btree (recipient_user_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: ux_ezv_appointment; Type: INDEX; Schema: greendogops; Owner: -
--

CREATE UNIQUE INDEX ux_ezv_appointment ON greendogops.ezyvet_appointment USING btree (client_contact_code, service_date, location_key);


--
-- Name: audit_log audit_log_append_only_row; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER audit_log_append_only_row BEFORE DELETE OR UPDATE ON greendogops.audit_log FOR EACH ROW EXECUTE FUNCTION greendogops.audit_log_append_only();


--
-- Name: audit_log audit_log_append_only_truncate; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER audit_log_append_only_truncate BEFORE TRUNCATE ON greendogops.audit_log FOR EACH STATEMENT EXECUTE FUNCTION greendogops.audit_log_append_only();


--
-- Name: crm_organization crm_organization_register_qr_code; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER crm_organization_register_qr_code AFTER INSERT OR UPDATE OF category, subtype ON greendogops.crm_organization FOR EACH ROW EXECUTE FUNCTION greendogops.register_partner_qr_code();


--
-- Name: medical_board_row guard_archived; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON greendogops.medical_board_row FOR EACH ROW EXECUTE FUNCTION greendogops.medical_board_row_guard();


--
-- Name: marketing_influencers marketing_influencers_register_qr_code; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER marketing_influencers_register_qr_code AFTER INSERT ON greendogops.marketing_influencers FOR EACH ROW EXECUTE FUNCTION greendogops.register_influencer_qr_code();


--
-- Name: person person_after_change; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER person_after_change AFTER INSERT OR UPDATE ON greendogops.person FOR EACH ROW EXECUTE FUNCTION greendogops.person_after_change();


--
-- Name: person person_before_change; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER person_before_change BEFORE INSERT OR UPDATE ON greendogops.person FOR EACH ROW EXECUTE FUNCTION greendogops.person_before_change();


--
-- Name: referral_partners referral_partners_register_qr_code; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER referral_partners_register_qr_code AFTER INSERT ON greendogops.referral_partners FOR EACH ROW EXECUTE FUNCTION greendogops.register_referral_qr_code();


--
-- Name: ezyvet_invoice_line request_reporting_refresh_on_invoice_line; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER request_reporting_refresh_on_invoice_line AFTER INSERT OR DELETE OR UPDATE ON greendogops.ezyvet_invoice_line FOR EACH STATEMENT EXECUTE FUNCTION greendogops.trg_request_reporting_refresh();


--
-- Name: medical_board_row set_board_key; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_board_key BEFORE INSERT OR UPDATE ON greendogops.medical_board_row FOR EACH ROW EXECUTE FUNCTION greendogops.medical_board_row_set_key();


--
-- Name: agent set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.agent FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: agent_report set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.agent_report FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: app_setting set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.app_setting FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: app_user set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.app_user FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: calendar_event set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.calendar_event FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: calendar_sync_state set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.calendar_sync_state FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: credential set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.credential FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_ce_attendance set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_ce_attendance FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_ce_event set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_ce_event FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_contact set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_contact FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_contact_document set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_contact_document FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_org_document set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_org_document FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_org_visit set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_org_visit FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_organization set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_organization FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_retail_lead set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.crm_retail_lead FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: ezyvet_agenda_dept_map set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.ezyvet_agenda_dept_map FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: ezyvet_appt_type_dept_map set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.ezyvet_appt_type_dept_map FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: ezyvet_record_tag set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.ezyvet_record_tag FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: ezyvet_tag set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.ezyvet_tag FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: location set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.location FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_budget_entry set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_budget_entry FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_budget_period set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_budget_period FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_event set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_event FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_event_attendee set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_event_attendee FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_event_source set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_event_source FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_goal set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_goal FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_influencers set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_influencers FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_initiative set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_initiative FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_promotion set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_promotion FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_resource set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_resource FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: marketing_tree_node set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.marketing_tree_node FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: medical_board_day set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.medical_board_day FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: medical_board_row set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.medical_board_row FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: notification_delivery set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.notification_delivery FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: ops_task set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.ops_task FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_asset set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_asset FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_compliance_entry set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_compliance_entry FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_disciplinary_action set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_disciplinary_action FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_document set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_document FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_employment set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_employment FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_interview set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_interview FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_license set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_license FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_onboarding_item set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_onboarding_item FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_pto_day set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_pto_day FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_recruiting set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_recruiting FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_review set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_review FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_slack_link set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_slack_link FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: person_time_off set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.person_time_off FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: planning_capacity_rule set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.planning_capacity_rule FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: planning_guide set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.planning_guide FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: planning_guide_column set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.planning_guide_column FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: planning_guide_slot set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.planning_guide_slot FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: position set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops."position" FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: qr_code set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.qr_code FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: qr_form set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.qr_form FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: qr_lead set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.qr_lead FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: recruiter_schedule set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.recruiter_schedule FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: recruiting_email_template set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.recruiting_email_template FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: recruiting_form set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.recruiting_form FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: recruiting_task set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.recruiting_task FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: reminder_rule set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.reminder_rule FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: report_capacity_override set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.report_capacity_override FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: report_capacity_target set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.report_capacity_target FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: resource_category set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.resource_category FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: resource_document set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.resource_document FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_assignment set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_assignment FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_department set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_department FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_employee_setting set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_employee_setting FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_event set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_event FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_role set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_role FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_shift_template set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_shift_template FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sched_week set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sched_week FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sheet_sync_issue set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sheet_sync_issue FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sheet_sync_source set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sheet_sync_source FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: smart_glossary set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.smart_glossary FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: sms_message set_updated_at; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON greendogops.sms_message FOR EACH ROW EXECUTE FUNCTION greendogops.set_updated_at();


--
-- Name: crm_contact trg_normalize_doc_recommendation; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER trg_normalize_doc_recommendation BEFORE INSERT OR UPDATE OF doc_recommendation ON greendogops.crm_contact FOR EACH ROW EXECUTE FUNCTION greendogops.normalize_doc_recommendation();


--
-- Name: crm_contact trg_normalize_student_program; Type: TRIGGER; Schema: greendogops; Owner: -
--

CREATE TRIGGER trg_normalize_student_program BEFORE INSERT OR UPDATE ON greendogops.crm_contact FOR EACH ROW EXECUTE FUNCTION greendogops.normalize_student_program();


--
-- Name: agent_report agent_report_agent_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_report
    ADD CONSTRAINT agent_report_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES greendogops.agent(id) ON DELETE CASCADE;


--
-- Name: agent_run agent_run_agent_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_run
    ADD CONSTRAINT agent_run_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES greendogops.agent(id) ON DELETE CASCADE;


--
-- Name: agent_run_log agent_run_log_run_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.agent_run_log
    ADD CONSTRAINT agent_run_log_run_id_fkey FOREIGN KEY (run_id) REFERENCES greendogops.agent_run(id) ON DELETE CASCADE;


--
-- Name: app_user app_user_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.app_user
    ADD CONSTRAINT app_user_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE SET NULL;


--
-- Name: bizdev_appt_type bizdev_appt_type_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.bizdev_appt_type
    ADD CONSTRAINT bizdev_appt_type_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: bizdev_location_config bizdev_location_config_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.bizdev_location_config
    ADD CONSTRAINT bizdev_location_config_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: calendar_event calendar_event_owner_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_event
    ADD CONSTRAINT calendar_event_owner_person_id_fkey FOREIGN KEY (owner_person_id) REFERENCES greendogops.person(id) ON DELETE SET NULL;


--
-- Name: calendar_notification calendar_notification_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_notification
    ADD CONSTRAINT calendar_notification_event_id_fkey FOREIGN KEY (event_id) REFERENCES greendogops.calendar_event(id) ON DELETE CASCADE;


--
-- Name: calendar_schedule_pin calendar_schedule_pin_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.calendar_schedule_pin
    ADD CONSTRAINT calendar_schedule_pin_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: credential credential_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.credential
    ADD CONSTRAINT credential_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE SET NULL;


--
-- Name: crm_ce_attendance crm_ce_attendance_ce_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_ce_attendance
    ADD CONSTRAINT crm_ce_attendance_ce_event_id_fkey FOREIGN KEY (ce_event_id) REFERENCES greendogops.crm_ce_event(id) ON DELETE SET NULL;


--
-- Name: crm_ce_attendance crm_ce_attendance_contact_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_ce_attendance
    ADD CONSTRAINT crm_ce_attendance_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES greendogops.crm_contact(id) ON DELETE CASCADE;


--
-- Name: crm_contact_document crm_contact_document_contact_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_contact_document
    ADD CONSTRAINT crm_contact_document_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES greendogops.crm_contact(id) ON DELETE CASCADE;


--
-- Name: crm_contact crm_contact_promoted_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_contact
    ADD CONSTRAINT crm_contact_promoted_person_id_fkey FOREIGN KEY (promoted_person_id) REFERENCES greendogops.person(id) ON DELETE SET NULL;


--
-- Name: crm_org_document crm_org_document_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_org_document
    ADD CONSTRAINT crm_org_document_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE CASCADE;


--
-- Name: crm_org_visit crm_org_visit_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_org_visit
    ADD CONSTRAINT crm_org_visit_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE CASCADE;


--
-- Name: crm_retail_lead crm_retail_lead_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.crm_retail_lead
    ADD CONSTRAINT crm_retail_lead_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_appt_snapshot ezyvet_agenda_appt_snapshot_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_appt_snapshot
    ADD CONSTRAINT ezyvet_agenda_appt_snapshot_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_appt_snapshot ezyvet_agenda_appt_snapshot_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_appt_snapshot
    ADD CONSTRAINT ezyvet_agenda_appt_snapshot_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_count ezyvet_agenda_count_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_count
    ADD CONSTRAINT ezyvet_agenda_count_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_count ezyvet_agenda_count_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_count
    ADD CONSTRAINT ezyvet_agenda_count_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_dept_map ezyvet_agenda_dept_map_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_dept_map
    ADD CONSTRAINT ezyvet_agenda_dept_map_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE SET NULL;


--
-- Name: ezyvet_agenda_snapshot ezyvet_agenda_snapshot_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_snapshot
    ADD CONSTRAINT ezyvet_agenda_snapshot_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: ezyvet_agenda_snapshot ezyvet_agenda_snapshot_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_agenda_snapshot
    ADD CONSTRAINT ezyvet_agenda_snapshot_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: ezyvet_appt_type_dept_map ezyvet_appt_type_dept_map_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_appt_type_dept_map
    ADD CONSTRAINT ezyvet_appt_type_dept_map_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE SET NULL;


--
-- Name: ezyvet_cancelled_appointment ezyvet_cancelled_appointment_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_cancelled_appointment
    ADD CONSTRAINT ezyvet_cancelled_appointment_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: ezyvet_record_tag ezyvet_record_tag_tag_key_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ezyvet_record_tag
    ADD CONSTRAINT ezyvet_record_tag_tag_key_fkey FOREIGN KEY (tag_key) REFERENCES greendogops.ezyvet_tag(tag_key) ON UPDATE CASCADE;


--
-- Name: interview_invite interview_invite_host_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.interview_invite
    ADD CONSTRAINT interview_invite_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES greendogops.app_user(id);


--
-- Name: interview_invite interview_invite_interview_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.interview_invite
    ADD CONSTRAINT interview_invite_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES greendogops.person_interview(id) ON DELETE SET NULL;


--
-- Name: interview_invite interview_invite_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.interview_invite
    ADD CONSTRAINT interview_invite_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: location location_parent_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.location
    ADD CONSTRAINT location_parent_location_id_fkey FOREIGN KEY (parent_location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: marketing_event_attendee marketing_event_attendee_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event_attendee
    ADD CONSTRAINT marketing_event_attendee_event_id_fkey FOREIGN KEY (event_id) REFERENCES greendogops.marketing_event(id) ON DELETE CASCADE;


--
-- Name: marketing_event marketing_event_calendar_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event
    ADD CONSTRAINT marketing_event_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES greendogops.calendar_event(id) ON DELETE SET NULL;


--
-- Name: marketing_event_source marketing_event_source_crm_organization_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event_source
    ADD CONSTRAINT marketing_event_source_crm_organization_id_fkey FOREIGN KEY (crm_organization_id) REFERENCES greendogops.crm_organization(id) ON DELETE SET NULL;


--
-- Name: marketing_event marketing_event_source_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_event
    ADD CONSTRAINT marketing_event_source_id_fkey FOREIGN KEY (source_id) REFERENCES greendogops.marketing_event_source(id) ON DELETE SET NULL;


--
-- Name: marketing_goal marketing_goal_node_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_goal
    ADD CONSTRAINT marketing_goal_node_id_fkey FOREIGN KEY (node_id) REFERENCES greendogops.marketing_tree_node(id) ON DELETE SET NULL;


--
-- Name: marketing_initiative marketing_initiative_node_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_initiative
    ADD CONSTRAINT marketing_initiative_node_id_fkey FOREIGN KEY (node_id) REFERENCES greendogops.marketing_tree_node(id) ON DELETE SET NULL;


--
-- Name: marketing_promotion marketing_promotion_source_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_promotion
    ADD CONSTRAINT marketing_promotion_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES greendogops.marketing_event(id) ON DELETE CASCADE;


--
-- Name: marketing_resource marketing_resource_crm_organization_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_resource
    ADD CONSTRAINT marketing_resource_crm_organization_id_fkey FOREIGN KEY (crm_organization_id) REFERENCES greendogops.crm_organization(id) ON DELETE SET NULL;


--
-- Name: marketing_tree_node marketing_tree_node_owner_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_tree_node
    ADD CONSTRAINT marketing_tree_node_owner_person_id_fkey FOREIGN KEY (owner_person_id) REFERENCES greendogops.person(id) ON DELETE SET NULL;


--
-- Name: marketing_tree_node marketing_tree_node_parent_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.marketing_tree_node
    ADD CONSTRAINT marketing_tree_node_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES greendogops.marketing_tree_node(id) ON DELETE SET NULL;


--
-- Name: medical_board_day medical_board_day_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_day
    ADD CONSTRAINT medical_board_day_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: medical_board_row medical_board_row_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.medical_board_row
    ADD CONSTRAINT medical_board_row_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: notification_delivery notification_delivery_notification_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.notification_delivery
    ADD CONSTRAINT notification_delivery_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES greendogops.user_notification(id) ON DELETE CASCADE;


--
-- Name: ops_task ops_task_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ops_task
    ADD CONSTRAINT ops_task_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: ops_task ops_task_completed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ops_task
    ADD CONSTRAINT ops_task_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: ops_task ops_task_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.ops_task
    ADD CONSTRAINT ops_task_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: person_asset person_asset_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_asset
    ADD CONSTRAINT person_asset_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_compliance_entry person_compliance_entry_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_compliance_entry
    ADD CONSTRAINT person_compliance_entry_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_disciplinary_action person_disciplinary_action_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_disciplinary_action
    ADD CONSTRAINT person_disciplinary_action_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_document person_document_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_document
    ADD CONSTRAINT person_document_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_employment person_employment_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_employment
    ADD CONSTRAINT person_employment_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: person_employment person_employment_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_employment
    ADD CONSTRAINT person_employment_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_employment person_employment_position_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_employment
    ADD CONSTRAINT person_employment_position_id_fkey FOREIGN KEY (position_id) REFERENCES greendogops."position"(id) ON DELETE SET NULL;


--
-- Name: person_employment person_employment_preferred_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_employment
    ADD CONSTRAINT person_employment_preferred_location_id_fkey FOREIGN KEY (preferred_location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: person_interview person_interview_guide_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_interview
    ADD CONSTRAINT person_interview_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES greendogops.recruiting_form(id) ON DELETE SET NULL;


--
-- Name: person_interview person_interview_host_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_interview
    ADD CONSTRAINT person_interview_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: person_interview person_interview_invite_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_interview
    ADD CONSTRAINT person_interview_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES greendogops.interview_invite(id) ON DELETE SET NULL;


--
-- Name: person_interview person_interview_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_interview
    ADD CONSTRAINT person_interview_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_license person_license_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_license
    ADD CONSTRAINT person_license_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_onboarding_item person_onboarding_item_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_onboarding_item
    ADD CONSTRAINT person_onboarding_item_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_pto_day person_pto_day_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_pto_day
    ADD CONSTRAINT person_pto_day_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_recruiting person_recruiting_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_recruiting
    ADD CONSTRAINT person_recruiting_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_recruiting person_recruiting_target_position_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_recruiting
    ADD CONSTRAINT person_recruiting_target_position_id_fkey FOREIGN KEY (target_position_id) REFERENCES greendogops."position"(id) ON DELETE SET NULL;


--
-- Name: person_review person_review_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_review
    ADD CONSTRAINT person_review_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person_slack_link person_slack_link_matched_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_slack_link
    ADD CONSTRAINT person_slack_link_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: person_slack_link person_slack_link_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_slack_link
    ADD CONSTRAINT person_slack_link_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: person person_source_contact_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person
    ADD CONSTRAINT person_source_contact_id_fkey FOREIGN KEY (source_contact_id) REFERENCES greendogops.crm_contact(id) ON DELETE SET NULL;


--
-- Name: person_time_off person_time_off_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.person_time_off
    ADD CONSTRAINT person_time_off_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: planning_capacity_rule planning_capacity_rule_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_capacity_rule
    ADD CONSTRAINT planning_capacity_rule_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: planning_capacity_rule planning_capacity_rule_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_capacity_rule
    ADD CONSTRAINT planning_capacity_rule_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: planning_guide_column planning_guide_column_guide_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide_column
    ADD CONSTRAINT planning_guide_column_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES greendogops.planning_guide(id) ON DELETE CASCADE;


--
-- Name: planning_guide planning_guide_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide
    ADD CONSTRAINT planning_guide_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE SET NULL;


--
-- Name: planning_guide planning_guide_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide
    ADD CONSTRAINT planning_guide_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: planning_guide_slot planning_guide_slot_column_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide_slot
    ADD CONSTRAINT planning_guide_slot_column_id_fkey FOREIGN KEY (column_id) REFERENCES greendogops.planning_guide_column(id) ON DELETE CASCADE;


--
-- Name: planning_guide_slot planning_guide_slot_guide_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide_slot
    ADD CONSTRAINT planning_guide_slot_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES greendogops.planning_guide(id) ON DELETE CASCADE;


--
-- Name: planning_guide planning_guide_source_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.planning_guide
    ADD CONSTRAINT planning_guide_source_week_id_fkey FOREIGN KEY (source_week_id) REFERENCES greendogops.sched_week(id) ON DELETE SET NULL;


--
-- Name: profile_transition_log profile_transition_log_contact_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.profile_transition_log
    ADD CONSTRAINT profile_transition_log_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES greendogops.crm_contact(id) ON DELETE SET NULL;


--
-- Name: profile_transition_log profile_transition_log_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.profile_transition_log
    ADD CONSTRAINT profile_transition_log_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: qr_code qr_code_ce_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_ce_event_id_fkey FOREIGN KEY (ce_event_id) REFERENCES greendogops.crm_ce_event(id) ON DELETE CASCADE;


--
-- Name: qr_code qr_code_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_event_id_fkey FOREIGN KEY (event_id) REFERENCES greendogops.marketing_event(id) ON DELETE CASCADE;


--
-- Name: qr_code qr_code_form_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_form_id_fkey FOREIGN KEY (form_id) REFERENCES greendogops.qr_form(id) ON DELETE SET NULL;


--
-- Name: qr_code qr_code_influencer_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES greendogops.marketing_influencers(id) ON DELETE CASCADE;


--
-- Name: qr_code qr_code_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE CASCADE;


--
-- Name: qr_code qr_code_promotion_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES greendogops.marketing_promotion(id) ON DELETE SET NULL;


--
-- Name: qr_code qr_code_referral_partner_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_code
    ADD CONSTRAINT qr_code_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES greendogops.referral_partners(id) ON DELETE CASCADE;


--
-- Name: qr_lead qr_lead_ce_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_ce_event_id_fkey FOREIGN KEY (ce_event_id) REFERENCES greendogops.crm_ce_event(id) ON DELETE SET NULL;


--
-- Name: qr_lead qr_lead_event_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_event_id_fkey FOREIGN KEY (event_id) REFERENCES greendogops.marketing_event(id) ON DELETE SET NULL;


--
-- Name: qr_lead qr_lead_influencer_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES greendogops.marketing_influencers(id) ON DELETE SET NULL;


--
-- Name: qr_lead qr_lead_org_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_org_id_fkey FOREIGN KEY (org_id) REFERENCES greendogops.crm_organization(id) ON DELETE SET NULL;


--
-- Name: qr_lead qr_lead_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES greendogops.qr_code(id) ON DELETE CASCADE;


--
-- Name: qr_lead qr_lead_referral_partner_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.qr_lead
    ADD CONSTRAINT qr_lead_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES greendogops.referral_partners(id) ON DELETE SET NULL;


--
-- Name: recruiter_google_token recruiter_google_token_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiter_google_token
    ADD CONSTRAINT recruiter_google_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: recruiter_schedule recruiter_schedule_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiter_schedule
    ADD CONSTRAINT recruiter_schedule_user_id_fkey FOREIGN KEY (user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: recruiting_activity recruiting_activity_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_activity
    ADD CONSTRAINT recruiting_activity_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: recruiting_form_request recruiting_form_request_form_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_request
    ADD CONSTRAINT recruiting_form_request_form_id_fkey FOREIGN KEY (form_id) REFERENCES greendogops.recruiting_form(id) ON DELETE CASCADE;


--
-- Name: recruiting_form_request recruiting_form_request_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_request
    ADD CONSTRAINT recruiting_form_request_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: recruiting_form_response recruiting_form_response_form_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_response
    ADD CONSTRAINT recruiting_form_response_form_id_fkey FOREIGN KEY (form_id) REFERENCES greendogops.recruiting_form(id) ON DELETE SET NULL;


--
-- Name: recruiting_form_response recruiting_form_response_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_response
    ADD CONSTRAINT recruiting_form_response_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: recruiting_form_response recruiting_form_response_request_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_form_response
    ADD CONSTRAINT recruiting_form_response_request_id_fkey FOREIGN KEY (request_id) REFERENCES greendogops.recruiting_form_request(id) ON DELETE SET NULL;


--
-- Name: recruiting_rejection recruiting_rejection_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_rejection
    ADD CONSTRAINT recruiting_rejection_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: recruiting_rejection recruiting_rejection_template_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_rejection
    ADD CONSTRAINT recruiting_rejection_template_id_fkey FOREIGN KEY (template_id) REFERENCES greendogops.recruiting_email_template(id) ON DELETE SET NULL;


--
-- Name: recruiting_score_change recruiting_score_change_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_score_change
    ADD CONSTRAINT recruiting_score_change_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: recruiting_task recruiting_task_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.recruiting_task
    ADD CONSTRAINT recruiting_task_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: reminder_ack reminder_ack_rule_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_ack
    ADD CONSTRAINT reminder_ack_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES greendogops.reminder_rule(id) ON DELETE CASCADE;


--
-- Name: reminder_ack reminder_ack_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_ack
    ADD CONSTRAINT reminder_ack_user_id_fkey FOREIGN KEY (user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: reminder_rule reminder_rule_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_rule
    ADD CONSTRAINT reminder_rule_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: reminder_rule reminder_rule_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.reminder_rule
    ADD CONSTRAINT reminder_rule_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: report_capacity_override report_capacity_override_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_override
    ADD CONSTRAINT report_capacity_override_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: report_capacity_target report_capacity_target_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.report_capacity_target
    ADD CONSTRAINT report_capacity_target_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: resource_document_chunk resource_document_chunk_document_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.resource_document_chunk
    ADD CONSTRAINT resource_document_chunk_document_id_fkey FOREIGN KEY (document_id) REFERENCES greendogops.resource_document(id) ON DELETE CASCADE;


--
-- Name: sched_assignment sched_assignment_line_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_assignment
    ADD CONSTRAINT sched_assignment_line_id_fkey FOREIGN KEY (line_id) REFERENCES greendogops.sched_week_line(id) ON DELETE CASCADE;


--
-- Name: sched_assignment sched_assignment_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_assignment
    ADD CONSTRAINT sched_assignment_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: sched_assignment sched_assignment_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_assignment
    ADD CONSTRAINT sched_assignment_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: sched_assignment sched_assignment_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_assignment
    ADD CONSTRAINT sched_assignment_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sched_change_log sched_change_log_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_change_log
    ADD CONSTRAINT sched_change_log_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sched_closure sched_closure_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_closure
    ADD CONSTRAINT sched_closure_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: sched_closure sched_closure_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_closure
    ADD CONSTRAINT sched_closure_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sched_employee_setting sched_employee_setting_default_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_employee_setting
    ADD CONSTRAINT sched_employee_setting_default_location_id_fkey FOREIGN KEY (default_location_id) REFERENCES greendogops.location(id) ON DELETE SET NULL;


--
-- Name: sched_employee_setting sched_employee_setting_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_employee_setting
    ADD CONSTRAINT sched_employee_setting_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: sched_event sched_event_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_event
    ADD CONSTRAINT sched_event_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: sched_event sched_event_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_event
    ADD CONSTRAINT sched_event_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sched_role sched_role_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_role
    ADD CONSTRAINT sched_role_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: sched_role_member sched_role_member_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_role_member
    ADD CONSTRAINT sched_role_member_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: sched_role_member sched_role_member_role_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_role_member
    ADD CONSTRAINT sched_role_member_role_id_fkey FOREIGN KEY (role_id) REFERENCES greendogops.sched_role(id) ON DELETE CASCADE;


--
-- Name: sched_shift_template sched_shift_template_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_shift_template
    ADD CONSTRAINT sched_shift_template_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: sched_shift_template sched_shift_template_role_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_shift_template
    ADD CONSTRAINT sched_shift_template_role_id_fkey FOREIGN KEY (role_id) REFERENCES greendogops.sched_role(id) ON DELETE SET NULL;


--
-- Name: sched_week_line sched_week_line_department_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_line
    ADD CONSTRAINT sched_week_line_department_id_fkey FOREIGN KEY (department_id) REFERENCES greendogops.sched_department(id) ON DELETE CASCADE;


--
-- Name: sched_week_line sched_week_line_role_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_line
    ADD CONSTRAINT sched_week_line_role_id_fkey FOREIGN KEY (role_id) REFERENCES greendogops.sched_role(id) ON DELETE SET NULL;


--
-- Name: sched_week_line sched_week_line_template_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_line
    ADD CONSTRAINT sched_week_line_template_id_fkey FOREIGN KEY (template_id) REFERENCES greendogops.sched_shift_template(id) ON DELETE SET NULL;


--
-- Name: sched_week_line sched_week_line_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_line
    ADD CONSTRAINT sched_week_line_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sched_week_location sched_week_location_location_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_location
    ADD CONSTRAINT sched_week_location_location_id_fkey FOREIGN KEY (location_id) REFERENCES greendogops.location(id) ON DELETE CASCADE;


--
-- Name: sched_week_location sched_week_location_week_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sched_week_location
    ADD CONSTRAINT sched_week_location_week_id_fkey FOREIGN KEY (week_id) REFERENCES greendogops.sched_week(id) ON DELETE CASCADE;


--
-- Name: sheet_sync_issue sheet_sync_issue_run_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sheet_sync_issue
    ADD CONSTRAINT sheet_sync_issue_run_id_fkey FOREIGN KEY (run_id) REFERENCES greendogops.agent_run(id) ON DELETE SET NULL;


--
-- Name: smart_glossary smart_glossary_created_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_glossary
    ADD CONSTRAINT smart_glossary_created_by_fkey FOREIGN KEY (created_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: smart_glossary smart_glossary_updated_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_glossary
    ADD CONSTRAINT smart_glossary_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: smart_question_log smart_question_log_app_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_question_log
    ADD CONSTRAINT smart_question_log_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: smart_question_log smart_question_log_verified_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.smart_question_log
    ADD CONSTRAINT smart_question_log_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: sms_consent sms_consent_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_consent
    ADD CONSTRAINT sms_consent_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: sms_consent sms_consent_recorded_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_consent
    ADD CONSTRAINT sms_consent_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: sms_message sms_message_person_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_message
    ADD CONSTRAINT sms_message_person_id_fkey FOREIGN KEY (person_id) REFERENCES greendogops.person(id) ON DELETE CASCADE;


--
-- Name: sms_message sms_message_sent_by_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.sms_message
    ADD CONSTRAINT sms_message_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: user_notification user_notification_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.user_notification
    ADD CONSTRAINT user_notification_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES greendogops.app_user(id) ON DELETE SET NULL;


--
-- Name: user_notification user_notification_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.user_notification
    ADD CONSTRAINT user_notification_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES greendogops.app_user(id) ON DELETE CASCADE;


--
-- Name: user_notification user_notification_task_id_fkey; Type: FK CONSTRAINT; Schema: greendogops; Owner: -
--

ALTER TABLE ONLY greendogops.user_notification
    ADD CONSTRAINT user_notification_task_id_fkey FOREIGN KEY (task_id) REFERENCES greendogops.ops_task(id) ON DELETE CASCADE;


--
-- Name: agent; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.agent ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_report; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.agent_report ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_run; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.agent_run ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_run_log; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.agent_run_log ENABLE ROW LEVEL SECURITY;

--
-- Name: app_setting; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.app_setting ENABLE ROW LEVEL SECURITY;

--
-- Name: app_user; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.app_user ENABLE ROW LEVEL SECURITY;

--
-- Name: app_user app_user_read_self; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY app_user_read_self ON greendogops.app_user FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: ats_hr_merge_backup_0032; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ats_hr_merge_backup_0032 ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: bizdev_appt_type; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.bizdev_appt_type ENABLE ROW LEVEL SECURITY;

--
-- Name: bizdev_location_config; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.bizdev_location_config ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_event; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.calendar_event ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_notification; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.calendar_notification ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_schedule_pin; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.calendar_schedule_pin ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_sync_state; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.calendar_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: clinic_visits; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.clinic_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: credential; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.credential ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_ce_attendance; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_ce_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_ce_event; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_ce_event ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contact; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_contact ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contact_document; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_contact_document ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_org_document; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_org_document ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_org_visit; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_org_visit ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_organization; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_organization ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_program_name; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_program_name ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_retail_lead; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.crm_retail_lead ENABLE ROW LEVEL SECURITY;

--
-- Name: email_event; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.email_event ENABLE ROW LEVEL SECURITY;

--
-- Name: email_template; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.email_template ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_aged_receivable; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_aged_receivable ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_agenda_appt_snapshot; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_agenda_appt_snapshot ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_agenda_count; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_agenda_count ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_agenda_dept_map; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_agenda_dept_map ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_agenda_snapshot; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_agenda_snapshot ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_animal; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_animal ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_animal_import; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_animal_import ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_appointment_record; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_appointment_record ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_appointment_status; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_appointment_status ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_appointment_type_stat; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_appointment_type_stat ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_appt_type_dept_map; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_appt_type_dept_map ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_cancelled_appointment; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_cancelled_appointment ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_clinical_note; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_clinical_note ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_consult_metric; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_consult_metric ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_contact; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_contact ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_contact_change; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_contact_change ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_contact_import; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_contact_import ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_controlled_drug; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_controlled_drug ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_customer_invoice_stat; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_customer_invoice_stat ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_disabled_record; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_disabled_record ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_end_of_day; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_end_of_day ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_estimate; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_estimate ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_expired_inventory; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_expired_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_expiring_inventory; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_expiring_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_inventory_ordering; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_inventory_ordering ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_inventory_transfer; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_inventory_transfer ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_inventory_value; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_inventory_value ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_invoice_import; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_invoice_import ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_invoice_line; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_invoice_line ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_invoice_summary; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_invoice_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_payment; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_payment ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_payment_allocation; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_payment_allocation ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_product; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_product ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_product_import; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_product_import ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_product_price; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_product_price ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_purchase; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_purchase ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_record_tag; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_record_tag ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_record_tag_run; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_record_tag_run ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_soc_overdue; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_soc_overdue ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_staff_sale; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_staff_sale ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_tag; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_tag ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_taxable_sales; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_taxable_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_unapplied_payment; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_unapplied_payment ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_unbilled_consult; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_unbilled_consult ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_vaccination; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_vaccination ENABLE ROW LEVEL SECURITY;

--
-- Name: ezyvet_wellness_plan_use; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ezyvet_wellness_plan_use ENABLE ROW LEVEL SECURITY;

--
-- Name: agent gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.agent TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: agent_report gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.agent_report TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: agent_run gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.agent_run TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: agent_run_log gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.agent_run_log TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: app_setting gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.app_setting TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: bizdev_appt_type gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.bizdev_appt_type TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: bizdev_location_config gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.bizdev_location_config TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: calendar_event gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.calendar_event TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: calendar_notification gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.calendar_notification TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: calendar_schedule_pin gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.calendar_schedule_pin TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: calendar_sync_state gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.calendar_sync_state TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: clinic_visits gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.clinic_visits TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_ce_attendance gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_ce_attendance TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_ce_event gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_ce_event TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_contact gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_contact TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_contact_document gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_contact_document TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_org_document gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_org_document TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_org_visit gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_org_visit TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_organization gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_organization TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_program_name gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_program_name TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: crm_retail_lead gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.crm_retail_lead TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: email_event gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.email_event TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: email_template gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.email_template TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_aged_receivable gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_aged_receivable TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_agenda_appt_snapshot gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_agenda_appt_snapshot TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_agenda_count gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_agenda_count TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_agenda_dept_map gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_agenda_dept_map TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_agenda_snapshot gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_agenda_snapshot TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_animal gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_animal TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_animal_import gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_animal_import TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_appointment_record gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_appointment_record TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_appointment_status gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_appointment_status TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_appointment_type_stat gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_appointment_type_stat TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_appt_type_dept_map gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_appt_type_dept_map TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_cancelled_appointment gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_cancelled_appointment TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_clinical_note gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_clinical_note TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_consult_metric gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_consult_metric TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_contact gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_contact TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_contact_change gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_contact_change TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_contact_import gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_contact_import TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_controlled_drug gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_controlled_drug TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_customer_invoice_stat gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_customer_invoice_stat TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_disabled_record gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_disabled_record TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_end_of_day gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_end_of_day TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_estimate gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_estimate TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_expired_inventory gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_expired_inventory TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_expiring_inventory gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_expiring_inventory TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_inventory_ordering gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_inventory_ordering TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_inventory_transfer gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_inventory_transfer TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_inventory_value gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_inventory_value TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_invoice_import gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_invoice_import TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_invoice_line gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_invoice_line TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_invoice_summary gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_invoice_summary TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_payment gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_payment TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_payment_allocation gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_payment_allocation TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_product gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_product TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_product_import gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_product_import TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_product_price gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_product_price TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_purchase gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_purchase TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_record_tag gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_record_tag TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_record_tag_run gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_record_tag_run TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_soc_overdue gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_soc_overdue TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_staff_sale gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_staff_sale TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_tag gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_tag TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_taxable_sales gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_taxable_sales TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_unapplied_payment gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_unapplied_payment TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_unbilled_consult gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_unbilled_consult TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_vaccination gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_vaccination TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: ezyvet_wellness_plan_use gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.ezyvet_wellness_plan_use TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: interview_invite gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.interview_invite TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: location gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.location TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_activity gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_activity TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_budget_entry gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_budget_entry TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_budget_period gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_budget_period TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_event gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_event TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_event_attendee gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_event_attendee TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_event_source gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_event_source TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_goal gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_goal TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_influencers gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_influencers TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_initiative gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_initiative TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_promotion gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_promotion TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_resource gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_resource TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: marketing_tree_node gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.marketing_tree_node TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: medical_board_day gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.medical_board_day TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: medical_board_row gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.medical_board_row TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: medical_board_type gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.medical_board_type TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: partner_contacts gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.partner_contacts TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: partner_notes gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.partner_notes TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_employment gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_employment TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_interview gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_interview TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_pto_day gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_pto_day TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_recruiting gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_recruiting TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_recruiting_cleanup_0220 gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_recruiting_cleanup_0220 TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_time_off gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.person_time_off TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: planning_capacity_rule gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.planning_capacity_rule TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: planning_guide gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.planning_guide TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: planning_guide_column gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.planning_guide_column TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: planning_guide_slot gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.planning_guide_slot TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: position gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops."position" TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: qr_code gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.qr_code TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: qr_form gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.qr_form TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: qr_lead gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.qr_lead TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiter_schedule gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiter_schedule TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_activity gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_activity TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_email_template gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_email_template TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_form gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_form TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_form_request gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_form_request TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_form_response gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_form_response TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_rejection gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_rejection TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_score_change gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_score_change TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: recruiting_task gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.recruiting_task TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: referral_partners gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.referral_partners TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: referral_revenue_line_items gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.referral_revenue_line_items TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: referral_sync_history gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.referral_sync_history TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: report_capacity_override gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.report_capacity_override TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: report_capacity_target gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.report_capacity_target TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: reporting_refresh_state gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.reporting_refresh_state TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: resource_category gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.resource_category TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: resource_document gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.resource_document TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: resource_document_chunk gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.resource_document_chunk TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_assignment gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_assignment TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_change_log gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_change_log TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_closure gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_closure TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_department gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_department TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_employee_setting gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_employee_setting TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_event gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_event TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_role gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_role TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_role_member gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_role_member TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_shift_template gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_shift_template TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_week gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_week TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_week_line gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_week_line TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sched_week_location gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sched_week_location TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sheet_sync_issue gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sheet_sync_issue TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: sheet_sync_source gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.sheet_sync_source TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: smart_glossary gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.smart_glossary TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: smart_question_log gdo_members_all; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY gdo_members_all ON greendogops.smart_question_log TO authenticated USING (greendogops.is_gdo_user()) WITH CHECK (greendogops.is_gdo_user());


--
-- Name: person_asset hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_asset FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_compliance_entry hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_compliance_entry FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_disciplinary_action hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_disciplinary_action FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_document hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_document FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = person_document.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text <> 'staff'::text) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END)))))));


--
-- Name: person_license hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_license FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_onboarding_item hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_onboarding_item FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_review hr_file_delete; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_delete ON greendogops.person_review FOR DELETE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_asset hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_asset FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_compliance_entry hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_compliance_entry FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_disciplinary_action hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_disciplinary_action FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_document hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_document FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = person_document.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text <> 'staff'::text) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END)))))));


--
-- Name: person_license hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_license FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_onboarding_item hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_onboarding_item FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_review hr_file_insert; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_insert ON greendogops.person_review FOR INSERT TO authenticated WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_asset hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_asset FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: person_compliance_entry hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_compliance_entry FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: person_disciplinary_action hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_disciplinary_action FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: person_document hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_document FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = person_document.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END)))))));


--
-- Name: person_license hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_license FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: person_onboarding_item hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_onboarding_item FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: person_review hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.person_review FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))))));


--
-- Name: profile_transition_log hr_file_read; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_read ON greendogops.profile_transition_log FOR SELECT TO authenticated USING ((greendogops.is_gdo_user() AND ((person_id IS NULL) OR (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text]))))) OR (person_id = ( SELECT u.person_id
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = profile_transition_log.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END)))))));


--
-- Name: person_asset hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_asset FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_compliance_entry hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_compliance_entry FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_disciplinary_action hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_disciplinary_action FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_document hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_document FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = person_document.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text <> 'staff'::text) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END))))))) WITH CHECK ((greendogops.is_gdo_user() AND ((EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))) OR ((EXISTS ( SELECT 1
   FROM greendogops.person p
  WHERE ((p.id = person_document.person_id) AND ((p.status)::text = ANY (ARRAY['prospect'::text, 'applicant'::text]))))) AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text <> 'staff'::text) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'ats'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'ats'::text))::boolean
            ELSE true
        END)))))));


--
-- Name: person_license hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_license FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_onboarding_item hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_onboarding_item FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: person_review hr_file_update; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY hr_file_update ON greendogops.person_review FOR UPDATE TO authenticated USING ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END))))) WITH CHECK ((greendogops.is_gdo_user() AND (EXISTS ( SELECT 1
   FROM greendogops.app_user u
  WHERE ((u.id = auth.uid()) AND u.is_active AND ((u.role)::text = ANY (ARRAY['owner'::text, 'admin'::text, 'executive'::text, 'manager'::text])) AND
        CASE
            WHEN (jsonb_typeof((u.module_access -> 'hr'::text)) = 'boolean'::text) THEN ((u.module_access ->> 'hr'::text))::boolean
            ELSE true
        END)))));


--
-- Name: interview_invite; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.interview_invite ENABLE ROW LEVEL SECURITY;

--
-- Name: location; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.location ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_activity; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_budget_entry; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_budget_entry ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_budget_period; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_budget_period ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_event; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_event ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_event_attendee; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_event_attendee ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_event_source; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_event_source ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_goal; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_goal ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_influencers; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_influencers ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_initiative; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_initiative ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_promotion; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_promotion ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_resource; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_resource ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_tree_node; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.marketing_tree_node ENABLE ROW LEVEL SECURITY;

--
-- Name: medical_board_day; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.medical_board_day ENABLE ROW LEVEL SECURITY;

--
-- Name: medical_board_row; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.medical_board_row ENABLE ROW LEVEL SECURITY;

--
-- Name: medical_board_type; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.medical_board_type ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_delivery; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.notification_delivery ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_task; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.ops_task ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_contacts; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.partner_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_notes; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.partner_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: person; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person ENABLE ROW LEVEL SECURITY;

--
-- Name: person_asset; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_asset ENABLE ROW LEVEL SECURITY;

--
-- Name: person_compliance_entry; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_compliance_entry ENABLE ROW LEVEL SECURITY;

--
-- Name: person_disciplinary_action; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_disciplinary_action ENABLE ROW LEVEL SECURITY;

--
-- Name: person_document; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_document ENABLE ROW LEVEL SECURITY;

--
-- Name: person_employment; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_employment ENABLE ROW LEVEL SECURITY;

--
-- Name: person_interview; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_interview ENABLE ROW LEVEL SECURITY;

--
-- Name: person_license; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_license ENABLE ROW LEVEL SECURITY;

--
-- Name: person_onboarding_item; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_onboarding_item ENABLE ROW LEVEL SECURITY;

--
-- Name: person_pto_day; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_pto_day ENABLE ROW LEVEL SECURITY;

--
-- Name: person_recruiting; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_recruiting ENABLE ROW LEVEL SECURITY;

--
-- Name: person_recruiting_cleanup_0220; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_recruiting_cleanup_0220 ENABLE ROW LEVEL SECURITY;

--
-- Name: person_recruiting_score_backup_0225; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_recruiting_score_backup_0225 ENABLE ROW LEVEL SECURITY;

--
-- Name: person_review; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_review ENABLE ROW LEVEL SECURITY;

--
-- Name: person_slack_link; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_slack_link ENABLE ROW LEVEL SECURITY;

--
-- Name: person_time_off; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.person_time_off ENABLE ROW LEVEL SECURITY;

--
-- Name: planning_capacity_rule; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.planning_capacity_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: planning_guide; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.planning_guide ENABLE ROW LEVEL SECURITY;

--
-- Name: planning_guide_column; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.planning_guide_column ENABLE ROW LEVEL SECURITY;

--
-- Name: planning_guide_slot; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.planning_guide_slot ENABLE ROW LEVEL SECURITY;

--
-- Name: position; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops."position" ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_transition_log; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.profile_transition_log ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_code; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.qr_code ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_form; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.qr_form ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_lead; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.qr_lead ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_bucket; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.rate_limit_bucket ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiter_google_token; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiter_google_token ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiter_schedule; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiter_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_activity; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_email_template; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_email_template ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_form; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_form ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_form_request; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_form_request ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_form_response; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_form_response ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_rejection; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_rejection ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_score_change; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_score_change ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiting_task; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.recruiting_task ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_partners; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.referral_partners ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_revenue_line_items; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.referral_revenue_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_sync_history; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.referral_sync_history ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_ack; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.reminder_ack ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_rule; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.reminder_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: report_capacity_override; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.report_capacity_override ENABLE ROW LEVEL SECURITY;

--
-- Name: report_capacity_target; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.report_capacity_target ENABLE ROW LEVEL SECURITY;

--
-- Name: reporting_refresh_state; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.reporting_refresh_state ENABLE ROW LEVEL SECURITY;

--
-- Name: resource_category; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.resource_category ENABLE ROW LEVEL SECURITY;

--
-- Name: resource_document; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.resource_document ENABLE ROW LEVEL SECURITY;

--
-- Name: resource_document_chunk; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.resource_document_chunk ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_assignment; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_assignment ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_change_log; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_closure; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_closure ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_department; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_department ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_employee_setting; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_employee_setting ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_event; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_event ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_role; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_role ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_role_member; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_role_member ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_shift_template; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_shift_template ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_week; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_week ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_week_line; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_week_line ENABLE ROW LEVEL SECURITY;

--
-- Name: sched_week_location; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sched_week_location ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.audit_log TO authenticated USING (false) WITH CHECK (false);


--
-- Name: notification_delivery service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.notification_delivery TO authenticated USING (false) WITH CHECK (false);


--
-- Name: ops_task service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.ops_task TO authenticated USING (false) WITH CHECK (false);


--
-- Name: person_recruiting_score_backup_0225 service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.person_recruiting_score_backup_0225 TO authenticated USING (false) WITH CHECK (false);


--
-- Name: person_slack_link service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.person_slack_link TO authenticated USING (false) WITH CHECK (false);


--
-- Name: rate_limit_bucket service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.rate_limit_bucket TO authenticated USING (false) WITH CHECK (false);


--
-- Name: recruiter_google_token service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.recruiter_google_token TO authenticated USING (false) WITH CHECK (false);


--
-- Name: reminder_ack service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.reminder_ack TO authenticated USING (false) WITH CHECK (false);


--
-- Name: reminder_rule service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.reminder_rule TO authenticated USING (false) WITH CHECK (false);


--
-- Name: sms_consent service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.sms_consent TO authenticated USING (false) WITH CHECK (false);


--
-- Name: sms_message service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.sms_message TO authenticated USING (false) WITH CHECK (false);


--
-- Name: sms_opt_out service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.sms_opt_out TO authenticated USING (false) WITH CHECK (false);


--
-- Name: user_notification service_role_only; Type: POLICY; Schema: greendogops; Owner: -
--

CREATE POLICY service_role_only ON greendogops.user_notification TO authenticated USING (false) WITH CHECK (false);


--
-- Name: sheet_sync_issue; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sheet_sync_issue ENABLE ROW LEVEL SECURITY;

--
-- Name: sheet_sync_source; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sheet_sync_source ENABLE ROW LEVEL SECURITY;

--
-- Name: smart_glossary; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.smart_glossary ENABLE ROW LEVEL SECURITY;

--
-- Name: smart_question_log; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.smart_question_log ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_consent; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sms_consent ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_message; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sms_message ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_opt_out; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.sms_opt_out ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification; Type: ROW SECURITY; Schema: greendogops; Owner: -
--

ALTER TABLE greendogops.user_notification ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA greendogops; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA greendogops TO anon;
GRANT USAGE ON SCHEMA greendogops TO authenticated;
GRANT USAGE ON SCHEMA greendogops TO service_role;


--
-- Name: FUNCTION apply_sheet_dvm_assignments(payload jsonb); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.apply_sheet_dvm_assignments(payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.apply_sheet_dvm_assignments(payload jsonb) TO service_role;
GRANT ALL ON FUNCTION greendogops.apply_sheet_dvm_assignments(payload jsonb) TO authenticated;


--
-- Name: FUNCTION apply_student_grid(payload jsonb); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.apply_student_grid(payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.apply_student_grid(payload jsonb) TO service_role;
GRANT ALL ON FUNCTION greendogops.apply_student_grid(payload jsonb) TO authenticated;


--
-- Name: FUNCTION appointment_review(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.appointment_review(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.appointment_review(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.appointment_review(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION appointment_review_by_type(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.appointment_review_by_type(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.appointment_review_by_type(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.appointment_review_by_type(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION appointment_review_detail(p_location uuid, p_department uuid, p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.appointment_review_detail(p_location uuid, p_department uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.appointment_review_detail(p_location uuid, p_department uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.appointment_review_detail(p_location uuid, p_department uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION appointment_review_type_detail(p_location uuid, p_start date, p_end date, p_type text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.appointment_review_type_detail(p_location uuid, p_start date, p_end date, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.appointment_review_type_detail(p_location uuid, p_start date, p_end date, p_type text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.appointment_review_type_detail(p_location uuid, p_start date, p_end date, p_type text) TO service_role;


--
-- Name: FUNCTION appt_type_observed_counts(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.appt_type_observed_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.appt_type_observed_counts() TO authenticated;
GRANT ALL ON FUNCTION greendogops.appt_type_observed_counts() TO service_role;


--
-- Name: FUNCTION audit_log_append_only(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.audit_log_append_only() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.audit_log_append_only() TO service_role;


--
-- Name: FUNCTION bizdev_appt_type_daily_avg(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.bizdev_appt_type_daily_avg() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.bizdev_appt_type_daily_avg() TO authenticated;
GRANT ALL ON FUNCTION greendogops.bizdev_appt_type_daily_avg() TO service_role;


--
-- Name: FUNCTION bizdev_appt_type_value(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.bizdev_appt_type_value() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.bizdev_appt_type_value() TO authenticated;
GRANT ALL ON FUNCTION greendogops.bizdev_appt_type_value() TO service_role;


--
-- Name: FUNCTION bizdev_hour_demand(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.bizdev_hour_demand() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.bizdev_hour_demand() TO authenticated;
GRANT ALL ON FUNCTION greendogops.bizdev_hour_demand() TO service_role;


--
-- Name: FUNCTION bizdev_refresh_metrics(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.bizdev_refresh_metrics() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.bizdev_refresh_metrics() TO authenticated;
GRANT ALL ON FUNCTION greendogops.bizdev_refresh_metrics() TO service_role;


--
-- Name: FUNCTION bizdev_weekday_factor(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.bizdev_weekday_factor() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.bizdev_weekday_factor() TO authenticated;
GRANT ALL ON FUNCTION greendogops.bizdev_weekday_factor() TO service_role;


--
-- Name: FUNCTION book_interview_slot(p_invite_id uuid, p_date date, p_start time without time zone, p_end time without time zone, p_interviewer text, p_booked_start timestamp with time zone); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.book_interview_slot(p_invite_id uuid, p_date date, p_start time without time zone, p_end time without time zone, p_interviewer text, p_booked_start timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.book_interview_slot(p_invite_id uuid, p_date date, p_start time without time zone, p_end time without time zone, p_interviewer text, p_booked_start timestamp with time zone) TO service_role;


--
-- Name: FUNCTION cancelled_appointments_by_type(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.cancelled_appointments_by_type(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.cancelled_appointments_by_type(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.cancelled_appointments_by_type(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION cancelled_appointments_detail(p_location uuid, p_start date, p_end date, p_type text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.cancelled_appointments_detail(p_location uuid, p_start date, p_end date, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.cancelled_appointments_detail(p_location uuid, p_start date, p_end date, p_type text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.cancelled_appointments_detail(p_location uuid, p_start date, p_end date, p_type text) TO service_role;


--
-- Name: FUNCTION is_appt_line(p_name text, p_group text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.is_appt_line(p_name text, p_group text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.is_appt_line(p_name text, p_group text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.is_appt_line(p_name text, p_group text) TO service_role;


--
-- Name: FUNCTION is_gdo_admin(uid uuid); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.is_gdo_admin(uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.is_gdo_admin(uid uuid) TO service_role;
GRANT ALL ON FUNCTION greendogops.is_gdo_admin(uid uuid) TO authenticated;


--
-- Name: FUNCTION is_gdo_user(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.is_gdo_user() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.is_gdo_user() TO authenticated;
GRANT ALL ON FUNCTION greendogops.is_gdo_user() TO service_role;


--
-- Name: FUNCTION med_age_short(p text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_age_short(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_age_short(p text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_age_short(p text) TO authenticated;


--
-- Name: FUNCTION med_board_is_archived(p_location uuid, p_date date, p_board_type text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_board_is_archived(p_location uuid, p_date date, p_board_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_board_is_archived(p_location uuid, p_date date, p_board_type text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_board_is_archived(p_location uuid, p_date date, p_board_type text) TO authenticated;


--
-- Name: FUNCTION med_dept_code(p_name text, p_code text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_dept_code(p_name text, p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_dept_code(p_name text, p_code text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_dept_code(p_name text, p_code text) TO authenticated;


--
-- Name: FUNCTION med_descr_credit(p_text text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_descr_credit(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_descr_credit(p_text text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_descr_credit(p_text text) TO authenticated;


--
-- Name: FUNCTION med_descr_field(p_text text, p_label text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_descr_field(p_text text, p_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_descr_field(p_text text, p_label text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_descr_field(p_text text, p_label text) TO authenticated;


--
-- Name: FUNCTION med_descr_initials(p_text text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_descr_initials(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_descr_initials(p_text text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_descr_initials(p_text text) TO authenticated;


--
-- Name: FUNCTION med_fas_from_caution(p text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_fas_from_caution(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_fas_from_caution(p text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_fas_from_caution(p text) TO authenticated;


--
-- Name: FUNCTION med_scheduled_dvm(p_location uuid, p_date date, p_board_type text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_scheduled_dvm(p_location uuid, p_date date, p_board_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_scheduled_dvm(p_location uuid, p_date date, p_board_type text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_scheduled_dvm(p_location uuid, p_date date, p_board_type text) TO authenticated;


--
-- Name: FUNCTION med_sex_short(p text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_sex_short(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_sex_short(p text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_sex_short(p text) TO authenticated;


--
-- Name: FUNCTION med_species_short(p text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.med_species_short(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.med_species_short(p text) TO service_role;
GRANT ALL ON FUNCTION greendogops.med_species_short(p text) TO authenticated;


--
-- Name: FUNCTION medical_board_coverage(p_date date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_coverage(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_coverage(p_date date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.medical_board_coverage(p_date date) TO service_role;


--
-- Name: FUNCTION medical_board_fill_staff(p_date date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_fill_staff(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_fill_staff(p_date date) TO service_role;
GRANT ALL ON FUNCTION greendogops.medical_board_fill_staff(p_date date) TO authenticated;


--
-- Name: FUNCTION medical_board_patch_card(p_row uuid, p_patch jsonb, p_actor text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_patch_card(p_row uuid, p_patch jsonb, p_actor text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_patch_card(p_row uuid, p_patch jsonb, p_actor text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.medical_board_patch_card(p_row uuid, p_patch jsonb, p_actor text) TO service_role;


--
-- Name: FUNCTION medical_board_register_missing_types(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_register_missing_types() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_register_missing_types() TO authenticated;
GRANT ALL ON FUNCTION greendogops.medical_board_register_missing_types() TO service_role;


--
-- Name: FUNCTION medical_board_rollover(p_today date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_rollover(p_today date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_rollover(p_today date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.medical_board_rollover(p_today date) TO service_role;


--
-- Name: FUNCTION medical_board_row_guard(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_row_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_row_guard() TO service_role;
GRANT ALL ON FUNCTION greendogops.medical_board_row_guard() TO authenticated;


--
-- Name: FUNCTION medical_board_row_set_key(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_row_set_key() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_row_set_key() TO service_role;
GRANT ALL ON FUNCTION greendogops.medical_board_row_set_key() TO authenticated;


--
-- Name: FUNCTION medical_board_seed(p_location uuid, p_date date, p_board_type text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.medical_board_seed(p_location uuid, p_date date, p_board_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.medical_board_seed(p_location uuid, p_date date, p_board_type text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.medical_board_seed(p_location uuid, p_date date, p_board_type text) TO service_role;


--
-- Name: FUNCTION merge_person(p_keep uuid, p_dup uuid); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.merge_person(p_keep uuid, p_dup uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.merge_person(p_keep uuid, p_dup uuid) TO service_role;


--
-- Name: FUNCTION merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text, p_tag_group text, p_activity_from date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text, p_tag_group text, p_activity_from date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.merge_record_tag(p_tag_key text, p_tag_label text, p_record_type text, p_mode text, p_run_on date, p_records jsonb, p_tag_type text, p_tag_group text, p_activity_from date) TO service_role;


--
-- Name: FUNCTION name_tokens(raw text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.name_tokens(raw text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.name_tokens(raw text) TO service_role;
GRANT ALL ON FUNCTION greendogops.name_tokens(raw text) TO authenticated;


--
-- Name: FUNCTION new_confirmation_code(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.new_confirmation_code() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.new_confirmation_code() TO service_role;
GRANT ALL ON FUNCTION greendogops.new_confirmation_code() TO authenticated;


--
-- Name: FUNCTION new_qr_token(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.new_qr_token() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.new_qr_token() TO service_role;
GRANT ALL ON FUNCTION greendogops.new_qr_token() TO authenticated;


--
-- Name: FUNCTION normalize_doc_recommendation(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.normalize_doc_recommendation() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.normalize_doc_recommendation() TO service_role;
GRANT ALL ON FUNCTION greendogops.normalize_doc_recommendation() TO authenticated;


--
-- Name: FUNCTION normalize_job_title(raw text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.normalize_job_title(raw text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.normalize_job_title(raw text) TO service_role;
GRANT ALL ON FUNCTION greendogops.normalize_job_title(raw text) TO authenticated;


--
-- Name: FUNCTION normalize_person_key(t text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.normalize_person_key(t text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.normalize_person_key(t text) TO authenticated;
GRANT ALL ON FUNCTION greendogops.normalize_person_key(t text) TO service_role;


--
-- Name: FUNCTION normalize_student_program(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.normalize_student_program() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.normalize_student_program() TO service_role;
GRANT ALL ON FUNCTION greendogops.normalize_student_program() TO authenticated;


--
-- Name: FUNCTION person_after_change(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.person_after_change() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.person_after_change() TO service_role;
GRANT ALL ON FUNCTION greendogops.person_after_change() TO authenticated;


--
-- Name: FUNCTION person_before_change(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.person_before_change() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.person_before_change() TO service_role;
GRANT ALL ON FUNCTION greendogops.person_before_change() TO authenticated;


--
-- Name: FUNCTION process_reporting_refresh(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.process_reporting_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.process_reporting_refresh() TO authenticated;
GRANT ALL ON FUNCTION greendogops.process_reporting_refresh() TO service_role;


--
-- Name: FUNCTION protect_new_objects(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.protect_new_objects() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.protect_new_objects() TO service_role;
GRANT ALL ON FUNCTION greendogops.protect_new_objects() TO authenticated;


--
-- Name: FUNCTION rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer) TO service_role;


--
-- Name: TABLE referral_partners; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_partners TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_partners TO service_role;


--
-- Name: FUNCTION recalculate_partner_metrics(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.recalculate_partner_metrics() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.recalculate_partner_metrics() TO authenticated;
GRANT ALL ON FUNCTION greendogops.recalculate_partner_metrics() TO service_role;


--
-- Name: FUNCTION recompute_referral_partner_totals(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.recompute_referral_partner_totals() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.recompute_referral_partner_totals() TO authenticated;
GRANT ALL ON FUNCTION greendogops.recompute_referral_partner_totals() TO service_role;


--
-- Name: FUNCTION record_qr_scan(p_token text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.record_qr_scan(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.record_qr_scan(p_token text) TO service_role;


--
-- Name: FUNCTION refresh_ezyvet_reporting(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.refresh_ezyvet_reporting() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.refresh_ezyvet_reporting() TO authenticated;
GRANT ALL ON FUNCTION greendogops.refresh_ezyvet_reporting() TO service_role;


--
-- Name: FUNCTION register_influencer_qr_code(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.register_influencer_qr_code() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.register_influencer_qr_code() TO service_role;
GRANT ALL ON FUNCTION greendogops.register_influencer_qr_code() TO authenticated;


--
-- Name: FUNCTION register_partner_qr_code(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.register_partner_qr_code() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.register_partner_qr_code() TO service_role;
GRANT ALL ON FUNCTION greendogops.register_partner_qr_code() TO authenticated;


--
-- Name: FUNCTION register_referral_qr_code(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.register_referral_qr_code() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.register_referral_qr_code() TO service_role;
GRANT ALL ON FUNCTION greendogops.register_referral_qr_code() TO authenticated;


--
-- Name: FUNCTION report_location_daily(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.report_location_daily(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.report_location_daily(p_start date, p_end date) TO service_role;
GRANT ALL ON FUNCTION greendogops.report_location_daily(p_start date, p_end date) TO authenticated;


--
-- Name: FUNCTION report_location_period(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.report_location_period(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.report_location_period(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.report_location_period(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION request_reporting_refresh(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.request_reporting_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.request_reporting_refresh() TO authenticated;
GRANT ALL ON FUNCTION greendogops.request_reporting_refresh() TO service_role;


--
-- Name: FUNCTION rls_audit(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.rls_audit() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.rls_audit() TO service_role;


--
-- Name: FUNCTION search_resource_content(p_query text, p_limit integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.search_resource_content(p_query text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.search_resource_content(p_query text, p_limit integer) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.set_updated_at() TO service_role;
GRANT ALL ON FUNCTION greendogops.set_updated_at() TO authenticated;


--
-- Name: FUNCTION smart_examples(p_question text, p_limit integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_examples(p_question text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_examples(p_question text, p_limit integer) TO service_role;


--
-- Name: FUNCTION smart_functions(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_functions() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_functions() TO service_role;


--
-- Name: FUNCTION smart_glossary_for(p_question text, p_limit integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_glossary_for(p_question text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_glossary_for(p_question text, p_limit integer) TO service_role;


--
-- Name: FUNCTION smart_query(p_sql text, p_limit integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_query(p_sql text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_query(p_sql text, p_limit integer) TO service_role;


--
-- Name: FUNCTION smart_schema(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_schema() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_schema() TO service_role;


--
-- Name: FUNCTION smart_value_hints(p_max_distinct integer); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.smart_value_hints(p_max_distinct integer) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.smart_value_hints(p_max_distinct integer) TO service_role;


--
-- Name: FUNCTION split_student_program(label text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.split_student_program(label text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.split_student_program(label text) TO service_role;
GRANT ALL ON FUNCTION greendogops.split_student_program(label text) TO authenticated;


--
-- Name: FUNCTION split_tag_list(p_list text); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.split_tag_list(p_list text) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.split_tag_list(p_list text) TO service_role;
GRANT ALL ON FUNCTION greendogops.split_tag_list(p_list text) TO authenticated;


--
-- Name: FUNCTION trg_request_reporting_refresh(); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.trg_request_reporting_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.trg_request_reporting_refresh() TO service_role;
GRANT ALL ON FUNCTION greendogops.trg_request_reporting_refresh() TO authenticated;


--
-- Name: FUNCTION undo_referral_upload(p_upload_id uuid); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.undo_referral_upload(p_upload_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.undo_referral_upload(p_upload_id uuid) TO authenticated;
GRANT ALL ON FUNCTION greendogops.undo_referral_upload(p_upload_id uuid) TO service_role;


--
-- Name: FUNCTION upcoming_appointment_demand(p_start date, p_end date); Type: ACL; Schema: greendogops; Owner: -
--

REVOKE ALL ON FUNCTION greendogops.upcoming_appointment_demand(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION greendogops.upcoming_appointment_demand(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION greendogops.upcoming_appointment_demand(p_start date, p_end date) TO service_role;


--
-- Name: TABLE agent; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent TO service_role;


--
-- Name: TABLE agent_report; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_report TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_report TO service_role;


--
-- Name: TABLE agent_run; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_run TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_run TO service_role;


--
-- Name: TABLE agent_run_log; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_run_log TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.agent_run_log TO service_role;


--
-- Name: TABLE app_setting; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.app_setting TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.app_setting TO service_role;


--
-- Name: TABLE app_user; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.app_user TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.app_user TO service_role;


--
-- Name: TABLE ats_hr_merge_backup_0032; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ats_hr_merge_backup_0032 TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ats_hr_merge_backup_0032 TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT ON TABLE greendogops.audit_log TO service_role;


--
-- Name: TABLE bizdev_appt_type; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.bizdev_appt_type TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.bizdev_appt_type TO service_role;


--
-- Name: TABLE bizdev_location_config; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.bizdev_location_config TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.bizdev_location_config TO service_role;


--
-- Name: TABLE calendar_event; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_event TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_event TO service_role;


--
-- Name: TABLE calendar_notification; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_notification TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_notification TO service_role;


--
-- Name: TABLE calendar_schedule_pin; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_schedule_pin TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_schedule_pin TO service_role;


--
-- Name: TABLE calendar_sync_state; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_sync_state TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.calendar_sync_state TO service_role;


--
-- Name: TABLE clinic_visits; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.clinic_visits TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.clinic_visits TO service_role;


--
-- Name: TABLE credential; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.credential TO service_role;


--
-- Name: TABLE crm_ce_attendance; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_ce_attendance TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_ce_attendance TO service_role;


--
-- Name: TABLE crm_ce_event; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_ce_event TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_ce_event TO service_role;


--
-- Name: TABLE crm_contact; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_contact TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_contact TO service_role;


--
-- Name: TABLE crm_contact_document; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_contact_document TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_contact_document TO service_role;


--
-- Name: TABLE crm_org_document; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_org_document TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_org_document TO service_role;


--
-- Name: TABLE crm_org_visit; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_org_visit TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_org_visit TO service_role;


--
-- Name: TABLE crm_organization; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_organization TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_organization TO service_role;


--
-- Name: TABLE crm_program_name; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_program_name TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_program_name TO service_role;


--
-- Name: TABLE crm_retail_lead; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_retail_lead TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.crm_retail_lead TO service_role;


--
-- Name: TABLE email_event; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.email_event TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.email_event TO service_role;


--
-- Name: TABLE email_template; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.email_template TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.email_template TO service_role;


--
-- Name: TABLE ezyvet_aged_receivable; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_aged_receivable TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_aged_receivable TO service_role;


--
-- Name: TABLE ezyvet_agenda_appt_snapshot; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_appt_snapshot TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_appt_snapshot TO service_role;


--
-- Name: TABLE ezyvet_agenda_count; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_count TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_count TO service_role;


--
-- Name: TABLE ezyvet_agenda_dept_map; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_dept_map TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_dept_map TO service_role;


--
-- Name: TABLE ezyvet_agenda_snapshot; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_snapshot TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_agenda_snapshot TO service_role;


--
-- Name: TABLE ezyvet_animal; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_animal TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_animal TO service_role;


--
-- Name: TABLE ezyvet_animal_import; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_animal_import TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_animal_import TO service_role;


--
-- Name: TABLE ezyvet_invoice_line; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_line TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_line TO service_role;


--
-- Name: TABLE ezyvet_appointment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment TO service_role;


--
-- Name: TABLE ezyvet_appointment_record; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_record TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_record TO service_role;


--
-- Name: TABLE ezyvet_appointment_status; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_status TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_status TO service_role;


--
-- Name: TABLE ezyvet_appointment_type_stat; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_type_stat TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appointment_type_stat TO service_role;


--
-- Name: TABLE ezyvet_appt_type_dept_map; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appt_type_dept_map TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_appt_type_dept_map TO service_role;


--
-- Name: TABLE ezyvet_cancelled_appointment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_cancelled_appointment TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_cancelled_appointment TO service_role;


--
-- Name: TABLE ezyvet_clinical_note; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_clinical_note TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_clinical_note TO service_role;


--
-- Name: TABLE ezyvet_consult_metric; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_consult_metric TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_consult_metric TO service_role;


--
-- Name: TABLE ezyvet_contact; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact TO service_role;


--
-- Name: TABLE ezyvet_contact_change; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact_change TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact_change TO service_role;


--
-- Name: TABLE ezyvet_contact_import; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact_import TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_contact_import TO service_role;


--
-- Name: TABLE ezyvet_controlled_drug; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_controlled_drug TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_controlled_drug TO service_role;


--
-- Name: TABLE ezyvet_customer_invoice_stat; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_customer_invoice_stat TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_customer_invoice_stat TO service_role;


--
-- Name: TABLE ezyvet_disabled_record; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_disabled_record TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_disabled_record TO service_role;


--
-- Name: TABLE ezyvet_end_of_day; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_end_of_day TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_end_of_day TO service_role;


--
-- Name: TABLE ezyvet_estimate; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_estimate TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_estimate TO service_role;


--
-- Name: TABLE ezyvet_expired_inventory; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_expired_inventory TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_expired_inventory TO service_role;


--
-- Name: TABLE ezyvet_expiring_inventory; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_expiring_inventory TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_expiring_inventory TO service_role;


--
-- Name: TABLE ezyvet_inventory_ordering; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_ordering TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_ordering TO service_role;


--
-- Name: TABLE ezyvet_inventory_transfer; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_transfer TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_transfer TO service_role;


--
-- Name: TABLE ezyvet_inventory_value; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_value TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_inventory_value TO service_role;


--
-- Name: TABLE ezyvet_invoice_import; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_import TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_import TO service_role;


--
-- Name: TABLE ezyvet_invoice_summary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_summary TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_invoice_summary TO service_role;


--
-- Name: TABLE ezyvet_payment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_payment TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_payment TO service_role;


--
-- Name: TABLE ezyvet_payment_allocation; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_payment_allocation TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_payment_allocation TO service_role;


--
-- Name: TABLE ezyvet_product; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product TO service_role;


--
-- Name: TABLE ezyvet_product_import; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product_import TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product_import TO service_role;


--
-- Name: TABLE ezyvet_product_price; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product_price TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_product_price TO service_role;


--
-- Name: TABLE ezyvet_purchase; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_purchase TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_purchase TO service_role;


--
-- Name: TABLE ezyvet_record_tag; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_record_tag TO service_role;


--
-- Name: TABLE ezyvet_record_tag_run; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_record_tag_run TO service_role;


--
-- Name: TABLE ezyvet_soc_overdue; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_soc_overdue TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_soc_overdue TO service_role;


--
-- Name: TABLE ezyvet_staff_sale; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_staff_sale TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_staff_sale TO service_role;


--
-- Name: TABLE ezyvet_tag; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_tag TO service_role;


--
-- Name: TABLE ezyvet_taxable_sales; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_taxable_sales TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_taxable_sales TO service_role;


--
-- Name: TABLE ezyvet_unapplied_payment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_unapplied_payment TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_unapplied_payment TO service_role;


--
-- Name: TABLE ezyvet_unbilled_consult; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_unbilled_consult TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_unbilled_consult TO service_role;


--
-- Name: TABLE ezyvet_vaccination; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_vaccination TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_vaccination TO service_role;


--
-- Name: TABLE ezyvet_wellness_plan_use; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_wellness_plan_use TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ezyvet_wellness_plan_use TO service_role;


--
-- Name: TABLE interview_invite; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.interview_invite TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.interview_invite TO service_role;


--
-- Name: TABLE location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.location TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.location TO service_role;


--
-- Name: TABLE marketing_activity; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_activity TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_activity TO service_role;


--
-- Name: TABLE marketing_budget_entry; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_budget_entry TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_budget_entry TO service_role;


--
-- Name: TABLE marketing_budget_period; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_budget_period TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_budget_period TO service_role;


--
-- Name: TABLE marketing_event; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event TO service_role;


--
-- Name: TABLE marketing_event_attendee; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event_attendee TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event_attendee TO service_role;


--
-- Name: TABLE marketing_event_source; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event_source TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_event_source TO service_role;


--
-- Name: TABLE marketing_goal; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_goal TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_goal TO service_role;


--
-- Name: TABLE marketing_influencers; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_influencers TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_influencers TO service_role;


--
-- Name: TABLE marketing_initiative; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_initiative TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_initiative TO service_role;


--
-- Name: TABLE marketing_promotion; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_promotion TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_promotion TO service_role;


--
-- Name: TABLE marketing_resource; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_resource TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_resource TO service_role;


--
-- Name: TABLE marketing_tree_node; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_tree_node TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.marketing_tree_node TO service_role;


--
-- Name: TABLE medical_board_day; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_day TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_day TO service_role;


--
-- Name: TABLE medical_board_row; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_row TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_row TO service_role;


--
-- Name: TABLE medical_board_type; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_type TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.medical_board_type TO service_role;


--
-- Name: TABLE notification_delivery; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.notification_delivery TO service_role;


--
-- Name: TABLE ops_task; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.ops_task TO service_role;


--
-- Name: TABLE partner_contacts; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.partner_contacts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.partner_contacts TO service_role;


--
-- Name: TABLE partner_notes; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.partner_notes TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.partner_notes TO service_role;


--
-- Name: TABLE person; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person TO service_role;


--
-- Name: TABLE person_asset; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_asset TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_asset TO service_role;


--
-- Name: TABLE person_compliance_entry; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_compliance_entry TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_compliance_entry TO service_role;


--
-- Name: TABLE person_disciplinary_action; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_disciplinary_action TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_disciplinary_action TO service_role;


--
-- Name: TABLE person_document; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_document TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_document TO service_role;


--
-- Name: TABLE person_employment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT DELETE ON TABLE greendogops.person_employment TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_employment TO service_role;


--
-- Name: COLUMN person_employment.person_id; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(person_id),INSERT(person_id),UPDATE(person_id) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.position_id; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(position_id),INSERT(position_id),UPDATE(position_id) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.location_id; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(location_id),INSERT(location_id),UPDATE(location_id) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.offer_title; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(offer_title),INSERT(offer_title),UPDATE(offer_title) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.adp_job_title; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(adp_job_title),INSERT(adp_job_title),UPDATE(adp_job_title) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.flsa_status; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(flsa_status),INSERT(flsa_status),UPDATE(flsa_status) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.work_schedule; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(work_schedule),INSERT(work_schedule),UPDATE(work_schedule) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.days_per_week; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(days_per_week),INSERT(days_per_week),UPDATE(days_per_week) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.hire_date; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(hire_date),INSERT(hire_date),UPDATE(hire_date) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.original_hire_date; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(original_hire_date),INSERT(original_hire_date),UPDATE(original_hire_date) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.pto_allotment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(pto_allotment),INSERT(pto_allotment),UPDATE(pto_allotment) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.pto_policy_allotment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(pto_policy_allotment),INSERT(pto_policy_allotment),UPDATE(pto_policy_allotment) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.pto_used; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(pto_used),INSERT(pto_used),UPDATE(pto_used) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.pto_available; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(pto_available),INSERT(pto_available),UPDATE(pto_available) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.pto_notes; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(pto_notes),INSERT(pto_notes),UPDATE(pto_notes) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.compliance; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(compliance),INSERT(compliance),UPDATE(compliance) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.separation_date; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(separation_date),INSERT(separation_date),UPDATE(separation_date) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.separation_type; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(separation_type),INSERT(separation_type),UPDATE(separation_type) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.separation_letter_signed; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(separation_letter_signed),INSERT(separation_letter_signed),UPDATE(separation_letter_signed) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.separation_notes; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(separation_notes),INSERT(separation_notes),UPDATE(separation_notes) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.created_at; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(created_at),INSERT(created_at),UPDATE(created_at) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.updated_at; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(updated_at),INSERT(updated_at),UPDATE(updated_at) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.schedule_type; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(schedule_type),INSERT(schedule_type),UPDATE(schedule_type) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: COLUMN person_employment.preferred_location_id; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT(preferred_location_id),INSERT(preferred_location_id),UPDATE(preferred_location_id) ON TABLE greendogops.person_employment TO authenticated;


--
-- Name: TABLE person_interview; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_interview TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_interview TO service_role;


--
-- Name: TABLE person_license; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_license TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_license TO service_role;


--
-- Name: TABLE person_onboarding_item; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_onboarding_item TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_onboarding_item TO service_role;


--
-- Name: TABLE person_pto_day; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_pto_day TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_pto_day TO service_role;


--
-- Name: TABLE person_recruiting; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_recruiting TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_recruiting TO service_role;


--
-- Name: TABLE person_recruiting_cleanup_0220; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_recruiting_cleanup_0220 TO service_role;


--
-- Name: TABLE person_recruiting_score_backup_0225; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_recruiting_score_backup_0225 TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_recruiting_score_backup_0225 TO service_role;


--
-- Name: TABLE person_review; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_review TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_review TO service_role;


--
-- Name: TABLE person_slack_link; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_slack_link TO service_role;


--
-- Name: TABLE person_time_off; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_time_off TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.person_time_off TO service_role;


--
-- Name: TABLE planning_capacity_rule; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_capacity_rule TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_capacity_rule TO service_role;


--
-- Name: TABLE planning_guide; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide TO service_role;


--
-- Name: TABLE planning_guide_column; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide_column TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide_column TO service_role;


--
-- Name: TABLE planning_guide_slot; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide_slot TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.planning_guide_slot TO service_role;


--
-- Name: TABLE "position"; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops."position" TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops."position" TO service_role;


--
-- Name: TABLE profile_transition_log; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.profile_transition_log TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.profile_transition_log TO service_role;


--
-- Name: TABLE qr_code; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_code TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_code TO service_role;


--
-- Name: TABLE qr_form; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_form TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_form TO service_role;


--
-- Name: TABLE qr_lead; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_lead TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.qr_lead TO service_role;


--
-- Name: TABLE rate_limit_bucket; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.rate_limit_bucket TO service_role;


--
-- Name: TABLE recruiter_google_token; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiter_google_token TO service_role;


--
-- Name: TABLE recruiter_schedule; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiter_schedule TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiter_schedule TO service_role;


--
-- Name: TABLE recruiting_activity; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_activity TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_activity TO service_role;


--
-- Name: TABLE recruiting_email_template; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_email_template TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_email_template TO service_role;


--
-- Name: TABLE recruiting_form; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form TO service_role;


--
-- Name: TABLE recruiting_form_request; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form_request TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form_request TO service_role;


--
-- Name: TABLE recruiting_form_response; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form_response TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_form_response TO service_role;


--
-- Name: TABLE recruiting_rejection; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_rejection TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_rejection TO service_role;


--
-- Name: TABLE recruiting_score_change; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_score_change TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_score_change TO service_role;


--
-- Name: TABLE recruiting_task; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_task TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.recruiting_task TO service_role;


--
-- Name: TABLE referral_revenue_line_items; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_revenue_line_items TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_revenue_line_items TO service_role;


--
-- Name: TABLE referral_sync_history; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_sync_history TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.referral_sync_history TO service_role;


--
-- Name: TABLE reminder_ack; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.reminder_ack TO service_role;


--
-- Name: TABLE reminder_rule; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.reminder_rule TO service_role;


--
-- Name: TABLE report_animal_summary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_animal_summary TO service_role;


--
-- Name: TABLE report_animals_by_species; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_animals_by_species TO service_role;


--
-- Name: TABLE report_appointment_detail; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_appointment_detail TO service_role;


--
-- Name: TABLE report_appointment_flow; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_appointment_flow TO service_role;


--
-- Name: TABLE report_appointment_type_by_species; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_appointment_type_by_species TO service_role;


--
-- Name: TABLE report_appointment_type_volume; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_appointment_type_volume TO service_role;


--
-- Name: TABLE report_ar_aging_current; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_ar_aging_current TO service_role;


--
-- Name: TABLE report_ar_aging_trend; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_ar_aging_trend TO service_role;


--
-- Name: TABLE report_by_case_owner; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_by_case_owner TO service_role;


--
-- Name: TABLE report_by_location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_by_location TO service_role;


--
-- Name: TABLE report_by_species; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_by_species TO service_role;


--
-- Name: TABLE report_by_staff; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_by_staff TO service_role;


--
-- Name: TABLE report_capacity_override; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_capacity_override TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_capacity_override TO service_role;


--
-- Name: TABLE report_capacity_target; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_capacity_target TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_capacity_target TO service_role;


--
-- Name: TABLE report_case_owner_by_month; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_case_owner_by_month TO service_role;


--
-- Name: TABLE report_case_owner_product; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_case_owner_product TO service_role;


--
-- Name: TABLE report_case_owner_product_group; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_case_owner_product_group TO service_role;


--
-- Name: TABLE report_client_summary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_client_summary TO service_role;


--
-- Name: TABLE report_clients_by_division; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clients_by_division TO service_role;


--
-- Name: TABLE report_clients_by_group; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clients_by_group TO service_role;


--
-- Name: TABLE report_clients_by_month; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clients_by_month TO service_role;


--
-- Name: TABLE report_clients_by_recency; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clients_by_recency TO service_role;


--
-- Name: TABLE report_clients_by_recency_location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clients_by_recency_location TO service_role;


--
-- Name: TABLE report_clinical_note_backlog; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_clinical_note_backlog TO service_role;


--
-- Name: TABLE report_record_tag_current; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_record_tag_current TO service_role;


--
-- Name: TABLE report_contact_tag; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_contact_tag TO service_role;


--
-- Name: TABLE report_contact_tag_summary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_contact_tag_summary TO service_role;


--
-- Name: TABLE report_daily_collections; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_daily_collections TO service_role;


--
-- Name: TABLE sched_assignment; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_assignment TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_assignment TO service_role;


--
-- Name: TABLE sched_department; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_department TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_department TO service_role;


--
-- Name: TABLE sched_role; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_role TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_role TO service_role;


--
-- Name: TABLE sched_week; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week TO service_role;


--
-- Name: TABLE sched_week_line; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week_line TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week_line TO service_role;


--
-- Name: TABLE report_dvm_by_dept; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_dvm_by_dept TO service_role;


--
-- Name: TABLE report_estimate_conversion; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_estimate_conversion TO service_role;


--
-- Name: TABLE report_inventory_on_hand; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_inventory_on_hand TO service_role;


--
-- Name: TABLE report_inventory_value_trend; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_inventory_value_trend TO service_role;


--
-- Name: TABLE report_location_monthly; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_location_monthly TO service_role;


--
-- Name: TABLE report_monthly; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_monthly TO service_role;


--
-- Name: TABLE report_new_clients_by_location_month; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_new_clients_by_location_month TO service_role;


--
-- Name: TABLE report_overview; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_overview TO service_role;


--
-- Name: TABLE report_patients_by_species; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_patients_by_species TO service_role;


--
-- Name: TABLE report_product_by_location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_product_by_location TO service_role;


--
-- Name: TABLE report_product_price_list; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_product_price_list TO service_role;


--
-- Name: TABLE report_product_summary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_product_summary TO service_role;


--
-- Name: TABLE report_products_by_group; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_products_by_group TO service_role;


--
-- Name: TABLE report_record_tag_runs; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_record_tag_runs TO service_role;


--
-- Name: TABLE report_reorder_list; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_reorder_list TO service_role;


--
-- Name: TABLE report_soc_overdue_current; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_soc_overdue_current TO service_role;


--
-- Name: TABLE report_species_by_recency; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_species_by_recency TO service_role;


--
-- Name: TABLE report_staff_by_location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_staff_by_location TO service_role;


--
-- Name: TABLE report_staff_product; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_staff_product TO service_role;


--
-- Name: TABLE report_staff_product_group; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_staff_product_group TO service_role;


--
-- Name: TABLE report_top_product; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_top_product TO service_role;


--
-- Name: TABLE report_top_product_group; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_top_product_group TO service_role;


--
-- Name: TABLE report_unbilled_consults_current; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_unbilled_consults_current TO service_role;


--
-- Name: TABLE report_wellness_plan_current; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_wellness_plan_current TO service_role;


--
-- Name: TABLE report_years; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.report_years TO service_role;


--
-- Name: TABLE reporting_refresh_state; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.reporting_refresh_state TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.reporting_refresh_state TO service_role;


--
-- Name: TABLE resource_category; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_category TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_category TO service_role;


--
-- Name: TABLE resource_document; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_document TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_document TO service_role;


--
-- Name: TABLE resource_document_chunk; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_document_chunk TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.resource_document_chunk TO service_role;


--
-- Name: SEQUENCE resource_document_chunk_id_seq; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE greendogops.resource_document_chunk_id_seq TO authenticated;
GRANT SELECT,USAGE ON SEQUENCE greendogops.resource_document_chunk_id_seq TO service_role;


--
-- Name: TABLE sched_change_log; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_change_log TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_change_log TO service_role;


--
-- Name: TABLE sched_closure; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_closure TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_closure TO service_role;


--
-- Name: TABLE sched_employee_setting; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_employee_setting TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_employee_setting TO service_role;


--
-- Name: TABLE sched_event; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_event TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_event TO service_role;


--
-- Name: TABLE sched_role_member; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_role_member TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_role_member TO service_role;


--
-- Name: TABLE sched_shift_template; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_shift_template TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_shift_template TO service_role;


--
-- Name: TABLE sched_week_location; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week_location TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sched_week_location TO service_role;


--
-- Name: TABLE sheet_sync_issue; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sheet_sync_issue TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sheet_sync_issue TO service_role;


--
-- Name: TABLE sheet_sync_source; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sheet_sync_source TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sheet_sync_source TO service_role;


--
-- Name: TABLE smart_glossary; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.smart_glossary TO service_role;


--
-- Name: TABLE smart_question_log; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.smart_question_log TO service_role;


--
-- Name: TABLE sms_consent; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sms_consent TO service_role;


--
-- Name: TABLE sms_message; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sms_message TO service_role;


--
-- Name: TABLE sms_opt_out; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.sms_opt_out TO service_role;


--
-- Name: TABLE user_notification; Type: ACL; Schema: greendogops; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE greendogops.user_notification TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: greendogops; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA greendogops GRANT SELECT,USAGE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA greendogops GRANT SELECT,USAGE ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: greendogops; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA greendogops GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA greendogops GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


