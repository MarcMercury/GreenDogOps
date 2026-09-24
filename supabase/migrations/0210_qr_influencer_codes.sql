-- ============================================================================
-- Green Dog Ops — 0210 QR codes for Influencers
-- ----------------------------------------------------------------------------
-- WHY: influencers hand their audience a code ("scan this, Green Dog will look
-- after your pet"). Attribution has to be per-influencer, so every influencer
-- gets their own qr_code row and every scan records influencer_id on the lead.
--
-- Mirrors 0209's referral-clinic treatment: new FK on qr_code + qr_lead, a
-- backfill so existing records are immediately trackable, and a trigger so new
-- influencers register themselves.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.qr_code
  add column if not exists influencer_id uuid
    references greendogops.marketing_influencers (id) on delete cascade;

-- Denormalized on the lead for the same reason event_id is: the influencer's
-- QR tab filters by subject without a join back through qr_code.
alter table greendogops.qr_lead
  add column if not exists influencer_id uuid
    references greendogops.marketing_influencers (id) on delete set null;

create index if not exists qr_code_influencer_idx
  on greendogops.qr_code (influencer_id);
create index if not exists qr_lead_influencer_idx
  on greendogops.qr_lead (influencer_id, scanned_at desc);

comment on column greendogops.qr_code.influencer_id is
  'Influencer this code belongs to. code_type = ''influencer''.';
comment on column greendogops.qr_lead.influencer_id is
  'Influencer whose code captured this lead (denormalized from qr_code).';

-- ---------------------------------------------------------------------------
-- Give every influencer a code
-- ---------------------------------------------------------------------------
-- A code with no form attached renders the standard contact form (see
-- src/app/q/[token]/page.tsx), so these are useful the moment they exist.
-- Inactive influencers get an inactive code: still listed in the hub behind
-- "Show inactive", never a live scan target.
insert into greendogops.qr_code (label, code_type, influencer_id, active, notes)
select coalesce(
         -- '-' is the placeholder the influencer import left in contact_name.
         nullif(nullif(trim(i.contact_name), ''), '-'),
         nullif(trim(i.pet_name), ''),
         nullif('@' || trim(i.instagram_handle), '@'),
         'Influencer'
       ),
       'influencer',
       i.id,
       coalesce(i.status::text, '') <> 'inactive',
       'Influencer code — scans land on the influencer''s QR tab.'
from greendogops.marketing_influencers i
where not exists (
  select 1 from greendogops.qr_code c where c.influencer_id = i.id
);

create or replace function greendogops.register_influencer_qr_code()
returns trigger
language plpgsql
security definer
set search_path = greendogops, public
as $$
begin
  insert into greendogops.qr_code (label, code_type, influencer_id, active)
  select coalesce(
           nullif(nullif(trim(new.contact_name), ''), '-'),
           nullif(trim(new.pet_name), ''),
           nullif('@' || trim(new.instagram_handle), '@'),
           'Influencer'
         ),
         'influencer',
         new.id,
         coalesce(new.status::text, '') <> 'inactive'
  where not exists (
    select 1 from greendogops.qr_code c where c.influencer_id = new.id
  );
  return new;
end;
$$;

drop trigger if exists marketing_influencers_register_qr_code on greendogops.marketing_influencers;
create trigger marketing_influencers_register_qr_code
  after insert on greendogops.marketing_influencers
  for each row execute function greendogops.register_influencer_qr_code();
