-- ============================================================================
-- Green Dog Ops — 0103 Marketing Tree (config-driven navigation nodes)
-- ----------------------------------------------------------------------------
-- The Marketing Tree is the visual home base for all marketing activity. Every
-- brand touchpoint is a NODE placed in one of five zones split by a "ground
-- line" (the first visit): above ground = acquisition (canopy / branch /
-- trunk), below ground = retention (root_primary / root_fine).
--
-- Fully config-driven: staff add / edit / retire nodes in-app; the renderer
-- computes positions from the hierarchy. Zone + status are free text, enforced
-- in the app layer (avoids CHECK-constraint case landmines).
--
--   zone    : canopy | branch | trunk | root_primary | root_fine
--   status  : active | needs_attention | planning | dormant | archived
--   parent_id: builds the hierarchy. Canopy → branch; root_fine → root_primary.
--              Trunk / branch / root_primary may be null (attach to trunk).
--   links   : jsonb array [{label,url}] — destinations into the ops software.
--   metrics : jsonb object shown only in the detail panel, e.g.
--             {"newClients":14,"spend":850}.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.marketing_tree_node (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  zone        text not null default 'canopy',
  parent_id   uuid references greendogops.marketing_tree_node (id) on delete set null,
  status      text not null default 'active',
  owner_name  text,
  due_date    date,
  links       jsonb not null default '[]'::jsonb,
  summary     text,
  metrics     jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists marketing_tree_node_zone_idx
  on greendogops.marketing_tree_node (zone);
create index if not exists marketing_tree_node_parent_idx
  on greendogops.marketing_tree_node (parent_id);

drop trigger if exists set_updated_at on greendogops.marketing_tree_node;
create trigger set_updated_at before update on greendogops.marketing_tree_node
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_tree_node
  to authenticated, service_role;

-- ============================================================================
-- Seed ~30 realistic Green Dog nodes. Guarded per-zone so re-running is safe.
-- Children reference parents by label (labels are unique within this seed).
-- ============================================================================

-- Trunk — daily essentials (no parent) --------------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, sort_order)
select * from (values
  ('Google reviews & response', 'trunk', 'active', 'Brittany', 'Respond to every Google review across all locations, daily.', 1),
  ('Front-desk & phone experience', 'trunk', 'active', 'Front teams', 'First impression on every call and greeting — brand voice & booking.', 2),
  ('Brand consistency', 'trunk', 'needs_attention', 'Marketing', 'Logos, colors, verbiage consistent everywhere (labels/cards need revamp).', 3),
  ('Website & online booking uptime', 'trunk', 'active', 'Marc', 'Site up, booking funnel working, content current.', 4)
) as v(label, zone, status, owner_name, summary, sort_order)
where not exists (select 1 from greendogops.marketing_tree_node where zone = 'trunk');

-- Branches — core acquisition channels --------------------------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, links, sort_order)
select * from (values
  ('Local SEO & Google Business', 'branch', 'active', 'Marketing', 'Google Business Profiles, local search visibility for all clinics.', '[]'::jsonb, 1),
  ('Website & booking funnel', 'branch', 'active', 'Marc', 'Genius Vets site, landing pages, online booking.', '[]'::jsonb, 2),
  ('Paid ads (Google / social)', 'branch', 'active', 'Brittany', 'FB/IG boosted posts & Google ads — concepts, targeting, tracking.', '[]'::jsonb, 3),
  ('Referral program', 'branch', 'active', 'Marc', 'Referring clinics & hospitals pipeline.', '[{"label":"Referral CRM","url":"/crm/referral"}]'::jsonb, 4),
  ('Community partnerships', 'branch', 'active', 'Dre', 'Chambers, rescues, local businesses & vendors.', '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"},{"label":"Rescue CRM","url":"/crm/rescue"}]'::jsonb, 5),
  ('Social media & content', 'branch', 'active', 'Brittany', 'IG / FB / TikTok / Threads daily content & engagement.', '[{"label":"Influencer CRM","url":"/crm/influencer"}]'::jsonb, 6)
) as v(label, zone, status, owner_name, summary, links, sort_order)
where not exists (select 1 from greendogops.marketing_tree_node where zone = 'branch');

-- Canopy — one-off / seasonal draws (parent = a branch) ----------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, due_date, summary, links, metrics, sort_order, parent_id)
select v.label, v.zone, v.status, v.owner_name, v.due_date, v.summary, v.links, v.metrics, v.sort_order, p.id
from (values
  ('Adoptapalooza 2026', 'canopy', 'planning', 'Dre', date '2026-07-11', 'Flagship hosted adoption + vendor festival.', '[{"label":"Events","url":"/marketing"}]'::jsonb, '{"newClients":0,"spend":0}'::jsonb, 1, 'Community partnerships'),
  ('Pet-Chella', 'canopy', 'planning', 'Marketing', null, 'Recurring hosted adoption festival.', '[]'::jsonb, '{}'::jsonb, 2, 'Community partnerships'),
  ('Spring street fair booth', 'canopy', 'active', 'Dre', date '2026-04-18', 'Booth, giveaways & new-client coupon.', '[]'::jsonb, '{"newClients":14,"spend":850}'::jsonb, 3, 'Community partnerships'),
  ('Pop-up vaccine clinic', 'canopy', 'planning', 'Marketing', null, 'Community low-cost vaccine pop-up.', '[]'::jsonb, '{}'::jsonb, 4, 'Community partnerships'),
  ('School visit', 'canopy', 'dormant', 'Marketing', null, 'Career day / classroom pet-care visit.', '[]'::jsonb, '{}'::jsonb, 5, 'Community partnerships'),
  ('Dental Health Month promo', 'canopy', 'active', 'Brittany', date '2026-02-01', 'February dental awareness campaign & discount.', '[]'::jsonb, '{}'::jsonb, 6, 'Social media & content'),
  ('Influencer collab', 'canopy', 'active', 'Brittany', null, 'Vet / pet influencer content collaborations.', '[{"label":"Influencer CRM","url":"/crm/influencer"}]'::jsonb, '{}'::jsonb, 7, 'Social media & content')
) as v(label, zone, status, owner_name, due_date, summary, links, metrics, sort_order, parent_label)
left join greendogops.marketing_tree_node p on p.label = v.parent_label
where not exists (select 1 from greendogops.marketing_tree_node where zone = 'canopy');

-- Primary roots — core retention programs (no parent; fork from trunk base) --
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, links, sort_order)
select * from (values
  ('In-clinic signage & flyers', 'root_primary', 'active', 'Marketing', 'Lobby signage, brochures & printed collateral.', '[]'::jsonb, 1),
  ('Uniforms & branded merch', 'root_primary', 'needs_attention', 'Brittany', 'Staff scrubs, jackets, hats — sourcing, ordering, embroidery.', '[]'::jsonb, 2),
  ('Retail product sales', 'root_primary', 'active', 'Marketing', 'SmileSpray, DentalDust & Green Dog Products.', '[]'::jsonb, 3),
  ('Recall / reminder campaigns', 'root_primary', 'active', 'Marketing', 'Automated recalls & reminders in ezyVet.', '[]'::jsonb, 4),
  ('Loyalty & wellness plan', 'root_primary', 'active', 'Marketing', 'Green Dog Pet Plus wellness plan & member perks.', '[]'::jsonb, 5),
  ('Follow-up & review requests', 'root_primary', 'active', 'Front teams', 'Post-visit follow-up & review asks.', '[]'::jsonb, 6)
) as v(label, zone, status, owner_name, summary, links, sort_order)
where not exists (select 1 from greendogops.marketing_tree_node where zone = 'root_primary');

-- Fine roots — individual tactics (parent = a primary root) -------------------
insert into greendogops.marketing_tree_node (label, zone, status, owner_name, summary, links, sort_order, parent_id)
select v.label, v.zone, v.status, v.owner_name, v.summary, v.links, v.sort_order, p.id
from (values
  ('Dental report cards', 'root_fine', 'active', 'Marketing', 'Take-home dental report cards for clients.', '[]'::jsonb, 1, 'In-clinic signage & flyers'),
  ('Referral brochures', 'root_fine', 'active', 'Marketing', 'GDU & referral brochures for the lobby.', '[]'::jsonb, 2, 'In-clinic signage & flyers'),
  ('Scrub & jacket ordering', 'root_fine', 'needs_attention', 'Brittany', 'UA order form, sizing, embroidery, distribution.', '[]'::jsonb, 3, 'Uniforms & branded merch'),
  ('Proud Pet Parent merch', 'root_fine', 'planning', 'Melissa', 'PPP merch line — needs new local vendor.', '[]'::jsonb, 4, 'Uniforms & branded merch'),
  ('Shopify store', 'root_fine', 'active', 'Marketing', 'Ecommerce store for products & merch.', '[{"label":"Shopify","url":"https://www.shopify.com"}]'::jsonb, 5, 'Retail product sales'),
  ('Post-visit email', 'root_fine', 'active', 'Marketing', 'Thank-you & aftercare email after each visit.', '[]'::jsonb, 6, 'Follow-up & review requests'),
  ('Google review request', 'root_fine', 'active', 'Front teams', 'Ask happy clients for a Google review.', '[]'::jsonb, 7, 'Follow-up & review requests'),
  ('Dental recall', 'root_fine', 'active', 'Marketing', 'Annual dental recall reminders.', '[]'::jsonb, 8, 'Recall / reminder campaigns')
) as v(label, zone, status, owner_name, summary, links, sort_order, parent_label)
left join greendogops.marketing_tree_node p on p.label = v.parent_label
where not exists (select 1 from greendogops.marketing_tree_node where zone = 'root_fine');
