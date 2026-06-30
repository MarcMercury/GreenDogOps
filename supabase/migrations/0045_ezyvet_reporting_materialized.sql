-- ============================================================================
-- Green Dog Ops — 0045 ezyVet Reporting: materialize the heavy aggregations
-- ----------------------------------------------------------------------------
-- The Reporting page issued ~18 read queries on every load. Most of them
-- re-aggregated the full `ezyvet_invoice_line` table (≈249k rows) from scratch:
--
--   * `ezyvet_appointment` GROUP BYs all invoice lines (~168ms) and is the base
--     for SIX report views (overview, monthly, by-location, location-monthly,
--     by-species, report_years) — so that 168ms scan ran six times per load.
--   * Seven product/staff report views each seq-scanned the 249k-row line table
--     independently.
--
-- Invoice data only changes when an admin uploads/deletes an import (monthly),
-- so these aggregations are recomputed thousands of times more than they change.
-- This migration converts the expensive, time-INDEPENDENT aggregations into
-- MATERIALIZED views and refreshes them via `refresh_ezyvet_reporting()` after
-- each import mutation. The page then reads small, pre-aggregated tables.
--
-- Time-RELATIVE views (client/species recency — they reference current_date)
-- are intentionally left as plain views so they never go stale, and the small
-- contact-derived views (28k rows) are cheap and untouched.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Base appointment roll-up → materialized view
-- ---------------------------------------------------------------------------
-- Dropping the appointment view CASCADEs to every report view built on it; we
-- recreate those as plain views over the materialized base below.
drop view if exists greendogops.report_years cascade;
drop view if exists greendogops.report_overview cascade;
drop view if exists greendogops.report_monthly cascade;
drop view if exists greendogops.report_location_monthly cascade;
drop view if exists greendogops.report_by_location cascade;
drop view if exists greendogops.report_by_species cascade;
drop view if exists greendogops.ezyvet_appointment cascade;

create materialized view greendogops.ezyvet_appointment as
select
  client_contact_code,
  line_date                                       as service_date,
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                   as line_count,
  count(distinct animal_code)::int                as pet_count,
  sum(total_incl)                                 as revenue,
  max(business_name)                              as business_name,
  (array_agg(species       order by total_incl desc nulls last))[1] as species,
  (array_agg(species_group order by total_incl desc nulls last))[1] as species_group
from greendogops.ezyvet_invoice_line
where client_contact_code is not null and client_contact_code <> ''
  and line_date is not null
group by client_contact_code, line_date, location_key
with data;

-- Unique key (one row per client + day + location) enables REFRESH ... CONCURRENTLY.
create unique index ux_ezv_appointment
  on greendogops.ezyvet_appointment (client_contact_code, service_date, location_key);
create index idx_ezv_appointment_service_date
  on greendogops.ezyvet_appointment (service_date);

-- ---------------------------------------------------------------------------
-- 2. Appointment-derived report views (plain views over the matview — cheap)
-- ---------------------------------------------------------------------------
create view greendogops.report_years as
select distinct extract(year from service_date)::int as year
from greendogops.ezyvet_appointment
where service_date is not null
order by 1 desc;

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
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                        as revenue
from greendogops.ezyvet_appointment
group by 1, 2, 3
order by 2;

create view greendogops.report_by_location as
select
  extract(year from service_date)::int            as year,
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                   as appointments,
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
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                        as revenue
from greendogops.ezyvet_appointment
group by 1, 2
order by appointments desc;

-- ---------------------------------------------------------------------------
-- 3. Invoice-line-derived report views → materialized views
-- ---------------------------------------------------------------------------
-- These each seq-scanned all 249k lines per load. Materialize them and read
-- the small pre-aggregated result instead. All are time-independent.
drop view if exists greendogops.report_top_product_group cascade;
drop view if exists greendogops.report_top_product cascade;
drop view if exists greendogops.report_product_by_location cascade;
drop view if exists greendogops.report_by_staff cascade;
drop view if exists greendogops.report_staff_by_location cascade;
drop view if exists greendogops.report_staff_product cascade;
drop view if exists greendogops.report_staff_product_group cascade;

create materialized view greendogops.report_top_product_group as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where line_date is not null
group by 1, 2
with data;
create index idx_rtpg_year on greendogops.report_top_product_group (year);

create materialized view greendogops.report_top_product as
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
with data;
create index idx_rtp_year on greendogops.report_top_product (year);

create materialized view greendogops.report_product_by_location as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  location_key,
  max(location_label)                                  as location_label,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where line_date is not null
group by 1, 2, 3
with data;
create index idx_rpbl_year on greendogops.report_product_by_location (year);

create materialized view greendogops.report_by_staff as
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
with data;
create index idx_rbs_year on greendogops.report_by_staff (year);

create materialized view greendogops.report_staff_by_location as
select
  extract(year from line_date)::int                 as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')  as staff_member,
  location_key,
  max(location_label)                               as location_label,
  count(*)::int                                     as line_count,
  coalesce(sum(total_incl), 0)                      as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2, 3
with data;
create index idx_rsbl_year on greendogops.report_staff_by_location (year, staff_member);

create materialized view greendogops.report_staff_product as
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
group by 1, 2, 3, 4
with data;
create index idx_rsp_year_staff on greendogops.report_staff_product (year, staff_member);

create materialized view greendogops.report_staff_product_group as
select
  extract(year from line_date)::int                    as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')     as staff_member,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2, 3
with data;
create index idx_rspg_year_staff on greendogops.report_staff_product_group (year, staff_member);

-- ---------------------------------------------------------------------------
-- 4. Refresh function — call after every invoice import mutation
-- ---------------------------------------------------------------------------
-- `ezyvet_appointment` has a unique index, so it refreshes CONCURRENTLY (no
-- read lock). The downstream report matviews are tiny and refresh in place.
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
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (re-applied after drop/recreate)
-- ---------------------------------------------------------------------------
grant select on
  greendogops.ezyvet_appointment,
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

grant execute on function greendogops.refresh_ezyvet_reporting() to authenticated, service_role;
