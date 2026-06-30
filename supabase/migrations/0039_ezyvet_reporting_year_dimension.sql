-- ============================================================================
-- Green Dog Ops — 0039 ezyVet Reporting: year dimension
-- ----------------------------------------------------------------------------
-- Adds a `year` column to every invoice-derived reporting view so the app can
-- filter by year (?year=) and toggle between years as more data lands. The
-- CRM/client views are a current contact snapshot and are intentionally left
-- un-scoped. `report_years` lists the years that have data, newest first.
--
-- The views are dropped and recreated (rather than CREATE OR REPLACE) because
-- adding `year` reorders columns and changes some column types, both of which
-- replace-in-place forbids. Nothing outside the app depends on these views.
-- Years come from the service date (appointment views) or the invoice line date
-- (invoice-line views).
-- ============================================================================
set search_path = greendogops, public;

drop view if exists greendogops.report_years cascade;
drop view if exists greendogops.report_overview cascade;
drop view if exists greendogops.report_monthly cascade;
drop view if exists greendogops.report_location_monthly cascade;
drop view if exists greendogops.report_by_location cascade;
drop view if exists greendogops.report_by_species cascade;
drop view if exists greendogops.report_top_product_group cascade;
drop view if exists greendogops.report_top_product cascade;
drop view if exists greendogops.report_product_by_location cascade;
drop view if exists greendogops.report_by_staff cascade;
drop view if exists greendogops.report_staff_by_location cascade;
drop view if exists greendogops.report_staff_product cascade;
drop view if exists greendogops.report_staff_product_group cascade;

create view greendogops.report_years as
select distinct extract(year from service_date)::int as year
from greendogops.ezyvet_appointment
where service_date is not null
order by 1 desc;

-- ---- Appointment-derived (year from service_date) -------------------------
create view greendogops.report_overview as
select
  extract(year from service_date)::int            as year,
  count(*)::int                                    as total_appointments,
  coalesce(sum(line_count), 0)::int               as total_lines,
  coalesce(sum(revenue), 0)                        as total_revenue,
  min(service_date)                               as first_date,
  max(service_date)                               as last_date,
  count(distinct client_contact_code)::int        as unique_clients
from greendogops.ezyvet_appointment
group by 1;

create view greendogops.report_monthly as
select
  extract(year from service_date)::int            as year,
  date_trunc('month', service_date)::date         as month,
  count(*)::int                                    as appointments,
  coalesce(sum(revenue), 0)                        as revenue,
  coalesce(sum(line_count), 0)::int               as line_count,
  coalesce(sum(pet_count), 0)::int                as pet_count,
  count(distinct client_contact_code)::int        as unique_clients
from greendogops.ezyvet_appointment
group by 1, 2
order by 2;

create view greendogops.report_location_monthly as
select
  extract(year from service_date)::int            as year,
  date_trunc('month', service_date)::date         as month,
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                    as appointments,
  coalesce(sum(revenue), 0)                        as revenue
from greendogops.ezyvet_appointment
group by 1, 2, 3
order by 2;

create view greendogops.report_by_location as
select
  extract(year from service_date)::int            as year,
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                    as appointments,
  coalesce(sum(revenue), 0)                        as revenue,
  count(distinct client_contact_code)::int        as unique_clients,
  coalesce(avg(revenue), 0)                        as avg_appointment_value
from greendogops.ezyvet_appointment
group by 1, 2
order by appointments desc;

create view greendogops.report_by_species as
select
  extract(year from service_date)::int            as year,
  coalesce(nullif(species_group, ''), 'Unknown')  as species_group,
  count(*)::int                                    as appointments,
  coalesce(sum(revenue), 0)                        as revenue
from greendogops.ezyvet_appointment
group by 1, 2
order by appointments desc;

-- ---- Invoice-line-derived (year from line_date) ---------------------------
create view greendogops.report_top_product_group as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where line_date is not null
group by 1, 2
order by revenue desc;

create view greendogops.report_top_product as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(product_name, ''), 'Unnamed')        as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(qty), 0)                                as qty,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where line_date is not null
group by 1, 2, 3
order by revenue desc;

create view greendogops.report_product_by_location as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  location_key,
  max(location_label)                                  as location_label,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where line_date is not null
group by 1, 2, 3;

create view greendogops.report_by_staff as
select
  extract(year from line_date)::int                                      as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')                       as staff_member,
  bool_or(coalesce(salesperson_is_vet, false))                           as is_vet,
  count(*)::int                                                          as line_count,
  count(distinct nullif(consult_id, ''))::int                            as consults,
  count(distinct (client_contact_code || '|' || line_date::text))::int   as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2
order by revenue desc;

create view greendogops.report_staff_by_location as
select
  extract(year from line_date)::int                 as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')  as staff_member,
  location_key,
  max(location_label)                               as location_label,
  count(*)::int                                     as line_count,
  coalesce(sum(total_incl), 0)                      as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2, 3;

create view greendogops.report_staff_product as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')     as staff_member,
  coalesce(nullif(product_name, ''), 'Unnamed')        as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(qty), 0)                                as qty,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2, 3, 4;

create view greendogops.report_staff_product_group as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')     as staff_member,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2, 3;

-- ---- Grants (re-applied after drop/recreate) ------------------------------
grant select on
  greendogops.report_years,
  greendogops.report_overview,
  greendogops.report_monthly,
  greendogops.report_location_monthly,
  greendogops.report_by_location,
  greendogops.report_by_species,
  greendogops.report_top_product_group,
  greendogops.report_top_product,
  greendogops.report_product_by_location,
  greendogops.report_by_staff,
  greendogops.report_staff_by_location,
  greendogops.report_staff_product,
  greendogops.report_staff_product_group
to authenticated, service_role;
