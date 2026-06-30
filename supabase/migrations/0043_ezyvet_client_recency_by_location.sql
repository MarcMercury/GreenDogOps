-- ---------------------------------------------------------------------------
-- 0043 ezyVet client recency by location
--
-- Splits the active client base into recency cohorts per clinic, so each site
-- can be read on its own. Powers the "Client recency by location" grid on the
-- Reporting → Clients tab, shown alongside the full-base recency (see 0040).
--
-- Why visit-level rather than contact last_invoiced: clinic location lives only
-- on invoice lines, which cover the uploaded export window (the trailing months
-- of activity). A contact's deep last-invoiced date has no line-level location,
-- so attributing the full multi-year recency by site would collapse every
-- cohort past the window into "Other". Bucketing each client by their OWN most
-- recent invoiced visit — and pinning them to that visit's location — keeps
-- recency and location consistent and fully populated across clinics.
--
-- This view therefore covers clients seen within the upload window only; the
-- companion report_clients_by_recency (0040) remains the full multi-year base.
--
-- Recency buckets (relative to current_date, mutually exclusive):
--   * ≤1 Mo  : last seen within the last month
--   * 1–3 Mo : last seen 1–3 months ago
--   * 3–6 Mo : last seen 3–6 months ago
--   * 6 Mo+  : last seen over 6 months ago (window edge)
-- ---------------------------------------------------------------------------

create or replace view greendogops.report_clients_by_recency_location as
with client_last as (
  select distinct on (client_contact_code)
    client_contact_code,
    coalesce(nullif(location_key, ''), 'other') as location_key,
    line_date
  from greendogops.ezyvet_invoice_line
  where client_contact_code is not null and client_contact_code <> ''
    and line_date is not null
  order by client_contact_code, line_date desc
),
classified as (
  select
    cl.client_contact_code,
    cl.location_key,
    coalesce(c.revenue_spend_ytd, 0) as revenue_ytd,
    case
      when cl.line_date >= current_date - interval '1 month'  then 1
      when cl.line_date >= current_date - interval '3 months' then 2
      when cl.line_date >= current_date - interval '6 months' then 3
      else                                                         4
    end as sort_order
  from client_last cl
  left join greendogops.ezyvet_contact c
    on c.contact_code = cl.client_contact_code
),
buckets (sort_order, bucket, label) as (
  values
    (1, 'm1',  '≤1 Mo'),
    (2, 'm3',  '1–3 Mo'),
    (3, 'm6',  '3–6 Mo'),
    (4, 'm6p', '6 Mo+')
),
location_dim (location_key, location_label, location_order) as (
  values
    ('sherman_oaks', 'Sherman Oaks', 1),
    ('van_nuys',     'Van Nuys',     2),
    ('venice',       'Venice',       3),
    ('other',        'Other',        4)
)
select
  d.location_key,
  d.location_label,
  d.location_order,
  b.sort_order,
  b.bucket,
  b.label,
  count(c.client_contact_code)::int             as contacts,
  coalesce(sum(c.revenue_ytd), 0)               as revenue_ytd
from location_dim d
cross join buckets b
left join classified c
  on c.location_key = d.location_key
 and c.sort_order = b.sort_order
group by d.location_key, d.location_label, d.location_order, b.sort_order, b.bucket, b.label
order by d.location_order, b.sort_order;

grant select on greendogops.report_clients_by_recency_location to authenticated, service_role;
