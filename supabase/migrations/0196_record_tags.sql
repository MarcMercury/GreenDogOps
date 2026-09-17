-- ============================================================================
-- Green Dog Ops — 0196 ezyVet record tags (Dashboard ▸ Records membership)
-- ----------------------------------------------------------------------------
-- WHY: 0195 made the tag TEXT on a contact searchable, but the tags the team
-- actually filters on day to day — the promo codes CODE *101* and CODE *501* —
-- are PET tags, and no Report Center report exports them. The only place they
-- exist is the Records dashboard filter (Record Type = Contact, Pet Tag = ...),
-- which the agent/record-tags.mjs worker now drives nightly.
--
-- Membership is stored as a daily SNAPSHOT rather than a current flag, because
-- a client dropping off a promo code is itself the interesting event and a
-- destructive overwrite would hide it. Each run rebuilds exactly its own
-- (tag_key, snapshot_date) slice, so a re-run is idempotent and a failed tag
-- leaves yesterday's answer standing rather than emptying the tag.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.ezyvet_record_tag (
  id                uuid primary key default gen_random_uuid(),
  -- Stable slug we own ('code_101'). Renaming the ezyVet tag changes only the
  -- label, so history stays on one key.
  tag_key           text not null,
  -- The ezyVet tag exactly as it is spelled there, e.g. 'CODE *101*'.
  tag_label         text not null,
  -- Which ezyVet tag family this came from. 'pet_tag' = the Records dashboard
  -- AnimalTag filter (a tag on the PET, reported against its owner).
  tag_type          text not null default 'pet_tag',
  record_type       text not null default 'contact',
  ezyvet_contact_id text,
  contact_code      text,
  full_name         text,
  email             text,
  snapshot_date     date not null,
  created_at        timestamptz not null default now()
);

-- One row per record per tag per pull; the worker deletes and reinserts a slice.
create unique index if not exists ezyvet_record_tag_key
  on greendogops.ezyvet_record_tag (tag_key, record_type, coalesce(contact_code, ezyvet_contact_id), snapshot_date);
create index if not exists ezyvet_record_tag_snapshot_idx
  on greendogops.ezyvet_record_tag (tag_key, snapshot_date desc);
create index if not exists ezyvet_record_tag_contact_idx
  on greendogops.ezyvet_record_tag (contact_code);

comment on table greendogops.ezyvet_record_tag is
  'Daily membership snapshot of ezyVet tags that only the Dashboard > Records filter can list (the CODE *101* / CODE *501* pet tags). One row per tagged record per pull.';

revoke all on greendogops.ezyvet_record_tag from public, anon, authenticated;
grant select, insert, update, delete on greendogops.ezyvet_record_tag to service_role;

-- ---------------------------------------------------------------------------
-- Current membership: the latest snapshot PER TAG, not the latest snapshot
-- overall — tags are pulled one at a time and one failing must not blank the
-- others by making them look absent from "today".
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_record_tag_current as
select t.*
from greendogops.ezyvet_record_tag t
join (
  select tag_key, max(snapshot_date) as d
  from greendogops.ezyvet_record_tag
  group by tag_key
) m on m.tag_key = t.tag_key and m.d = t.snapshot_date;

comment on view greendogops.report_record_tag_current is
  'Who currently carries each Records-dashboard tag: the most recent pull per tag_key.';

-- ---------------------------------------------------------------------------
-- Membership trend, so "how many clients are on CODE *101*" can be asked over
-- time and a sudden collapse (usually a failed pull) is visible rather than
-- being served as a real drop.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_record_tag_trend as
select tag_key,
       min(tag_label)                    as tag_label,
       snapshot_date,
       count(distinct contact_code)      as contacts
from greendogops.ezyvet_record_tag
group by tag_key, snapshot_date;

-- ---------------------------------------------------------------------------
-- Fold the pet-tag membership into the one view Smart Report already searches
-- for tags (0195), so "clients tagged X" works the same whether X is a contact
-- tag or one of these pet tags. tag_type tells them apart.
--
-- Rebuilt rather than replaced: tag_type is a NEW column, and CREATE OR REPLACE
-- cannot change a view's column list.
-- ---------------------------------------------------------------------------
drop view if exists greendogops.report_contact_tag_summary;
drop view if exists greendogops.report_contact_tag;

create view greendogops.report_contact_tag as
with latest_ar as (
  -- The most recent snapshot that carried tags FOR EACH client, not the single
  -- latest pull: a client only appears in Aged Receivables while they owe
  -- money, so pinning one snapshot_date throws away everyone who has since
  -- paid up and shrinks the fallback to a few dozen rows.
  select distinct on (r.contact_code)
         r.contact_code, r.contact_tags, r.snapshot_date
  from greendogops.ezyvet_aged_receivable r
  where nullif(btrim(r.contact_tags), '') is not null
  order by r.contact_code, r.snapshot_date desc
),
tagged as (
  select c.ezyvet_contact_id,
         c.contact_code,
         c.full_name,
         c.business_name,
         c.email,
         c.phone,
         c.mobile,
         c.is_customer,
         c.is_active,
         c.customer_group,
         c.hear_about,
         c.last_invoiced,
         coalesce(nullif(btrim(c.contact_tags), ''), a.contact_tags) as tag_list,
         case when nullif(btrim(c.contact_tags), '') is not null
              then 'contacts_export' else 'aged_receivable' end       as tag_source,
         case when nullif(btrim(c.contact_tags), '') is not null
              then null else a.snapshot_date end                      as tag_as_of
  from greendogops.ezyvet_contact c
  left join latest_ar a on a.contact_code = c.contact_code
)
select t.ezyvet_contact_id,
       t.contact_code,
       t.full_name,
       t.business_name,
       t.email,
       t.phone,
       t.mobile,
       t.is_customer,
       t.is_active,
       t.customer_group,
       t.hear_about,
       t.last_invoiced,
       btrim(x.tag)                                as tag,
       lower(btrim(x.tag))                         as tag_norm,
       'contact_tag'::text                         as tag_type,
       t.tag_list,
       t.tag_source,
       t.tag_as_of
from tagged t
cross join lateral unnest(greendogops.split_tag_list(t.tag_list)) as x(tag)
where nullif(btrim(x.tag), '') is not null

union all

select c.ezyvet_contact_id,
       rt.contact_code,
       coalesce(c.full_name, rt.full_name),
       c.business_name,
       coalesce(c.email, rt.email),
       c.phone,
       c.mobile,
       c.is_customer,
       c.is_active,
       c.customer_group,
       c.hear_about,
       c.last_invoiced,
       rt.tag_label                                as tag,
       lower(rt.tag_label)                         as tag_norm,
       rt.tag_type,
       rt.tag_label                                as tag_list,
       'records_dashboard'::text                   as tag_source,
       rt.snapshot_date                            as tag_as_of
from greendogops.report_record_tag_current rt
left join greendogops.ezyvet_contact c on c.contact_code = rt.contact_code
where rt.record_type = 'contact';

comment on view greendogops.report_contact_tag is
  'One row per contact per ezyVet tag, with the client''s name and contact details. Filter on tag_norm. tag_type: contact_tag (from the contact record) or pet_tag (a tag on one of their pets). tag_source: contacts_export = full coverage, records_dashboard = the nightly per-tag pull (complete for that tag), aged_receivable = fallback covering only clients who have owed money.';

create view greendogops.report_contact_tag_summary as
select tag_norm,
       min(tag)                                                     as tag,
       min(tag_type)                                                as tag_type,
       count(distinct ezyvet_contact_id)                            as contacts,
       count(distinct ezyvet_contact_id) filter (where is_customer) as customers,
       count(distinct ezyvet_contact_id) filter (where is_active)   as active_contacts,
       max(last_invoiced)                                           as last_visit,
       bool_or(tag_source in ('contacts_export', 'records_dashboard')) as fully_covered,
       max(tag_as_of)                                               as tag_as_of
from greendogops.report_contact_tag
group by tag_norm;

comment on view greendogops.report_contact_tag_summary is
  'Every ezyVet tag in use with how many clients carry it. Query this first to find the exact spelling of a tag, then filter report_contact_tag on tag_norm.';

grant select on
  greendogops.report_contact_tag,
  greendogops.report_contact_tag_summary,
  greendogops.report_record_tag_current,
  greendogops.report_record_tag_trend
to service_role;

-- ---------------------------------------------------------------------------
-- Agent catalog entry so the pull shows up in Admin ▸ Agents.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'record_tags', 'Record Tags (CODE *101* / *501*)', 'global',
       'Which clients carry each ezyVet pet tag — the only source for tags, which no Report Center report exports.',
       'ezyvet_record_tag', 12
from greendogops.agent a
where a.key = 'ezyvet_extra_reports'
on conflict (agent_id, key) do nothing;
