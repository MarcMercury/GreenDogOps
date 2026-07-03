-- ============================================================================
-- Green Dog Ops — 0063 Normalize CRM subtype (Type) values for the dropdown
-- ----------------------------------------------------------------------------
-- The record "Type" field is becoming a fixed dropdown (CRM_SUBTYPE_OPTIONS).
-- Collapse the only case-duplicate / junk values so every record maps cleanly
-- to a single option. All other stored values already match an option verbatim.
-- ============================================================================

update greendogops.crm_organization set subtype = 'other'
where subtype = 'Other';

update greendogops.crm_organization set subtype = null
where subtype in ('None', 'none', '');
