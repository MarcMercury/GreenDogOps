-- ---------------------------------------------------------------------------
-- 0163: track geocoding attempts for referral partners (Map View)
-- ---------------------------------------------------------------------------
-- Partners with a valid address but no coordinates were silently invisible on
-- the Referral CRM map: geocoding only ran when someone opened the Map tab and
-- clicked "Plot", and any address Google could not resolve was retried forever
-- with no record of why. These columns let the app auto-geocode on load while
-- backing off addresses that genuinely cannot be located.
alter table greendogops.referral_partners
  add column if not exists geocode_attempted_at timestamptz,
  add column if not exists geocode_error        text;

comment on column greendogops.referral_partners.geocode_attempted_at is
  'When geocoding was last attempted for the current address (success or failure).';
comment on column greendogops.referral_partners.geocode_error is
  'Google Geocoding status for the last failed attempt (e.g. ZERO_RESULTS); null when located.';

-- Same treatment for the rescue/shelter CRM map, which mirrors this schema.
alter table greendogops.crm_organization
  add column if not exists geocode_attempted_at timestamptz,
  add column if not exists geocode_error        text;
