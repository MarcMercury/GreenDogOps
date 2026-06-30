-- 0045_executive_role.sql
-- Add the 'executive' role to the app_role enum.
-- Executives can view and edit every module except the Admin panel (they do
-- get the otherwise admin-only Reporting / Emp Reporting pages). Like managers,
-- they can view all compensation, but they cannot manage users or settings.
-- Postgres cannot drop or reorder enum values in-place, so 'executive' is simply
-- appended; ADD VALUE is idempotent via IF NOT EXISTS (PG12+).
set search_path = greendogops, public;

alter type greendogops.app_role add value if not exists 'executive';
