-- ============================================================================
-- Green Dog Ops — 0076 DVM production by department
-- ----------------------------------------------------------------------------
-- "How does each doctor perform in each department they actually work in?"
--
-- The published schedule is the source of truth for WHERE a doctor worked on a
-- given day (their department), and the ezyVet invoices are the source of truth
-- for their PRODUCTION that day (Case Owner revenue + appointments). This
-- matview joins the two on (doctor, service date):
--
--   1. dvm_days   — one row per (published DVM assignment) person + work_date +
--                   department. Only weeks with status='published' count, and
--                   only the DVM role within each department.
--   2. day_weights— how many distinct departments a doctor was scheduled in on
--                   a day. On the rare day a doctor splits across departments,
--                   that day's production is divided evenly between them so no
--                   revenue is double-counted.
--   3. inv        — that day's invoice production for each Case Owner (revenue +
--                   distinct appointment-eligible clients).
--
-- Doctor <-> Case Owner matching is by name tokens (surname/first name), which
-- tolerates the small differences between the schedule's person names and the
-- ezyVet Case Owner strings (e.g. "Dr. Garcia" ⇄ "Dr. Ren Garcia",
-- "Dr. Heather Rally Webb" ⇄ "Dr. Heather Rally"). See name_tokens() below.
--
-- Refreshed automatically by refresh_ezyvet_reporting() (migration 0054 auto-
-- discovers every matview in the schema) on each invoice upload/delete/reset.
-- Because it also reads the schedule, re-publishing a schedule for a past month
-- won't be reflected until the next invoice refresh (or a manual RPC call).
-- ============================================================================
set search_path = greendogops, public;

-- Immutable name-token helper: lowercases, drops a leading "Dr." honorific,
-- strips punctuation, and returns the remaining words. Used on both sides of
-- the doctor<->case-owner join so a subset match (one name's tokens contained
-- in the other's) links records despite minor naming differences.
create or replace function greendogops.name_tokens(raw text)
returns text[]
language sql
immutable
as $$
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

drop materialized view if exists greendogops.report_dvm_by_dept cascade;
create materialized view greendogops.report_dvm_by_dept as
with dvm_days as (
  select
    a.person_id,
    p.full_name,
    a.work_date,
    wl.department_id,
    d.name       as department_name,
    d.color      as department_color,
    d.sort_order as department_sort
  from greendogops.sched_assignment a
  join greendogops.sched_week w        on w.id = a.week_id and w.status = 'published'
  join greendogops.sched_week_line wl  on wl.id = a.line_id
  join greendogops.sched_department d  on d.id = wl.department_id
  join greendogops.sched_role r        on r.id = wl.role_id and r.name ilike '%dvm%'
  join greendogops.person p            on p.id = a.person_id
  where a.removed_post_publish = false
  group by a.person_id, p.full_name, a.work_date,
           wl.department_id, d.name, d.color, d.sort_order
),
day_weights as (
  select person_id, work_date, count(*)::numeric as dept_count
  from dvm_days
  group by person_id, work_date
),
dvm_people as (
  select distinct
    person_id,
    full_name,
    greendogops.name_tokens(full_name) as tok
  from dvm_days
),
inv as (
  select
    case_owner,
    line_date,
    greendogops.name_tokens(case_owner) as tok,
    coalesce(sum(total_incl), 0)        as revenue,
    count(distinct client_contact_code) filter (
      where greendogops.is_appt_line(product_name, product_group)
    )                                   as appointments
  from greendogops.ezyvet_invoice_line
  where case_owner is not null and case_owner <> '' and line_date is not null
  group by case_owner, line_date
)
select
  extract(year from dd.work_date)::int              as year,
  dd.full_name                                      as doctor,
  dd.department_name,
  dd.department_color,
  dd.department_sort,
  count(distinct dd.work_date)::int                 as days_worked,
  round(sum(inv.appointments / dw.dept_count))::int as appointments,
  round(sum(inv.revenue / dw.dept_count), 2)        as revenue
from dvm_days dd
join day_weights dw on dw.person_id = dd.person_id and dw.work_date = dd.work_date
join dvm_people dp  on dp.person_id = dd.person_id
join inv            on inv.line_date = dd.work_date
                   and (dp.tok <@ inv.tok or inv.tok <@ dp.tok)
group by 1, 2, 3, 4, 5
with data;

create index idx_rdbd_year on greendogops.report_dvm_by_dept (year, doctor);

grant select on greendogops.report_dvm_by_dept to authenticated, service_role;

-- Populate immediately (and refresh siblings) so the new tab has data at once.
select greendogops.refresh_ezyvet_reporting();
