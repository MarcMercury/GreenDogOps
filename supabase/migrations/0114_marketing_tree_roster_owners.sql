-- ============================================================================
-- Green Dog Ops — 0114 Marketing Tree owners → real HR roster people
-- ----------------------------------------------------------------------------
-- The 0113 restructure seeded owners as free-text nicknames (Dre, Naomi, Jenn,
-- Marc). Per team direction, marketing roles are ACTUAL employees on the HR
-- roster — no duplicate/"floating" identities. This migration:
--   1. Links each node's owner to the matching greendogops.person (owner_person_id)
--      and clears the free-text owner_name so the app renders the roster person
--      (clickable → /hr) instead of a loose string.
--   2. Normalizes the in-node item `owner` tags from nicknames to real names.
--   3. Rewrites the "Roles & Responsibilities" node to reference the real people
--      with links into the HR roster.
--
-- Name → roster person (matched by full_name so it is environment-portable):
--   Dre   → Andrea Rehrig            (Marketing Director / CMO)
--   Naomi → Naomi Folta              (Social Media Manager + Brand Ambassador)
--   Jenn  → Jennifer Velasquez       (Marketing Assistant + Events Coordinator)
--   Marc  → Marc Mercury
-- "Front teams" / "Marketing" are TEAM descriptors (not individuals) — left as-is.
-- ============================================================================
set search_path = greendogops, public;

-- 1) Link node owners to real roster people, then drop the free-text name. -----
update greendogops.marketing_tree_node n
   set owner_person_id = p.id,
       owner_name = null
  from greendogops.person p
 where n.status <> 'archived'
   and n.owner_name is not null
   and (
        (n.owner_name = 'Dre'   and p.full_name = 'Andrea Rehrig')
     or (n.owner_name = 'Naomi' and p.full_name = 'Naomi Folta')
     or (n.owner_name = 'Jenn'  and p.full_name = 'Jennifer Velasquez')
     or (n.owner_name = 'Marc'  and p.full_name = 'Marc Mercury')
   );

-- 2) Normalize the in-node item owner tags (nickname → real name). -------------
update greendogops.marketing_tree_node n
   set items = coalesce((
         select jsonb_agg(
                  case when m.fullname is not null
                       then jsonb_set(elem, '{owner}', to_jsonb(m.fullname))
                       else elem end
                  order by ord
                )
           from jsonb_array_elements(n.items) with ordinality as e(elem, ord)
           left join (values
                       ('Dre',   'Andrea Rehrig'),
                       ('Naomi', 'Naomi Folta'),
                       ('Jenn',  'Jennifer Velasquez'),
                       ('Marc',  'Marc Mercury')
                     ) as m(short, fullname) on m.short = elem->>'owner'
       ), '[]'::jsonb)
 where n.status <> 'archived'
   and jsonb_array_length(n.items) > 0;

-- 3) Rewrite the Roles node to point at the actual employees (link → /hr). -----
update greendogops.marketing_tree_node set items = $j$[
  {"label":"Andrea Rehrig — Marketing Director / CMO (strategy, partnerships, budget)","date":"","status":"active","owner":"Andrea Rehrig","url":"/hr"},
  {"label":"Naomi Folta — Social Media Manager + Brand Ambassador","date":"","status":"active","owner":"Naomi Folta","url":"/hr"},
  {"label":"Jennifer Velasquez — Marketing Assistant + Events Coordinator","date":"","status":"active","owner":"Jennifer Velasquez","url":"/hr"}
]$j$::jsonb
 where label = 'Roles & Responsibilities' and status <> 'archived';
