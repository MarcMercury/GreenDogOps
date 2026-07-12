-- ============================================================================
-- Green Dog Ops — 0082 CE event itinerary
-- ----------------------------------------------------------------------------
-- Adds a per-event, editable itinerary so the CE Events management tab can
-- build, download, and print a run-of-show for each event. Stored as a jsonb
-- array of line items: [{ id, day, time, description }]. Defaults to the event
-- day(s) with blank hourly lines when first opened.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  add column if not exists itinerary jsonb not null default '[]'::jsonb;

comment on column greendogops.crm_ce_event.itinerary is
  'Editable event itinerary: jsonb array of { id, day, time, description } line items rendered/printed in the CE Events management tab.';
