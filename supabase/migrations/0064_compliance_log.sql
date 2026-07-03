-- ============================================================================
-- Green Dog Ops — 0064 Annual compliance log
-- ----------------------------------------------------------------------------
-- The Onboarding tab's "Annual Compliance" section becomes an ongoing *log*:
-- every time a compliance item (e.g. Sexual Harassment Training, Safety
-- Training) is completed, a dated entry is recorded, building a history over
-- time. HR can also add custom compliance lines via an "Add Item" button.
--
-- Entries live in the new `person_compliance_entry` table (many rows per
-- person per compliance track), replacing the single-row annual model that
-- used `person_onboarding_item`. Existing annual rows that carry a completed
-- date are migrated over as the first log entry, then the annual (and the
-- retired "Onboarding Checklist") rows are removed from the checklist table.
-- ============================================================================

create table if not exists greendogops.person_compliance_entry (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references greendogops.person (id) on delete cascade,
  -- Stable track key: a catalog key (e.g. 'safety_training') or a custom key.
  compliance_key  text not null,
  -- Display label, stored per row so custom tracks survive without a catalog.
  label           text not null,
  completed_date  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists person_compliance_entry_person_idx
  on greendogops.person_compliance_entry (person_id);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.person_compliance_entry;
create trigger set_updated_at before update on greendogops.person_compliance_entry
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Migrate existing annual-compliance rows (only those with a recorded date)
-- into the log as their first entry.
-- ---------------------------------------------------------------------------
insert into greendogops.person_compliance_entry
  (person_id, compliance_key, label, completed_date, notes)
select
  o.person_id,
  o.item_key,
  case o.item_key
    when 'sexual_harassment_training' then 'Sexual Harassment Training'
    when 'safety_training'            then 'Safety Training'
    else o.item_key
  end,
  o.completed_date,
  o.notes
from greendogops.person_onboarding_item o
where o.item_key in ('sexual_harassment_training', 'safety_training')
  and o.completed_date is not null;

-- ---------------------------------------------------------------------------
-- Remove the retired checklist rows now handled elsewhere:
--   * the two annual-compliance items (moved to the log above)
--   * the "Onboarding Checklist" item (dropped from the catalog)
-- ---------------------------------------------------------------------------
delete from greendogops.person_onboarding_item
where item_key in (
  'sexual_harassment_training',
  'safety_training',
  'onboarding_checklist'
);
