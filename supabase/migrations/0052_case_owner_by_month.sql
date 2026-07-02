-- ============================================================================
-- Green Dog Ops — 0052 Case owner sales by month
-- ----------------------------------------------------------------------------
-- Powers the "Case owner sales by month" panel on the Doctors/Staff tab: one
-- collapsible row per case-owning provider, showing their monthly sales.
-- Grouped strictly by ezyVet Case Owner (added in migration 0051).
-- ============================================================================
set search_path = greendogops, public;

drop materialized view if exists greendogops.report_case_owner_by_month cascade;

create materialized view greendogops.report_case_owner_by_month as
select
  extract(year from line_date)::int            as year,
  case_owner,
  date_trunc('month', line_date)::date         as month,
  count(*)::int                                as line_count,
  coalesce(sum(total_incl), 0)                 as revenue
from greendogops.ezyvet_invoice_line
where case_owner is not null and case_owner <> '' and line_date is not null
group by 1, 2, 3
with data;
create index idx_rcobm_year on greendogops.report_case_owner_by_month (year, case_owner);

grant select on greendogops.report_case_owner_by_month to authenticated, service_role;

-- Add the new matview to the reporting refresh routine.
create or replace function greendogops.refresh_ezyvet_reporting()
returns void
language plpgsql
security definer
set search_path = greendogops
as $$
begin
  refresh materialized view concurrently greendogops.ezyvet_appointment;
  refresh materialized view greendogops.report_top_product_group;
  refresh materialized view greendogops.report_top_product;
  refresh materialized view greendogops.report_product_by_location;
  refresh materialized view greendogops.report_by_staff;
  refresh materialized view greendogops.report_staff_by_location;
  refresh materialized view greendogops.report_staff_product;
  refresh materialized view greendogops.report_staff_product_group;
  refresh materialized view greendogops.report_case_owner_by_month;
end;
$$;
