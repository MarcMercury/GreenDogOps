-- ============================================================================
-- Green Dog Ops — 0199 record tag grain + worklist defaults
-- ----------------------------------------------------------------------------
-- Which RECORD a tag should be pulled against is a property of the tag, not of
-- the run, so it belongs on the catalog row.
--
-- It matters for correctness, not tidiness. A pet tag changes the PET's record,
-- so its activity window has to be evaluated against the pet. Pulling pet tags
-- as Contact records and then filtering on the contact's modified date would
-- miss every tag edit that did not also change the client record — which is
-- most of them — and the nightly run would quietly stop seeing changes.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.ezyvet_tag
  add column if not exists record_type text not null default 'animal'
    check (record_type in ('contact', 'animal'));

comment on column greendogops.ezyvet_tag.record_type is
  'Grain this tag is pulled at: animal for pet tags (the activity window must be judged on the pet, which is what a tag edit modifies), contact for tags on the client record.';

-- Seed the two promo codes the team filters and excludes on today. Pet tags, so
-- they are pulled as pet records; backfilled_on stays null until a full run has
-- established the baseline, which keeps them out of incremental runs until then.
insert into greendogops.ezyvet_tag (tag_key, tag_label, tag_type, tag_group, record_type)
values
  ('code_101', 'CODE *101*', 'pet_tag', 'Promotions/Coupon', 'animal'),
  ('code_501', 'CODE *501*', 'pet_tag', 'Promotions/Coupon', 'animal')
on conflict (tag_key) do nothing;
