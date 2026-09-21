-- ============================================================================
-- Green Dog Ops — 0205 Recruiting candidate background & screening fields
-- ----------------------------------------------------------------------------
-- Job-board exports (Indeed "candidates" CSV) carry several columns we had
-- nowhere to put: where the candidate lives, their most relevant experience,
-- education, which posting/location they applied to, the recruiter's interest
-- level, the board's own status, and the answers to the screening questions
-- attached to the posting.
--
-- These are permanent parts of a recruiting profile, so they live on
-- person_recruiting alongside stage/source rather than in free-text notes.
--
-- Repeat applicants are common (someone applies to three postings over a
-- year). The scalar columns always describe the MOST RECENT application;
-- application_history keeps every application, newest first.
-- ============================================================================

set search_path = greendogops, public;

alter table greendogops.person_recruiting
  add column if not exists candidate_location  text,
  add column if not exists relevant_experience text,
  add column if not exists education           text,
  add column if not exists job_location        text,
  add column if not exists interest_level      text,
  add column if not exists external_status     text,
  add column if not exists source_detail       text,
  add column if not exists screening_answers   jsonb not null default '[]'::jsonb,
  add column if not exists application_history jsonb not null default '[]'::jsonb;

alter table greendogops.person_recruiting
  drop constraint if exists person_recruiting_interest_level_check;
alter table greendogops.person_recruiting
  add constraint person_recruiting_interest_level_check
  check (interest_level is null or interest_level in ('Yes', 'Maybe', 'Reject'));

create index if not exists person_recruiting_interest_level_idx
  on greendogops.person_recruiting (interest_level);
create index if not exists person_recruiting_job_location_idx
  on greendogops.person_recruiting (job_location);

comment on column greendogops.person_recruiting.candidate_location is
  'Where the candidate lives, as reported on their application (e.g. "Reseda, CA").';
comment on column greendogops.person_recruiting.relevant_experience is
  'Most relevant prior role/experience summarized from the application or resume.';
comment on column greendogops.person_recruiting.education is
  'Highest level of education reported by the candidate.';
comment on column greendogops.person_recruiting.job_location is
  'Green Dog posting location the candidate applied to (e.g. "Van Nuys, CA 91411").';
comment on column greendogops.person_recruiting.interest_level is
  'Recruiter interest rating carried from the job board: Yes, Maybe, or Reject.';
comment on column greendogops.person_recruiting.external_status is
  'Status in the originating job board''s own ATS (e.g. Indeed: Awaiting Review, '
  'Reviewed, Contacting, Hired, Rejected). Kept for reconciliation with the board.';
comment on column greendogops.person_recruiting.source_detail is
  'Sub-source within `source` (e.g. Indeed "Sponsored Job Link" vs organic "Indeed").';
comment on column greendogops.person_recruiting.screening_answers is
  'Answers to the posting''s screening questions: '
  '[{"question":text,"answer":text,"match":"Yes"|"No"|"N/A"}], newest application.';
comment on column greendogops.person_recruiting.application_history is
  'Every application this person has submitted, newest first: '
  '[{"date":"YYYY-MM-DD","job_title":text,"job_location":text,"status":text,'
  '"interest_level":text,"source":text}]. The scalar columns mirror entry 0.';
