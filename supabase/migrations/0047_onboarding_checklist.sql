-- ============================================================================
-- Green Dog Ops — 0047 Onboarding checklist
-- ----------------------------------------------------------------------------
-- Backing table for the Employee Profile "Onboarding" tab. Each row tracks one
-- checklist item for one person with a two-state model that mirrors real
-- veterinary onboarding: "Provided/Sent" and "Completed/Signed/Received", each
-- with an optional date, plus free-text notes.
--
-- The item catalog itself lives in code (src/lib/hr/onboarding.ts) so it can
-- evolve without a migration; this table only stores per-person state keyed by
-- a stable `item_key`.
--
-- A one-time backfill seeds the table from the legacy
-- greendogops.person_employment.compliance JSON (imported from the Merit
-- Increase Calculator) so nothing is lost. Backfill is idempotent
-- (on conflict do nothing) and never clobbers edits made in the app.
-- ============================================================================

create table if not exists greendogops.person_onboarding_item (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references greendogops.person (id) on delete cascade,
  item_key       text not null,
  provided       boolean not null default false,
  provided_date  date,
  completed      boolean not null default false,
  completed_date date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (person_id, item_key)
);

create index if not exists person_onboarding_item_person_idx
  on greendogops.person_onboarding_item (person_id);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.person_onboarding_item;
create trigger set_updated_at before update on greendogops.person_onboarding_item
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- One-time backfill from person_employment.compliance
-- ---------------------------------------------------------------------------

-- Loose text -> boolean: anything that reads as affirmative (or is a date)
-- counts as done; "NO", "N/A", "False", blanks count as not done.
create or replace function greendogops.ob_bool(t text)
returns boolean language sql immutable as $$
  select case
    when t is null then false
    when lower(btrim(t)) in (
      'true','yes','y','1','done','complete','completed',
      'signed','sent','provided','processed','paid','cleared','received','x'
    ) then true
    when btrim(t) ~ '^\d{4}-\d{2}-\d{2}' then true  -- a date implies done
    else false
  end;
$$;

-- Loose text -> date: only when the value actually parses as a date.
create or replace function greendogops.ob_date(t text)
returns date language plpgsql immutable as $$
begin
  if t is null then return null; end if;
  begin
    return btrim(t)::date;
  exception when others then
    return null;
  end;
end;
$$;

insert into greendogops.person_onboarding_item
  (person_id, item_key, provided, provided_date, completed, completed_date)
select
  e.person_id,
  m.item_key,
  greendogops.ob_bool(e.compliance ->> m.provided_key),
  greendogops.ob_date(e.compliance ->> m.provided_key),
  greendogops.ob_bool(e.compliance ->> m.completed_key),
  greendogops.ob_date(e.compliance ->> m.completed_key)
from greendogops.person_employment e
cross join (values
  ('offer_letter',               null::text,                     'offer_letter_completed'),
  ('handbook',                    null,                           'handbook_signed'),
  ('onboarding_checklist',        null,                           'onboarding_completed'),
  ('benefits',                    null,                           'benefits_completed'),
  ('sexual_harassment_training',  null,                           'sexual_harassment_training_date'),
  ('harassment_pay',              null,                           'harassment_pay'),
  ('background_check',            null,                           'background_check_processed'),
  ('safety_training',             null,                           'safety_training'),
  ('emergency_contact',           null,                           'emergency_contact_form'),
  ('employee_contract',           'contract_sent',                'contract_signed'),
  ('approved_denied',             null,                           'approved_denied'),
  ('ce_contract',                 'ce_contract_sent',             'ce_contract_signed'),
  ('immigration_agreement',       'immigration_agreement_sent',   'immigration_agreement_signed'),
  ('licenses',                    null,                           'licenses_tracked')
) as m(item_key, provided_key, completed_key)
where e.compliance is not null
  and e.compliance <> '{}'::jsonb
  and (
    e.compliance ? m.completed_key
    or (m.provided_key is not null and e.compliance ? m.provided_key)
  )
on conflict (person_id, item_key) do nothing;

drop function if exists greendogops.ob_bool(text);
drop function if exists greendogops.ob_date(text);
