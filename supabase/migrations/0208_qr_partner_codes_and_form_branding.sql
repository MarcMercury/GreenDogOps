-- ============================================================================
-- Green Dog Ops — 0208 Partner codes join the QR registry + form branding
-- ----------------------------------------------------------------------------
-- WHY: Non-Med Partner codes were printed before qr_code existed, so they only
-- lived as crm_organization.qr_token and needed their own tab. That tab could
-- not do the one thing the codes need — attach a capture form.
--
-- Fix: give every partner a real qr_code row REUSING its existing qr_token as
-- the code token. The printed /lead/<token> URLs are byte-for-byte unchanged;
-- they simply now resolve to a managed code that can carry a form_id. QR Code
-- Mgmt drops the partner tab and lists everything from qr_code.
--
-- Partner submissions keep landing in crm_retail_lead (the Partner CRM reads
-- it), so that table gains the two columns a custom form can produce.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Capture form branding
-- ---------------------------------------------------------------------------
alter table greendogops.qr_form
  add column if not exists theme text not null default 'emerald',
  add column if not exists banner_url text;

comment on column greendogops.qr_form.theme is
  'Colour scheme key rendered on the public form. Validated against QR_FORM_THEMES in src/lib/marketing/qr.ts — never interpolated into CSS.';
comment on column greendogops.qr_form.banner_url is
  'Public URL of the header image in the qr-form-banners bucket. Null = no banner.';

-- Public bucket: these images are shown to unauthenticated scanners, so a
-- signed URL would expire mid-event.
insert into storage.buckets (id, name, public)
values ('qr-form-banners', 'qr-form-banners', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Retail leads can now come from a custom form
-- ---------------------------------------------------------------------------
alter table greendogops.crm_retail_lead
  add column if not exists zip text,
  add column if not exists answers jsonb not null default '{}'::jsonb;

comment on column greendogops.crm_retail_lead.answers is
  'Answers to the custom questions on the qr_form attached to this partner''s code, keyed by QrFormField.key.';

-- ---------------------------------------------------------------------------
-- 3. Backfill a qr_code row for every Non-Med Partner
-- ---------------------------------------------------------------------------
-- token = the org's existing qr_token, so every code already in the wild keeps
-- working. ON CONFLICT guards re-runs and the (unlikely) case where a partner
-- code was already created by hand.
insert into greendogops.qr_code (token, label, code_type, org_id, active, notes)
select o.qr_token,
       o.name,
       'partner',
       o.id,
       true,
       'Retail partner counter code — scans land on /lead/' || o.qr_token
from greendogops.crm_organization o
where lower(trim(coalesce(o.category, ''))) = 'marketing'
  and o.qr_token is not null
  and not exists (
    select 1 from greendogops.qr_code c where c.org_id = o.id and c.code_type = 'partner'
  )
on conflict (token) do nothing;

-- Keep the registry complete: a partner added tomorrow must show up in QR Code
-- Mgmt without another backfill.
create or replace function greendogops.register_partner_qr_code()
returns trigger
language plpgsql
security definer
set search_path = greendogops, public
as $$
begin
  if lower(trim(coalesce(new.category, ''))) = 'marketing' and new.qr_token is not null then
    insert into greendogops.qr_code (token, label, code_type, org_id, active)
    values (new.qr_token, new.name, 'partner', new.id, true)
    on conflict (token) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_organization_register_qr_code on greendogops.crm_organization;
create trigger crm_organization_register_qr_code
  after insert or update of category on greendogops.crm_organization
  for each row execute function greendogops.register_partner_qr_code();
