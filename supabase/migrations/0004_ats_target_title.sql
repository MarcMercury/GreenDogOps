-- 0004_ats_target_title.sql
-- Capture the position a candidate applied for in the ATS pipeline.
set search_path = greendogops, public;

alter table greendogops.person_recruiting
  add column if not exists target_title text;
