-- ============================================================================
-- Green Dog Ops — 0090 Agents: add ezyVet CRM (Contacts) daily report
-- ----------------------------------------------------------------------------
-- The ezyVet daily ingest also refreshes the ezyVet CRM (the full Contacts
-- list). It's a global export (all clinics) that upserts into ezyvet_contact
-- and logs new/updated/unchanged for client-growth trend reporting.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'ezyvet_crm_contacts', 'ezyVet CRM (Contacts)', 'global',
       'Full contact/customer list. Daily refresh of customer info; upserts into ezyvet_contact and logs client growth/churn.',
       'ezyvet_contact', 15
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
