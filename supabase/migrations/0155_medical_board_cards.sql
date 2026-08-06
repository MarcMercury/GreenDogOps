-- ============================================================================
-- Green Dog Ops — 0155 Medical Boards: card templates
-- ----------------------------------------------------------------------------
-- The Clinic board is a flat grid (one row per appointment), but the AP and
-- Surgery boards are per-patient CARDS: signalment, bloodwork, IV catheter, a
-- drug/dosing table, a procedure list, prep checklists and doctor's notes.
--
-- In the spreadsheets each patient lived on its own tab and the "MASTER BOARD"
-- pulled the cards together by cell reference — which is why those workbooks are
-- riddled with #REF! errors once a tab is moved or deleted. Here every patient is
-- just a row, and the master board is a query, so nothing can break.
--
-- The card's fields vary per board type and will keep evolving, so they live in
-- a jsonb document rather than dozens of sparse columns. The shape is defined by
-- the board template in src/lib/med-ops/templates.ts.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.medical_board_row
  add column if not exists card jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- medical_board_patch_card(row, patch) : shallow-merge a patch into the card.
-- Merging server-side (rather than writing the whole document) means two people
-- editing DIFFERENT fields of the same patient can't clobber each other.
-- ---------------------------------------------------------------------------
create or replace function greendogops.medical_board_patch_card(
  p_row   uuid,
  p_patch jsonb,
  p_actor text default null
)
returns void
language sql
volatile
security definer
set search_path = greendogops, public
as $$
  update greendogops.medical_board_row
     set card = coalesce(card, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
         updated_by = coalesce(p_actor, updated_by)
   where id = p_row;
$$;

grant execute on function greendogops.medical_board_patch_card(uuid, jsonb, text)
  to authenticated, service_role;
