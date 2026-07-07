-- ============================================================================
-- Green Dog Ops — 0071 Recruiting Position follow-up mappings
-- ----------------------------------------------------------------------------
-- Resolve the remaining ambiguous single-value positions per manual review.
-- (VET -> DVM, Venice -> CSR, Petsmart & Idexx -> Vet Tech.)
-- Remote, MPMV and the dual-role titles are intentionally left as-is.
-- ============================================================================

set search_path = greendogops, public;

update person_recruiting set target_title = 'DVM' where target_title = 'VET';
update person_recruiting set target_title = 'CSR' where target_title = 'Venice';
update person_recruiting set target_title = 'Vet Tech'
where target_title in ('Petsmart', 'Idexx labratories');
