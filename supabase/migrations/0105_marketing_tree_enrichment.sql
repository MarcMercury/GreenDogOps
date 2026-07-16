-- ============================================================================
-- Green Dog Ops — 0105 Marketing Tree enrichment
-- ----------------------------------------------------------------------------
-- Assimilates the layered channels from the GDD Marketing Channels doc and the
-- recurring marketing task list into the Marketing Tree as additional nodes.
-- Idempotent: each node is inserted only if a node with that label is absent.
-- Children reference parents by label (labels are unique in the tree seed).
-- ============================================================================
set search_path = greendogops, public;

-- Helper values inserted per zone. We use one guarded insert per node so
-- re-running (or partial prior seeds) never duplicates.

-- New TRUNK node (daily essential) -------------------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, sort_order)
select 'Social inbox & Google Voice', 'trunk', 'active', 'Marketing',
       'Daily: keep the Green Dog Social email inbox at zero, and answer Google Voice texts/calls; escalate to Dre as needed.', 5
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Social inbox & Google Voice');

-- New BRANCH: Local media & PR (acquisition) ---------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, sort_order)
select 'Local media & PR', 'branch', 'active', 'Marketing',
       'SMDP / Venice & SM / SO / WS papers: maintain relationships, negotiate exchanges, send PR/promos, interviews, monthly articles & adoptable dogs.', 7
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Local media & PR');

-- New BRANCH: Events program (acquisition) — the hub for the events system ----
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, links, sort_order)
select 'Events program', 'branch', 'active', 'Dre',
       'Self-managed marketing events: scout local events, schedule, plan, promote, staff, and recap. (CE events are handled separately for RACE approval.)',
       '[{"label":"Events tab","url":"/marketing"}]'::jsonb, 8
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Events program');

-- CANOPY nodes (one-off / ongoing outreach) ----------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, parent_id, sort_order)
select v.label, 'canopy', v.status, v.owner_name, v.summary,
       (select id from greendogops.marketing_tree_node p where p.label = v.parent_label), v.sort_order
from (values
  ('Local event scouting', 'active', 'Marketing', 'Monitor chambers & listings for new local events to convert into scheduled events.', 'Events program', 10),
  ('Movie night / comedy club', 'planning', 'Dre', 'Smaller hosted events at Green Dog (e.g. Don''t Tell Comedy) — dates, promo, staff, setup/cleanup.', 'Events program', 11),
  ('Chamber events', 'active', 'Dre', 'Attend & host chamber events; edit chamber profiles; submit promotions.', 'Community partnerships', 12),
  ('Grooming salon partners', 'active', 'Dre', 'Balanced Dog / Fluffology: discounts for staff & members, events, cross-promotion.', 'Community partnerships', 13),
  ('Local business partners', 'active', 'Dre', 'Main Street businesses, Earthwise, Tavern on Main: partnerships, discounts, cross-promotion.', 'Community partnerships', 14),
  ('Dog PPL partnership', 'active', 'Dre', 'Member discounts (add ezyVet tag), cross-promotion, 3rd-party collabs (e.g. Spectrum filming).', 'Community partnerships', 15),
  ('CE outreach & attendees', 'active', 'Jenn', 'Continuing-education outreach, RSVPs and attendee follow-up.', 'Community partnerships', 16),
  ('Pet-business referrals', 'active', 'Marketing', 'Pet-related referral businesses tracker; physical visits & materials.', 'Referral program', 17),
  ('Medical referral outreach', 'active', 'Marc', 'Referring clinics — promotional materials, visits, website content.', 'Referral program', 18),
  ('TikTok content', 'active', 'Marketing', 'Daily TikTok content, trending sounds, engagement.', 'Social media & content', 19),
  ('Threads & X', 'active', 'Marketing', 'Cross-post IG content to Threads and X; engagement & maintenance.', 'Social media & content', 20),
  ('Media features & articles', 'active', 'Marketing', 'Monthly articles and adoptable-dog features in local papers.', 'Local media & PR', 21)
) as v(label, status, owner_name, summary, parent_label, sort_order)
where not exists (select 1 from greendogops.marketing_tree_node t where t.label = v.label);

-- New PRIMARY ROOT: Email & SMS marketing (retention) ------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, links, sort_order)
select 'Email & SMS marketing', 'root_primary', 'active', 'Jenn',
       'Mailchimp email + SMS campaigns to clients & event attendees (promos, follow-ups, announcements).',
       '[]'::jsonb, 7
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Email & SMS marketing');

-- New PRIMARY ROOT: Employee engagement (retention / internal brand) ---------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, sort_order)
select 'Employee engagement', 'root_primary', 'active', 'Brittany',
       'Internal brand: appreciation weeks, staff events, onboarding kits, swag.', 8
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Employee engagement');

-- New PRIMARY ROOT: Green Dog Products (retention / revenue) ------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, sort_order)
select 'Green Dog Products', 'root_primary', 'active', 'Marketing',
       'SmileSpray, DentalDust & merch: production, in-house line items, ecommerce, wholesale, promotions.', 9
where not exists (select 1 from greendogops.marketing_tree_node where label = 'Green Dog Products');

-- FINE ROOTS (individual retention tactics) ----------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, parent_id, sort_order)
select v.label, 'root_fine', v.status, v.owner_name, v.summary,
       (select id from greendogops.marketing_tree_node p where p.label = v.parent_label), v.sort_order
from (values
  ('Mailchimp campaigns', 'active', 'Jenn', 'Build & send email/SMS blasts (promos, event follow-ups).', 'Email & SMS marketing', 1),
  ('Mass event texts', 'active', 'Jenn', 'Post-event SMS promos to attendees (e.g. Adoptapalooza follow-up).', 'Email & SMS marketing', 2),
  ('New-client list capture', 'active', 'Jenn', 'Add event RSVPs & sign-ups to the new-client list; hand to front teams.', 'Follow-up & review requests', 9),
  ('Staff appreciation weeks', 'active', 'Brittany', 'CSR / tech / vet appreciation — gifts, lunches, customizing.', 'Employee engagement', 1),
  ('Holiday & staff parties', 'active', 'Brittany', 'Holiday parties, gift exchanges, staff events.', 'Employee engagement', 2),
  ('Onboarding kits & manuals', 'active', 'Gladys', 'Training manuals, key cards, name tags, welcome items.', 'Employee engagement', 3),
  ('SmileSpray', 'active', 'Marketing', 'Liquid product line: stock, vendor, filling/labeling, sales.', 'Green Dog Products', 1),
  ('DentalDust', 'active', 'Marketing', 'Product packaging, labels, creation & sales.', 'Green Dog Products', 2),
  ('Wholesale orders', 'active', 'Marketing', 'Wholesale lists/prices, invoicing, delivery.', 'Green Dog Products', 3),
  ('Product cards (ezyVet)', 'needs_attention', 'Marketing', 'Product cards & ezyVet line items/prices; labels need a revamp.', 'Green Dog Products', 4)
) as v(label, status, owner_name, summary, parent_label, sort_order)
where not exists (select 1 from greendogops.marketing_tree_node t where t.label = v.label);
