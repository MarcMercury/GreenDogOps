-- 0020_referral_geocoding.sql
-- Adds geocoding columns to referral partners so the Referral CRM "Map View"
-- can plot each clinic as an interactive dot on a Google Map. Coordinates are
-- resolved server-side from `address` via the Google Geocoding API and cached
-- here so the map loads instantly without re-geocoding on every visit.

set search_path = greendogops, public;

alter table greendogops.referral_partners
  add column if not exists latitude       double precision,
  add column if not exists longitude      double precision,
  add column if not exists geocoded_at    timestamptz,
  add column if not exists geocoded_address text;  -- the address string that produced the cached coords

comment on column greendogops.referral_partners.latitude is
  'Cached latitude (WGS84) resolved from address via Google Geocoding API.';
comment on column greendogops.referral_partners.longitude is
  'Cached longitude (WGS84) resolved from address via Google Geocoding API.';
comment on column greendogops.referral_partners.geocoded_at is
  'Timestamp of the last successful geocode.';
comment on column greendogops.referral_partners.geocoded_address is
  'The address string that produced the cached coordinates; used to detect staleness when the address changes.';
