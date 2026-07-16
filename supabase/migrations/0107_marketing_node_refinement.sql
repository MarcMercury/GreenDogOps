-- ============================================================================
-- Green Dog Ops — 0107 Marketing Tree node refinement + activity log
-- ----------------------------------------------------------------------------
-- Make the tree NODE the hub of the marketing module:
--   * owner_person_id  — real roster person (FK) instead of free text
--   * priority         — low | medium | high (drives priority lists)
--   * budget_amount / budget_spent / budget_notes — per-node budgeting (visible
--     to everyone; the full Budget tab stays admin-only)
--   * last_handled_at  — set by an "Updated" button; drives a staleness tint
--   (metrics jsonb is retired from the UI — column kept but unused)
--
-- marketing_activity — an append-only feed of node/actions that powers the
-- Activity tab and lets node actions drive the rest of the module.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.marketing_tree_node
  add column if not exists owner_person_id uuid
    references greendogops.person (id) on delete set null,
  add column if not exists priority       text not null default 'medium',
  add column if not exists budget_amount  numeric,
  add column if not exists budget_spent   numeric,
  add column if not exists budget_notes   text,
  add column if not exists last_handled_at timestamptz;

comment on column greendogops.marketing_tree_node.last_handled_at is
  'Last time someone clicked "Updated" on the node; drives the staleness tint.';

-- Activity feed ----------------------------------------------------------------
create table if not exists greendogops.marketing_activity (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,            -- node_handled | node_saved | node_created | ...
  entity_type  text not null default 'node',
  entity_id    uuid,
  title        text not null,
  detail       text,
  actor        text,
  created_at   timestamptz not null default now()
);

create index if not exists marketing_activity_created_idx
  on greendogops.marketing_activity (created_at desc);

grant select, insert, update, delete on greendogops.marketing_activity
  to authenticated, service_role;
