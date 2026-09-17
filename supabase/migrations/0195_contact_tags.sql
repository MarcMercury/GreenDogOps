-- ============================================================================
-- Green Dog Ops — 0195 Client tags, searchable
-- ----------------------------------------------------------------------------
-- WHY: ezyVet tags a contact record with free-text tags ("code *501*",
-- "(8,9,10) star review tree", "delinquent account - reach out to tiff do not
-- book", "*outside dvm referral", promo codes, review-tree stages) plus one
-- Financial Customer Group. The team uses them to mark real situations, but
-- until now the only tag data we stored was the denormalized "Contact Tag(s)"
-- cell on the Aged Receivables snapshot — which only covers clients who OWE
-- MONEY. Asking Smart Report "which clients are tagged X" silently answered
-- from that slice and collapsed thousands of clients to a handful.
--
-- Two changes:
--   1. ezyvet_contact.contact_tags — the tag cell for EVERY contact, filled by
--      the nightly Contacts export. Requires "Contact Tag(s)" to be added to
--      the ezyVet Report Center "Contacts" report layout; until it is, the
--      column stays null and the views below fall back to receivables.
--   2. report_contact_tag / report_contact_tag_summary — the tag cell is a
--      comma-joined list, which no ILIKE can filter safely ("code *5*" matches
--      "code *501*"). These views explode it to one row per contact per tag so
--      a tag can be matched exactly, and list the whole tag vocabulary so the
--      model can discover which tags exist before it filters on one.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.ezyvet_contact
  add column if not exists contact_tags text;

comment on column greendogops.ezyvet_contact.contact_tags is
  'ezyVet "Contact Tag(s)": the contact''s tags as one comma-joined list. Query greendogops.report_contact_tag instead of matching this text directly.';

-- ---------------------------------------------------------------------------
-- Split a tag cell into its tags.
--
-- ezyVet joins tags with commas and does not quote them, so a plain
-- string_to_array shreds any tag that contains a comma — the real tag
-- "(8,9,10) star review tree" comes back as "(8", "9" and "10) star review
-- tree", none of which anyone would ever search for. Commas inside parentheses
-- are therefore treated as part of the tag and only top-level commas split.
-- ---------------------------------------------------------------------------
create or replace function greendogops.split_tag_list(p_list text)
returns text[]
language plpgsql
immutable
parallel safe
strict
as $$
declare
  tags  text[] := '{}';
  buf   text   := '';
  ch    text;
  depth int    := 0;
  i     int;
begin
  for i in 1..length(p_list) loop
    ch := substr(p_list, i, 1);
    if ch = '(' then
      depth := depth + 1;
      buf := buf || ch;
    elsif ch = ')' then
      depth := greatest(depth - 1, 0);
      buf := buf || ch;
    elsif ch = ',' and depth = 0 then
      if btrim(buf) <> '' then tags := tags || btrim(buf); end if;
      buf := '';
    else
      buf := buf || ch;
    end if;
  end loop;
  if btrim(buf) <> '' then tags := tags || btrim(buf); end if;
  return tags;
end;
$$;

comment on function greendogops.split_tag_list(text) is
  'Split an ezyVet comma-joined tag cell into individual tags, ignoring commas inside parentheses.';

-- ---------------------------------------------------------------------------
-- One row per contact per tag.
--
-- Tag text comes from the Contacts export when we have it and falls back to the
-- latest Aged Receivables snapshot otherwise, so the view is useful today and
-- gets complete the moment the Contacts report layout carries the column.
-- tag_source says which one a row came from, because the receivables fallback
-- only ever covers clients with an outstanding balance.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_contact_tag as
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
       t.tag_list,
       t.tag_source,
       t.tag_as_of
from tagged t
cross join lateral unnest(greendogops.split_tag_list(t.tag_list)) as x(tag)
where nullif(btrim(x.tag), '') is not null;

comment on view greendogops.report_contact_tag is
  'One row per contact per ezyVet tag, with the client''s name and contact details. Filter on tag_norm (lower-cased tag). tag_source = contacts_export for full coverage, aged_receivable for the fallback slice that only covers clients who have owed money, in which case tag_as_of is the snapshot the tag was read from.';

-- ---------------------------------------------------------------------------
-- The tag vocabulary: what tags exist and how many clients carry each. Tags are
-- free text entered by staff, so the same idea is spelled several ways
-- ("Employee Referred" / "employee referred"); tag_norm folds case, and reading
-- this list first is how you find the right spelling before filtering.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_contact_tag_summary as
select tag_norm,
       min(tag)                                                     as tag,
       count(distinct ezyvet_contact_id)                            as contacts,
       count(distinct ezyvet_contact_id) filter (where is_customer) as customers,
       count(distinct ezyvet_contact_id) filter (where is_active)   as active_contacts,
       max(last_invoiced)                                           as last_visit,
       bool_or(tag_source = 'contacts_export')                      as from_contacts_export,
       max(tag_as_of)                                               as tag_as_of
from greendogops.report_contact_tag
group by tag_norm;

comment on view greendogops.report_contact_tag_summary is
  'Every ezyVet contact tag in use with how many clients carry it. Query this first to find the exact spelling of a tag, then filter report_contact_tag on tag_norm.';

grant select on
  greendogops.report_contact_tag,
  greendogops.report_contact_tag_summary
to service_role;

grant execute on function greendogops.split_tag_list(text) to service_role;
