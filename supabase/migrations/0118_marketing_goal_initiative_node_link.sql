-- ===========================================================================
-- 0118 — Link Goals & Initiatives to Marketing Tree nodes
-- ---------------------------------------------------------------------------
-- Each marketing_goal and marketing_initiative may optionally be connected to
-- a single marketing_tree_node so contributors can see, from a node, which
-- goals and initiatives grow out of it (and vice-versa). ON DELETE SET NULL so
-- archiving/removing a node never destroys the goal/initiative record.
-- ===========================================================================

alter table greendogops.marketing_goal
  add column if not exists node_id uuid
    references greendogops.marketing_tree_node (id) on delete set null;

alter table greendogops.marketing_initiative
  add column if not exists node_id uuid
    references greendogops.marketing_tree_node (id) on delete set null;

create index if not exists marketing_goal_node_idx
  on greendogops.marketing_goal (node_id);
create index if not exists marketing_initiative_node_idx
  on greendogops.marketing_initiative (node_id);
