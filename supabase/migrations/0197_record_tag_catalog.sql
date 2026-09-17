-- ============================================================================
-- Green Dog Ops — 0197 Record tags: catalog + merge semantics
-- ----------------------------------------------------------------------------
-- WHY: 0196 stored tag membership as a daily SNAPSHOT — each run replaced that
-- tag's whole population. That only works while every run re-reads every tagged
-- record, and it cannot: ezyVet tags change only on records with recent
-- activity, so the standing plan is one full backfill and then small nightly
-- runs scoped to a short activity window. Under snapshot semantics a 7-day
-- incremental run would delete the other 99% of the membership and report that
-- almost nobody carries the tag.
--
-- So membership becomes a MERGE: one durable row per (tag, record), carrying
-- first_seen_on / last_confirmed_on, and removals are recorded by setting
-- removed_on rather than by deleting the row.
--
-- Three tables:
--   ezyvet_tag            the tag catalog (what tags exist, and when each was
--                         last fully backfilled)
--   ezyvet_record_tag     membership, merged not replaced
--   ezyvet_record_tag_run one row per pull, so a run that returned nothing is
--                         distinguishable from a tag that genuinely emptied
--
-- Safe to drop 0196's table: it has never carried production data (the pull
-- that fills it has not run yet).
-- ============================================================================
set search_path = greendogops, public;

drop view if exists greendogops.report_contact_tag_summary;
drop view if exists greendogops.report_contact_tag;
drop view if exists greendogops.report_record_tag_current;
drop view if exists greendogops.report_record_tag_trend;
drop table if exists greendogops.ezyvet_record_tag;

-- ---------------------------------------------------------------------------
-- The tag catalog, enumerated from the Records dashboard filter dropdowns.
-- `backfilled_on` is what makes the incremental plan safe: a tag that has never
-- had a full run cannot be trusted as a complete population, and a tag whose
-- backfill is older than the incremental window has a hole in it.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_tag (
  id             uuid primary key default gen_random_uuid(),
  -- Stable slug we own; renaming the tag in ezyVet keeps the history attached.
  tag_key        text not null unique,
  tag_label      text not null,
  -- 'pet_tag' (a tag on a patient) or 'contact_tag' (a tag on a client record).
  tag_type       text not null default 'pet_tag',
  -- The ezyVet tag group the tag sits in, e.g. 'Promotions/Coupon', 'General'.
  tag_group      text,
  -- The numeric id ezyVet's filter resolves the label to.
  ezyvet_tag_id  text,
  is_active      boolean not null default true,
  -- Last completed FULL (unwindowed) pull. Null = never backfilled.
  backfilled_on  date,
  last_run_on    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ezyvet_tag_type_idx on greendogops.ezyvet_tag (tag_type, is_active);

comment on table greendogops.ezyvet_tag is
  'Catalog of ezyVet tags discovered from the Dashboard > Records filter. backfilled_on is the last full pull; membership for a tag with a null backfilled_on is incomplete.';

drop trigger if exists set_updated_at on greendogops.ezyvet_tag;
create trigger set_updated_at before update on greendogops.ezyvet_tag
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership. One durable row per tag per record.
--
-- record_type says what record_code identifies: 'contact' = ezyvet_contact
-- .contact_code, 'animal' = ezyvet_animal.animal_code. Pet tags are best pulled
-- as PET records (a tag change modifies the pet, not its owner, so an activity
-- window on the contact would miss it); contact_code is then the owner, filled
-- by the ingest so both grains answer "which clients".
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_record_tag (
  id                uuid primary key default gen_random_uuid(),
  tag_key           text not null references greendogops.ezyvet_tag (tag_key) on update cascade,
  record_type       text not null default 'contact' check (record_type in ('contact', 'animal')),
  record_code       text not null,
  record_name       text,
  -- Owner of the record: itself for a contact, the pet's client for an animal.
  contact_code      text,
  ezyvet_contact_id text,
  email             text,
  first_seen_on     date not null,
  -- Last pull that still returned this record for this tag.
  last_confirmed_on date not null,
  -- Set when a record that WAS in scope for a pull no longer carried the tag.
  -- Never inferred for records outside the activity window — absence there
  -- means "not looked at", not "untagged".
  removed_on        date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists ezyvet_record_tag_key
  on greendogops.ezyvet_record_tag (tag_key, record_type, record_code);
create index if not exists ezyvet_record_tag_contact_idx
  on greendogops.ezyvet_record_tag (contact_code) where removed_on is null;
create index if not exists ezyvet_record_tag_live_idx
  on greendogops.ezyvet_record_tag (tag_key) where removed_on is null;

comment on table greendogops.ezyvet_record_tag is
  'Which records carry which ezyVet tag. Merged, never replaced: removed_on marks a tag that was taken off a record we actually re-read. Current membership = removed_on is null.';

drop trigger if exists set_updated_at on greendogops.ezyvet_record_tag;
create trigger set_updated_at before update on greendogops.ezyvet_record_tag
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- One row per pull. Without this, "0 rows returned" and "the pull never ran"
-- look identical in the membership table, and a silently broken nightly run
-- would masquerade as a tag nobody uses any more.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_record_tag_run (
  id            uuid primary key default gen_random_uuid(),
  tag_key       text not null,
  mode          text not null check (mode in ('backfill', 'incremental')),
  -- Start of the activity window; null on a backfill (which reads everything).
  activity_from date,
  matched       integer not null default 0,
  added         integer not null default 0,
  confirmed     integer not null default 0,
  removed       integer not null default 0,
  ran_on        date not null default (now() at time zone 'America/Los_Angeles')::date,
  ran_at        timestamptz not null default now()
);

create index if not exists ezyvet_record_tag_run_idx
  on greendogops.ezyvet_record_tag_run (tag_key, ran_at desc);

revoke all on greendogops.ezyvet_tag, greendogops.ezyvet_record_tag,
  greendogops.ezyvet_record_tag_run from public, anon, authenticated;
grant select, insert, update, delete on
  greendogops.ezyvet_tag, greendogops.ezyvet_record_tag,
  greendogops.ezyvet_record_tag_run to service_role;

-- ---------------------------------------------------------------------------
-- Current membership, resolved to the client either way: a pet tag is reported
-- against the pet's owner so "which clients have tag X" is one query whichever
-- grain the tag was pulled at.
-- ---------------------------------------------------------------------------
create view greendogops.report_record_tag_current as
select rt.tag_key,
       t.tag_label,
       t.tag_type,
       t.tag_group,
       rt.record_type,
       rt.record_code,
       rt.record_name,
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

-- ---------------------------------------------------------------------------
-- Pull history, so a collapse in a tag's population can be read as the failed
-- run it usually is rather than as a real change.
-- ---------------------------------------------------------------------------
create view greendogops.report_record_tag_runs as
select r.tag_key,
       t.tag_label,
       r.mode,
       r.activity_from,
       r.matched,
       r.added,
       r.removed,
       r.ran_on,
       r.ran_at
from greendogops.ezyvet_record_tag_run r
left join greendogops.ezyvet_tag t on t.tag_key = r.tag_key;

-- ---------------------------------------------------------------------------
-- Rebuild the Smart Report tag views on the new membership shape (0195/0196).
-- ---------------------------------------------------------------------------
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
       t.tag_as_of
from tagged t
cross join lateral unnest(greendogops.split_tag_list(t.tag_list)) as x(tag)
where nullif(btrim(x.tag), '') is not null

union all

select c.ezyvet_contact_id,
       rt.contact_code,
       coalesce(c.full_name, rt.record_name),
       c.business_name,
       c.email, c.phone, c.mobile, c.is_customer, c.is_active,
       c.customer_group, c.hear_about, c.last_invoiced,
       rt.tag_label                                as tag,
       lower(rt.tag_label)                         as tag_norm,
       rt.tag_type,
       rt.tag_group,
       'records_dashboard'::text                   as tag_source,
       rt.last_confirmed_on                        as tag_as_of
from greendogops.report_record_tag_current rt
left join greendogops.ezyvet_contact c on c.contact_code = rt.contact_code;

comment on view greendogops.report_contact_tag is
  'One row per contact per ezyVet tag, with the client''s name and contact details. Filter on tag_norm. tag_type: contact_tag (on the client record) or pet_tag (on one of their pets, reported against the owner). tag_source: contacts_export = full coverage, records_dashboard = the per-tag pull, aged_receivable = fallback covering only clients who have owed money.';

create view greendogops.report_contact_tag_summary as
select tag_norm,
       min(tag)                                                       as tag,
       min(tag_type)                                                  as tag_type,
       min(tag_group)                                                 as tag_group,
       count(distinct ezyvet_contact_id)                              as contacts,
       count(distinct ezyvet_contact_id) filter (where is_customer)   as customers,
       count(distinct ezyvet_contact_id) filter (where is_active)     as active_contacts,
       max(last_invoiced)                                             as last_visit,
       bool_or(tag_source in ('contacts_export', 'records_dashboard')) as fully_covered,
       max(tag_as_of)                                                 as tag_as_of
from greendogops.report_contact_tag
group by tag_norm;

comment on view greendogops.report_contact_tag_summary is
  'Every ezyVet tag in use with how many clients carry it. Query this first to find the exact spelling of a tag, then filter report_contact_tag on tag_norm.';

grant select on
  greendogops.report_contact_tag,
  greendogops.report_contact_tag_summary,
  greendogops.report_record_tag_current,
  greendogops.report_record_tag_runs
to service_role;
