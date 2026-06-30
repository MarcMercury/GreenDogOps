-- ---------------------------------------------------------------------------
-- 0040 ezyVet client recency buckets
--
-- Breaks the contact base into active vs. non-active cohorts based on how
-- recently they were last invoiced, plus a Non-Client bucket for records with
-- no spend on their account. Powers the "Client recency" chart on the
-- Reporting → Clients tab.
--
-- Bucketing rules (mutually exclusive, one row per contact):
--   * Non-Client : never invoiced — blank last-invoiced date and no account
--                  spend on file (a record that has not transacted)
--   * 6 Mo       : last invoiced within the last 6 months
--   * 12 Mo      : last invoiced 6–12 months ago
--   * 24 Mo      : last invoiced 12–24 months ago
--   * 36 Mo      : last invoiced 24–36 months ago
--   * 48 Mo+     : last invoiced over 36 months ago
-- ---------------------------------------------------------------------------

create or replace view greendogops.report_clients_by_recency as
with classified as (
  select
    revenue_spend_ytd,
    case
      when last_invoiced is null and coalesce(revenue_spend_ytd, 0) = 0 then 6
      when last_invoiced >= (current_date - interval '6 months')    then 1
      when last_invoiced >= (current_date - interval '12 months')   then 2
      when last_invoiced >= (current_date - interval '24 months')   then 3
      when last_invoiced >= (current_date - interval '36 months')   then 4
      else                                                               5
    end as sort_order
  from greendogops.ezyvet_contact
),
buckets (sort_order, bucket, label) as (
  values
    (1, 'm6',  '6 Mo'),
    (2, 'm12', '12 Mo'),
    (3, 'm24', '24 Mo'),
    (4, 'm36', '36 Mo'),
    (5, 'm48', '48 Mo+'),
    (6, 'non', 'Non-Clients')
)
select
  b.sort_order,
  b.bucket,
  b.label,
  count(c.sort_order)::int                          as contacts,
  coalesce(sum(c.revenue_spend_ytd), 0)             as revenue_ytd
from buckets b
left join classified c on c.sort_order = b.sort_order
group by b.sort_order, b.bucket, b.label
order by b.sort_order;

grant select on greendogops.report_clients_by_recency to authenticated, service_role;
