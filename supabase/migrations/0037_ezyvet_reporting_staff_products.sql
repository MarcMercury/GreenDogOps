-- ============================================================================
-- Green Dog Ops — 0037 ezyVet Reporting: staff/doctor + product breakdowns
-- ----------------------------------------------------------------------------
-- Adds the read models powering the tabbed Reporting page:
--   * Doctors/Staff — production (revenue, lines, consults, appointments) per
--     staff member, with a vet flag and a per-location split.
--   * Products/Services — top individual products and a product-group split by
--     clinic location.
-- All are plain views over greendogops.ezyvet_invoice_line, consistent with
-- the roll-ups created in 0036.
-- ============================================================================
set search_path = greendogops, public;

-- Production per staff member. An appointment here is the same client on the
-- same service day (location-independent for a given provider's day).
create or replace view greendogops.report_by_staff as
select
  coalesce(nullif(staff_member, ''), 'Unassigned')                       as staff_member,
  bool_or(coalesce(salesperson_is_vet, false))                           as is_vet,
  count(*)::int                                                          as line_count,
  count(distinct nullif(consult_id, ''))::int                            as consults,
  count(distinct (client_contact_code || '|' || line_date::text))::int   as appointments,
  coalesce(sum(total_incl), 0)                                           as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> ''
group by 1
order by revenue desc;

-- Staff production split by clinic location.
create or replace view greendogops.report_staff_by_location as
select
  coalesce(nullif(staff_member, ''), 'Unassigned')  as staff_member,
  location_key,
  max(location_label)                               as location_label,
  count(*)::int                                     as line_count,
  coalesce(sum(total_incl), 0)                      as revenue
from greendogops.ezyvet_invoice_line
where staff_member is not null and staff_member <> ''
group by 1, 2;

-- Top individual products / services by revenue.
create or replace view greendogops.report_top_product as
select
  coalesce(nullif(product_name, ''), 'Unnamed')        as product_name,
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  count(*)::int                                        as line_count,
  coalesce(sum(qty), 0)                                as qty,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
group by 1, 2
order by revenue desc;

-- Product groups split by clinic location.
create or replace view greendogops.report_product_by_location as
select
  coalesce(nullif(product_group, ''), 'Uncategorized') as product_group,
  location_key,
  max(location_label)                                  as location_label,
  count(*)::int                                        as line_count,
  coalesce(sum(total_incl), 0)                         as revenue
from greendogops.ezyvet_invoice_line
group by 1, 2;

grant select on
  greendogops.report_by_staff,
  greendogops.report_staff_by_location,
  greendogops.report_top_product,
  greendogops.report_product_by_location
to authenticated, service_role;
