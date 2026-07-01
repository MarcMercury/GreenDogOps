-- ============================================================================
-- Green Dog Ops — 0048 Employee licenses & annual-compliance cleanup
-- ----------------------------------------------------------------------------
-- The Onboarding tab grows two capabilities:
--
--   1. "Licenses & Expiration Dates" becomes a proper *list* of an employee's
--      professional credentials (DVM, RVT, DEA, etc.) instead of a single
--      checklist row. Each license tracks its number, issuing authority, issue
--      date and — most importantly — its expiration date, so it can be renewed
--      over time. Backed by the new `person_license` table below.
--
--   2. Sexual-harassment and safety training move into an "Annual Compliance"
--      section that only cares about the *last completed date*. They keep using
--      the existing `person_onboarding_item` table (item_key unchanged), so no
--      data migration is needed for them.
--
-- The obsolete "Approved / Denied List" checklist item is removed from the
-- catalog in code; its stored rows (if any) are cleaned up here.
-- ============================================================================

create table if not exists greendogops.person_license (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references greendogops.person (id) on delete cascade,
  name              text not null,
  license_number    text,
  issuing_authority text,
  issued_date       date,
  expiration_date   date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists person_license_person_idx
  on greendogops.person_license (person_id);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.person_license;
create trigger set_updated_at before update on greendogops.person_license
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Remove the retired "Approved / Denied List" checklist rows. The licenses
-- checklist row is intentionally left in place — its history is harmless and
-- the new list lives in its own table.
-- ---------------------------------------------------------------------------
delete from greendogops.person_onboarding_item
where item_key = 'approved_denied';
