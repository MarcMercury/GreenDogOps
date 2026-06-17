-- 0013_student_comprehensive.sql
-- Adds the remaining student-rotation tracking fields surfaced by the
-- "Western Grid - Students Comprehensive" workbook so nothing from the source
-- of truth is lost in the Student CRM.
--
-- These live on greendogops.crm_contact alongside the existing student/CE
-- fields so the same columns are available to every contact_type (students and
-- CE attendees) — keeping related profile types consistent. The student detail
-- carries onto the recruiting record at promotion time (see actions.ts).
--
--   supervising_dvm    : assigned doctor for the rotation (Any / Doc / Geist / Rally…)
--   weekday_schedule   : days on site (M-F, "TU & TH ONLY", "M/T then M-Sat"…)
--   doc_recommendation : Dr. Hab color rating from the grid (Green / Red…)
--   hire_interest      : recruiting flag from the grid ("Want to hire", "No", "Absent"…)
--   grad_year          : DVM graduation cohort (DVM 2025 / 2026 / 2027…)
--   stipend            : stipend status text (Yes / No / "No stipend" / "No, Professor"…)
--   completed          : rotation finished
--   stipend_paid       : stipend has been paid out
--   check_cashed       : stipend check has cleared

alter table greendogops.crm_contact
  add column if not exists supervising_dvm    text,
  add column if not exists weekday_schedule   text,
  add column if not exists doc_recommendation text,
  add column if not exists hire_interest      text,
  add column if not exists grad_year          text,
  add column if not exists stipend            text,
  add column if not exists completed          boolean,
  add column if not exists stipend_paid       boolean,
  add column if not exists check_cashed       boolean;

comment on column greendogops.crm_contact.supervising_dvm is
  'Assigned supervising doctor for the rotation (Any / Doc / Geist / Rally…).';
comment on column greendogops.crm_contact.weekday_schedule is
  'Days on site for the rotation (e.g. M-F, "TU & TH ONLY").';
comment on column greendogops.crm_contact.doc_recommendation is
  'Dr. Hab color-coded recommendation from the student grid (Green / Red…).';
comment on column greendogops.crm_contact.hire_interest is
  'Recruiting flag from the student grid ("Want to hire", "No", "Absent"…).';
comment on column greendogops.crm_contact.grad_year is
  'DVM graduation cohort (e.g. DVM 2026).';
comment on column greendogops.crm_contact.stipend is
  'Stipend status text (Yes / No / "No stipend" / "No, Professor"…).';
comment on column greendogops.crm_contact.completed is
  'Whether the rotation has been completed.';
comment on column greendogops.crm_contact.stipend_paid is
  'Whether the student stipend has been paid out.';
comment on column greendogops.crm_contact.check_cashed is
  'Whether the stipend check has cleared.';
