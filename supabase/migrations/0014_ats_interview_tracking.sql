-- ============================================================================
-- Green Dog Ops — 0014 ATS interview tracking
-- ----------------------------------------------------------------------------
-- Backing table for the new ATS "Interview Tracking" candidate-profile tab.
-- Each row is one interview event (phone screen, in-person, working interview,
-- final / decision) logged against a recruiting candidate, modeled after the
-- "IN HOUSE CSR INTERVIEW TEMPLATE": date, interviewer, location, overall
-- grade, recommendation, status, a summary, and a structured set of
-- question / answer responses captured as JSON.
-- ============================================================================

set search_path = greendogops, public;

create table if not exists greendogops.person_interview (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references greendogops.person (id) on delete cascade,
  interview_date  date,
  interview_type  text,        -- phone_screen, in_person, working_interview, final, other
  interviewer     text,
  location        text,
  status          text not null default 'scheduled',  -- scheduled, completed, no_show, cancelled
  overall_grade   text,        -- A / B / C / D / F (or free text)
  recommendation  text,        -- advance, hold, pass
  summary         text,
  responses       jsonb not null default '[]'::jsonb,  -- [{ "question": text, "answer": text }]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists person_interview_person_idx
  on greendogops.person_interview (person_id, interview_date desc);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.person_interview;
create trigger set_updated_at before update on greendogops.person_interview
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.person_interview
  to authenticated, service_role;
