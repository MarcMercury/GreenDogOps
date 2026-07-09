-- ============================================================================
-- Green Dog Ops — 0077 CE event CEbroker submission fields
-- ----------------------------------------------------------------------------
-- Expands crm_ce_event so a CE event captures everything needed to submit the
-- course to CEbroker (providers.cebroker.com) AND to run the event internally,
-- mirroring the GDD CE setup/registration workflow:
--   * CEbroker course record  — course type, delivery method, tracking number,
--     description, learning objectives, disclosure statements.
--   * RACE / AAVSB approval    — approval board, status, RACE flag, granted CE
--     hours split medical vs non-medical, effective window, projected offering
--     date, and the date rosters may begin.
--   * Presenter & marketing    — presenter bio, public website/registration URL.
--   * Event logistics          — what's included, who should attend, social
--     dinner flag.
-- All columns are nullable / defaulted so existing rows stay valid.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  -- CEbroker course record ----------------------------------------------------
  add column if not exists course_type            text,   -- Live Course | RACE online interactive | ...
  add column if not exists delivery_method         text,   -- Seminar/Lecture | Lab/Wet Lab | ...
  add column if not exists tracking_number         text,   -- CEbroker tracking number (e.g. 20-1305377)
  add column if not exists learning_objectives     text,
  add column if not exists disclosure_statements   text,
  -- RACE / AAVSB approval -----------------------------------------------------
  add column if not exists approval_board          text,   -- e.g. AAVSB
  add column if not exists approval_status         text,   -- pending | submitted | registered | approved | denied
  add column if not exists race_approved           boolean not null default false,
  add column if not exists ce_hours_total          numeric,
  add column if not exists ce_hours_medical        numeric,
  add column if not exists ce_hours_nonmedical     numeric,
  add column if not exists effective_start         date,
  add column if not exists effective_end           date,
  add column if not exists projected_offering_date date,
  add column if not exists rosters_allowed_date    date,
  -- Presenter & marketing -----------------------------------------------------
  add column if not exists presenter_bio           text,
  add column if not exists website_url             text,
  -- Event logistics -----------------------------------------------------------
  add column if not exists whats_included          text,
  add column if not exists who_should_attend       text,
  add column if not exists social_dinner           boolean not null default false;

comment on column greendogops.crm_ce_event.tracking_number is
  'CEbroker course tracking number assigned on submission (e.g. 20-1305377).';
comment on column greendogops.crm_ce_event.ce_hours_medical is
  'RACE medical CE hours granted for this course.';
comment on column greendogops.crm_ce_event.ce_hours_nonmedical is
  'RACE non-medical CE hours granted for this course.';
