-- 0010_phone_types.sql
-- Separate phone numbers into Cell / Home / Other for person records
-- (used by HR employee profiles + ATS candidate profiles).
-- The existing phone_mobile column is the "Cell" number.

alter table greendogops.person
  add column if not exists phone_home  text,
  add column if not exists phone_other text;
