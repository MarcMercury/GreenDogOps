-- ============================================================================
-- Green Dog Ops — 0111 Link Events Scout sources to the Vendor & Partner CRM
-- ----------------------------------------------------------------------------
-- The Marketing → Events → "Event sources to scout" list (marketing_event_source)
-- catalogs the chambers, associations, listings and partner venues we mine for
-- events. Every one of those is really a business partner that belongs in the
-- Vendor & Partner CRM (crm_organization).
--
-- This migration:
--   1) Adds a crm_organization_id back-link on marketing_event_source.
--   2) Links each source to an existing CRM organization when one already
--      matches by name (case-insensitive), skipping rescues (own CRM).
--   3) Creates a marketing_partner CRM record for every remaining source and
--      links it, carrying over all applicable info (name, website, region,
--      membership/cost, notes).
-- ============================================================================
set search_path = greendogops, public;

-- 1) Back-link column --------------------------------------------------------
alter table greendogops.marketing_event_source
  add column if not exists crm_organization_id uuid
    references greendogops.crm_organization (id) on delete set null;

create index if not exists marketing_event_source_crm_org_idx
  on greendogops.marketing_event_source (crm_organization_id);

-- 2) Link sources that already have a matching CRM organization --------------
update greendogops.marketing_event_source s
set crm_organization_id = o.id
from greendogops.crm_organization o
where s.crm_organization_id is null
  and lower(trim(o.name)) = lower(trim(s.name))
  and o.org_type in
    ('marketing_partner', 'facility_resource', 'med_ops', 'office_marketing')
  and coalesce(lower(trim(o.subtype)), '') <> 'rescue';

-- 3) Create CRM records for the remaining sources, then link them ------------
with created as (
  insert into greendogops.crm_organization
    (org_type, name, website, area, status, is_active, source, notes)
  select
    'marketing_partner',
    s.name,
    s.url,
    s.region,
    'active',
    true,
    'events_scout',
    nullif(
      concat_ws(
        E'\n',
        s.notes,
        case when s.membership_cost is not null
             then 'Membership / cost: ' || s.membership_cost end
      ),
      ''
    )
  from greendogops.marketing_event_source s
  where s.crm_organization_id is null
  returning id, lower(trim(name)) as name_key
)
update greendogops.marketing_event_source s
set crm_organization_id = c.id
from created c
where s.crm_organization_id is null
  and lower(trim(s.name)) = c.name_key;
