-- ============================================================================
-- Green Dog Ops — 0115 Marketing Tree channel coverage
-- ----------------------------------------------------------------------------
-- Backfills the "Green Dog Marketing Channels & Activities" catalog into the
-- tree so every documented channel/activity is accounted for somewhere — a
-- category NODE (canopy / root_fine leaf) or an in-node LIST item.
--
-- Coverage decisions (source list → where it lands):
--   General Campaigns
--     Proud Pet Parent Initiative ............. new node "Client Referral Program" (item)
--     Client Referral Program ................. new node "Client Referral Program"
--     GeniusVet Drive-by Check-in ............. "Client Referral Program" (item)
--     Physical Mail Campaign .................. new node "Direct / Physical Mail"
--   Email Marketing (existing / new-client) ... new node "Email Marketing"
--   Social Media
--     Facebook / Instagram / TikTok ........... already in "Social Channels"
--     LinkedIn + Threads & X .................. appended to "Social Channels"
--   Influencer Marketing .................... already "Influencer & Collabs"
--   Video Marketing (web / social / in-clinic)  new node "Video Marketing"
--   SEO / Web Presence (site, Google Ads) ... new node "SEO & Web Presence"
--   Discount Campaigns (Groupon, ValPak) .... new node "Deal & Discount Sites"
--   Print Media ............................. appended to "Signage & Print"
--   Podcast Marketing ....................... new node "Podcast Marketing"
--   Review Sites (Yelp/Google/NextDoor/Reddit) appended to trunk "Reviews & Reputation"
--   Other Digital Partnerships
--     Eventbrite / SMDP / ThingsToDoLA ........ new node "Event Listings & Promo"
--     Local pet-business partners ............. new node "Pet Business Partners"
--   Industry Referrals
--     Medical ................................. already "Referral Network"
--     Non-Medical ............................. new node "Pet Business Partners"
--   Promotional Events (educational/community)  already CE/GDU & 3rd-Party/GDD events
--   Retail & Direct Partnerships ............ already "Retail & Shopify" + Partnerships
--   Building Promotion ...................... appended to "Signage & Print" (item)
--   Employee-Related Marketing
--     Uniforms + branded swag / event shirts .. "Uniforms" (node + items)
--     Glassdoor ............................... appended to "Reviews & Reputation"
--
-- Idempotent: guarded on the "Video Marketing" anchor node.
-- ============================================================================
set search_path = greendogops, public;

do $$
begin
  if exists (
    select 1 from greendogops.marketing_tree_node
     where label = 'Video Marketing' and status <> 'archived'
  ) then
    return;
  end if;

  -- ---- NEW CANOPY LEAVES (attract categories) ----------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order, items, parent_id)
  select v.label, v.zone, v.status, v.owner_name, v.priority, v.summary, v.links, v.sort_order, v.items, p.id
  from (values
    -- Events & Community
    ('Event Listings & Promo', 'canopy', 'active', 'Jenn', 'medium',
     'Promote Green Dog events on 3rd-party digital listing & discovery platforms.',
     '[{"label":"Calendar","url":"/calendar"}]'::jsonb, 6, $j$[
       {"label":"Eventbrite — list & cross-promote our events","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":"https://www.eventbrite.com/"},
       {"label":"SMDP (Santa Monica Daily Press) event promo","date":"Ongoing","status":"idea","owner":"Jennifer Velasquez","url":""},
       {"label":"ThingsToDoLA event listings","date":"Ongoing","status":"idea","owner":"Jennifer Velasquez","url":""}
     ]$j$::jsonb, 'Events & Community'),
    -- Campaigns & Promotions
    ('Email Marketing', 'canopy', 'active', 'Dre', 'high',
     'Dedicated email programs beyond the quarterly newsletter — existing clients & new-client acquisition.',
     '[]'::jsonb, 5, $j$[
       {"label":"Existing customer campaigns — retention, recalls, reactivation","date":"Ongoing","status":"active","owner":"Andrea Rehrig","url":""},
       {"label":"New client acquisition campaigns — welcome & first-visit offers","date":"Ongoing","status":"active","owner":"Andrea Rehrig","url":""}
     ]$j$::jsonb, 'Campaigns & Promotions'),
    ('Direct / Physical Mail', 'canopy', 'active', 'Dre', 'medium',
     'Printed direct-mail campaigns — postcards & mailers to targeted neighborhoods.',
     '[]'::jsonb, 6, $j$[
       {"label":"Physical mail campaign — neighborhood postcard drop","date":"","status":"idea","owner":"Andrea Rehrig","url":""}
     ]$j$::jsonb, 'Campaigns & Promotions'),
    ('Deal & Discount Sites', 'canopy', 'active', 'Dre', 'low',
     'Third-party deal & coupon platforms for new-client acquisition.',
     '[]'::jsonb, 7, $j$[
       {"label":"Groupon — intro exam / dental deal listing","date":"","status":"idea","owner":"Andrea Rehrig","url":""},
       {"label":"ValPak — coupon mailer insert","date":"","status":"idea","owner":"Andrea Rehrig","url":""}
     ]$j$::jsonb, 'Campaigns & Promotions'),
    -- Social & Digital
    ('Video Marketing', 'canopy', 'active', 'Naomi', 'medium',
     'Video content across web, social & in-clinic screens.',
     '[]'::jsonb, 5, $j$[
       {"label":"For web — homepage & service explainer videos","date":"","status":"planned","owner":"Naomi Folta","url":""},
       {"label":"For social media — reels, shorts & TikToks","date":"Weekly","status":"active","owner":"Naomi Folta","url":""},
       {"label":"In-clinic presentations — lobby & exam-room screen loops","date":"","status":"idea","owner":"Naomi Folta","url":""}
     ]$j$::jsonb, 'Social & Digital'),
    ('SEO & Web Presence', 'canopy', 'active', 'Marc', 'medium',
     'Search visibility & the GeniusVets website — keep GDD.com ranking for core & exotics terms.',
     '[{"label":"Website & booking","url":"/marketing"}]'::jsonb, 6, $j$[
       {"label":"Website (GDD.com) — content, SEO & landing pages","date":"Ongoing","status":"active","owner":"Marc Mercury","url":""},
       {"label":"Google Ads — core & exotics terms rank 1–2 (via GeniusVets)","date":"Ongoing","status":"active","owner":"Naomi Folta","url":""}
     ]$j$::jsonb, 'Social & Digital'),
    ('Podcast Marketing', 'canopy', 'active', 'Naomi', 'low',
     'Podcast guest spots & sponsorship opportunities on pet / local shows.',
     '[]'::jsonb, 7, $j$[
       {"label":"Scout pet & local podcast guest / sponsor opportunities","date":"","status":"idea","owner":"Naomi Folta","url":""}
     ]$j$::jsonb, 'Social & Digital'),
    -- Partnerships & Outreach
    ('Pet Business Partners', 'canopy', 'active', 'Jenn', 'medium',
     'Non-medical local pet businesses — grooming, daycare, boarding — for cross-referrals & co-promotion.',
     '[{"label":"Vendor & Partner CRM","url":"/crm/vendor"}]'::jsonb, 6, $j$[
       {"label":"Grooming, daycare & boarding cross-referral partners","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":"/crm/vendor"},
       {"label":"Non-medical referral network — local pet businesses","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":"/crm/vendor"}
     ]$j$::jsonb, 'Partnerships & Outreach')
  ) as v(label, zone, status, owner_name, priority, summary, links, sort_order, items, parent_label)
  left join greendogops.marketing_tree_node p
    on p.label = v.parent_label and p.status <> 'archived';

  -- ---- NEW FINE ROOT (retain category) -----------------------------------
  insert into greendogops.marketing_tree_node (label, zone, status, owner_name, priority, summary, links, sort_order, items, parent_id)
  select v.label, v.zone, v.status, v.owner_name, v.priority, v.summary, v.links, v.sort_order, v.items, p.id
  from (values
    ('Client Referral Program', 'root_fine', 'active', 'Dre', 'high',
     'Turn happy clients into advocates — referral rewards, proud-pet-parent shares & drive-by check-ins.',
     '[]'::jsonb, 5, $j$[
       {"label":"Client referral program — reward clients who refer friends","date":"","status":"planned","owner":"Andrea Rehrig","url":""},
       {"label":"Proud Pet Parent initiative — encourage client social shares & tags","date":"","status":"idea","owner":"Naomi Folta","url":""},
       {"label":"GeniusVet drive-by check-in system","date":"","status":"idea","owner":"Marc Mercury","url":""}
     ]$j$::jsonb, 'Client Programs')
  ) as v(label, zone, status, owner_name, priority, summary, links, sort_order, items, parent_label)
  left join greendogops.marketing_tree_node p
    on p.label = v.parent_label and p.status <> 'archived';

  -- ---- APPEND ITEMS TO EXISTING NODES ------------------------------------
  -- Social Channels: add the remaining platforms from the catalog.
  update greendogops.marketing_tree_node
     set items = items || $j$[
       {"label":"LinkedIn — brand & recruiting presence","date":"","status":"idea","owner":"Naomi Folta","url":""},
       {"label":"Threads & X (Twitter) — reshare social content","date":"","status":"idea","owner":"Naomi Folta","url":""}
     ]$j$::jsonb
   where label = 'Social Channels' and status <> 'archived';

  -- Reviews & Reputation (trunk): enumerate the review sites + Glassdoor.
  update greendogops.marketing_tree_node
     set items = items || $j$[
       {"label":"Google reviews — respond daily, grow volume","date":"Daily","status":"active","owner":"Front teams","url":""},
       {"label":"Yelp — monitor & respond, add photos/videos","date":"Ongoing","status":"active","owner":"Front teams","url":""},
       {"label":"NextDoor — neighborhood presence & recommendations","date":"Ongoing","status":"idea","owner":"Naomi Folta","url":""},
       {"label":"Reddit — local pet subreddits (light-touch)","date":"Ongoing","status":"idea","owner":"Naomi Folta","url":""},
       {"label":"Glassdoor — encourage positive employee reviews","date":"Ongoing","status":"idea","owner":"Andrea Rehrig","url":""}
     ]$j$::jsonb
   where label = 'Reviews & Reputation' and status <> 'archived';

  -- Signage & Print: add the remaining print collateral + building promotion.
  update greendogops.marketing_tree_node
     set items = items || $j$[
       {"label":"Product cards & internal-medicine (IM) service flyers","date":"","status":"planned","owner":"Naomi Folta","url":""},
       {"label":"Business cards & event-specific printed materials","date":"","status":"active","owner":"Naomi Folta","url":""},
       {"label":"Building promotion — window, sidewalk & monument signage","date":"","status":"idea","owner":"Naomi Folta","url":""}
     ]$j$::jsonb
   where label = 'Signage & Print' and status <> 'archived';

  -- Uniforms: add branded swag & event shirts (employee-related marketing).
  update greendogops.marketing_tree_node
     set items = items || $j$[
       {"label":"Event shirts — branded staff tees for events","date":"","status":"active","owner":"Jennifer Velasquez","url":""},
       {"label":"Branded swag — hats, pins & giveaway items","date":"","status":"active","owner":"Naomi Folta","url":""}
     ]$j$::jsonb
   where label = 'Uniforms' and status <> 'archived';

  -- ---- Link the new nodes' owners to real roster people (per 0114) --------
  update greendogops.marketing_tree_node n
     set owner_person_id = p.id,
         owner_name = null
    from greendogops.person p
   where n.status <> 'archived'
     and n.owner_name is not null
     and n.owner_person_id is null
     and (
          (n.owner_name = 'Dre'   and p.full_name = 'Andrea Rehrig')
       or (n.owner_name = 'Naomi' and p.full_name = 'Naomi Folta')
       or (n.owner_name = 'Jenn'  and p.full_name = 'Jennifer Velasquez')
       or (n.owner_name = 'Marc'  and p.full_name = 'Marc Mercury')
     );

end $$;
