-- ============================================================================
-- Green Dog Ops — 0083 CE event simple start/end dates
-- ----------------------------------------------------------------------------
-- Simplifies the CE event date model to a single Start date (event_date) and
-- End date. The prior CEbroker "effective_start/effective_end/
-- projected_offering_date/rosters_allowed_date" fields were confusing in the
-- builder and are dropped from the UI. Adds end_date and backfills it from the
-- old effective_end (falling back to event_date) so existing events keep a
-- sensible range.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  add column if not exists end_date date;

update greendogops.crm_ce_event
  set end_date = coalesce(effective_end, event_date)
  where end_date is null;

comment on column greendogops.crm_ce_event.event_date is
  'Event Start date. Paired with end_date for the full event range.';
comment on column greendogops.crm_ce_event.end_date is
  'Event End date. Equals event_date for single-day events.';
