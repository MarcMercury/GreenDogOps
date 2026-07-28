-- ============================================================================
-- Green Dog Ops — 0146 CE event CE Broker submission package
-- ----------------------------------------------------------------------------
-- Adds the pieces needed to hand a RACE-ready course off to CE Broker (Propelus)
-- in one shot. CE Broker does NOT approve CE — AAVSB RACE does (see migration
-- 0145 / the RACE Standards). CE Broker is where the RACE-approved course is
-- submitted to state board(s) and where completions are reported. Its course
-- wizard requires FILE ATTACHMENTS (course summary, RACE approval letter,
-- agenda, presenter CVs), so we capture those here as a document set plus a
-- submitted flag so the "Submit to CE Broker" package is complete.
--   * submission_documents  — jsonb array of {id,kind,label,url,description}.
--   * cebroker_submitted     — marked once the course has been pushed to CE Broker.
--   * cebroker_submitted_at  — timestamp of that submission.
-- All columns are nullable / defaulted so existing rows stay valid.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.crm_ce_event
  add column if not exists submission_documents  jsonb not null default '[]'::jsonb,
  add column if not exists cebroker_submitted     boolean not null default false,
  add column if not exists cebroker_submitted_at  timestamptz;

comment on column greendogops.crm_ce_event.submission_documents is
  'Documents attached to the CE Broker / board submission: jsonb array of '
  '{id, kind, label, url, description}. kind ∈ course_summary | race_approval | '
  'agenda | presenter_cv | disclosure | marketing | other.';
comment on column greendogops.crm_ce_event.cebroker_submitted is
  'True once the RACE-approved course has been submitted to CE Broker for board '
  'distribution.';
comment on column greendogops.crm_ce_event.cebroker_submitted_at is
  'Timestamp the course was submitted to CE Broker.';
