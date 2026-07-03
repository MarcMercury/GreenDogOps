-- ============================================================================
-- Green Dog Ops — 0065 Student CRM improvements
-- ----------------------------------------------------------------------------
-- Two additions driven by the Student CRM profile overhaul:
--
--  1. `crm_contact.degree_type` — the student's veterinary degree track (DVM or
--     a specialty diplomate abbreviation). Backed by a dropdown in the UI.
--
--  2. Student mentor / coordinator eligibility flags on the per-employee
--     scheduling settings. These are NOT shifts — a person is never scheduled
--     for them — but they are edited from the same "Shift eligibility" surface
--     (HR profile + Schedule → Setup) under a new "Student" section. They drive
--     which roster members appear in the student Mentor / Coordinator dropdowns.
-- ============================================================================

alter table greendogops.crm_contact
  add column if not exists degree_type text;

alter table greendogops.sched_employee_setting
  add column if not exists is_student_mentor      boolean not null default false,
  add column if not exists is_student_coordinator boolean not null default false;
