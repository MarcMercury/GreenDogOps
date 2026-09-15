-- ============================================================================
-- Green Dog Ops — 0185 Split the Vendor & Partner CRM on `category`
-- ----------------------------------------------------------------------------
-- The old Vendor & Partner CRM becomes two sections:
--   * Non-Med Partners  (/crm/vendor)   — category = 'marketing'
--   * Vendors & Supplies (/crm/supplies) — every other category
-- The split is purely category-driven, so a handful of marketing_partner rows
-- that never got a category backfilled would silently land in the wrong list.
-- Stamp them as 'marketing' (their org type is already a marketing partner) and
-- index the column the two lists now filter on.
-- ============================================================================
set search_path = greendogops, public;

update greendogops.crm_organization
   set category = 'marketing'
 where org_type = 'marketing_partner'
   and category is null;

-- Rescues are a marketing_partner subtype and must keep the marketing category
-- so they stay out of Vendors & Supplies.
update greendogops.crm_organization
   set category = 'marketing'
 where subtype = 'rescue'
   and coalesce(category, '') <> 'marketing';

create index if not exists crm_organization_category_idx
  on greendogops.crm_organization (category);
