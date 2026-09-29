-- ============================================================================
-- Green Dog Ops — 0213 Reconcile production drift
-- ----------------------------------------------------------------------------
-- Building a database from scratch in a fresh project surfaced three places
-- where production and this migration history had diverged. Applying this file
-- to production makes the two agree again, and lets a rebuilt database match
-- production.
--
-- 1. person.preferred_name exists in production but no migration ever created
--    it. It is empty (0 of 3508 rows) and unreferenced by application code;
--    migration 0170 assumed it and failed on a rebuild because of that. It is
--    recreated here rather than dropped so this migration stays non-destructive
--    -- see the note at the bottom about removing it for good.
--
-- 2. register_influencer_qr_code() in production predates the guard added in
--    0210, so a blank "-" contact name still produced a QR label of "-".
--    Production never received the updated body.
--
-- 3. greendogops.format_phone(text) is created by 0162 and was later dropped
--    from production by hand. It is deliberately NOT restored here; nothing
--    calls it outside 0162 itself. A rebuilt database will have it and
--    production will not, which is harmless and recorded here so the next
--    person to diff the two schemas is not surprised.
-- ============================================================================
set search_path = greendogops, public;

-- 1 -------------------------------------------------------------------------
alter table greendogops.person
  add column if not exists preferred_name text;

comment on column greendogops.person.preferred_name is
  'Unused and empty as of 0213. Retained only so production and the migration '
  'history agree. Safe to drop once confirmed no external consumer reads it.';

-- 2 -------------------------------------------------------------------------
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

-- The trigger is recreated too: 0210 may have landed in production without the
-- function update, and a trigger bound to a stale function is the failure this
-- whole file exists to prevent.
drop trigger if exists marketing_influencers_register_qr_code
  on greendogops.marketing_influencers;
create trigger marketing_influencers_register_qr_code
  after insert on greendogops.marketing_influencers
  for each row execute function greendogops.register_influencer_qr_code();
