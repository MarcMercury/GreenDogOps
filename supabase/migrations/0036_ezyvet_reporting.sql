-- ============================================================================
-- Green Dog Ops — 0036 ezyVet Reporting + ezyVet CRM
-- ----------------------------------------------------------------------------
-- Two new data domains fed by periodic (monthly) ezyVet exports:
--
--   1. Invoice-line reporting. Every invoice line of the business is stored in
--      `ezyvet_invoice_line` (deduped on the ezyVet "Invoice Line ID"). An
--      appointment is defined as the same client contact on the same service
--      day at the same clinic location, surfaced through the `ezyvet_appointment`
--      view. Reporting roll-ups (monthly, by-location, by-species, by-product)
--      are exposed as plain views so the app can read pre-aggregated rows.
--
--   2. ezyVet CRM. The full contact export lands in `ezyvet_contact` (deduped on
--      the ezyVet "Contact Id"). Each upload is a fresh snapshot of the most
--      recent data; we upsert, count new vs. updated, and log changes to
--      `ezyvet_contact_change` so the Reporting page can chart client growth and
--      churn over time.
--
-- Clinic location is parsed from the invoice "Department" / "Inventory Location"
-- columns (Sherman Oaks, Van Nuys, Venice) by the importer before insert.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Invoice line storage (detailed, deduped on ezyVet Invoice Line ID)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_invoice_line (
  id                 uuid primary key default gen_random_uuid(),
  invoice_line_id    text not null unique,   -- ezyVet unique line id
  invoice_no         text,
  invoice_date       date,
  line_date          date,                   -- service date (Invoice Line Date)
  line_type          text,
  department_raw     text,                    -- e.g. "Green Dog - Sherman Oaks"
  location_key       text,                    -- 'sherman_oaks' | 'van_nuys' | 'venice' | 'other'
  location_label     text,                    -- "Sherman Oaks" etc.
  inventory_location text,
  client_contact_code text,
  business_name      text,
  first_name         text,
  last_name          text,
  email              text,
  animal_code        text,
  pet_name           text,
  species            text,
  species_group      text,                    -- 'Dog' | 'Cat' | 'Exotic' | 'Unknown'
  breed              text,
  product_code       text,
  product_name       text,
  product_group      text,
  account            text,
  staff_member       text,
  staff_member_id    text,
  salesperson_is_vet boolean,
  consult_id         text,
  qty                numeric,
  total_excl         numeric,
  total_incl         numeric,
  import_id          uuid,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ezv_line_date     on greendogops.ezyvet_invoice_line (line_date);
create index if not exists idx_ezv_line_location on greendogops.ezyvet_invoice_line (location_key);
create index if not exists idx_ezv_line_contact  on greendogops.ezyvet_invoice_line (client_contact_code);
create index if not exists idx_ezv_line_species  on greendogops.ezyvet_invoice_line (species_group);
create index if not exists idx_ezv_line_import   on greendogops.ezyvet_invoice_line (import_id);

create table if not exists greendogops.ezyvet_invoice_import (
  id                uuid primary key default gen_random_uuid(),
  filename          text,
  label             text,
  uploaded_by       uuid,
  total_rows        integer not null default 0,
  new_rows          integer not null default 0,
  skipped_rows      integer not null default 0,
  date_range_start  date,
  date_range_end    date,
  revenue_total     numeric not null default 0,
  appointment_count integer not null default 0,
  details           jsonb,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. ezyVet contacts (CRM) — latest snapshot, deduped on ezyVet Contact Id
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_contact (
  id                  uuid primary key default gen_random_uuid(),
  ezyvet_contact_id   text not null unique,
  contact_code        text,
  business_name       text,
  title               text,
  first_name          text,
  last_name           text,
  full_name           text,
  date_of_birth       date,
  is_customer         boolean,
  is_business         boolean,
  is_vet              boolean,
  is_active           boolean,
  is_supplier         boolean,
  preferred_contact_method text,
  physical_street1    text,
  physical_street2    text,
  physical_city       text,
  physical_state      text,
  physical_post_code  text,
  physical_country    text,
  number_of_miles     numeric,
  email               text,
  phone               text,
  mobile              text,
  website             text,
  notes               text,
  account_code        text,
  last_invoiced       date,
  staff_member        text,
  hear_about          text,
  customer_group      text,
  regional_group      text,
  division            text,
  revenue_spend_ytd   numeric,
  opt_out_marketing   boolean,
  ezyvet_created_at   timestamptz,
  ezyvet_created_by   text,
  ezyvet_modified_at  timestamptz,
  ezyvet_modified_by  text,
  first_seen_at       timestamptz not null default now(),
  last_import_id      uuid,
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ezv_contact_group    on greendogops.ezyvet_contact (customer_group);
create index if not exists idx_ezv_contact_division on greendogops.ezyvet_contact (division);
create index if not exists idx_ezv_contact_created   on greendogops.ezyvet_contact (ezyvet_created_at);
create index if not exists idx_ezv_contact_customer  on greendogops.ezyvet_contact (is_customer);

create table if not exists greendogops.ezyvet_contact_import (
  id                  uuid primary key default gen_random_uuid(),
  filename            text,
  uploaded_by         uuid,
  total_rows          integer not null default 0,
  new_contacts        integer not null default 0,
  updated_contacts    integer not null default 0,
  unchanged_contacts  integer not null default 0,
  snapshot_date       date,
  details             jsonb,
  created_at          timestamptz not null default now()
);

create table if not exists greendogops.ezyvet_contact_change (
  id                uuid primary key default gen_random_uuid(),
  ezyvet_contact_id text not null,
  import_id         uuid,
  change_type       text not null,     -- 'created' | 'updated'
  changed_fields    jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_ezv_change_created on greendogops.ezyvet_contact_change (created_at);
create index if not exists idx_ezv_change_contact on greendogops.ezyvet_contact_change (ezyvet_contact_id);

-- ---------------------------------------------------------------------------
-- 3. Reporting views
-- ---------------------------------------------------------------------------
-- Appointment = same client contact + same service day + same clinic location.
create or replace view greendogops.ezyvet_appointment as
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
group by client_contact_code, line_date, location_key;

create or replace view greendogops.report_overview as
select
  (select count(*)                         from greendogops.ezyvet_appointment)                                       as total_appointments,
  (select count(*)                         from greendogops.ezyvet_invoice_line)                                      as total_lines,
  (select coalesce(sum(total_incl), 0)     from greendogops.ezyvet_invoice_line)                                      as total_revenue,
  (select min(line_date)                   from greendogops.ezyvet_invoice_line where line_date is not null)          as first_date,
  (select max(line_date)                   from greendogops.ezyvet_invoice_line where line_date is not null)          as last_date,
  (select count(distinct client_contact_code) from greendogops.ezyvet_appointment)                                   as unique_clients;

create or replace view greendogops.report_monthly as
select
  date_trunc('month', service_date)::date        as month,
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                       as revenue,
  coalesce(sum(line_count), 0)::int               as line_count,
  coalesce(sum(pet_count), 0)::int                as pet_count,
  count(distinct client_contact_code)::int        as unique_clients
from greendogops.ezyvet_appointment
group by 1
order by 1;

create or replace view greendogops.report_location_monthly as
select
  date_trunc('month', service_date)::date        as month,
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                       as revenue
from greendogops.ezyvet_appointment
group by 1, 2
order by 1;

create or replace view greendogops.report_by_location as
select
  location_key,
  max(location_label)                             as location_label,
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                       as revenue,
  count(distinct client_contact_code)::int        as unique_clients,
  coalesce(avg(revenue), 0)                       as avg_appointment_value
from greendogops.ezyvet_appointment
group by location_key
order by appointments desc;

create or replace view greendogops.report_by_species as
select
  coalesce(nullif(species_group, ''), 'Unknown')  as species_group,
  count(*)::int                                   as appointments,
  coalesce(sum(revenue), 0)                       as revenue
from greendogops.ezyvet_appointment
group by 1
order by appointments desc;

create or replace view greendogops.report_top_product_group as
select
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
group by 1
order by revenue desc;

-- ---------------------------------------------------------------------------
-- 4. Client trends views (driven from ezyVet CRM contacts)
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_client_summary as
select
  count(*)::int                                          as total_contacts,
  count(*) filter (where is_active)::int                 as active_contacts,
  count(*) filter (where is_customer)::int               as customers,
  count(*) filter (where is_business)::int               as businesses,
  coalesce(sum(revenue_spend_ytd), 0)                    as total_revenue_ytd,
  coalesce(avg(nullif(revenue_spend_ytd, 0)), 0)         as avg_revenue_ytd
from greendogops.ezyvet_contact;

create or replace view greendogops.report_clients_by_month as
select
  date_trunc('month', ezyvet_created_at)::date  as month,
  count(*)::int                                  as new_clients
from greendogops.ezyvet_contact
where ezyvet_created_at is not null
group by 1
order by 1;

create or replace view greendogops.report_clients_by_group as
select
  coalesce(nullif(customer_group, ''), 'Ungrouped') as customer_group,
  count(*)::int                                      as contacts,
  coalesce(sum(revenue_spend_ytd), 0)                as revenue_ytd
from greendogops.ezyvet_contact
group by 1
order by contacts desc;

create or replace view greendogops.report_clients_by_division as
select
  coalesce(nullif(division, ''), 'Unassigned') as division,
  count(*)::int                                 as contacts,
  coalesce(sum(revenue_spend_ytd), 0)           as revenue_ytd
from greendogops.ezyvet_contact
group by 1
order by revenue_ytd desc;

-- ---------------------------------------------------------------------------
-- 5. Grants (schema isolation + grants; no RLS, consistent with other modules)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  greendogops.ezyvet_invoice_line,
  greendogops.ezyvet_invoice_import,
  greendogops.ezyvet_contact,
  greendogops.ezyvet_contact_import,
  greendogops.ezyvet_contact_change
to authenticated, service_role;

grant select on
  greendogops.ezyvet_appointment,
  greendogops.report_overview,
  greendogops.report_monthly,
  greendogops.report_location_monthly,
  greendogops.report_by_location,
  greendogops.report_by_species,
  greendogops.report_top_product_group,
  greendogops.report_client_summary,
  greendogops.report_clients_by_month,
  greendogops.report_clients_by_group,
  greendogops.report_clients_by_division
to authenticated, service_role;
