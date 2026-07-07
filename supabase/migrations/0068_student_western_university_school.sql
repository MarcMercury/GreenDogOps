-- ============================================================================
-- Green Dog Ops — 0068 Set school = 'Western University' for Western emails
-- ----------------------------------------------------------------------------
-- Any Student CRM record whose email contains "western" belongs to Western
-- University (of Health Sciences). Normalize their school so the grid/filters
-- group them under a single, canonical school name.
-- ============================================================================

update greendogops.crm_contact
set school = 'Western University'
where contact_type = 'student'
  and email ilike '%western%';
