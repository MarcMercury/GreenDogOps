-- ============================================================================
-- Green Dog Ops — 0189 Daily Google Sheet sync
-- ----------------------------------------------------------------------------
-- Until now every spreadsheet source of truth (HR "Merit Increase Calculator",
-- "GDD Staff Schedule 2026", "Christinas Western Grid - Students
-- Comprehensive") was only pulled when a human ran a script by hand. This adds
-- the control plane for a nightly pull:
--
--   * sheet_sync_source — one row per connected workbook: its id, whether it is
--     enabled, and the Drive modifiedTime / summary of the last successful run
--     so an unchanged workbook can be skipped.
--   * sheet_sync_issue  — the review queue. The syncs apply the changes that
--     are provably safe and file everything ambiguous here (someone active in
--     the DB but on NEITHER HR tab, a GRID NAME that belongs to another
--     employee, a schedule name that matches nobody...) instead of guessing.
--
-- Two apply functions carry the logic that previously lived in the generated
-- SQL of scripts/import_students.py and scripts/import_sheet_dvm.mjs, so the
-- multi-statement reconciliation still runs in a single transaction when it is
-- driven from the app.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- sheet_sync_source : a connected workbook.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sheet_sync_source (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique,        -- 'hr_roster' | 'staff_schedule' | 'student_grid'
  name               text not null,
  description        text,
  spreadsheet_id     text not null,
  spreadsheet_url    text,
  enabled            boolean not null default true,
  -- Per-source knobs (tab names, how many months ahead to read, ...).
  config             jsonb not null default '{}'::jsonb,
  -- Drive modifiedTime observed on the last successful read. A run whose
  -- modifiedTime matches this is a no-op unless forced.
  last_modified_time timestamptz,
  last_synced_at     timestamptz,
  last_status        text,                        -- 'success' | 'error' | 'skipped'
  last_error         text,
  last_summary       jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.sheet_sync_source;
create trigger set_updated_at before update on greendogops.sheet_sync_source
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.sheet_sync_source to authenticated, service_role;

comment on table greendogops.sheet_sync_source is
  'Google Sheets / workbooks pulled automatically every night by the sheet sync agents.';

-- ---------------------------------------------------------------------------
-- sheet_sync_issue : anything the sync refused to decide on its own.
-- Keyed by (source, kind, subject) so a recurring problem updates in place
-- rather than piling up a new row every night.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.sheet_sync_issue (
  id                uuid primary key default gen_random_uuid(),
  source_key        text not null,
  run_id            uuid references greendogops.agent_run (id) on delete set null,
  kind              text not null,
  subject           text not null,
  detail            jsonb not null default '{}'::jsonb,
  status            text not null default 'open'
                      check (status in ('open', 'resolved', 'ignored')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by_email text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (source_key, kind, subject)
);

create index if not exists sheet_sync_issue_open_idx
  on greendogops.sheet_sync_issue (source_key, status, last_seen_at desc);

drop trigger if exists set_updated_at on greendogops.sheet_sync_issue;
create trigger set_updated_at before update on greendogops.sheet_sync_issue
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.sheet_sync_issue to authenticated, service_role;

comment on table greendogops.sheet_sync_issue is
  'Review queue for spreadsheet rows the nightly sync would not apply automatically.';

-- ---------------------------------------------------------------------------
-- Register the three workbooks.
-- ---------------------------------------------------------------------------
insert into greendogops.sheet_sync_source
  (key, name, description, spreadsheet_id, spreadsheet_url, config)
values
  ('hr_roster',
   'HR Roster — Merit Increase Calculator',
   'Source of truth for current/former staff, titles, wages, PTO and CE budgets.',
   '1KpTMcNM9m1P7u9qCVzob8p1-RZoC1ejaYs5CdpAbWFY',
   'https://docs.google.com/spreadsheets/d/1KpTMcNM9m1P7u9qCVzob8p1-RZoC1ejaYs5CdpAbWFY/edit',
   jsonb_build_object('current_tab', '2026 EMP PROFILE DATA', 'former_tab', 'Former Employees')),
  ('staff_schedule',
   'GDD Staff Schedule 2026',
   'Weekly DVM placements by location. Published weeks are never overwritten.',
   '18DvLbxmzT-mmyaCRUW2xbzRxG4-HNPJS8rbUHZdNXdU',
   'https://docs.google.com/spreadsheets/d/18DvLbxmzT-mmyaCRUW2xbzRxG4-HNPJS8rbUHZdNXdU/edit',
   jsonb_build_object('months_ahead', 1)),
  ('student_grid',
   'Christinas Western Grid — Students Comprehensive',
   'Externship / rotation / SAP student roster feeding the Student CRM.',
   '1blKZca422PVxwSoLO3Ddayd9nA-QRPfWcJRf4t8d2KM',
   'https://docs.google.com/spreadsheets/d/1blKZca422PVxwSoLO3Ddayd9nA-QRPfWcJRf4t8d2KM/edit',
   jsonb_build_object('year_tabs', jsonb_build_array('2025', '2026', '2027', 'HIRE 2025', 'WE WANT TO HIRE 2025')))
on conflict (key) do update set
  name            = excluded.name,
  description     = excluded.description,
  spreadsheet_id  = excluded.spreadsheet_id,
  spreadsheet_url = excluded.spreadsheet_url,
  config          = greendogops.sheet_sync_source.config || excluded.config;

-- ---------------------------------------------------------------------------
-- Register the agent so the sync shows up in Admin ▸ Agents with history and a
-- "Run now" button. `runner: inline` marks it as running inside the app rather
-- than on the off-Vercel browser worker.
-- ---------------------------------------------------------------------------
insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values (
  'sheet_daily_sync',
  'Spreadsheet Daily Sync',
  'Reads the connected Google Sheets (HR roster, staff schedule, student grid) every morning, applies the safe changes, and files anything ambiguous in the review queue.',
  'ingest',
  '45 5 * * *',
  'America/Los_Angeles',
  jsonb_build_object('runner', 'inline', 'endpoint', '/api/agents/sheets/sync')
)
on conflict (key) do update set
  description   = excluded.description,
  schedule_cron = excluded.schedule_cron,
  config        = greendogops.agent.config || excluded.config;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, r.key, r.name, 'global', r.description, r.target, r.sort_order
from greendogops.agent a
cross join (values
  ('hr_roster',      'HR Roster',       'Hires, separations, titles, wages, PTO and CE from the Merit Increase Calculator.', 'person + person_employment', 10),
  ('staff_schedule', 'Staff Schedule',  'DVM placements for the current and next month.',                                    'sched_assignment',           20),
  ('student_grid',   'Student Grid',    'Externship / rotation students.',                                                   'crm_contact (student)',      30)
) as r(key, name, description, target, sort_order)
where a.key = 'sheet_daily_sync'
on conflict (agent_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- normalize_person_key(text) — comparison key for a display name: drop
-- parenthetical nicknames, honorifics and punctuation. Every sync path matches
-- people through this so they all agree on identity.
-- ---------------------------------------------------------------------------
create or replace function greendogops.normalize_person_key(t text)
returns text
language sql
immutable
set search_path = greendogops, public
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '\([^)]*\)', ' ', 'g'),
        '\mdr\.?\M', ' ', 'g'),
      '[^a-z ]', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- apply_student_grid(payload) — staging + match + enrich + insert, in one
-- transaction. Port of the SQL generated by scripts/import_students.py.
--
-- payload: [{ full_name, first_name, last_name, email, location, program_type,
--             supervising_dvm, weekday_schedule, doc_recommendation,
--             hire_interest, grad_year, stipend, start_date, end_date,
--             completed, stipend_paid, check_cashed, notes, eligible }]
-- ---------------------------------------------------------------------------
create or replace function greendogops.apply_student_grid(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = greendogops, public
as $$
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

comment on function greendogops.apply_student_grid(jsonb) is
  'Reconcile parsed student-grid rows into crm_contact: enrich matches, insert the rest.';

-- ---------------------------------------------------------------------------
-- apply_sheet_dvm_assignments(payload) — load DVM placements from the staff
-- schedule sheet. Port of scripts/import_sheet_dvm.mjs: idempotent per week,
-- and a week that is already published is skipped so a hand-built week is
-- never overwritten.
--
-- payload: [{ week_start, work_date, day_of_week, dept, second, location,
--             person_id }]
-- ---------------------------------------------------------------------------
create or replace function greendogops.apply_sheet_dvm_assignments(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = greendogops, public
as $$
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

comment on function greendogops.apply_sheet_dvm_assignments(jsonb) is
  'Load DVM placements from the staff schedule sheet; skips published weeks.';

grant execute on function greendogops.apply_student_grid(jsonb) to service_role;
grant execute on function greendogops.apply_sheet_dvm_assignments(jsonb) to service_role;
grant execute on function greendogops.normalize_person_key(text) to authenticated, service_role;
