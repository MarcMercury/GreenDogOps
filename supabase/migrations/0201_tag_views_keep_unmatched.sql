-- ============================================================================
-- Green Dog Ops — 0201 tag views must not lose unmatched clients
-- ----------------------------------------------------------------------------
-- The tag exports contain clients that ezyvet_contact does not: 401 of the
-- 5,798 accounts tagged 'ap' have no row in our contacts mirror at all (not by
-- code, not by email). The nightly Contacts pull is missing them.
--
-- Two bugs that made those clients disappear rather than show up as a gap:
--   1. report_contact_tag took email/phone/mobile only from the joined contact,
--      so the name and email the export DID carry were thrown away.
--   2. report_contact_tag_summary counted distinct ezyvet_contact_id, which is
--      null for an unmatched client — so they were silently dropped from the
--      count. "How many clients are tagged ap" answered 5,398 instead of 5,798,
--      and nothing in the answer hinted that 400 were missing.
--
-- Counting now keys on contact_code (always present) and the summary reports
-- unmatched_contacts, so the gap is visible instead of quietly wrong.
-- ============================================================================
set search_path = greendogops, public;

drop view if exists greendogops.report_contact_tag_summary;
drop view if exists greendogops.report_contact_tag;
drop view if exists greendogops.report_record_tag_current;

-- Carries record_name/email through, which is all we have for a tagged client
-- that ezyvet_contact does not know about.
create view greendogops.report_record_tag_current as
select rt.tag_key,
       t.tag_label,
       t.tag_type,
       t.tag_group,
       rt.record_type,
       rt.record_code,
       rt.record_name,
       rt.email,
       coalesce(rt.contact_code, a.owner_contact_code) as contact_code,
       rt.first_seen_on,
       rt.last_confirmed_on,
       t.backfilled_on
from greendogops.ezyvet_record_tag rt
join greendogops.ezyvet_tag t on t.tag_key = rt.tag_key
left join greendogops.ezyvet_animal a
       on rt.record_type = 'animal' and a.animal_code = rt.record_code
where rt.removed_on is null;

comment on view greendogops.report_record_tag_current is
  'Who currently carries each ezyVet tag, pet tags resolved to the pet''s owner.';

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
  select c.ezyvet_contact_id, c.contact_code, c.full_name, c.business_name,
         c.email, c.phone, c.mobile, c.is_customer, c.is_active,
         c.customer_group, c.hear_about, c.last_invoiced,
         coalesce(nullif(btrim(c.contact_tags), ''), a.contact_tags) as tag_list,
         case when nullif(btrim(c.contact_tags), '') is not null
              then 'contacts_export' else 'aged_receivable' end       as tag_source,
         case when nullif(btrim(c.contact_tags), '') is not null
              then null else a.snapshot_date end                      as tag_as_of
  from greendogops.ezyvet_contact c
  left join latest_ar a on a.contact_code = c.contact_code
)
select t.ezyvet_contact_id, t.contact_code, t.full_name, t.business_name,
       t.email, t.phone, t.mobile, t.is_customer, t.is_active,
       t.customer_group, t.hear_about, t.last_invoiced,
       btrim(x.tag)                                as tag,
       lower(btrim(x.tag))                         as tag_norm,
       'contact_tag'::text                         as tag_type,
       null::text                                  as tag_group,
       t.tag_source,
       t.tag_as_of,
       true                                        as in_contact_mirror
from tagged t
cross join lateral unnest(greendogops.split_tag_list(t.tag_list)) as x(tag)
where nullif(btrim(x.tag), '') is not null

union all

select c.ezyvet_contact_id,
       rt.contact_code,
       -- Fall back to what the tag export carried, so a client missing from the
       -- contacts mirror is still a usable row rather than a bare code.
       coalesce(c.full_name, rt.record_name)       as full_name,
       c.business_name,
       coalesce(c.email, rt.email)                 as email,
       c.phone, c.mobile, c.is_customer, c.is_active,
       c.customer_group, c.hear_about, c.last_invoiced,
       rt.tag_label                                as tag,
       lower(rt.tag_label)                         as tag_norm,
       rt.tag_type,
       rt.tag_group,
       'records_dashboard'::text                   as tag_source,
       rt.last_confirmed_on                        as tag_as_of,
       (c.contact_code is not null)                as in_contact_mirror
from greendogops.report_record_tag_current rt
left join greendogops.ezyvet_contact c on c.contact_code = rt.contact_code;

comment on view greendogops.report_contact_tag is
  'One row per contact per ezyVet tag, with the client''s name and contact details. Filter on tag_norm. tag_type: contact_tag (on the client record) or pet_tag (on one of their pets, reported against the owner). in_contact_mirror = false means the tag export knows this client but ezyvet_contact does not, so only name/email are available for them.';

create view greendogops.report_contact_tag_summary as
select tag_norm,
       min(tag)                                                     as tag,
       min(tag_type)                                                as tag_type,
       min(tag_group)                                               as tag_group,
       -- contact_code is always present; ezyvet_contact_id is not, and counting
       -- on it silently drops every client missing from the contacts mirror.
       count(distinct contact_code)                                 as contacts,
       count(distinct contact_code) filter (where is_customer)      as customers,
       count(distinct contact_code) filter (where is_active)        as active_contacts,
       count(distinct contact_code) filter (where not in_contact_mirror)
                                                                    as unmatched_contacts,
       max(last_invoiced)                                           as last_visit,
       bool_or(tag_source in ('contacts_export', 'records_dashboard')) as fully_covered,
       max(tag_as_of)                                               as tag_as_of
from greendogops.report_contact_tag
group by tag_norm;

comment on view greendogops.report_contact_tag_summary is
  'Every ezyVet tag in use with how many clients carry it. Query this first to find the exact spelling of a tag, then filter report_contact_tag on tag_norm. unmatched_contacts are tagged clients absent from ezyvet_contact, so is_customer/is_active/last_visit are unknown for them.';

grant select on
  greendogops.report_contact_tag,
  greendogops.report_contact_tag_summary,
  greendogops.report_record_tag_current
to service_role;
