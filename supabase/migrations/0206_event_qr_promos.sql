-- ============================================================================
-- Green Dog Ops — 0206 Event QR codes, custom forms, event leads & event promos
-- ----------------------------------------------------------------------------
-- WHY: events are worked in person, and the only way we capture who we met is a
-- clipboard. This migration gives every event (and later any promo or retail
-- partner) its own QR code pointing at a custom, per-code intake form. Scans
-- land in greendogops.qr_lead and surface as the "Event Leads" tab.
--
-- It also promotes the promo we run at an event to a first-class thing: the
-- event records whether it HAS a promo plus its active window, and that row is
-- mirrored into marketing_promotion so the Promotions tab is the single list of
-- every promotion we are running — event-driven or not.
--
-- NOTE: the QR token is an opaque 16-char hex handle (greendogops.new_qr_token
-- from 0186), never the row id — the URL is public and must not be enumerable.
-- Non-Med Partner codes keep living on crm_organization.qr_token (/lead/<token>);
-- the QR Code Mgmt page unions the two at read time rather than migrating them,
-- so every printed partner code keeps working.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1) Promotions gain a real active window + a link back to their event
-- ---------------------------------------------------------------------------
alter table greendogops.marketing_promotion
  add column if not exists active_start date,
  add column if not exists active_end date,
  add column if not exists source_event_id uuid
    references greendogops.marketing_event (id) on delete cascade;

create index if not exists marketing_promotion_source_event_idx
  on greendogops.marketing_promotion (source_event_id);

comment on column greendogops.marketing_promotion.active_start is
  'First day the promotion can be redeemed.';
comment on column greendogops.marketing_promotion.active_end is
  'Last day the promotion can be redeemed.';
comment on column greendogops.marketing_promotion.source_event_id is
  'Set when this promotion is owned by a marketing_event. The event is the editor of record; deleting the event removes its promotion.';

-- ---------------------------------------------------------------------------
-- 2) Events: promo flag + details, and a structured staff roster
-- ---------------------------------------------------------------------------
-- `staff` (free text) is kept as the printable summary so existing rows, the
-- packing list and any exports keep reading. staff_ids is the structured
-- source of truth: person ids picked from the HR roster.
alter table greendogops.marketing_event
  add column if not exists has_promo boolean not null default false,
  add column if not exists promo_name text,
  add column if not exists promo_details text,
  add column if not exists promo_starts_on date,
  add column if not exists promo_ends_on date,
  add column if not exists staff_ids jsonb not null default '[]'::jsonb;

comment on column greendogops.marketing_event.has_promo is
  'Does this event have its own promotion? Drives the Promo column in the event list and whether a marketing_promotion row is mirrored.';
comment on column greendogops.marketing_event.staff_ids is
  'Array of person.id uuids staffing the event (picked from the roster). `staff` holds the rendered names.';

-- ---------------------------------------------------------------------------
-- 3) Custom capture forms
-- ---------------------------------------------------------------------------
-- A form is reusable: one form can be pointed at by many QR codes (e.g. the
-- same "Event sign-up" form on every 2026 event code).
create table if not exists greendogops.qr_form (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  headline        text,
  intro           text,
  success_message text,
  -- Built-in lead fields are always collected (name + email/phone); these
  -- toggle the optional ones so a form stays a 10-second scan-and-go.
  collect_pet_name boolean not null default true,
  collect_zip      boolean not null default false,
  -- Extra questions: [{key,label,type,required,options[],placeholder}]
  fields          jsonb not null default '[]'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.qr_form;
create trigger set_updated_at before update on greendogops.qr_form
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.qr_form to authenticated, service_role;

comment on table greendogops.qr_form is
  'Reusable public intake form rendered at /q/<token>. `fields` holds the custom questions; answers land in qr_lead.answers.';

-- ---------------------------------------------------------------------------
-- 4) The QR code registry
-- ---------------------------------------------------------------------------
create table if not exists greendogops.qr_code (
  id           uuid primary key default gen_random_uuid(),
  token        text not null default greendogops.new_qr_token(),
  label        text not null,
  -- event | promo | partner | other. Free text, validated in the app.
  code_type    text not null default 'event',
  event_id     uuid references greendogops.marketing_event (id) on delete cascade,
  promotion_id uuid references greendogops.marketing_promotion (id) on delete set null,
  org_id       uuid references greendogops.crm_organization (id) on delete cascade,
  form_id      uuid references greendogops.qr_form (id) on delete set null,
  -- When set, the code redirects here instead of rendering the form.
  target_url   text,
  active       boolean not null default true,
  notes        text,
  scan_count   integer not null default 0,
  last_scanned_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists qr_code_token_key on greendogops.qr_code (token);
create index if not exists qr_code_event_idx on greendogops.qr_code (event_id);
create index if not exists qr_code_org_idx on greendogops.qr_code (org_id);
create index if not exists qr_code_active_idx on greendogops.qr_code (active);

drop trigger if exists set_updated_at on greendogops.qr_code;
create trigger set_updated_at before update on greendogops.qr_code
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.qr_code to authenticated, service_role;

comment on table greendogops.qr_code is
  'Every generated QR code. token is the public, non-enumerable handle in /q/<token>.';

-- ---------------------------------------------------------------------------
-- 5) Leads captured by a scan
-- ---------------------------------------------------------------------------
create table if not exists greendogops.qr_lead (
  id          uuid primary key default gen_random_uuid(),
  qr_code_id  uuid not null references greendogops.qr_code (id) on delete cascade,
  -- Denormalized so the Event Leads tab can filter by event without a join.
  event_id    uuid references greendogops.marketing_event (id) on delete set null,
  org_id      uuid references greendogops.crm_organization (id) on delete set null,
  full_name   text not null,
  email       text,
  phone       text,
  pet_name    text,
  zip         text,
  -- Answers to the form's custom questions, keyed by field key.
  answers     jsonb not null default '{}'::jsonb,
  status      text not null default 'new',
  notes       text,
  source      text not null default 'qr_scan',
  scanned_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists qr_lead_code_idx on greendogops.qr_lead (qr_code_id, scanned_at desc);
create index if not exists qr_lead_event_idx on greendogops.qr_lead (event_id, scanned_at desc);
create index if not exists qr_lead_scanned_idx on greendogops.qr_lead (scanned_at desc);
create index if not exists qr_lead_status_idx on greendogops.qr_lead (status);

drop trigger if exists set_updated_at on greendogops.qr_lead;
create trigger set_updated_at before update on greendogops.qr_lead
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.qr_lead to authenticated, service_role;

comment on table greendogops.qr_lead is
  'A person who scanned a QR code and submitted its form. Event codes surface these as the Event Leads tab.';

-- ---------------------------------------------------------------------------
-- 6) Scan counter
-- ---------------------------------------------------------------------------
-- Called from the public page, so it must be a single atomic statement rather
-- than a read-modify-write (two people scanning at once would lose a count).
create or replace function greendogops.record_qr_scan(p_token text)
returns void
language sql
volatile
security definer
set search_path = greendogops, pg_catalog
as $$
  update greendogops.qr_code
     set scan_count = scan_count + 1,
         last_scanned_at = now()
   where token = p_token
     and active;
$$;

revoke all on function greendogops.record_qr_scan(text) from public;
grant execute on function greendogops.record_qr_scan(text) to service_role;

comment on function greendogops.record_qr_scan(text) is
  'Atomically bump a QR code''s scan counter. Called by the public /q/<token> page via the service-role client.';
