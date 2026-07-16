-- ============================================================================
-- Green Dog Ops — 0106 Marketing Promotions + meeting-notes context seed
-- ----------------------------------------------------------------------------
-- 1) marketing_promotion — the promotions / coupons / discount-code tracker
--    (from "Current Promotions / Groupon List"): what's live, where it's
--    placed, the discount, ezyVet line item / product code, how to redeem, the
--    public link and the rules. Also covers influencer codes, gift certs,
--    Vetstoria booking widgets, and expired history.
-- 2) Hand-curated events + initiatives distilled from the Internal Marketing and
--    GeniusVets meeting-notes PDFs (concrete, actionable items only).
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.marketing_promotion (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  placement        text,
  status           text not null default 'active',   -- active | upcoming | expired
  promo_type       text not null default 'standard', -- standard | influencer | gift_certificate | widget | event
  duration_text    text,
  discount_text    text,
  discount_amount  numeric,
  product_code     text,
  ezyvet_line_item text,
  how_to_redeem    text,
  promo_url        text,
  booking_url      text,
  rules            text,
  appointments     integer,
  notes            text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists marketing_promotion_status_idx
  on greendogops.marketing_promotion (status);

drop trigger if exists set_updated_at on greendogops.marketing_promotion;
create trigger set_updated_at before update on greendogops.marketing_promotion
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_promotion
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Curated upcoming/known events from the Internal Marketing meeting notes.
-- Idempotent by name.
-- ---------------------------------------------------------------------------
insert into greendogops.marketing_event
  (name, event_type, status, starts_on, ends_on, location, owner_name, cost, description)
select * from (values
  ('GIRL SWIRL', 'tent', 'tentative', date '2026-07-25', null, 'Under the Venice sign', 'Dre', null,
   'Outdoor community festival (8-15k attendance). Market hours 1–7:30pm, set/breakdown 12–8:30pm. Booth cost pending.'),
  ('Dog Adoption & Comedy Show', 'third_party', 'tentative', date '2026-07-26', null, 'Penmar Golf Course, Venice', 'Marc', null,
   'Adoptions 3–5pm, comedy 5–7pm. Vendors, sponsors, dog-training comedy. Booth cost possibly none. Marc following up.'),
  ('CatCon Pasadena 2026', 'third_party', 'confirmed', date '2026-10-10', date '2026-10-11', 'Pasadena', 'Marketing', 975,
   'Approved for a 10x10 booth ($975). Need to finalize contract + payment. Start event-specific marketing strategy.'),
  ('Venice Beach Festival', 'city', 'cancelled', date '2026-07-25', null, 'Windward Ave & Venice Beach Boardwalk', 'Marketing', null,
   'NOT GOING for 2026. Outdoor community festival, 8-15k attendance.'),
  ('AVMA Convention 2026', 'vet_conference', 'completed', date '2026-07-15', null, null, 'Marketing', null,
   'Attended AVMA. Not-great booth location; collected ~100 contacts (DVMs & techs) for CE outreach.')
) as v(name, event_type, status, starts_on, ends_on, location, owner_name, cost, description)
where not exists (select 1 from greendogops.marketing_event e where e.name = v.name);

-- ---------------------------------------------------------------------------
-- Curated GeniusVets-driven initiatives from the GeniusVets meeting notes.
-- ---------------------------------------------------------------------------
insert into greendogops.marketing_initiative
  (title, category, status, priority, owner_name, partner_name, next_action, notes, sort_order)
select * from (values
  ('Green Dog University website build', 'pr', 'in_progress', 'high', 'Gladys', 'GeniusVets',
   'Create dedicated CE-topic pages; finalize GDU branding/domain', 'New standalone GDU site; CE events listed with dates & signup links.', 10),
  ('CE Google Ads campaign', 'pr', 'in_progress', 'high', 'Marketing', 'GeniusVets',
   'Aim Google Ads at vet conferences (PacVet, AVMA) for CE courses', 'Promote wet labs / CE; industry newsletter + FB group lists.', 11),
  ('Exotics marketing expansion', 'pr', 'in_progress', 'medium', 'Marketing', 'GeniusVets',
   'Expand exotics services pages; get Dr. Robertson species videos', 'Consistent look across exotics service pages; mass email to clients.', 12),
  ('Performance Max + Local accelerator', 'pr', 'in_progress', 'medium', 'Marketing', 'GeniusVets',
   'Optimize Google Ads (cost/conversion ~$15.90); local accelerator $800/mo', 'Reels (not stories), YouTube shorts for service topics.', 13),
  ('Shopify shop page support', 'products', 'in_progress', 'medium', 'Marketing', 'GeniusVets',
   'Hand off Shopify shop page management to GeniusVets', 'green-dog-dental.myshopify.com — needs full support.', 14)
) as v(title, category, status, priority, owner_name, partner_name, next_action, notes, sort_order)
where not exists (select 1 from greendogops.marketing_initiative i where i.title = v.title);
