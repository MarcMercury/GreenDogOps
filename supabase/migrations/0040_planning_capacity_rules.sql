-- ============================================================================
-- Green Dog Ops — 0040 Planning Capacity Rules
-- ----------------------------------------------------------------------------
-- Self-managed appointment-capacity rules for the Daily Capacity page. Each
-- rule answers the question "for this schedule AREA, if this staffing situation
-- exists, then this many appointments are available." Areas are the planning
-- departments (AP, NAD, Clinic/Wellness/UC, IM, EXOTICS …); the condition is a
-- staffing signature (DVMs + support roles) that mirrors the planning-guide
-- staffing key, and `appointment_capacity` is the total bookable appointments
-- that team can render under that condition.
--
-- The Daily Capacity view resolves the best-matching rule for each staffed
-- (location, department, day) and shows its capacity, so schedulers can manage
-- the assumptions behind capacity without hand-authoring a full guide grid.
-- Columns marked NULL are wildcards — they are not part of the rule's key.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.planning_capacity_rule (
  id                   uuid primary key default gen_random_uuid(),
  -- NULL location = the rule applies to any location for this area.
  location_id          uuid references greendogops.location (id) on delete cascade,
  -- The schedule area this rule governs (a planning department).
  department_id        uuid not null references greendogops.sched_department (id) on delete cascade,
  label                text,                               -- optional condition description
  weekdays             smallint[] not null default '{}',   -- 0=Sun .. 6=Sat; empty = any day
  -- Staffing condition — NULL means wildcard (not part of the rule's key).
  dvm_count            smallint,
  tech_count           smallint,
  lead_count           smallint,
  dental_count         smallint,
  da_count             smallint,
  float_count          smallint,
  -- Total appointments this team can render when the condition matches.
  appointment_capacity int  not null default 0 check (appointment_capacity >= 0),
  status               text not null default 'active'
                         check (status in ('active', 'archived')),
  sort_order           int  not null default 0,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists planning_capacity_rule_location_idx
  on greendogops.planning_capacity_rule (location_id);
create index if not exists planning_capacity_rule_department_idx
  on greendogops.planning_capacity_rule (department_id);

comment on table greendogops.planning_capacity_rule is
  'Condition -> appointment-capacity rules per schedule area, managed on the Daily Capacity page; drives the displayed capacity and planning-guide assumptions.';
comment on column greendogops.planning_capacity_rule.location_id is
  'Location the rule applies to; NULL = any location for this area.';
comment on column greendogops.planning_capacity_rule.appointment_capacity is
  'Total bookable appointments this area can render when the staffing condition matches.';

-- updated_at trigger ---------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.planning_capacity_rule;
create trigger set_updated_at before update on greendogops.planning_capacity_rule
  for each row execute function greendogops.set_updated_at();

-- Grants ---------------------------------------------------------------------
grant select, insert, update, delete
  on greendogops.planning_capacity_rule to authenticated, service_role;
