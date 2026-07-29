-- 0147_marketing_admin_role.sql
-- Add the 'marketing_admin' role to the app_role enum.
-- Marketing Admins see the same pages as Schedule Admins and can edit them all
-- except the Operations section (Calendar, Scheduling, Planning), which is
-- view-only. They cannot reach the Admin panel and cannot view all compensation.
-- Postgres cannot drop or reorder enum values in-place, so 'marketing_admin' is
-- simply appended; ADD VALUE is idempotent via IF NOT EXISTS (PG12+).
set search_path = greendogops, public;

alter type greendogops.app_role add value if not exists 'marketing_admin';
