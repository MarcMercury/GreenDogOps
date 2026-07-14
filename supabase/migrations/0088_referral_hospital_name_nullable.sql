-- =====================================================
-- Migration 0088: Relax legacy referral_partners.hospital_name NOT NULL
-- =====================================================
-- greendogops.referral_partners was created in 0008 via
--   (like public.referral_partners including constraints ...)
-- which copied a NOT NULL constraint on the legacy `hospital_name` column.
-- The app treats `name` as the canonical partner name and only uses
-- `hospital_name` as a display fallback, so inserts that populate `name`
-- (e.g. the "+ Add to CRM" quick-add on the Upload tab, and the partner
-- dialog) failed with:
--   null value in column "hospital_name" ... violates not-null constraint
--
-- Backfill any existing null/blank hospital_name from name, then drop the
-- NOT NULL constraint so `name` is the single source of truth.
-- =====================================================

update greendogops.referral_partners
   set hospital_name = name
 where hospital_name is null or btrim(hospital_name) = '';

alter table greendogops.referral_partners
  alter column hospital_name drop not null;
