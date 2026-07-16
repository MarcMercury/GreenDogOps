-- ============================================================================
-- Green Dog Ops — 0108 Consolidate events under a single "Events program" node
-- ----------------------------------------------------------------------------
-- The actual events (Adoptapalooza, Pet-Chella, street fair booth, etc.) were
-- originally seeded under the "Community partnerships" branch. This reparents
-- them under the dedicated "Events program" branch so there is ONE Events node
-- that owns all the individual events. "Community partnerships" keeps the true
-- partnership relationships (grooming salons, local businesses, chambers, etc.).
-- ============================================================================
set search_path = greendogops, public;

update greendogops.marketing_tree_node child
set parent_id = (
  select id from greendogops.marketing_tree_node
  where label = 'Events program' and zone = 'branch'
  limit 1
)
where child.label in (
  'Adoptapalooza 2026',
  'Pet-Chella',
  'Spring street fair booth',
  'Pop-up vaccine clinic',
  'School visit'
)
and exists (
  select 1 from greendogops.marketing_tree_node
  where label = 'Events program' and zone = 'branch'
);
