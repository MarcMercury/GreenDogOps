-- ============================================================================
-- Green Dog Ops — 0154 ezyVet Animals (patient roster)
-- ----------------------------------------------------------------------------
-- The ezyVet Report Center "Animals" report is a full snapshot of every patient
-- record with its summary (species/breed/sex/weight, vaccination + visit dates,
-- master problems, insurance, referring clinic) and the owning contact's name
-- and contact details.
--
-- It is scraped nightly by the ezyVet agent worker exactly like the "Contacts"
-- report (see 0036 / 0090) and upserted here, deduped on the ezyVet Animal Id.
-- The report has no date range — every run is a fresh full snapshot, so this
-- table always mirrors the current state of the practice's patient list.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.ezyvet_animal (
  id                    uuid primary key default gen_random_uuid(),
  ezyvet_animal_id      text not null unique,
  animal_code           text,
  animal_name           text,
  division              text,

  -- Patient summary
  species               text,
  breed                 text,
  color                 text,
  sex                   text,
  weight_lb             numeric,
  date_of_birth         date,
  dob_is_estimated      boolean,
  age                   text,
  is_active             boolean,
  has_passed_away       boolean,
  date_of_passing       date,
  cause_of_death        text,
  caution_status        text,
  microchip_number      text,
  rabies_number         text,
  rabies_number_date    date,
  last_vaccination_date date,
  last_vaccination_name text,
  next_vaccination_due  date,
  next_vaccination_name text,
  master_problems       text,
  animal_notes          text,
  last_visit            date,
  next_appointment      date,
  latest_bcs            text,
  latest_ds             text,
  latest_temp           text,
  insurance_supplier    text,
  insurance_number      text,
  referring_clinic      text,
  referring_vet         text,

  -- Owner (the ezyVet contact this patient belongs to)
  owner_contact_code    text,
  owner_business_name   text,
  owner_title           text,
  owner_first_name      text,
  owner_last_name       text,
  owner_full_name       text,
  owner_is_business     boolean,
  opt_out_marketing     boolean,
  email                 text,
  home_email            text,
  business_email        text,
  accounts_email        text,
  phone                 text,
  mobile                text,
  fax                   text,
  physical_street1      text,
  physical_street2      text,
  physical_suburb       text,
  physical_city         text,
  physical_state        text,
  physical_post_code    text,
  physical_country      text,
  postal_street1        text,
  postal_street2        text,
  postal_suburb         text,
  postal_city           text,
  postal_state          text,
  postal_post_code      text,
  postal_country        text,

  -- ezyVet record audit
  ezyvet_created_at     timestamptz,
  ezyvet_created_by     text,
  ezyvet_modified_at    timestamptz,

  first_seen_at         timestamptz not null default now(),
  last_import_id        uuid,
  updated_at            timestamptz not null default now()
);

create index if not exists idx_ezv_animal_name     on greendogops.ezyvet_animal (animal_name);
create index if not exists idx_ezv_animal_species  on greendogops.ezyvet_animal (species);
create index if not exists idx_ezv_animal_division on greendogops.ezyvet_animal (division);
create index if not exists idx_ezv_animal_owner    on greendogops.ezyvet_animal (owner_contact_code);
create index if not exists idx_ezv_animal_active   on greendogops.ezyvet_animal (is_active);
create index if not exists idx_ezv_animal_visit    on greendogops.ezyvet_animal (last_visit);

-- One row per ingest run (the worker uploads the snapshot in several chunks;
-- they all share a single import row, whose counters accumulate).
create table if not exists greendogops.ezyvet_animal_import (
  id                 uuid primary key default gen_random_uuid(),
  filename           text,
  uploaded_by        uuid,
  total_rows         integer not null default 0,
  new_animals        integer not null default 0,
  updated_animals    integer not null default 0,
  unchanged_animals  integer not null default 0,
  snapshot_date      date,
  details            jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ezv_animal_import_created
  on greendogops.ezyvet_animal_import (created_at desc);

grant select, insert, update, delete on
  greendogops.ezyvet_animal,
  greendogops.ezyvet_animal_import
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Roll-ups for the patient list page (headline counts + species filter).
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_animal_summary as
select
  count(*)::int                                    as total_animals,
  count(*) filter (where is_active)::int           as active_animals,
  count(*) filter (where has_passed_away)::int     as deceased_animals,
  count(distinct owner_contact_code)::int          as owners
from greendogops.ezyvet_animal;

create or replace view greendogops.report_animals_by_species as
select
  coalesce(nullif(species, ''), 'Unknown') as species,
  count(*)::int                            as patients
from greendogops.ezyvet_animal
group by 1
order by 2 desc;

grant select on
  greendogops.report_animal_summary,
  greendogops.report_animals_by_species
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Register the report in the daily ezyVet agent's catalog.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'ezyvet_animals', 'ezyVet Animals (Patients)', 'global',
       'Full patient list with summaries (species, breed, vaccinations, visits, owner). Daily snapshot upserted into ezyvet_animal.',
       'ezyvet_animal', 16
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
