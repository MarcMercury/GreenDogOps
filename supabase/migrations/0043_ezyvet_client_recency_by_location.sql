-- ---------------------------------------------------------------------------
-- 0043 ezyVet client recency by location
--
-- Splits the contact-base recency buckets (see 0040) across clinic locations,
-- so each cohort can be read per site. Powers the "Client recency by location"
-- grid on the Reporting → Clients tab, shown alongside the full-base recency.
--
-- Location attribution: each contact is pinned to the location of their most
-- recent invoice line (client_contact_code + line_date). Contacts with no
-- invoice line on file — including deep-recency clients whose last visit
-- predates the uploaded invoice window — fall into the "Other" column. Totals
-- therefore reconcile exactly with report_clients_by_recency (every contact is
-- counted once), but the deeper buckets concentrate in "Other" because those
-- contacts have no line-level location to attribute.
--
-- Recency buckets mirror 0040 (mutually exclusive, one row per contact):
--   * 6 Mo        : last invoiced within the last 6 months
--   * 12 Mo       : last invoiced 6–12 months ago
--   * 24 Mo       : last invoiced 12–24 months ago
--   * 36 Mo       : last invoiced 24–36 months ago
--   * 48 Mo+      : last invoiced over 36 months ago
--   * Non-Clients : never invoiced (blank last-invoiced date and no spend)
-- ---------------------------------------------------------------------------

create or replace view greendogops.report_clients_by_recency_location as
with latest_location as (
  select distinct on (client_contact_code)
    client_contact_code,
    location_key
  from greendogops.ezyvet_invoice_line
  where client_contact_code is not null and client_contact_code <> ''
    and line_date is not null
  order by client_contact_code, line_date desc
),
classified as (
  select
    coalesce(nullif(ll.location_key, ''), 'other') as location_key,
    c.revenue_spend_ytd,
    case
      when c.last_invoiced is null and coalesce(c.revenue_spend_ytd, 0) = 0 then 6
      when c.last_invoiced >= (current_date - interval '6 months')    then 1
      when c.last_invoiced >= (current_date - interval '12 months')   then 2
      when c.last_invoiced >= (current_date - interval '24 months')   then 3
      when c.last_invoiced >= (current_date - interval '36 months')   then 4
      else                                                                 5
    end as sort_order
  from greendogops.ezyvet_contact c
  left join latest_location ll on ll.client_contact_code = c.contact_code
),
buckets (sort_order, bucket, label) as (
  values
    (1, 'm6',  '6 Mo'),
    (2, 'm12', '12 Mo'),
    (3, 'm24', '24 Mo'),
    (4, 'm36', '36 Mo'),
    (5, 'm48', '48 Mo+'),
    (6, 'non', 'Non-Clients')
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
  count(c.sort_order)::int                      as contacts,
  coalesce(sum(c.revenue_spend_ytd), 0)         as revenue_ytd
from location_dim d
cross join buckets b
left join classified c
  on c.location_key = d.location_key
 and c.sort_order = b.sort_order
group by d.location_key, d.location_label, d.location_order, b.sort_order, b.bucket, b.label
order by d.location_order, b.sort_order;

grant select on greendogops.report_clients_by_recency_location to authenticated, service_role;
