-- ============================================================================
-- Green Dog Ops — 0005 HR profile tabs
-- ----------------------------------------------------------------------------
-- Backing tables for the new Employee Profile tabs:
--   * person_review   — performance / disciplinary review log
--   * person_asset    — items (laptops, badges, scrubs, keys) assigned to staff
--   * person_document — uploadable document list (files in Storage)
-- "History" tab reuses the existing greendogops.person_recruiting record, so it
-- needs no new table here.
-- ============================================================================

-- Reviews -------------------------------------------------------------------
create table if not exists greendogops.person_review (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references greendogops.person (id) on delete cascade,
  review_date       date,
  review_type       text,     -- annual, 90_day, performance, disciplinary, check_in
  reviewer          text,
  rating            text,     -- free text or score, e.g. "Exceeds", "4/5"
  summary           text,
  next_review_date  date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists person_review_person_idx
  on greendogops.person_review (person_id, review_date desc);

-- Assets --------------------------------------------------------------------
create table if not exists greendogops.person_asset (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references greendogops.person (id) on delete cascade,
  asset_name      text not null,
  asset_type      text,        -- laptop, phone, badge, key, scrubs, other
  identifier      text,        -- serial number / asset tag
  assigned_date   date,
  returned_date   date,
  status          text not null default 'assigned',  -- assigned, returned, lost, damaged
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists person_asset_person_idx
  on greendogops.person_asset (person_id, status);

-- Documents -----------------------------------------------------------------
create table if not exists greendogops.person_document (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references greendogops.person (id) on delete cascade,
  title         text not null,
  category      text,          -- contract, license, certification, id, review, other
  storage_path  text not null, -- object path within the employee-documents bucket
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists person_document_person_idx
  on greendogops.person_document (person_id, uploaded_at desc);

-- updated_at triggers -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['person_review','person_asset','person_document']
  loop
    execute format(
      'drop trigger if exists set_updated_at on greendogops.%I;
       create trigger set_updated_at before update on greendogops.%I
       for each row execute function greendogops.set_updated_at();', t, t);
  end loop;
end $$;

grant select, insert, update, delete on greendogops.person_review   to authenticated, service_role;
grant select, insert, update, delete on greendogops.person_asset    to authenticated, service_role;
grant select, insert, update, delete on greendogops.person_document to authenticated, service_role;

-- Private Storage bucket for employee documents -----------------------------
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;
