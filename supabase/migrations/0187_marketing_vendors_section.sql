-- ============================================================================
-- Green Dog Ops — 0187 Split "Marketing Vendors" out of Non-Med Partners
-- ----------------------------------------------------------------------------
-- Non-Med Partners is meant to be relationships we VISIT (groomers, daycares,
-- food, retail, chambers). The purchased-service types mixed in with them —
-- printing, media, merch, client-comms software, entertainment, misc/other —
-- are vendors, not partners, so they move to their own section the same way
-- 0185 split Vendors & Supplies off: purely by `category`.
--
-- Two taxonomies were also duplicated across the old import sources and are
-- collapsed first so each concept is a single Type:
--   'Industry Media' -> 'media'        (Media & Press)
--   'PRINTING'       -> 'print_vendor' (Printing, Signage & Design)
-- Both only ever appear on category='marketing' rows, so the merge is safe to
-- run unscoped.
-- ============================================================================
set search_path = greendogops, public;

-- 1) Collapse the duplicate Type values -------------------------------------
update greendogops.crm_organization
   set subtype = 'media'
 where subtype = 'Industry Media';

update greendogops.crm_organization
   set subtype = 'print_vendor'
 where subtype = 'PRINTING';

-- 2) Re-categorize the vendor Types -----------------------------------------
-- Scoped to category='marketing' so the identically-named 'other' /
-- 'MISCELLANEOUS' rows in the medical & facility categories stay put.
update greendogops.crm_organization
   set category = 'marketing_vendor'
 where category = 'marketing'
   and coalesce(subtype, '') <> 'rescue'
   and subtype in (
     'Client Communication & Payment',
     'entertainment',
     'media',
     'merch_vendor',
     'MISCELLANEOUS',
     'other',
     'print_vendor'
   );
