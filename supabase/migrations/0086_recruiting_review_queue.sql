-- ============================================================================
-- Green Dog Ops — 0086 Recruiting intake review queue
-- ----------------------------------------------------------------------------
-- Auto-ingested applicants (Gmail poller + Indeed Apply webhook) land in a
-- review queue instead of going straight into the active pipeline. A recruiter
-- accepts (→ active lead) or rejects (→ declined) each one. Declined records
-- are retained so a later re-application can be detected and reopened.
--
--   review_status:
--     'pending'  — awaiting a recruiter's accept/reject decision (auto-intake)
--     'accepted' — an active lead in the pipeline (also the DEFAULT, so every
--                  existing row and all manual entries remain visible as-is)
--     'declined' — rejected but retained for re-apply detection
-- ============================================================================

set search_path = greendogops, public;

alter table greendogops.person_recruiting
  add column if not exists review_status text not null default 'accepted',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

alter table greendogops.person_recruiting
  drop constraint if exists person_recruiting_review_status_check;
alter table greendogops.person_recruiting
  add constraint person_recruiting_review_status_check
  check (review_status in ('pending', 'accepted', 'declined'));

create index if not exists person_recruiting_review_status_idx
  on greendogops.person_recruiting (review_status);

comment on column greendogops.person_recruiting.review_status is
  'Intake triage state: pending (awaiting accept/reject), accepted (active '
  'lead), or declined (rejected but retained for re-apply detection).';
comment on column greendogops.person_recruiting.reviewed_at is
  'When the pending applicant was accepted or rejected.';
comment on column greendogops.person_recruiting.reviewed_by is
  'auth.uid() of the recruiter who accepted or rejected the applicant.';
