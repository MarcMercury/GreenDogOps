-- ============================================================================
-- Green Dog Ops — 0119 Student CRM program fields
-- ----------------------------------------------------------------------------
-- Student CRM profile overhaul:
--
--  1. `crm_contact.program_subcategory` — the free-text remainder of a program
--     label. The "Program name" (e.g. "SAPP") is now a managed dropdown value;
--     everything after it (e.g. "Avail / Split for holiday") lives here.
--
--  2. `crm_program_name` — a small reference table backing the Program Name
--     dropdown so coordinators can add new program names on the fly and have
--     them appear consistently across every student profile.
-- ============================================================================

alter table greendogops.crm_contact
  add column if not exists program_subcategory text;

create table if not exists greendogops.crm_program_name (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);

grant select, insert, update, delete
  on greendogops.crm_program_name to authenticated, service_role;

-- Seed the canonical Western / Massey program names. `on conflict do nothing`
-- keeps this idempotent and never clobbers names added later from the UI.
insert into greendogops.crm_program_name (name, sort_order) values
  ('SAPP', 10),
  ('SAP III/IV', 20),
  ('Dentistry Rotation', 30),
  ('Internal Medicine Rotation', 40),
  ('CVM 7035 Surgery Anesthesia', 50),
  ('CVM 7070 Dentistry Rotation', 60),
  ('Zoo/Exotics Wildlife Course', 70),
  ('Independent Study', 80),
  ('Shadowing', 90),
  ('Massey Student', 100),
  ('Externship', 110),
  ('Internship', 120)
on conflict (name) do nothing;
