-- ============================================================================
-- Green Dog Ops — 0030 Department "show in planning" flag
-- ----------------------------------------------------------------------------
-- Adds a per-department toggle that controls whether a scheduling department
-- appears in the Planning Guides "Department" dropdown. Defaults to false so
-- the dropdown stays focused; the appointment-facing departments are enabled
-- below to match the existing seeded planning guides.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.sched_department
  add column if not exists show_in_planning boolean not null default false;

-- Enable the departments that drive appointment planning guides.
update greendogops.sched_department
  set show_in_planning = true
  where name in ('Clinic/Wellness/UC', 'NAD', 'AP', 'IM', 'EXOTICS');
