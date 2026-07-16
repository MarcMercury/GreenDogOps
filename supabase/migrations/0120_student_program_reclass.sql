-- ============================================================================
-- Green Dog Ops — 0120 Student CRM program reclassification
-- ----------------------------------------------------------------------------
-- Normalize free-text `crm_contact.program_name` values into a managed
-- "Program name" plus a `program_subcategory` remainder:
--
--   * "SAP*"            -> Program "SAP",            subcategory = text after "SAP"
--   * "Externship*"     -> Program "Externship",     subcategory = text after "Externship"
--   * "Western Extern*" -> Program "Western Extern", subcategory = text after "Western Extern"
--
-- Idempotent: re-running is a no-op once values are already normalized.
-- ============================================================================

-- Ensure the target program names exist in the dropdown reference list.
insert into greendogops.crm_program_name (name, sort_order) values
  ('SAP', 15),
  ('Western Extern', 115)
on conflict (name) do nothing;

-- SAP*  ->  Program = 'SAP', subcategory = remainder after 'SAP'
update greendogops.crm_contact
set program_subcategory = nullif(btrim(substring(program_name from 4)), ''),
    program_name        = 'SAP'
where program_name ilike 'SAP%';

-- Externship*  ->  Program = 'Externship', subcategory = remainder
update greendogops.crm_contact
set program_subcategory = nullif(btrim(substring(program_name from 11)), ''),
    program_name        = 'Externship'
where program_name ilike 'Externship%';

-- Western Extern*  ->  Program = 'Western Extern', subcategory = remainder
update greendogops.crm_contact
set program_subcategory = nullif(btrim(substring(program_name from 15)), ''),
    program_name        = 'Western Extern'
where program_name ilike 'Western Extern%';
