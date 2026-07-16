-- ============================================================================
-- Green Dog Ops — 0109 Combine product roots under a single "Retail" root node
-- ----------------------------------------------------------------------------
-- Previously there were two separate primary-root nodes:
--   * "Retail product sales"  (→ Shopify store)
--   * "Green Dog Products"     (→ SmileSpray, DentalDust, Wholesale orders,
--                                 Product cards (ezyVet))
--
-- This consolidates them under ONE new primary root "Retail" and demotes the
-- two former roots to sub-nodes ("GDD Products", "Retail Products"). The old
-- detail tactics are re-parented to sit under "Retail" alongside the two
-- sub-nodes (the tree supports two root tiers, so everything lives one level
-- below the Retail root).
-- ============================================================================
set search_path = greendogops, public;

-- 1) Create the new "Retail" primary root -----------------------------------
insert into greendogops.marketing_tree_node
  (label, zone, status, owner_name, summary, links, sort_order)
select 'Retail', 'root_primary', 'active', 'Marketing',
       'Retail & product sales — Green Dog Products (GDD) and general retail merchandise.',
       '[]'::jsonb, 3
where not exists (
  select 1 from greendogops.marketing_tree_node
  where label = 'Retail' and zone = 'root_primary'
);

-- 2) Re-parent the existing detail tactics to the Retail root ----------------
update greendogops.marketing_tree_node t
set parent_id = r.id,
    zone = 'root_fine',
    sort_order = v.new_sort
from (values
  ('SmileSpray', 3),
  ('DentalDust', 4),
  ('Wholesale orders', 5),
  ('Product cards (ezyVet)', 6),
  ('Shopify store', 7)
) as v(label, new_sort)
cross join lateral (
  select id from greendogops.marketing_tree_node
  where label = 'Retail' and zone = 'root_primary' limit 1
) r
where t.label = v.label;

-- 3) Demote the two former roots to sub-nodes under Retail --------------------
update greendogops.marketing_tree_node t
set label = 'GDD Products',
    zone = 'root_fine',
    parent_id = r.id,
    sort_order = 1
from (
  select id from greendogops.marketing_tree_node
  where label = 'Retail' and zone = 'root_primary' limit 1
) r
where t.label = 'Green Dog Products' and t.zone = 'root_primary';

update greendogops.marketing_tree_node t
set label = 'Retail Products',
    zone = 'root_fine',
    parent_id = r.id,
    sort_order = 2
from (
  select id from greendogops.marketing_tree_node
  where label = 'Retail' and zone = 'root_primary' limit 1
) r
where t.label = 'Retail product sales' and t.zone = 'root_primary';
