-- ============================================================================
-- Green Dog Ops — 0085 Recruiting application date
-- ----------------------------------------------------------------------------
-- Capture WHEN a candidate applied / when their resume was received. This is
-- distinct from person.created_at (the row-creation timestamp) so the intake
-- date survives re-imports and can be edited by recruiters. Populated by the
-- resume/list upload flow (defaults to the upload date) and editable on the
-- candidate profile.
-- ============================================================================

set search_path = greendogops, public;

alter table greendogops.person_recruiting
  add column if not exists application_date date;

comment on column greendogops.person_recruiting.application_date is
  'Date the candidate applied / their resume was received. Defaults to the '
  'upload date at intake; editable on the candidate profile.';
