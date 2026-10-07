-- ============================================================================
-- Green Dog Ops — 0221 Recruiting: full website application on the profile
-- ----------------------------------------------------------------------------
-- Indeed ads now send candidates to the greendog careers "Apply" form, which
-- collects far more than name/contact/role: availability, eligibility,
-- experience, employment history, credentials, role-specific skills, written
-- answers, references and acknowledgements.
--
-- The question set will keep evolving with the form, so it is stored as one
-- JSON document rather than dozens of columns. The schema lives in code
-- (src/lib/ats/application.ts). The summary columns the pipeline filters on
-- (source, education, relevant_experience, candidate_location, postal_code)
-- are still derived into their own columns at intake.
-- ============================================================================

set search_path = greendogops, public;

alter table greendogops.person_recruiting
  add column if not exists application jsonb not null default '{}'::jsonb;

comment on column greendogops.person_recruiting.application is
  'Full website application, keyed by src/lib/ats/application.ts: '
  '{"answers":{key:text|text[]},"employment":[{...}],"references":[{...}],'
  '"languages":[{"language":text,"fluency":text}],"skills":{key:level},'
  '"extra":[{"label":text,"value":text}],"received_at":timestamptz}. '
  'Empty object when the candidate did not apply through the website form.';
