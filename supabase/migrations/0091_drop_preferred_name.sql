-- ============================================================================
-- Green Dog Ops — 0091 Drop preferred_name
-- ----------------------------------------------------------------------------
-- The HR/Roster record no longer tracks a "preferred name". Display-name
-- derivation across Schedule, Calendar, Resources and search now relies on
-- first_name / grid_name / full_name only, so the column is removed entirely.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.person
  drop column if exists preferred_name;
