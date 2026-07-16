-- ============================================================================
-- Green Dog Ops — 0110 Marketing resource credentials on the record
-- ----------------------------------------------------------------------------
-- The marketing Resources directory previously kept passwords OUT of the record
-- and only stored a `credential_note` pointing at the separate credentials
-- vault. Per the team, marketing resource logins are shared working tools and
-- are meant to live directly on the record — not hidden away. This adds the
-- username/password columns so the login can be stored and shown inline.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.marketing_resource
  add column if not exists username text,
  add column if not exists password text;
