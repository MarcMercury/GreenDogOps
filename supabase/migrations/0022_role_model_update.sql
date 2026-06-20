-- 0022_role_model_update.sql
-- Refresh the app_role model for Green Dog Ops:
--   * add 'schedule_admin' (same as staff, but can edit the Schedule module)
--   * retire 'viewer' (migrate any remaining viewer users to 'staff')
-- Postgres cannot drop an enum value in-place, so 'viewer' stays defined at the
-- type level but is no longer used by the application or assigned to any user.
set search_path = greendogops, public;

-- Add the new role. ADD VALUE is idempotent via IF NOT EXISTS (PG12+).
alter type greendogops.app_role add value if not exists 'schedule_admin';

-- Retire the viewer role: anyone still on it becomes read-only staff.
update greendogops.app_user
set role = 'staff'
where role = 'viewer';
