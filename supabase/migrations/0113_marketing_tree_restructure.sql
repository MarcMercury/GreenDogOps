-- ============================================================================
-- Green Dog Ops — 0113 Marketing Tree restructure (higher-level view)
-- ----------------------------------------------------------------------------
-- The tree was too granular: ~59 flat nodes made the visual unwieldy. This
-- migration reshapes it into a clean, executive-to-contributor readable map:
--
--   Trunk    → brand core (daily essentials)
--   Branches → attract pillars  (Events, Campaigns, Social, Partnerships)
--   Roots    → retain pillars   (Client Programs, Materials, Team & Ops)
--   Leaves   → CATEGORIES (e.g. "GDD Hosted Events") that hold an in-node
--              LIST of the real things (Adoptapalooza, Halloween, …).
--
-- The granular specifics now live INSIDE a node as `items` (jsonb list), so
-- the tree stays a high-level map and the detail lives one click away.
--
-- Data is assimilated from "MARKETING DEPARTEMENT 2026.pdf" (roles, promo
-- calendar, month-by-month plan, events list, local-event SOP, exotics plan).
--
-- Old nodes are ARCHIVED (recoverable via "Show archived"), never hard-deleted.
--
--   items : jsonb array of { label, date, status, owner, url }
--           status ∈ planned | confirmed | active | done | hold | idea
-- ============================================================================
set search_path = greendogops, public;

-- 1) New in-node list column -------------------------------------------------
alter table greendogops.marketing_tree_node
  add column if not exists items jsonb not null default '[]'::jsonb;

-- 2) Archive the previous (granular) structure so we start from a clean map.
--    Recoverable: flip status back or toggle "Show archived" in-app.
update greendogops.marketing_tree_node
   set status = 'archived'
 where status <> 'archived';

-- 3) Seed the new high-level structure. Idempotent: only seeds if no ACTIVE
--    node named "Events & Community" exists yet (this migration's anchor).
do $$
begin
  if exists (
    select 1 from greendogops.marketing_tree_node
     where label = 'Events & Community' and status <> 'archived'
  ) then
    return;
  end if;

  -- ---- TRUNK — brand core / daily essentials -----------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order)
  values
    ('Brand & Voice', 'trunk', 'active', 'Dre', 'high',
     'Logo, brand kit, colors & messaging consistent everywhere across locations.',
     '[{"label":"Resources library","url":"/resources"}]'::jsonb, 1),
    ('Reviews & Reputation', 'trunk', 'active', 'Front teams', 'high',
     'Respond to every Google review daily; grow Yelp & testimonials.',
     '[]'::jsonb, 2),
    ('Website & Online Booking', 'trunk', 'active', 'Marc', 'high',
     'GeniusVets site, landing pages & the online booking funnel stay current & working.',
     '[]'::jsonb, 3);

  -- ---- BRANCHES — attract pillars ----------------------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order)
  values
    ('Events & Community', 'branch', 'active', 'Jenn', 'high',
     'Every event Green Dog hosts, attends, or scouts — community presence & new-client draw.',
     '[{"label":"Calendar","url":"/calendar"}]'::jsonb, 1),
    ('Campaigns & Promotions', 'branch', 'active', 'Dre', 'high',
     'Quarterly mailers, off-quarter SMS, seasonal campaigns & client offers.',
     '[{"label":"Promotions","url":"/marketing"}]'::jsonb, 2),
    ('Social & Digital', 'branch', 'active', 'Naomi', 'high',
     'Instagram, Facebook, TikTok, content themes, influencer collabs & paid digital ads.',
     '[{"label":"Influencer CRM","url":"/crm/influencer"}]'::jsonb, 3),
    ('Partnerships & Outreach', 'branch', 'active', 'Dre', 'medium',
     'Dog PPL, chambers, rescues, schools, local businesses & the referral network.',
     '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"}]'::jsonb, 4);

  -- ---- CANOPY LEAVES — event/campaign/social/partnership CATEGORIES -------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order, parent_id)
  select v.label, v.zone, v.status, v.owner_name, v.priority, v.summary, v.links, v.sort_order, p.id
  from (values
    -- Events & Community
    ('GDD Hosted Events', 'canopy', 'active', 'Dre', 'high', 'Flagship events Green Dog produces & hosts.', '[{"label":"Calendar","url":"/calendar"}]'::jsonb, 1, 'Events & Community'),
    ('3rd-Party Events', 'canopy', 'active', 'Jenn', 'medium', 'Community events we attend with a tent / booth presence.', '[{"label":"Calendar","url":"/calendar"}]'::jsonb, 2, 'Events & Community'),
    ('Pop-Up Clinics', 'canopy', 'active', 'Jenn', 'high', 'Recurring Dog PPL vaccine pop-ups & Ask-a-Vet demos.', '[]'::jsonb, 3, 'Events & Community'),
    ('CE / GDU Events', 'canopy', 'active', 'Dre', 'high', 'Green Dog University continuing-education courses for veterinary pros.', '[{"label":"CE Leads / Events","url":"/crm/ce"}]'::jsonb, 4, 'Events & Community'),
    ('Local Event Scouting', 'canopy', 'active', 'Jenn', 'medium', 'Weekly SOP: track & score events within 5mi of our clinics; report in #marketing.', '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"}]'::jsonb, 5, 'Events & Community'),
    -- Campaigns & Promotions
    ('Quarterly Mailers', 'canopy', 'active', 'Dre', 'high', 'Quarterly email newsletter + featured promotion.', '[]'::jsonb, 1, 'Campaigns & Promotions'),
    ('Off-Quarter SMS', 'canopy', 'active', 'Dre', 'medium', 'SMS promos straddling the newsletter months (every ~6 weeks).', '[]'::jsonb, 2, 'Campaigns & Promotions'),
    ('Seasonal Campaigns', 'canopy', 'active', 'Naomi', 'medium', 'Themed monthly content & awareness campaigns.', '[]'::jsonb, 3, 'Campaigns & Promotions'),
    ('Client Promos', 'canopy', 'active', 'Dre', 'high', 'New- & returning-client offers with codes & landing pages.', '[{"label":"Promotions","url":"/marketing"}]'::jsonb, 4, 'Campaigns & Promotions'),
    -- Social & Digital
    ('Social Channels', 'canopy', 'active', 'Naomi', 'high', 'Instagram, Facebook & TikTok — 3–4 posts/week, trend-aware.', '[]'::jsonb, 1, 'Social & Digital'),
    ('Content Themes', 'canopy', 'active', 'Naomi', 'medium', 'Monthly content calendar & storytelling themes.', '[]'::jsonb, 2, 'Social & Digital'),
    ('Influencer & Collabs', 'canopy', 'active', 'Naomi', 'medium', 'Influencer content & digital-partner collaborations.', '[{"label":"Influencer CRM","url":"/crm/influencer"}]'::jsonb, 3, 'Social & Digital'),
    ('Digital Ads', 'canopy', 'active', 'Naomi', 'medium', 'Google (GeniusVets), Meta, Yelp & evaluated channels.', '[]'::jsonb, 4, 'Social & Digital'),
    -- Partnerships & Outreach
    ('Dog PPL Partnership', 'canopy', 'active', 'Dre', 'high', 'Anchor partnership — monthly pop-ups & member events.', '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"}]'::jsonb, 1, 'Partnerships & Outreach'),
    ('Chambers & Local Business', 'canopy', 'active', 'Jenn', 'medium', 'Chamber memberships, networking & local-business ambassador program.', '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"}]'::jsonb, 2, 'Partnerships & Outreach'),
    ('Rescues & Shelters', 'canopy', 'active', 'Dre', 'medium', 'Rescue & shelter relationships, welcome & rescue packets.', '[{"label":"Rescue / Shelter CRM","url":"/crm/rescue"}]'::jsonb, 3, 'Partnerships & Outreach'),
    ('Schools & Education', 'canopy', 'active', 'Dre', 'low', 'School partnerships & classroom pet-care outreach.', '[]'::jsonb, 4, 'Partnerships & Outreach'),
    ('Referral Network', 'canopy', 'active', 'Marc', 'medium', 'Referring clinics & hospitals pipeline.', '[{"label":"Referral CRM","url":"/crm/referral"}]'::jsonb, 5, 'Partnerships & Outreach')
  ) as v(label, zone, status, owner_name, priority, summary, links, sort_order, parent_label)
  left join greendogops.marketing_tree_node p
    on p.label = v.parent_label and p.status <> 'archived';

  -- ---- PRIMARY ROOTS — retain pillars ------------------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order)
  values
    ('Client Programs', 'root_primary', 'active', 'Dre', 'high',
     'Programs that keep clients coming back — wellness, birthdays, recalls, loyalty.',
     '[]'::jsonb, 1),
    ('Brand Materials & Merch', 'root_primary', 'active', 'Naomi', 'medium',
     'Signage, print collateral, uniforms, retail products & exotics marketing.',
     '[{"label":"Resources library","url":"/resources"}]'::jsonb, 2),
    ('Team & Operations', 'root_primary', 'active', 'Dre', 'medium',
     'Who does what, the SOPs & playbooks, budget & performance, inventory.',
     '[{"label":"HR / Roster","url":"/hr"}]'::jsonb, 3);

  -- ---- FINE ROOTS — retention CATEGORIES ---------------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order, parent_id)
  select v.label, v.zone, v.status, v.owner_name, v.priority, v.summary, v.links, v.sort_order, p.id
  from (values
    -- Client Programs
    ('Wellness Plan', 'root_fine', 'active', 'Dre', 'high', 'Green Dog Pet Plus wellness plan & member perks.', '[]'::jsonb, 1, 'Client Programs'),
    ('Birthday Program', 'root_fine', 'active', 'Jenn', 'medium', 'Pet-birthday SMS + swag bag pickup — drives re-engagement.', '[]'::jsonb, 2, 'Client Programs'),
    ('Recall & Reminders', 'root_fine', 'active', 'Marketing', 'medium', 'Automated recalls & reminders in ezyVet.', '[]'::jsonb, 3, 'Client Programs'),
    ('Loyalty & Follow-up', 'root_fine', 'active', 'Front teams', 'medium', 'Post-visit follow-up, review asks & aftercare emails.', '[]'::jsonb, 4, 'Client Programs'),
    -- Brand Materials & Merch
    ('Signage & Print', 'root_fine', 'active', 'Naomi', 'medium', 'Banners, consult-room posters, dental report cards, urgent-care flyers.', '[{"label":"Resources library","url":"/resources"}]'::jsonb, 1, 'Brand Materials & Merch'),
    ('Uniforms', 'root_fine', 'active', 'Jenn', 'low', 'Scrubs, jackets & embroidery — order via Slack, fulfill as needed.', '[]'::jsonb, 2, 'Brand Materials & Merch'),
    ('Retail & Shopify', 'root_fine', 'active', 'Jenn', 'medium', 'SmileSpray, DentalDust, merch & Shopify order fulfillment.', '[{"label":"Shopify","url":"https://www.shopify.com"}]'::jsonb, 3, 'Brand Materials & Merch'),
    ('Exotics Marketing', 'root_fine', 'active', 'Dre', 'low', 'Dr. Robertson exotics strategy — website, socials, rescue packets, events.', '[]'::jsonb, 4, 'Brand Materials & Merch'),
    -- Team & Operations
    ('Roles & Responsibilities', 'root_fine', 'active', 'Dre', 'medium', 'Who owns what across the marketing team.', '[{"label":"HR / Roster","url":"/hr"}]'::jsonb, 1, 'Team & Operations'),
    ('SOPs & Playbooks', 'root_fine', 'active', 'Jenn', 'medium', 'Repeatable playbooks — local event search, scoring rubric, event prep.', '[]'::jsonb, 2, 'Team & Operations'),
    ('Budget & Performance', 'root_fine', 'active', 'Dre', 'medium', '2026 marketing budget, ROI evaluation & campaign performance tracking.', '[{"label":"Reporting","url":"/reporting"}]'::jsonb, 3, 'Team & Operations'),
    ('Inventory & Fulfillment', 'root_fine', 'active', 'Jenn', 'low', 'Marketing assets, merch & swag — track stock & reorder.', '[]'::jsonb, 4, 'Team & Operations')
  ) as v(label, zone, status, owner_name, priority, summary, links, sort_order, parent_label)
  left join greendogops.marketing_tree_node p
    on p.label = v.parent_label and p.status <> 'archived';

  -- ---- IN-NODE ITEM LISTS (the granular reality, assimilated from 2026 PDF)
  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Adoptapalooza — signature adoption & vendor festival","date":"2026-06-13","status":"confirmed","owner":"Dre","url":"/calendar"},
    {"label":"Halloween Haunted House — costume contest + trick-or-treat","date":"2026-10-31","status":"planned","owner":"Dre","url":"/calendar"},
    {"label":"Staff Holiday Party — Los Olivos","date":"2026-01","status":"done","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'GDD Hosted Events' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Venice Love Fest — First Aid + marketing tent","date":"2026-03-21","status":"done","owner":"Naomi","url":"/calendar"},
    {"label":"Pet Resource Fair — Santa Monica","date":"2026-04-12","status":"done","owner":"Jenn","url":"/calendar"},
    {"label":"Fur Fest — Valley","date":"2026-05-09","status":"planned","owner":"Jenn","url":"/calendar"},
    {"label":"Vanderpump Dog event — Valley","date":"2026-05-09","status":"planned","owner":"Jenn","url":"/calendar"},
    {"label":"Repticon Costa Mesa (exotics)","date":"2026-05-30","status":"idea","owner":"Dre","url":""}
  ]$j$::jsonb where label = '3rd-Party Events' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Dog PPL Vaccine Pop-up — Santa Monica","date":"Monthly","status":"active","owner":"Jenn","url":"/crm/vendor"},
    {"label":"Ask-a-Vet First Aid Demo","date":"2026-03-22","status":"done","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Pop-Up Clinics' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Idexx + Purina CE — Kidney Health","date":"2026-03-25","status":"done","owner":"Jenn","url":"/crm/ce"},
    {"label":"Advanced Dentistry CE","date":"2026-04-18","status":"done","owner":"Jenn","url":"/crm/ce"},
    {"label":"Abdominal Ultrasound CE","date":"2026-07-11","status":"planned","owner":"Dre","url":"/crm/ce"}
  ]$j$::jsonb where label = 'CE / GDU Events' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Weekly local event search (Venice / Sherman Oaks / Van Nuys, 5mi)","date":"Mondays 12pm","status":"active","owner":"Jenn","url":""},
    {"label":"Sources: Eventbrite, Discover LA, Santa Monica, Venice Paparazzi","date":"Weekly","status":"active","owner":"Jenn","url":"https://www.eventbrite.com/d/ca--los-angeles/events/"},
    {"label":"Chamber checks — Venice, Santa Monica, Sherman Oaks, SFV","date":"Weekly","status":"active","owner":"Jenn","url":"/crm/vendor"},
    {"label":"Score 1–5 (fit/visibility/partnership); 17–20 attend/sponsor","date":"Weekly","status":"active","owner":"Jenn","url":""}
  ]$j$::jsonb where label = 'Local Event Scouting' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Q1 Mailer — New: 50% off NAD · Returning: $50 off NAD","date":"2026-01-29","status":"done","owner":"Dre","url":""},
    {"label":"Q2 Mailer — Flea/tick: 50% off heartworm test w/ dental","date":"2026-04-30","status":"done","owner":"Dre","url":""},
    {"label":"Q3 Summer Mailer — tips + promo","date":"2026-07-30","status":"planned","owner":"Dre","url":""},
    {"label":"Q4 Fall Mailer — seasonal check-up + promo","date":"2026-10-29","status":"planned","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Quarterly Mailers' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Jan 30 — New 50% off NAD · Returning $50 off","date":"2026-01-30","status":"done","owner":"Dre","url":""},
    {"label":"Mar 17 — $25 off dental / 50% off first exam","date":"2026-03-17","status":"done","owner":"Dre","url":"https://mcsms.io/713v9h"},
    {"label":"May 14 — $20 off next appointment","date":"2026-05-14","status":"planned","owner":"Dre","url":""},
    {"label":"Aug 13 — Summer safety: save $25","date":"2026-08-13","status":"planned","owner":"Dre","url":""},
    {"label":"Nov 12 — Fall into wellness: $20 off","date":"2026-11-12","status":"planned","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Off-Quarter SMS' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Jan/Feb — National Pet Dental Month + New Year New You","date":"2026-01","status":"done","owner":"Naomi","url":""},
    {"label":"March — Spring Cleaning for Pets","date":"2026-03","status":"done","owner":"Naomi","url":""},
    {"label":"April — Back Outside (allergies, hiking/beach safety)","date":"2026-04","status":"active","owner":"Naomi","url":""},
    {"label":"May — Meet Your Neighborhood Vet (staff & partner spotlights)","date":"2026-05","status":"planned","owner":"Naomi","url":""},
    {"label":"Sept/Oct — Endless Summer → Halloween tease","date":"2026-09","status":"planned","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Seasonal Campaigns' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"New client — 50% off first vet exam / NAD","date":"","status":"active","owner":"Dre","url":"https://mcsms.io/713v9h"},
    {"label":"Returning client — $50 off NAD (first 50 bookings)","date":"","status":"active","owner":"Dre","url":""},
    {"label":"Returning client — $25 off dental","date":"","status":"active","owner":"Dre","url":"https://tinyurl.com/ya9b3y3w"},
    {"label":"Birthday swag bag pickup (returning clients)","date":"","status":"active","owner":"Jenn","url":""}
  ]$j$::jsonb where label = 'Client Promos' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Instagram — 3–4x/week, trend-aware","date":"Weekly","status":"active","owner":"Naomi","url":""},
    {"label":"Facebook — posts + event pages","date":"Weekly","status":"active","owner":"Naomi","url":""},
    {"label":"TikTok — engaging/relevant content","date":"Weekly","status":"active","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Social Channels' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Monthly socials plan (share w/ marketing lead)","date":"Monthly","status":"active","owner":"Naomi","url":""},
    {"label":"Quarterly newsletter — patient spotlight + vet quote","date":"Quarterly","status":"active","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Content Themes' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"West Side Dog Gang collab (Venice Love Fest)","date":"2026-03","status":"done","owner":"Naomi","url":"/crm/influencer"},
    {"label":"Digital partner & influencer outreach — ongoing","date":"Ongoing","status":"active","owner":"Naomi","url":"/crm/influencer"}
  ]$j$::jsonb where label = 'Influencer & Collabs' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Google Ads via GeniusVets — exotics & core terms rank 1–2","date":"Ongoing","status":"active","owner":"Naomi","url":""},
    {"label":"Instagram / Facebook ad — spring campaign","date":"2026-03","status":"active","owner":"Naomi","url":""},
    {"label":"Yelp ad — add videos","date":"","status":"planned","owner":"Naomi","url":""},
    {"label":"Reddit ads — evaluated, on hold (not ideal fit)","date":"2026-05","status":"hold","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Digital Ads' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"2026 partnership strategy — present to leadership","date":"","status":"active","owner":"Dre","url":""},
    {"label":"First Aid / Ask-a-Vet member events","date":"Recurring","status":"active","owner":"Dre","url":""},
    {"label":"Monthly vaccine pop-up clinics — Santa Monica","date":"Monthly","status":"active","owner":"Jenn","url":""}
  ]$j$::jsonb where label = 'Dog PPL Partnership' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Venice / Santa Monica / Sherman Oaks / SFV chambers","date":"Ongoing","status":"active","owner":"Jenn","url":"/crm/vendor"},
    {"label":"Local business ambassador — flyers + digital giveaway QR","date":"Ongoing","status":"active","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Chambers & Local Business' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Adoption rescue welcome packets","date":"Ongoing","status":"active","owner":"Dre","url":"/crm/rescue"},
    {"label":"Exotics rescue promotional packets","date":"Ongoing","status":"active","owner":"Dre","url":"/crm/rescue"}
  ]$j$::jsonb where label = 'Rescues & Shelters' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Kester Elementary outreach — folder ad","date":"2026-03","status":"done","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Schools & Education' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Green Dog Pet Plus — relaunch (April 1)","date":"2026-04-01","status":"active","owner":"Dre","url":""},
    {"label":"In-clinic materials, banners & consult-room posters","date":"","status":"active","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Wellness Plan' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Assemble birthday swag bags","date":"","status":"active","owner":"Jenn","url":""},
    {"label":"SMS happy-birthday message coordination","date":"","status":"active","owner":"Dre","url":""},
    {"label":"Front-desk distribution system","date":"","status":"active","owner":"Front teams","url":""}
  ]$j$::jsonb where label = 'Birthday Program' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Wellness banners (lobby x2 + traveling stand)","date":"","status":"active","owner":"Naomi","url":""},
    {"label":"11x17 consult-room posters","date":"","status":"active","owner":"Naomi","url":""},
    {"label":"Dental report cards refresh","date":"","status":"active","owner":"Naomi","url":""},
    {"label":"Urgent care flyers (Venice / Van Nuys)","date":"","status":"active","owner":"Jenn","url":""},
    {"label":"New Venice clinic signage","date":"","status":"planned","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Signage & Print' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"SmileSpray & DentalDust — Green Dog products","date":"","status":"active","owner":"Jenn","url":""},
    {"label":"Shopify order fulfillment","date":"Ongoing","status":"active","owner":"Jenn","url":"https://www.shopify.com"},
    {"label":"New t-shirt / merch designs","date":"","status":"planned","owner":"Naomi","url":""}
  ]$j$::jsonb where label = 'Retail & Shopify' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Dr. Robertson bio + rabbit-care videos (site & YouTube)","date":"","status":"active","owner":"Naomi","url":""},
    {"label":"Exotics rescue promotional packets","date":"","status":"active","owner":"Dre","url":"/crm/rescue"},
    {"label":"Exotics booth at Adoptapalooza (potential)","date":"2026-06-13","status":"idea","owner":"Dre","url":""}
  ]$j$::jsonb where label = 'Exotics Marketing' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Dre — Marketing Director / CMO (strategy, partnerships, budget)","date":"","status":"active","owner":"Dre","url":"/hr"},
    {"label":"Naomi — Social Media Manager + Brand Ambassador","date":"","status":"active","owner":"Naomi","url":"/hr"},
    {"label":"Jenn — Marketing Assistant + Events Coordinator","date":"","status":"active","owner":"Jenn","url":"/hr"}
  ]$j$::jsonb where label = 'Roles & Responsibilities' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Local Event Search SOP (weekly, #marketing by 12pm Mon)","date":"Weekly","status":"active","owner":"Jenn","url":""},
    {"label":"Event scoring rubric (1–5 x fit/visibility/partnership)","date":"","status":"active","owner":"Jenn","url":""},
    {"label":"Event week-of prep & follow-up checklist","date":"","status":"active","owner":"Jenn","url":""}
  ]$j$::jsonb where label = 'SOPs & Playbooks' and status <> 'archived';

  update greendogops.marketing_tree_node set items = $j$[
    {"label":"2026 marketing budget — maintain & forecast","date":"","status":"active","owner":"Dre","url":"/reporting"},
    {"label":"Campaign performance & ROI tracking","date":"","status":"active","owner":"Dre","url":"/reporting"}
  ]$j$::jsonb where label = 'Budget & Performance' and status <> 'archived';

end $$;
