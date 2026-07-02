-- ============================================================================
-- Green Dog Ops — 0051 Provider production by case owner
-- ----------------------------------------------------------------------------
-- "Provider production by location" should attribute revenue to the doctor who
-- OWNS the case (ezyVet "Case Owner"), not to the Staff Member listed on each
-- invoice line (which can be whoever rang the line up — front office, techs).
--
-- Adds ezyvet_invoice_line.case_owner and rebuilds report_staff_by_location to
-- group by case owner. Rows without a case owner (e.g. retail/front-office
-- lines) are excluded — only real provider production is counted.
--
-- NOTE: case_owner is null on invoice lines imported before this migration.
-- Re-uploading the monthly Invoice Lines exports repopulates it (the uploader
-- upserts on invoice_line_id and refreshes the roll-ups).
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.ezyvet_invoice_line
  add column if not exists case_owner text;

-- ---------------------------------------------------------------------------
-- Rebuild report_staff_by_location keyed by case owner (the provider).
-- ---------------------------------------------------------------------------
drop materialized view if exists greendogops.report_staff_by_location cascade;

create materialized view greendogops.report_staff_by_location as
select
  extract(year from line_date)::int                 as year,
  coalesce(nullif(case_owner, ''), 'Unassigned')    as staff_member,
  location_key,
  max(location_label)                               as location_label,
  count(*)::int                                     as line_count,
  coalesce(sum(total_incl), 0)                      as revenue
from greendogops.ezyvet_invoice_line
where case_owner is not null and case_owner <> '' and line_date is not null
group by 1, 2, 3
with data;
create index idx_rsbl_year on greendogops.report_staff_by_location (year, staff_member);

grant select on greendogops.report_staff_by_location to authenticated, service_role;
