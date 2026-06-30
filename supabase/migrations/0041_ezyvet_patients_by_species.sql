-- ---------------------------------------------------------------------------
-- 0041 ezyVet patients by species
--
-- Distinct patients (and the clients behind them) seen per species group,
-- derived from the uploaded invoice-line window. Powers the "Patients by
-- species" chart on the Reporting → Clients tab (replacing the customer-group
-- breakdown).
--
-- Note: species lives only on invoice lines, which cover the uploaded export
-- window (currently the trailing months of activity). The deep last-invoiced
-- recency on ezyvet_contact has no species attribution, so this view reflects
-- recent visit activity rather than multi-year recency buckets.
-- ---------------------------------------------------------------------------

create or replace view greendogops.report_patients_by_species as
select
  coalesce(nullif(species_group, ''), 'Unknown')        as species_group,
  count(distinct animal_code)::int                       as patients,
  count(distinct nullif(client_contact_code, ''))::int   as clients,
  max(line_date)                                         as last_visit
from greendogops.ezyvet_invoice_line
where animal_code is not null and animal_code <> ''
group by 1
order by patients desc;

grant select on greendogops.report_patients_by_species to authenticated, service_role;
