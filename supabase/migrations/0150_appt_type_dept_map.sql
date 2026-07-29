-- ============================================================================
-- Green Dog Ops — 0150 Appointment type → schedule department map
-- ----------------------------------------------------------------------------
-- The ezyVet Agenda demand overlay attributes booked appointments to a schedule
-- department using the RESOURCE calendar they sit on (ezyvet_agenda_dept_map).
-- But the appointment TYPE is the truer signal of which team renders it: e.g.
-- "GDD (New)" and "GDD (Returning)" are both NAD/VE/UC appointments regardless
-- of which calendar they were booked on.
--
-- ezyvet_appt_type_dept_map lets the schedule admin assign each appointment type
-- to a department (managed on the Schedule ▸ Set Up ▸ Planning Guide Setup tab).
-- At ingest time a type's mapping takes precedence over the resource mapping; a
-- type left unassigned (NULL department) falls back to the resource mapping, so
-- there is no behaviour change until a department is chosen.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.ezyvet_appt_type_dept_map (
  id            uuid primary key default gen_random_uuid(),
  appt_type     text not null unique,
  department_id uuid references greendogops.sched_department (id) on delete set null,
  is_ignored    boolean not null default false,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.ezyvet_appt_type_dept_map;
create trigger set_updated_at before update on greendogops.ezyvet_appt_type_dept_map
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed the catalog from every appointment type seen in the Agenda snapshot,
-- with a best-effort department guess. Ambiguous / non-appointment tokens are
-- left unassigned (NULL) for the admin to resolve. CASE is evaluated top-down,
-- so the more specific AP / Surgery / IM / Exotics / Cardio rules win before the
-- broad NAD/VE/UC catch-all.
-- ---------------------------------------------------------------------------
with types as (
  select distinct btrim(appt_type) as appt_type
  from greendogops.ezyvet_agenda_appt_snapshot
  where appt_type is not null and btrim(appt_type) <> ''
),
dep as (
  select name, id from greendogops.sched_department
)
insert into greendogops.ezyvet_appt_type_dept_map (appt_type, department_id)
select t.appt_type,
       case
         when t.appt_type ilike '%advanced procedure%'
           or t.appt_type ilike '%post ap%'
           or t.appt_type ilike '%same day ap%'   then (select id from dep where name = 'AP')
         when t.appt_type ilike '%surgery%'        then (select id from dep where name = 'SURGERY')
         when t.appt_type ilike 'im -%'
           or t.appt_type ilike '%internal med%'   then (select id from dep where name = 'IM')
         when t.appt_type ilike 'ex -%'
           or t.appt_type ilike '%exotic%'         then (select id from dep where name = 'EXOTICS')
         when t.appt_type ilike '%cardiolog%'      then (select id from dep where name = 'CARDIO')
         when t.appt_type ilike '%gdd%'
           or t.appt_type ilike '%veterinary exam%'
           or t.appt_type ilike '%oral exam%'
           or t.appt_type ilike 'oe %'
           or t.appt_type ilike '%urgent care%'
           or t.appt_type ilike '%neat%'
           or t.appt_type ilike '%bloodwork%'
           or t.appt_type ilike '%dr call back%'
           or t.appt_type ilike '%drop off%'
           or t.appt_type ilike '%tech services%'
           or t.appt_type ilike '%vetfm%'
           or t.appt_type ilike '%nad%'            then (select id from dep where name = 'NAD/VE/UC')
         else null
       end
from types t
on conflict (appt_type) do nothing;

-- ---------------------------------------------------------------------------
-- appt_type_observed_counts() — how often each appointment type appears in the
-- booked-appointment snapshot, so the setup tab can order by real popularity.
-- ---------------------------------------------------------------------------
create or replace function greendogops.appt_type_observed_counts()
returns table (appt_type text, observed_count bigint)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  select btrim(appt_type) as appt_type, count(*)::bigint
  from greendogops.ezyvet_agenda_appt_snapshot
  where appt_type is not null and btrim(appt_type) <> ''
  group by btrim(appt_type)
$$;

grant execute on function greendogops.appt_type_observed_counts()
  to authenticated, service_role;
