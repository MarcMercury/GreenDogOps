-- 0003_crm_module.sql
-- CRM module for Green Dog Ops. Two normalized tables in the greendogops schema:
--   crm_organization : businesses/clinics/vendors (referral clinics, marketing
--                      partners, facility resources, med-ops vendors)
--   crm_contact      : individual people we've engaged (students, CE attendees)
-- Data is COPIED from the shared public schema (owned by EmployeeGMGDD) so Green
-- Dog Ops keeps its own independent copy. external_id preserves the source row id.

set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Organizations (businesses / clinics / vendors)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.crm_organization (
  id                 uuid primary key default gen_random_uuid(),
  org_type           text not null,          -- referral_clinic | marketing_partner | facility_resource | med_ops
  name               text not null,
  subtype            text,                    -- clinic_type / partner_type / resource_type / category
  status             text,
  contact_name       text,
  title              text,
  phone              text,
  phone_alt          text,
  email              text,
  website            text,
  instagram          text,
  address            text,
  city               text,
  state              text,
  zip                text,
  area               text,                    -- zone / service_area / area / proximity
  services           text,
  products           text[],
  tier               text,
  priority           text,
  membership_level   text,
  annual_fee         numeric,
  account_number     text,
  account_rep        text,
  total_referrals    integer,
  revenue            numeric,
  monthly_spend      numeric,
  spend_ytd          numeric,
  relationship_score integer,
  internal_rating    integer,
  is_preferred       boolean not null default false,
  is_active          boolean not null default true,
  last_visit_date    date,
  last_contact_date  date,
  last_referral_date date,
  notes              text,
  source             text not null,           -- which dataset/table it came from
  external_id        uuid,                    -- original id in the public schema
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists crm_organization_source_external_idx
  on greendogops.crm_organization (source, external_id)
  where external_id is not null;

create index if not exists crm_organization_org_type_idx
  on greendogops.crm_organization (org_type);

create index if not exists crm_organization_status_idx
  on greendogops.crm_organization (status);

drop trigger if exists set_updated_at on greendogops.crm_organization;
create trigger set_updated_at before update on greendogops.crm_organization
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Contacts (individual people: students, CE attendees)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.crm_contact (
  id                     uuid primary key default gen_random_uuid(),
  contact_type           text not null,       -- student | ce_attendee
  first_name             text,
  last_name              text,
  full_name              text,
  email                  text,
  phone                  text,
  status                 text,
  organization           text,                -- school / org affiliation
  program_type           text,
  program_name           text,
  cohort                 text,
  school                 text,
  location               text,
  mentor                 text,
  coordinator            text,
  visitor_type           text,
  start_date             date,
  end_date               date,
  hours_completed        numeric,
  hours_required         numeric,
  eligible_for_employment boolean,
  ce_events_attended     text,
  lead_source            text,
  notes                  text,
  source                 text not null,
  external_id            uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists crm_contact_source_external_idx
  on greendogops.crm_contact (source, external_id)
  where external_id is not null;

create index if not exists crm_contact_type_idx
  on greendogops.crm_contact (contact_type);

drop trigger if exists set_updated_at on greendogops.crm_contact;
create trigger set_updated_at before update on greendogops.crm_contact
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.crm_organization to authenticated, service_role;
grant select, insert, update, delete on greendogops.crm_contact      to authenticated, service_role;
