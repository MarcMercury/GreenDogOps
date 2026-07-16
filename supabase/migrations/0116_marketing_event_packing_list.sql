-- ---------------------------------------------------------------------------
-- Green Dog Ops — 0115 Event Packing / Material list
-- ---------------------------------------------------------------------------
-- Every marketing event gets an editable Packing / Material list that defaults
-- to the GD Event Master Packing List (see public/GD Event Master Packing
-- List.pdf). The list is grouped (Tents & Structure, Print Material, First Aid
-- Items, …) and each line tracks a status through the procurement → pack
-- pipeline: need → decided → ordered → received → packed.
--
-- Stored as jsonb so the whole grouped structure lives on the event row and is
-- edited/printed/copied/emailed as one document:
--
--   [
--     { "group": "Tents & Structure",
--       "items": [
--         { "label": "Tents", "qty": "x1", "status": "need",
--           "note": "Check 2nd tent cover" }
--       ] }
--   ]
--
-- The app layer (src/lib/marketing/types.ts → MASTER_PACKING_LIST) seeds new
-- events with the default template; existing rows default to an empty list and
-- get the template applied the first time the event is opened.
-- ---------------------------------------------------------------------------

alter table greendogops.marketing_event
  add column if not exists packing_list jsonb not null default '[]'::jsonb;

comment on column greendogops.marketing_event.packing_list is
  'Editable, grouped Packing / Material list. Each item: {label, qty, status, note}; status ∈ need|decided|ordered|received|packed. Defaults to the GD master template in the app layer.';
