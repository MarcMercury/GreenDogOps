-- ============================================================================
-- Green Dog Ops — 0144 CE event RACE Standards submission fields
-- ----------------------------------------------------------------------------
-- Captures everything the AAVSB RACE Standards (2026, effective Aug 1 2026)
-- require in a program application so a CE event can be built ONCE and submitted
-- to RACE cleanly. Mirrors the RACE Standards sections:
--   * Program category   (Sec 3)   — medical vs non-medical subject matter.
--   * Interactivity      (Sec 5)   — interactive vs non-interactive delivery,
--                                     which drives credit calc + post-test rules.
--   * Course format      (Sec 7)   — single course | conference | series/modular
--                                     (determines which roster template applies).
--   * Presenter info     (Sec 7.04)— subject-matter-expert qualifications + a
--                                     CV / RACE template link required per program.
--   * Conflict of intr.  (Sec 6)   — flags product/service programs needing a
--                                     disclosure statement.
--   * Post-course test   (Sec 5.02)— non-interactive programs need >=5 questions
--                                     per CE credit, 70% pass.
--   * ADA compliance     (Sec 5.03)— provider acknowledgment.
-- All columns are nullable / defaulted so existing rows stay valid.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  add column if not exists race_program_category   text,    -- medical | nonmedical | both
  add column if not exists race_interactivity      text,    -- interactive | noninteractive
  add column if not exists race_course_format       text,    -- single | conference | series_modular
  add column if not exists presenter_qualifications text,
  add column if not exists presenter_cv_url         text,
  add column if not exists has_conflict_of_interest boolean not null default false,
  add column if not exists post_test_questions      numeric,
  add column if not exists ada_acknowledged         boolean not null default false;

comment on column greendogops.crm_ce_event.race_program_category is
  'RACE program category (Sec 3): medical, nonmedical, or both. Drives the '
  'medical/non-medical CE hour split.';
comment on column greendogops.crm_ce_event.race_interactivity is
  'RACE method of delivery (Sec 5): interactive (able to interact with the '
  'presenter) vs non-interactive/on-demand. Non-interactive requires a post-'
  'course test (>=5 questions per credit, 70% pass).';
comment on column greendogops.crm_ce_event.race_course_format is
  'RACE course type (Sec 7): single course, conference (multi-session roster), '
  'or series/modular (all courses required before credit).';
comment on column greendogops.crm_ce_event.presenter_qualifications is
  'Presenter subject-matter-expert qualifications required for RACE (Sec 7.04): '
  'board certification / VTS / advanced degree / peer-reviewed publications, etc.';
comment on column greendogops.crm_ce_event.presenter_cv_url is
  'Link to the presenter CV / resume / RACE template page attached to the RACE '
  'application (required per presenter, Sec 7.04).';
comment on column greendogops.crm_ce_event.has_conflict_of_interest is
  'Program educates about a product/service/company or presenter has a commercial '
  'relationship (Sec 6.01/6.02) — a disclosure statement is then required.';
comment on column greendogops.crm_ce_event.post_test_questions is
  'Number of post-course test questions. RACE requires >=5 per CE credit for '
  'non-interactive programs, awarded only at 70% or higher (Sec 5.02).';
comment on column greendogops.crm_ce_event.ada_acknowledged is
  'Provider acknowledges ADA / disabilities-law compliance for the program '
  '(Sec 5.03).';
