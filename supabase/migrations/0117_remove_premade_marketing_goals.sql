-- ============================================================================
-- Remove the pre-made marketing goals that were seeded in 0102. Goals are now
-- managed by the team in-app (under the "Goals & Initiatives" tab), so the
-- placeholder KPIs are no longer wanted.
-- ============================================================================

delete from greendogops.marketing_goal
where title in (
  'New clients from marketing',
  'Events attended',
  'Partnerships created',
  'Leads generated',
  'Marketing budget spend'
);
