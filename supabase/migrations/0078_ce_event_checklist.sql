-- ============================================================================
-- Green Dog Ops — 0078 CE event planning checklist
-- ----------------------------------------------------------------------------
-- Adds a per-event planning/resources checklist so the CE Events management tab
-- can track operational setup progress (marketing, venue/AV, lab & supplies,
-- food/filming/final) against each event. Stored as a jsonb map of
-- { checklist_item_key: boolean }; missing keys are treated as unchecked.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  add column if not exists planning_checklist jsonb not null default '{}'::jsonb;

comment on column greendogops.crm_ce_event.planning_checklist is
  'Per-event planning checklist: jsonb map of { item_key: boolean } tracked in the CE Events management tab.';
