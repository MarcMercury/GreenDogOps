-- ---------------------------------------------------------------------------
-- 0044 ezyVet client recency by location — multi-year dynamic buckets
--
-- Supersedes the window-edge bucketing introduced in 0043. The invoice-line
-- history now reaches back far enough (multiple years) that visit recency can
-- be graduated the same way as the full client base (see 0040), instead of
-- collapsing everything older than the upload window into a single "6 Mo+"
-- bucket.
--
-- Each client is bucketed by their OWN most recent invoiced visit and pinned
-- to that visit's clinic, so recency and location stay consistent. The bucket
-- boundaries are all relative to current_date, so the view is self-extending:
-- as older months are imported, the deeper cohorts (24 / 36 / 48 Mo+) fill in
-- automatically with no code change. The UI drops any bucket that is still
-- empty across every clinic.
--
-- Recency buckets (relative to current_date, mutually exclusive):
--   * 6 Mo   : last seen within the last 6 months
--   * 12 Mo  : last seen 6–12 months ago
--   * 24 Mo  : last seen 12–24 months ago
--   * 36 Mo  : last seen 24–36 months ago
--   * 48 Mo+ : last seen over 36 months ago
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
      when cl.line_date >= current_date - interval '6 months'  then 1
      when cl.line_date >= current_date - interval '12 months' then 2
      when cl.line_date >= current_date - interval '24 months' then 3
      when cl.line_date >= current_date - interval '36 months' then 4
      else                                                          5
    end as sort_order
  from client_last cl
  left join greendogops.ezyvet_contact c
    on c.contact_code = cl.client_contact_code
),
buckets (sort_order, bucket, label) as (
  values
    (1, 'm6',  '6 Mo'),
    (2, 'm12', '12 Mo'),
    (3, 'm24', '24 Mo'),
    (4, 'm36', '36 Mo'),
    (5, 'm48', '48 Mo+')
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
