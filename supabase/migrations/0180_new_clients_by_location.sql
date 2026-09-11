-- New clients per month, attributed to the hospital they first visited.
--
-- ezyvet_contact.division only ever holds 'GDD & MPMV' or 'Green Dog - Sherman Oaks',
-- so a client record cannot be attributed to Venice or Van Nuys by division. The only
-- reliable hospital signal for a client is ezyvet_invoice_line.location_key, so this
-- view pins each contact to the location of their FIRST billed line.
--
-- "New" follows report_clients_by_month: the month ezyVet created the contact record.
-- Contacts created but never billed land in the 'no_visit_yet' bucket, so summing the
-- view over a month reconciles exactly with report_clients_by_month.

create or replace view greendogops.report_new_clients_by_location_month as
with first_visit as (
  select distinct on (client_contact_code)
    client_contact_code,
    coalesce(nullif(location_key, ''), 'other') as first_location
  from greendogops.ezyvet_invoice_line
  where client_contact_code is not null
    and client_contact_code <> ''
    and line_date is not null
  order by client_contact_code, line_date
)
select
  date_trunc('month', c.ezyvet_created_at)::date as month,
  coalesce(fv.first_location, 'no_visit_yet')    as location_key,
  case coalesce(fv.first_location, 'no_visit_yet')
    when 'sherman_oaks' then 'Sherman Oaks'
    when 'van_nuys'     then 'Van Nuys'
    when 'venice'       then 'Venice'
    when 'other'        then 'Other'
    else 'No billed visit yet'
  end                                            as location_label,
  count(*)::int                                  as new_clients,
  count(*) filter (where c.is_customer)::int     as new_customers
from greendogops.ezyvet_contact c
left join first_visit fv on fv.client_contact_code = c.contact_code
where c.ezyvet_created_at is not null
group by 1, 2, 3
order by 1, 2;

comment on view greendogops.report_new_clients_by_location_month is
  'New client records per month (ezyvet_created_at) split by the hospital of their first billed invoice line. '
  'Clients with no billed visit yet are location_key = ''no_visit_yet''. Totals per month match report_clients_by_month. '
  'Invoice lines only start 2025-01-02, so location attribution is unreliable for clients created before 2025.';

grant select on greendogops.report_new_clients_by_location_month to service_role;
