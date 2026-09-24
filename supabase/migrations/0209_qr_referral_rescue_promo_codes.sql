-- ============================================================================
-- Green Dog Ops — 0209 QR codes for Referral partners, Rescues & Promotions
-- ----------------------------------------------------------------------------
-- WHY: 0208 gave Non-Med Retail Partners a managed qr_code row and a "QR Code"
-- tab on their record. The same thing is wanted on referral clinics, rescues &
-- shelters, and promotions — one registry, one hub, one capture-form system.
--
-- Rescues are already crm_organization rows, so they were caught by the 0208
-- partner backfill and only need re-typing. Referral clinics live in their own
-- table and need a new FK. Promotions already had promotion_id — they only
-- needed the UI, so nothing structural happens for them here beyond an index.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Referral clinics join the registry
-- ---------------------------------------------------------------------------
alter table greendogops.qr_code
  add column if not exists referral_partner_id uuid
    references greendogops.referral_partners (id) on delete cascade;

-- Denormalized on the lead for the same reason event_id is: the record's QR
-- tab filters by subject without a join back through qr_code.
alter table greendogops.qr_lead
  add column if not exists referral_partner_id uuid
    references greendogops.referral_partners (id) on delete set null;

create index if not exists qr_code_referral_idx
  on greendogops.qr_code (referral_partner_id);
create index if not exists qr_code_promotion_idx
  on greendogops.qr_code (promotion_id);
create index if not exists qr_lead_referral_idx
  on greendogops.qr_lead (referral_partner_id, scanned_at desc);
create index if not exists qr_lead_org_idx
  on greendogops.qr_lead (org_id, scanned_at desc);

comment on column greendogops.qr_code.referral_partner_id is
  'Referral clinic this code belongs to. code_type = ''referral''.';

-- ---------------------------------------------------------------------------
-- 2. Rescues & shelters are their own kind of code
-- ---------------------------------------------------------------------------
-- They are crm_organization rows with category='marketing', so the 0208
-- backfill already made them a code — but typed 'partner', which would file
-- them under Retail partners in the hub and route scans at the retail lead
-- form. Retype them; none of these codes has been printed.
update greendogops.qr_code c
set code_type = 'rescue'
from greendogops.crm_organization o
where c.org_id = o.id
  and c.code_type = 'partner'
  and o.org_type = 'marketing_partner'
  and o.subtype = 'rescue';

-- ---------------------------------------------------------------------------
-- 3. Keep new records registering themselves (replaces the 0208 trigger fn)
-- ---------------------------------------------------------------------------
create or replace function greendogops.register_partner_qr_code()
returns trigger
language plpgsql
security definer
set search_path = greendogops, public
as $$
begin
  if lower(trim(coalesce(new.category, ''))) = 'marketing' and new.qr_token is not null then
    insert into greendogops.qr_code (token, label, code_type, org_id, active)
    values (
      new.qr_token,
      new.name,
      case
        when new.org_type = 'marketing_partner' and new.subtype = 'rescue' then 'rescue'
        else 'partner'
      end,
      new.id,
      true
    )
    on conflict (token) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_organization_register_qr_code on greendogops.crm_organization;
create trigger crm_organization_register_qr_code
  after insert or update of category, subtype on greendogops.crm_organization
  for each row execute function greendogops.register_partner_qr_code();

-- ---------------------------------------------------------------------------
-- 4. Give every referral clinic a code
-- ---------------------------------------------------------------------------
-- A code with no form attached now renders the standard contact form (see
-- src/app/q/[token]/page.tsx), so these are useful the moment they exist.
-- Inactive clinics get an inactive code: still in the hub behind "Show
-- inactive", never a live scan target.
insert into greendogops.qr_code (label, code_type, referral_partner_id, active, notes)
select coalesce(nullif(trim(p.name), ''), p.hospital_name, 'Referral clinic'),
       'referral',
       p.id,
       coalesce(p.is_active, true),
       'Referral clinic code — scans land on the clinic''s QR tab.'
from greendogops.referral_partners p
where not exists (
  select 1 from greendogops.qr_code c where c.referral_partner_id = p.id
);

create or replace function greendogops.register_referral_qr_code()
returns trigger
language plpgsql
security definer
set search_path = greendogops, public
as $$
begin
  insert into greendogops.qr_code (label, code_type, referral_partner_id, active)
  select coalesce(nullif(trim(new.name), ''), new.hospital_name, 'Referral clinic'),
         'referral',
         new.id,
         coalesce(new.is_active, true)
  where not exists (
    select 1 from greendogops.qr_code c where c.referral_partner_id = new.id
  );
  return new;
end;
$$;

drop trigger if exists referral_partners_register_qr_code on greendogops.referral_partners;
create trigger referral_partners_register_qr_code
  after insert on greendogops.referral_partners
  for each row execute function greendogops.register_referral_qr_code();
