-- ============================================================================
-- Green Dog Ops — 0050 Refine what qualifies as an appointment
-- ----------------------------------------------------------------------------
-- Appointments roll up every invoice line for the same client on the same day
-- at one clinic. But a day whose ONLY line(s) are a Deposit or a Refund is not
-- a real appointment — the client didn't actually come in for services.
--
-- Rule: a (client + day + location) group counts as an appointment only if it
-- has at least one line that is NOT a Deposit or Refund. Deposit/Refund lines
-- that sit alongside real service lines still roll up into that appointment;
-- only days made up exclusively of Deposit/Refund lines are dropped.
--
-- "Deposit" / "Refund" are detected from the invoice line's Product Name
-- (e.g. "Surgery Deposit $350", "Cancelation Deposit", "Refund"). This mirrors
-- the aggregations in migration 0045; we drop/recreate the base appointment
-- matview (CASCADEs to its plain report views) and the by-staff matview.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Base appointment roll-up → materialized view (now filters deposit/refund
--    only days). Dropping it CASCADEs to every plain report view built on it.
-- ---------------------------------------------------------------------------
drop view if exists greendogops.report_years cascade;
drop view if exists greendogops.report_overview cascade;
drop view if exists greendogops.report_monthly cascade;
drop view if exists greendogops.report_location_monthly cascade;
drop view if exists greendogops.report_by_location cascade;
drop view if exists greendogops.report_by_species cascade;
drop materialized view if exists greendogops.ezyvet_appointment cascade;

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
-- Keep the day only if at least one line is NOT a deposit/refund.
having count(*) filter (
         where lower(coalesce(product_name, '')) not like '%deposit%'
           and lower(coalesce(product_name, '')) not like '%refund%'
       ) > 0
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
-- 3. Per-staff roll-up → materialized view (appointments now exclude days
--    where that staff member's only line for the client was a deposit/refund).
-- ---------------------------------------------------------------------------
drop materialized view if exists greendogops.report_by_staff cascade;

create materialized view greendogops.report_by_staff as
select
  extract(year from line_date)::int                                      as year,
  coalesce(nullif(staff_member, ''), 'Unassigned')                       as staff_member,
  bool_or(coalesce(salesperson_is_vet, false))                           as is_vet,
  count(*)::int                                                          as line_count,
  count(distinct nullif(consult_id, ''))::int                            as consults,
  count(distinct (client_contact_code || '|' || line_date::text)) filter (
    where lower(coalesce(product_name, '')) not like '%deposit%'
      and lower(coalesce(product_name, '')) not like '%refund%'
  )::int                                                                 as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2
with data;
create index idx_rbs_year on greendogops.report_by_staff (year);

-- ---------------------------------------------------------------------------
-- 4. Grants (re-applied after drop/recreate)
-- ---------------------------------------------------------------------------
grant select on
  greendogops.ezyvet_appointment,
  greendogops.report_years,
  greendogops.report_overview,
  greendogops.report_monthly,
  greendogops.report_location_monthly,
  greendogops.report_by_location,
  greendogops.report_by_species,
  greendogops.report_by_staff
to authenticated, service_role;
