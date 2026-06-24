-- 0034 — Expand the planning-guide staffing key beyond DVM count.
--
-- A guide already carries `dvm_count` (migration 0033). The Daily Capacity view
-- now reads the full staffing signature of a scheduled day — DVMs plus the
-- location-wide support roles — and matches the guide whose staffing key best
-- fits. Each new column is the target headcount for that category; NULL means
-- "wildcard" (the category is not part of this guide's key), preserving the
-- existing DVM-only matching for guides that don't set them.

alter table greendogops.planning_guide
  add column if not exists tech_count   smallint,
  add column if not exists lead_count   smallint,
  add column if not exists dental_count smallint,
  add column if not exists da_count     smallint,
  add column if not exists float_count  smallint;

comment on column greendogops.planning_guide.tech_count is
  'Target number of Techs for this guide''s staffing key; NULL = wildcard.';
comment on column greendogops.planning_guide.lead_count is
  'Target number of Leads for this guide''s staffing key; NULL = wildcard.';
comment on column greendogops.planning_guide.dental_count is
  'Target number of Dentals for this guide''s staffing key; NULL = wildcard.';
comment on column greendogops.planning_guide.da_count is
  'Target number of DAs for this guide''s staffing key; NULL = wildcard.';
comment on column greendogops.planning_guide.float_count is
  'Target number of Floats for this guide''s staffing key; NULL = wildcard.';
