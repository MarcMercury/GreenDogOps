-- ============================================================================
-- Green Dog Ops — 0253 ezyVet tag catalog: AP is the General "AP" tag (#5140)
-- ----------------------------------------------------------------------------
-- The record-tags worker types each tag's label into ezyVet's Records filter,
-- which only resolves when exactly one tag matches. ezyVet has two: "AP"
-- (General, #5140 — the Advanced Procedure tag) and "ap" (MyPetClient group,
-- #6364), so "ap" stopped resolving and the AP export was refused every night
-- after the 2026-09-17 backfill.
--
-- Record the label as ezyVet spells it and pin every tracked tag to its ezyVet
-- id (listed 2026-10-15 with agent/ezyvet/list-tags.mjs); the worker now picks
-- the suggestion by id when typing alone is ambiguous. Data-only: no schema
-- change, so the baseline is unaffected.
-- ============================================================================

set search_path = greendogops, public;

begin;

update greendogops.ezyvet_tag set tag_label = 'AP', ezyvet_tag_id = '5140' where tag_key = 'ap';
update greendogops.ezyvet_tag set ezyvet_tag_id = '4944' where tag_key = 'alert'    and tag_label = 'Alert';
update greendogops.ezyvet_tag set ezyvet_tag_id = '5177' where tag_key = 'code_101' and tag_label = 'CODE *101*';
update greendogops.ezyvet_tag set ezyvet_tag_id = '6224' where tag_key = 'code_501' and tag_label = 'CODE *501*';

commit;
