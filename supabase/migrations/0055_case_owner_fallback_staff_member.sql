-- ============================================================================
-- Green Dog Ops — 0055 Case Owner attribution falls back to Staff Member
-- ----------------------------------------------------------------------------
-- When ezyVet leaves Case Owner blank (wellness-plan billing, pharmacy/OTC,
-- external labs, admin/service fees), attribute the line to its Staff Member
-- instead. Provider = coalesce(nullif(case_owner,''), nullif(staff_member,'')).
-- Only lines where BOTH are blank stay unattributed (those net to $0).
--
-- Applied to every provider/case-owner report view so doctor production, the
-- monthly panel, the drill-downs, and provider-by-location all reconcile to
-- gross invoice revenue. is_vet is derived so real providers (case owners or
-- vet salespeople) land in the Doctors table and everyone else in Support.
-- ============================================================================
set search_path = greendogops, public;

drop materialized view if exists greendogops.report_by_case_owner cascade;
create materialized view greendogops.report_by_case_owner as
select
  extract(year from line_date)::int                                      as year,
  coalesce(nullif(case_owner, ''), nullif(staff_member, ''))             as staff_member,
  bool_or(
    (case_owner is not null and case_owner <> '')
    or coalesce(salesperson_is_vet, false)
  )                                                                      as is_vet,
  count(*)::int                                                          as line_count,
  count(distinct (client_contact_code || '|' || line_date::text)) filter (
    where lower(coalesce(product_name, '')) not like '%deposit%'
      and lower(coalesce(product_name, '')) not like '%refund%'
  )::int                                                                 as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2
with data;
create index idx_rbco_year on greendogops.report_by_case_owner (year);

drop materialized view if exists greendogops.report_case_owner_product cascade;
create materialized view greendogops.report_case_owner_product as
select
  extract(year from line_date)::int                          as year,
  coalesce(nullif(case_owner, ''), nullif(staff_member, '')) as staff_member,
  coalesce(nullif(product_name, ''), 'Unnamed')              as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized')       as product_group,
  count(*)::int                                              as line_count,
  coalesce(sum(qty), 0)                                      as qty,
  coalesce(sum(total_incl), 0)                               as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2, 3, 4
with data;
create index idx_rcop_year_owner on greendogops.report_case_owner_product (year, staff_member);

drop materialized view if exists greendogops.report_case_owner_product_group cascade;
create materialized view greendogops.report_case_owner_product_group as
select
  extract(year from line_date)::int                          as year,
  coalesce(nullif(case_owner, ''), nullif(staff_member, '')) as staff_member,
  coalesce(nullif(product_group, ''), 'Uncategorized')       as product_group,
  count(*)::int                                              as line_count,
  coalesce(sum(total_incl), 0)                               as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2, 3
with data;
create index idx_rcopg_year_owner on greendogops.report_case_owner_product_group (year, staff_member);

drop materialized view if exists greendogops.report_case_owner_by_month cascade;
create materialized view greendogops.report_case_owner_by_month as
select
  extract(year from line_date)::int                          as year,
  coalesce(nullif(case_owner, ''), nullif(staff_member, '')) as case_owner,
  date_trunc('month', line_date)::date                       as month,
  count(*)::int                                              as line_count,
  coalesce(sum(total_incl), 0)                               as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2, 3
with data;
create index idx_rcobm_year on greendogops.report_case_owner_by_month (year, case_owner);

drop materialized view if exists greendogops.report_staff_by_location cascade;
create materialized view greendogops.report_staff_by_location as
select
  extract(year from line_date)::int                          as year,
  coalesce(nullif(case_owner, ''), nullif(staff_member, '')) as staff_member,
  location_key,
  max(location_label)                                        as location_label,
  count(*)::int                                              as line_count,
  coalesce(sum(total_incl), 0)                               as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2, 3
with data;
create index idx_rsbl_year on greendogops.report_staff_by_location (year, staff_member);

grant select on
  greendogops.report_by_case_owner,
  greendogops.report_case_owner_product,
  greendogops.report_case_owner_product_group,
  greendogops.report_case_owner_by_month,
  greendogops.report_staff_by_location
to authenticated, service_role;
