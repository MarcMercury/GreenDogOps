-- ============================================================================
-- Green Dog Ops — 0073 Disciplinary actions
-- ----------------------------------------------------------------------------
-- Backing table for the Employee Profile → Disciplinary Action tab. Mirrors the
-- person_review log: each row is one dated disciplinary write-up capturing who
-- reported it, the nature of the violation, and witnesses.
-- ============================================================================

create table if not exists greendogops.person_disciplinary_action (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references greendogops.person (id) on delete cascade,
  incident_date      date,
  reported_by        text,   -- "Your name" — who filed the write-up
  employee_position  text,   -- position of the employee being disciplined
  violation_type     text,   -- job_performance, conduct, attendance, safety, policy, other
  nature             text,   -- narrative description of the violation
  action_taken       text,   -- corrective action / next steps
  witnesses          text,   -- comma-separated witness names
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists person_disciplinary_action_person_idx
  on greendogops.person_disciplinary_action (person_id, incident_date desc);

drop trigger if exists set_updated_at on greendogops.person_disciplinary_action;
create trigger set_updated_at before update on greendogops.person_disciplinary_action
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.person_disciplinary_action to authenticated, service_role;
