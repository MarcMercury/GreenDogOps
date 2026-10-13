-- 0237 — Staff have no Recruiting (ATS) access by default.
--
-- Since 2026-10-13 `STAFF_MODULES` in src/lib/auth/permissions.ts no longer
-- includes `ats`, so canAccessModule(staff, 'ats') is false unless a per-user
-- override turns it on. The `ats_read` predicate from 0227 still defaulted
-- Recruiting to ON for every role, so a Staff user calling the API directly
-- could read candidates' documents and stage history that the app hides.
--
-- New predicate (mirrors canAccessModule 'ats'):
--   ats_read  module_access.ats if set, otherwise role is not staff
--
-- Only the two read policies that use ats_read change. The write policies
-- (ats_edit) already exclude Staff. Every other branch (HR roles, own record,
-- rows with no person) is copied unchanged from 0227.
do $$
declare
  hr_full  constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and u.role::text in (''owner'', ''admin'', ''executive'', ''manager''))';
  ats_read constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and case when jsonb_typeof(u.module_access -> ''ats'') = ''boolean'' '
    'then (u.module_access ->> ''ats'')::boolean else u.role::text <> ''staff'' end)';
  t      text;
  own    text;
  cand   text;
  read_q text;
begin
  t := 'person_document';
  own  := format(
    '%I.person_id = (select u.person_id from greendogops.app_user u where u.id = auth.uid() and u.is_active)', t);
  cand := format(
    'exists (select 1 from greendogops.person p where p.id = %I.person_id and p.status::text in (''prospect'', ''applicant''))', t);
  read_q := format('greendogops.is_gdo_user() and (%s or %s or (%s and %s))', hr_full, own, cand, ats_read);
  execute 'drop policy if exists hr_file_read on greendogops.person_document';
  execute format('create policy hr_file_read on greendogops.person_document for select to authenticated using (%s)', read_q);

  t := 'profile_transition_log';
  own  := format(
    '%I.person_id = (select u.person_id from greendogops.app_user u where u.id = auth.uid() and u.is_active)', t);
  cand := format(
    'exists (select 1 from greendogops.person p where p.id = %I.person_id and p.status::text in (''prospect'', ''applicant''))', t);
  read_q := format(
    'greendogops.is_gdo_user() and (%I.person_id is null or %s or %s or (%s and %s))',
    t, hr_full, own, cand, ats_read);
  execute 'drop policy if exists hr_file_read on greendogops.profile_transition_log';
  execute format('create policy hr_file_read on greendogops.profile_transition_log for select to authenticated using (%s)', read_q);
end $$;
