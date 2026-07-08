-- ============================================================================
-- Green Dog Ops — 0074 Employee schedule type
-- ----------------------------------------------------------------------------
-- Adds a "schedule type" designation to each employee's employment record.
-- This describes the pattern of workdays an employee works across a two-week
-- period, e.g.:
--   * "5:5" — works 5 days and 5 days across the two weeks
--   * "5:4" — alternates between a 5-workday week and a 4-workday week
--
-- Stored as free text so the option list can grow without a schema change;
-- the HR/Roster UI presents a fixed dropdown (5:5, 5:4, 4:4, 4:3, 5:3) and the
-- Schedule → Setup → Employees tab mirrors the value read-only.
-- ============================================================================

alter table greendogops.person_employment
  add column if not exists schedule_type text;
