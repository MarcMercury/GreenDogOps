-- ============================================================================
-- Green Dog Ops — 0099 Rescue / Shelter CRM
-- ----------------------------------------------------------------------------
-- Rescues & shelters graduate from the Vendor & Partner CRM into their own
-- dedicated Marketing sub-CRM. They remain crm_organization rows
-- (org_type='marketing_partner', subtype='rescue', category='marketing') so no
-- data migration is needed — the new CRM simply filters to those records.
--
-- This migration adds:
--   1) verified_adoptions — a simple user-maintained count of confirmed
--      adoptions credited to the relationship (rescue-specific, but harmless as
--      a generic column).
--   2) Geocoding cache columns on crm_organization so the Rescue CRM can plot a
--      Map View (mirrors referral_partners.latitude/longitude added in 0020).
--   3) crm_org_visit — a structured visit/activity log per organization record
--      (mirrors clinic_visits), powering the Activity feed and the Targeting
--      "oldest → newest visit" ordering.
-- ============================================================================

-- 1) New columns on the shared organization record ---------------------------
alter table greendogops.crm_organization
  add column if not exists verified_adoptions  integer,
  add column if not exists latitude             double precision,
  add column if not exists longitude            double precision,
  add column if not exists geocoded_at          timestamptz,
  add column if not exists geocoded_address     text;

comment on column greendogops.crm_organization.verified_adoptions is
  'User-maintained count of verified adoptions credited to this rescue/shelter.';
comment on column greendogops.crm_organization.latitude is
  'Cached latitude (WGS84) resolved from address via Google Geocoding API.';
comment on column greendogops.crm_organization.longitude is
  'Cached longitude (WGS84) resolved from address via Google Geocoding API.';
comment on column greendogops.crm_organization.geocoded_at is
  'Timestamp of the last successful geocode.';
comment on column greendogops.crm_organization.geocoded_address is
  'The address string that produced the cached coordinates.';

-- 2) Structured per-record visit / activity log ------------------------------
create table if not exists greendogops.crm_org_visit (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references greendogops.crm_organization (id) on delete cascade,
  user_id       uuid,
  visit_date    date not null default current_date,
  spoke_to      text,
  visit_notes   text,
  logged_via    text default 'web',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists crm_org_visit_org_idx
  on greendogops.crm_org_visit (org_id, visit_date desc);
create index if not exists crm_org_visit_date_idx
  on greendogops.crm_org_visit (visit_date desc);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.crm_org_visit;
create trigger set_updated_at before update on greendogops.crm_org_visit
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.crm_org_visit to authenticated, service_role;
