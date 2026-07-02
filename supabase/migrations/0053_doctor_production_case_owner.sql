-- ============================================================================
-- Green Dog Ops — 0053 Doctor production by Case Owner
-- ----------------------------------------------------------------------------
-- The "Doctors by production" table (and its drill-down) should attribute
-- revenue, lines, and appointments to the case-owning doctor (ezyVet Case
-- Owner), not the Staff Member on each line. Support-staff production stays on
-- report_by_staff (staff_member). These new matviews mirror report_by_staff /
-- report_staff_product / report_staff_product_group but keyed by case_owner.
--
-- Appointments = distinct (client + day) among the case owner's non
-- deposit/refund lines, matching the appointment rule in migration 0050.
--
-- NOTE: case_owner is only populated for lines imported since 0051 (2026
-- Jan-May backfilled). Months without case_owner are excluded here.
-- ============================================================================
set search_path = greendogops, public;

drop materialized view if exists greendogops.report_by_case_owner cascade;
create materialized view greendogops.report_by_case_owner as
select
  extract(year from line_date)::int                                      as year,
  case_owner                                                             as staff_member,
  true                                                                   as is_vet,
  count(*)::int                                                          as line_count,
  count(distinct (client_contact_code || '|' || line_date::text)) filter (
    where lower(coalesce(product_name, '')) not like '%deposit%'
      and lower(coalesce(product_name, '')) not like '%refund%'
  )::int                                                                 as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where case_owner is not null and case_owner <> '' and line_date is not null
group by 1, 2
with data;
create index idx_rbco_year on greendogops.report_by_case_owner (year);

drop materialized view if exists greendogops.report_case_owner_product cascade;
create materialized view greendogops.report_case_owner_product as
select
  extract(year from line_date)::int                    as year,
  case_owner                                           as staff_member,
  coalesce(nullif(product_name, ''), 'Unnamed')        as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(qty), 0)                                as qty,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where case_owner is not null and case_owner <> '' and line_date is not null
group by 1, 2, 3, 4
with data;
create index idx_rcop_year_owner on greendogops.report_case_owner_product (year, staff_member);

drop materialized view if exists greendogops.report_case_owner_product_group cascade;
create materialized view greendogops.report_case_owner_product_group as
select
  extract(year from line_date)::int                    as year,
  case_owner                                           as staff_member,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where case_owner is not null and case_owner <> '' and line_date is not null
group by 1, 2, 3
with data;
create index idx_rcopg_year_owner on greendogops.report_case_owner_product_group (year, staff_member);

grant select on
  greendogops.report_by_case_owner,
  greendogops.report_case_owner_product,
  greendogops.report_case_owner_product_group
to authenticated, service_role;

-- Add the new matviews to the reporting refresh routine.
create or replace function greendogops.refresh_ezyvet_reporting()
returns void
language plpgsql
security definer
set search_path = greendogops
as $$
begin
  refresh materialized view concurrently greendogops.ezyvet_appointment;
  refresh materialized view greendogops.report_top_product_group;
  refresh materialized view greendogops.report_top_product;
  refresh materialized view greendogops.report_product_by_location;
  refresh materialized view greendogops.report_by_staff;
  refresh materialized view greendogops.report_staff_by_location;
  refresh materialized view greendogops.report_staff_product;
  refresh materialized view greendogops.report_staff_product_group;
  refresh materialized view greendogops.report_case_owner_by_month;
  refresh materialized view greendogops.report_by_case_owner;
  refresh materialized view greendogops.report_case_owner_product;
  refresh materialized view greendogops.report_case_owner_product_group;
end;
$$;
