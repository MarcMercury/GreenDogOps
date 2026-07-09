-- 0080_crm_confirmed_leads_clients.sql
-- Add confirmed leads / clients tracking to CRM organizations (partner/vendor CRM).

set search_path = greendogops, public;

alter table greendogops.crm_organization
  add column if not exists confirmed_leads integer,
  add column if not exists confirmed_clients integer;
