-- ============================================================================
-- Green Dog Ops — 0122 Student CRM Dentistry Rotation split
-- ----------------------------------------------------------------------------
-- Any student program starting with "Dentistry Rotation" (in either
-- `program_name` or the legacy `program_type` field) becomes:
--
--     program_name        = 'Dentistry Rotation'
--     program_subcategory = the text after "Dentistry Rotation"
--
-- e.g. "Dentistry Rotation 4th year" -> Program "Dentistry Rotation",
--       subcategory "4th year".
--
-- NOTE: "CVM 7070 Dentistry Rotation" is intentionally NOT matched — it starts
-- with "CVM" and remains its own program. Idempotent.
-- ============================================================================

-- Value stored in program_type (legacy imports).
update greendogops.crm_contact
set program_subcategory = nullif(btrim(substring(program_type from 19)), ''),
    program_name        = 'Dentistry Rotation',
    program_type        = null
where program_type ilike 'Dentistry Rotation%';

-- Value stored in program_name (not already the clean canonical).
update greendogops.crm_contact
set program_subcategory = coalesce(nullif(btrim(substring(program_name from 19)), ''), program_subcategory),
    program_name        = 'Dentistry Rotation'
where program_name ilike 'Dentistry Rotation%' and program_name <> 'Dentistry Rotation';
