-- ============================================================================
-- Green Dog Ops — 0126 Marketing tree ← "MARKETING TEAM | CORE RESPONSIBILITIES"
-- ----------------------------------------------------------------------------
-- Assimilates the current org responsibilities doc
-- (public/MARKETING TEAM _ CORE RESPONSIBILITIES.pdf) into the Marketing tree:
--   1. Re-owns nodes to the people the doc names for each responsibility area.
--   2. Adds nodes for responsibilities that had no home yet.
--   3. Normalizes in-node item owner tags so they match the new node owners.
--
-- LEADERSHIP CHANGE captured here: the doc names GLADYS (Gladys Juliette, CCO)
-- as Marketing Lead — the strategic/leadership + website/digital + email/SMS +
-- budget scope previously carried by Andrea Rehrig ("Dre", CMO). Andrea is not
-- named in the doc, so her nodes move to Gladys. If Andrea is still involved,
-- flip individual owners in-app.
--
-- People → roster person (matched by full_name so it stays environment-portable):
--   Gladys  → Gladys Juliette   (Chief Communications Officer / Marketing Lead)
--   Marc    → Marc Mercury      (COO / Referral & Partnership Lead)
--   Jenn    → Jennifer Velasquez (Marketing Assistant / Events Coordinator)
--   Laurence→ Laurence Marai    (Referral & Relationship Coordinator)  [NEW]
--   Naomi   → Naomi Folta       (Social Media Manager / Brand Ambassador)
--   Hso     → Hso Hkam          (Media Production / On-Call Support)   [NEW]
-- Reviews & Reputation stays with the front teams (doc: review monitoring &
-- responses are "handled by another department").
-- ============================================================================
set search_path = greendogops, public;

do $$
declare
  gladys_id   uuid := (select id from greendogops.person where full_name = 'Gladys Juliette'    order by is_active desc limit 1);
  marc_id     uuid := (select id from greendogops.person where full_name = 'Marc Mercury'        order by is_active desc limit 1);
  jenn_id     uuid := (select id from greendogops.person where full_name = 'Jennifer Velasquez'  order by is_active desc limit 1);
  laurence_id uuid := (select id from greendogops.person where full_name = 'Laurence Marai'      order by is_active desc limit 1);
  naomi_id    uuid := (select id from greendogops.person where full_name = 'Naomi Folta'         order by is_active desc limit 1);
  hso_id      uuid := (select id from greendogops.person where full_name = 'Hso Hkam'            order by is_active desc limit 1);
  team_ops_id uuid := (select id from greendogops.marketing_tree_node where label = 'Team & Operations' and status <> 'archived' limit 1);
  client_prog_id uuid := (select id from greendogops.marketing_tree_node where label = 'Client Programs' and status <> 'archived' limit 1);
begin
  -- Idempotent: bail if this migration's anchor node already exists.
  if exists (
    select 1 from greendogops.marketing_tree_node
     where label = 'Team Meetings & Cadence' and status <> 'archived'
  ) then
    return;
  end if;

  -- ==========================================================================
  -- 1) RE-OWN EXISTING NODES to the doc's named owners (by unique active label)
  -- ==========================================================================

  -- GLADYS — strategy & leadership, website & digital, email/SMS, budget -------
  update greendogops.marketing_tree_node
     set owner_person_id = gladys_id, owner_name = null
   where status <> 'archived'
     and label in (
       'Brand & Voice',
       'Website & Online Booking',
       'SEO & Web Presence',
       'Campaigns & Promotions',
       'Quarterly Mailers',
       'Off-Quarter SMS',
       'Email Marketing',
       'Client Promos',
       'Digital Ads',
       'Deal & Discount Sites',
       'Direct / Physical Mail',
       'Wellness Plan',
       'Client Programs',
       'Client Referral Program',
       'Exotics Marketing',
       'Budget & Performance',
       'Team & Operations',
       'Roles & Responsibilities'
     );

  -- MARC — referral & partnership strategy/oversight --------------------------
  update greendogops.marketing_tree_node
     set owner_person_id = marc_id, owner_name = null
   where status <> 'archived'
     and label in ('Partnerships & Outreach');  -- Referral Network already Marc

  -- LAURENCE — executes partner/community relationships -----------------------
  update greendogops.marketing_tree_node
     set owner_person_id = laurence_id, owner_name = null
   where status <> 'archived'
     and label in (
       'Dog PPL Partnership',
       'Rescues & Shelters',
       'Chambers & Local Business',
       'Schools & Education',
       'Pet Business Partners'
     );

  -- JENN — events & CE (CE moves from Andrea to Jenn) -------------------------
  update greendogops.marketing_tree_node
     set owner_person_id = jenn_id, owner_name = null
   where status <> 'archived'
     and label in ('CE / GDU Events');

  -- HSO — media production owns the video pipeline ----------------------------
  update greendogops.marketing_tree_node
     set owner_person_id = hso_id, owner_name = null
   where status <> 'archived'
     and label in ('Video Marketing');

  -- ==========================================================================
  -- 2) NEW NODES for responsibilities that had no home yet
  -- ==========================================================================

  -- Under Team & Operations --------------------------------------------------
  insert into greendogops.marketing_tree_node
    (label, zone, status, owner_person_id, priority, summary, links, sort_order, items, parent_id)
  values
    ('Marketing Inbox & Google Voice', 'root_fine', 'active', jenn_id, 'medium',
     'Monitor & organize the shared Marketing inbox and Google Voice communications.',
     '[]'::jsonb, 5, $j$[
       {"label":"Monitor & triage the shared Marketing inbox","date":"Daily","status":"active","owner":"Jennifer Velasquez","url":""},
       {"label":"Manage Google Voice messages & callbacks","date":"Daily","status":"active","owner":"Jennifer Velasquez","url":""}
     ]$j$::jsonb, team_ops_id),

    ('Training & Onboarding Materials', 'root_fine', 'active', jenn_id, 'medium',
     'Maintain training manuals, onboarding materials, name tags & key cards; centralize guides in the shared Google folder.',
     '[{"label":"HR / Roster","url":"/hr"}]'::jsonb, 6, $j$[
       {"label":"Maintain training manuals & onboarding materials","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":""},
       {"label":"Name tags & key cards","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":""},
       {"label":"Centralize training guides in the shared Google folder","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":""}
     ]$j$::jsonb, team_ops_id),

    ('Employee Appreciation & Culture', 'root_fine', 'active', jenn_id, 'low',
     'Coordinate employee appreciation activities, holidays & staff special events.',
     '[]'::jsonb, 7, $j$[
       {"label":"Employee appreciation activities & holidays","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":""},
       {"label":"Staff special events","date":"Ongoing","status":"active","owner":"Jennifer Velasquez","url":""}
     ]$j$::jsonb, team_ops_id),

    ('Team Meetings & Cadence', 'root_fine', 'active', gladys_id, 'medium',
     'Marketing meeting cadence — Monday Deep Dive & Wednesday reporting with Doc; progress reports & action items.',
     '[]'::jsonb, 8, $j$[
       {"label":"Monday Marketing Deep Dive meeting","date":"Weekly","status":"active","owner":"Gladys Juliette","url":""},
       {"label":"Wednesday reporting meeting with Doc","date":"Weekly","status":"active","owner":"Gladys Juliette","url":""},
       {"label":"Come prepared: progress, priorities, opportunities, challenges","date":"Weekly","status":"active","owner":"Whole team","url":""},
       {"label":"Meeting notes & assigned action items","date":"Weekly","status":"active","owner":"Whole team","url":""}
     ]$j$::jsonb, team_ops_id);

  -- Under Client Programs ----------------------------------------------------
  insert into greendogops.marketing_tree_node
    (label, zone, status, owner_person_id, priority, summary, links, sort_order, items, parent_id)
  values
    ('In-Clinic Reviews & Sign-ups', 'root_fine', 'active', laurence_id, 'high',
     'In-clinic client relationships — introduce programs, generate Google/Yelp reviews organically, hit weekly sign-up & review goals set by Marc.',
     '[]'::jsonb, 6, $j$[
       {"label":"Greet clients & introduce Green Dog programs and services","date":"Daily","status":"active","owner":"Laurence Marai","url":""},
       {"label":"Generate Google & Yelp reviews organically through conversations","date":"Daily","status":"active","owner":"Laurence Marai","url":""},
       {"label":"Weekly program sign-up & client-review goals (set by Marc)","date":"Weekly","status":"active","owner":"Laurence Marai","url":""},
       {"label":"Report client concerns to the appropriate manager","date":"As needed","status":"active","owner":"Laurence Marai","url":""}
     ]$j$::jsonb, client_prog_id);

  -- ==========================================================================
  -- 3) NORMALIZE in-node item owner tags to the new owners
  -- ==========================================================================

  -- 3a) Andrea Rehrig is no longer on the team → her item tags become Gladys.
  update greendogops.marketing_tree_node n
     set items = coalesce((
           select jsonb_agg(
                    case when elem->>'owner' = 'Andrea Rehrig'
                         then jsonb_set(elem, '{owner}', to_jsonb('Gladys Juliette'::text))
                         else elem end
                    order by ord)
             from jsonb_array_elements(n.items) with ordinality as e(elem, ord)
         ), '[]'::jsonb)
   where n.status <> 'archived'
     and n.items @> '[{"owner":"Andrea Rehrig"}]'::jsonb;

  -- 3b) In the partnership nodes now owned by Laurence, the (ex-Andrea, now
  --     Gladys) relationship items belong to Laurence.
  update greendogops.marketing_tree_node n
     set items = coalesce((
           select jsonb_agg(
                    case when elem->>'owner' = 'Gladys Juliette'
                         then jsonb_set(elem, '{owner}', to_jsonb('Laurence Marai'::text))
                         else elem end
                    order by ord)
             from jsonb_array_elements(n.items) with ordinality as e(elem, ord)
         ), '[]'::jsonb)
   where n.status <> 'archived'
     and n.label in ('Dog PPL Partnership','Rescues & Shelters',
                     'Chambers & Local Business','Schools & Education',
                     'Pet Business Partners')
     and n.items @> '[{"owner":"Gladys Juliette"}]'::jsonb;

  -- 3c) Video production items follow the node to Hso.
  update greendogops.marketing_tree_node n
     set items = coalesce((
           select jsonb_agg(
                    case when elem->>'owner' = 'Naomi Folta'
                         then jsonb_set(elem, '{owner}', to_jsonb('Hso Hkam'::text))
                         else elem end
                    order by ord)
             from jsonb_array_elements(n.items) with ordinality as e(elem, ord)
         ), '[]'::jsonb)
   where n.status <> 'archived'
     and n.label = 'Video Marketing'
     and n.items @> '[{"owner":"Naomi Folta"}]'::jsonb;

  -- ==========================================================================
  -- 4) Rewrite the "Roles & Responsibilities" node to the current team.
  -- ==========================================================================
  update greendogops.marketing_tree_node set items = $j$[
    {"label":"Gladys Juliette — Chief Communications Officer / Marketing Lead (strategy, website & digital, email/SMS, budget)","date":"","status":"active","owner":"Gladys Juliette","url":"/hr"},
    {"label":"Marc Mercury — COO / Referral & Partnership Lead (referral & partnership strategy, manages Laurence)","date":"","status":"active","owner":"Marc Mercury","url":"/hr"},
    {"label":"Jennifer Velasquez — Marketing Assistant / Events Coordinator (events, CE, inventory, Shopify, email/SMS support)","date":"","status":"active","owner":"Jennifer Velasquez","url":"/hr"},
    {"label":"Laurence Marai — Referral & Relationship Coordinator (partnerships, chambers, referral outreach, in-clinic)","date":"","status":"active","owner":"Laurence Marai","url":"/hr"},
    {"label":"Naomi Folta — Social Media Manager / Brand Ambassador (social, content, brand, influencers)","date":"","status":"active","owner":"Naomi Folta","url":"/hr"},
    {"label":"Hso Hkam — Media Production / On-Call Support (photography & video production)","date":"","status":"active","owner":"Hso Hkam","url":"/hr"}
  ]$j$::jsonb
   where label = 'Roles & Responsibilities' and status <> 'archived';

end $$;
