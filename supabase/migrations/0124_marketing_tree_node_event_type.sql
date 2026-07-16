-- ============================================================================
-- Green Dog Ops — 0124 Marketing Tree node event-type link
-- ----------------------------------------------------------------------------
-- Ties Events (from the Events tab) to Marketing Tree nodes by event_type.
-- A node can be tagged with an event_type (matches marketing_event.event_type,
-- e.g. "third_party", "hosted"). Upcoming events whose type matches the node's
-- event_type render on that node's list. Past events fall off automatically
-- (the UI filters by starts_on >= today), so no data is deleted here.
-- Free-text (no CHECK constraint) to match the rest of the marketing module.
-- ============================================================================

alter table greendogops.marketing_tree_node
  add column if not exists event_type text;
