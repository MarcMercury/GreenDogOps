-- ============================================================================
-- Green Dog Ops — 0056 Appointment count: exclusionary (retail/OTC) rule
-- ----------------------------------------------------------------------------
-- Some providers meet clients on days with no "exam" line (surgery, advanced
-- dental, etc.), so an inclusionary "must have an exam" rule under-counts them.
-- Instead we use an EXCLUSIONARY rule: a client-day counts as an appointment
-- unless EVERY line that day is a non-appointment item — currently deposits,
-- refunds, retail, and OTC (food/supplements/supplies). Lab work is NOT
-- excluded (yet). This affects the APPOINTMENT COUNT only — revenue is
-- unchanged everywhere.
--
-- The rule lives in one IMMUTABLE helper, greendogops.is_appt_line(name,group),
-- so the exclusion list can be extended in a single place later.
-- ============================================================================
set search_path = greendogops, public;

-- A line counts toward an appointment unless it is a deposit/refund or a
-- retail/OTC product group. Extend the excluded groups here as needed.
create or replace function greendogops.is_appt_line(p_name text, p_group text)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_name, '')) not like '%deposit%'
    and lower(coalesce(p_name, '')) not like '%refund%'
    and coalesce(nullif(p_group, ''), '') not in (
      'Retail',
      'Consumables, Food, and Supplements',
      'Supplies'
    );
$$;

-- ---------------------------------------------------------------------------
-- Base appointment roll-up (drop CASCADEs to its plain report views).
-- ---------------------------------------------------------------------------
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
-- Keep the day only if at least one line is appointment-eligible.
having count(*) filter (where greendogops.is_appt_line(product_name, product_group)) > 0
with data;

create unique index ux_ezv_appointment
  on greendogops.ezyvet_appointment (client_contact_code, service_date, location_key);
create index idx_ezv_appointment_service_date
  on greendogops.ezyvet_appointment (service_date);

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
-- Per-staff and per-case-owner roll-ups: appointments use the same rule.
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
    where greendogops.is_appt_line(product_name, product_group)
  )::int                                                                 as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> '' and line_date is not null
group by 1, 2
with data;
create index idx_rbs_year on greendogops.report_by_staff (year);

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
    where greendogops.is_appt_line(product_name, product_group)
  )::int                                                                 as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where coalesce(nullif(case_owner, ''), nullif(staff_member, '')) is not null
  and line_date is not null
group by 1, 2
with data;
create index idx_rbco_year on greendogops.report_by_case_owner (year);

grant execute on function greendogops.is_appt_line(text, text) to authenticated, service_role;
grant select on
  greendogops.ezyvet_appointment,
  greendogops.report_years,
  greendogops.report_overview,
  greendogops.report_monthly,
  greendogops.report_location_monthly,
  greendogops.report_by_location,
  greendogops.report_by_species,
  greendogops.report_by_staff,
  greendogops.report_by_case_owner
to authenticated, service_role;
