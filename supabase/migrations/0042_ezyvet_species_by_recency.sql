-- ---------------------------------------------------------------------------
-- 0042 ezyVet species by recency
--
-- Cross-tabs each patient's species against how recently it was last seen,
-- using the patient's own most-recent invoice line (animal_code + line_date).
-- Powers the "Species by recency" grid on the Reporting → Clients tab.
--
-- Why patient-level rather than contact last_invoiced: species lives only on
-- invoice lines, which cover the uploaded export window (the trailing months
-- of activity). Contacts whose last visit predates that window have no lines
-- and therefore no species, so a contact-recency cross-tab would collapse to
-- "Unknown" outside the window. Bucketing by each patient's own last visit
-- keeps species and recency consistent and fully populated.
--
-- Recency buckets (relative to current_date, mutually exclusive):
--   * ≤1 Mo  : last seen within the last month
--   * 1–3 Mo : last seen 1–3 months ago
--   * 3–6 Mo : last seen 3–6 months ago
--   * 6 Mo+  : last seen over 6 months ago (window edge)
-- ---------------------------------------------------------------------------

create or replace view greendogops.report_species_by_recency as
with patient_last as (
  select distinct on (animal_code)
    animal_code,
    coalesce(nullif(species_group, ''), 'Unknown')      as species_group,
    nullif(client_contact_code, '')                     as client_contact_code,
    line_date
  from greendogops.ezyvet_invoice_line
  where animal_code is not null and animal_code <> ''
    and line_date is not null
  order by animal_code, line_date desc
),
classified as (
  select
    species_group,
    client_contact_code,
    animal_code,
    case
      when line_date >= current_date - interval '1 month'  then 1
      when line_date >= current_date - interval '3 months' then 2
      when line_date >= current_date - interval '6 months' then 3
      else                                                      4
    end as sort_order
  from patient_last
),
buckets (sort_order, bucket, label) as (
  values
    (1, 'm1',  '≤1 Mo'),
    (2, 'm3',  '1–3 Mo'),
    (3, 'm6',  '3–6 Mo'),
    (4, 'm6p', '6 Mo+')
),
species_dim (species_group) as (
  values ('Dog'), ('Cat'), ('Exotic'), ('Unknown')
)
select
  s.species_group,
  b.sort_order,
  b.bucket,
  b.label,
  count(c.animal_code)::int                      as patients,
  count(distinct c.client_contact_code)::int     as clients
from species_dim s
cross join buckets b
left join classified c
  on c.species_group = s.species_group
 and c.sort_order = b.sort_order
group by s.species_group, b.sort_order, b.bucket, b.label
order by s.species_group, b.sort_order;

grant select on greendogops.report_species_by_recency to authenticated, service_role;
