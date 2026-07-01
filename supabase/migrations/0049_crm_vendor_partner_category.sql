-- 0049: Merge Vendor + Business CRM into a single "Vendor & Partner CRM".
-- Adds a high-level `category` to every vendor/partner organization record,
-- keeping the existing free-text `subtype` as the record "Type". Revenue is no
-- longer tracked for these records (kept only for referral clinics).

set search_path = greendogops, public;

-- 1. New high-level category column (5 controlled values, free text tolerated).
alter table greendogops.crm_organization
  add column if not exists category text;

comment on column greendogops.crm_organization.category is
  'High-level Vendor & Partner CRM category: medical_equip, medical_supplies, '
  'facility_supply, marketing, facility_maintenance. Null for referral clinics.';

-- 2. Backfill category from (org_type, subtype) for the combined record set.
update greendogops.crm_organization set category = case
  -- Business partners / outreach relationships (pet businesses, associations,
  -- rescues, media, etc.) are all marketing.
  when org_type = 'marketing_partner' then 'marketing'
  -- Facility trades & building services.
  when org_type = 'facility_resource' then 'facility_maintenance'
  -- Med-ops: durable equipment, diagnostics, and clinical software.
  when org_type = 'med_ops' and subtype in (
    'Equipment & Hardware', 'Equipment Vendor', 'ENDODONTICS',
    'Practice Management Software', 'Diagnostics & Reference Labs'
  ) then 'medical_equip'
  when org_type = 'med_ops' and subtype = 'Conference / CE' then 'marketing'
  -- Med-ops: consumables, pharmacy, pharma, distributors, misc suppliers.
  when org_type = 'med_ops' then 'medical_supplies'
  -- Office/marketing: physical office & retail supply.
  when org_type = 'office_marketing' and subtype in (
    'Office Supply', 'RETAIL', 'VENDORS'
  ) then 'facility_supply'
  -- Office/marketing: media, printing, client comms, everything else.
  when org_type = 'office_marketing' then 'marketing'
  else category
end
where org_type in (
  'marketing_partner', 'facility_resource', 'med_ops', 'office_marketing'
);

-- 3. Stop tracking revenue for vendor/partner records (referral clinics keep it).
update greendogops.crm_organization
  set revenue = null
where org_type in (
    'marketing_partner', 'facility_resource', 'med_ops', 'office_marketing'
  )
  and revenue is not null;
