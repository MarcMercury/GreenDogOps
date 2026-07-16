-- ============================================================================
-- Green Dog Ops — 0121 Student CRM SAP consolidation (program_type aware)
-- ----------------------------------------------------------------------------
-- 0120 only normalized `program_name`, but legacy student imports stored the
-- program label in `program_type` (the Student CRM "Program" column renders
-- `program_name ?? program_type`). This consolidates every SAP/SAPP variant —
-- in EITHER field, with or without a space (e.g. "SAP III/IV", "SAPIII/IV",
-- "SAPP Avail / Split for holiday") — into:
--
--     program_name        = 'SAP'
--     program_subcategory = the text after the leading SAPP/SAP token
--
-- Per the coordinator, "SAPP" was a typo for "SAP"; the remainder after the
-- SAPP/SAP prefix becomes the sub-category. Idempotent.
-- ============================================================================

-- SAP value stored in program_type (program_name null on legacy imports).
update greendogops.crm_contact
set program_subcategory = nullif(
      btrim(substring(program_type from case when program_type ilike 'SAPP%' then 5 else 4 end)),
    ''),
    program_name = 'SAP',
    program_type = null
where program_type ilike 'SAP%';

-- SAP value stored in program_name but not yet the clean 'SAP' canonical.
update greendogops.crm_contact
set program_subcategory = coalesce(
      nullif(btrim(substring(program_name from case when program_name ilike 'SAPP%' then 5 else 4 end)), ''),
      program_subcategory),
    program_name = 'SAP'
where program_name ilike 'SAP%' and program_name <> 'SAP';
