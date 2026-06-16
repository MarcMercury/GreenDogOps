-- ============================================================================
-- Green Dog Ops — 0002 HR module
-- ----------------------------------------------------------------------------
-- Shared person model that powers BOTH HR (employees) and ATS (prospects).
-- A person's `status` distinguishes them; hiring a prospect = changing status.
-- All objects live in the isolated `greendogops` schema.
-- ============================================================================

-- updated_at trigger helper -------------------------------------------------
create or replace function greendogops.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type greendogops.employment_status as enum
    ('prospect', 'applicant', 'employee', 'former', 'contractor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.work_location_type as enum ('in_house', 'remote', 'hybrid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.flsa_status as enum ('exempt', 'non_exempt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.work_schedule as enum
    ('full_time', 'part_time', 'per_diem', 'contractor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type greendogops.separation_type as enum ('quit', 'fired', 'laid_off', 'other');
exception when duplicate_object then null; end $$;

-- Lookups -------------------------------------------------------------------
create table if not exists greendogops.location (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists greendogops.position (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Core person (identity, shared by HR + ATS) --------------------------------
create table if not exists greendogops.person (
  id                  uuid primary key default gen_random_uuid(),
  status              greendogops.employment_status not null default 'prospect',
  status_changed_at   timestamptz not null default now(),
  first_name          text,
  last_name           text,
  preferred_name      text,
  grid_name           text,            -- short name shown on the schedule grid
  full_name           text,            -- as captured on the roster
  email               text,
  phone_mobile        text,
  date_of_birth       date,
  postal_code         text,            -- ZIP
  work_location_type  greendogops.work_location_type,
  avatar_url          text,
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);
create index if not exists person_status_idx on greendogops.person (status);
create index if not exists person_name_idx on greendogops.person (last_name, first_name);

-- Employment / payroll / PTO / CE / compliance / separation (1:1) -----------
create table if not exists greendogops.person_employment (
  person_id              uuid primary key references greendogops.person (id) on delete cascade,
  position_id            uuid references greendogops.position (id) on delete set null,
  location_id            uuid references greendogops.location (id) on delete set null,
  offer_title            text,         -- Offer Letter / Comp Adjustment Title
  adp_job_title          text,
  flsa_status            greendogops.flsa_status,
  work_schedule          greendogops.work_schedule,
  days_per_week          numeric(3,1),
  hire_date              date,
  original_hire_date     date,
  -- Compensation
  pay_type               text check (pay_type in ('hourly', 'salary', 'day_rate', 'contract')),
  current_rate           numeric(12,2),   -- hourly rate OR annual salary per contract
  previous_rate          numeric(12,2),
  latest_wage_change_date date,
  biweekly_wage          numeric(12,2),
  annual_wages           numeric(12,2),
  -- PTO
  pto_allotment          text,            -- can be a number or 'ACCRUED'
  pto_policy_allotment   numeric(6,2),
  pto_used               numeric(6,2),
  pto_available          numeric(6,2),
  pto_notes              text,
  -- Continuing education
  ce_budget              numeric(12,2),
  ce_used                numeric(12,2),
  ce_remaining           numeric(12,2),
  -- Benefits
  benefits_enrolled      boolean,
  benefits_monthly       numeric(12,2),
  benefits_annual        numeric(12,2),
  last_review_date       date,
  -- Compliance / onboarding checklist (flexible, evolving set)
  compliance             jsonb not null default '{}'::jsonb,
  -- Separation (for former employees)
  separation_date        date,            -- last day / notice day
  separation_type        greendogops.separation_type,
  separation_letter_signed boolean,
  separation_notes       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Recruiting / ATS data (1:1) — expanded in Phase 2 -------------------------
create table if not exists greendogops.person_recruiting (
  person_id            uuid primary key references greendogops.person (id) on delete cascade,
  target_position_id   uuid references greendogops.position (id) on delete set null,
  pipeline             text,            -- e.g. 'Remote CSR', 'DVM', 'Volunteers'
  stage                text,            -- e.g. 'No hire', 'Hired', 'Remain in Contact'
  status_notes         text,
  source               text,            -- "Found on:"
  interview_date       date,
  score                numeric(4,1),
  resume_url           text,
  keep_for_future      boolean,
  follow_up_date       date,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- updated_at triggers -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['location','position','person','person_employment','person_recruiting']
  loop
    execute format(
      'drop trigger if exists set_updated_at on greendogops.%I;
       create trigger set_updated_at before update on greendogops.%I
       for each row execute function greendogops.set_updated_at();', t, t);
  end loop;
end $$;
