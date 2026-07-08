-- ============================================================================
-- Green Dog Ops — 0072 Preferred work location
-- ----------------------------------------------------------------------------
-- Employees can designate a preferred work location (a clinic from the central
-- locations directory). It lives on the HR roster record — person_employment —
-- as the single source of truth, and is mirrored into the Schedule → Setup →
-- Employees tab so the schedule admin can see and edit the same value.
--
-- This is distinct from sched_employee_setting.eligible_location_ids (where an
-- employee *may* be scheduled). Preferred location is simply the location the
-- employee has said they would like to work at.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.person_employment
  add column if not exists preferred_location_id uuid
    references greendogops.location (id) on delete set null;

comment on column greendogops.person_employment.preferred_location_id is
  'Location the employee has designated as their preferred work location. '
  'Set on the HR roster and mirrored in Schedule → Setup → Employees.';
