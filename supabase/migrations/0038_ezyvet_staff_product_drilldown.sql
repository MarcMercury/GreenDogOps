-- ============================================================================
-- Green Dog Ops — 0038 ezyVet Reporting: per-staff product drill-down
-- ----------------------------------------------------------------------------
-- Backs the Doctors/Staff tab drill-down: clicking a provider reveals their
-- top products and product groups (with revenue), filtered server-side by
-- staff_member via PostgREST.
-- ============================================================================
set search_path = greendogops, public;

-- Individual products/services per staff member.
create or replace view greendogops.report_staff_product as
select
  coalesce(nullif(staff_member, ''), 'Unassigned')     as staff_member,
  coalesce(nullif(product_name, ''), 'Unnamed')        as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(qty), 0)                                as qty,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> ''
group by 1, 2, 3;

-- Product groups per staff member.
create or replace view greendogops.report_staff_product_group as
select
  coalesce(nullif(staff_member, ''), 'Unassigned')     as staff_member,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> ''
group by 1, 2;

grant select on
  greendogops.report_staff_product,
  greendogops.report_staff_product_group
to authenticated, service_role;
