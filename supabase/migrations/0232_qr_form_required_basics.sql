-- ============================================================================
-- Green Dog Ops — 0232 Required toggles for a capture form's basic info
-- ----------------------------------------------------------------------------
-- WHY: custom questions on a QR capture form could already be marked Required,
-- but the built-in contact block could not. Only the name was enforced, plus
-- "email OR phone", so event visitors were submitting half-empty leads.
--
-- Each basic field now carries its own Required flag. Email and phone default
-- to required — on every existing form too, which is the point of the change.
-- Pet name and ZIP stay optional unless an editor turns them on (and are only
-- enforced while the form actually asks for them via collect_pet_name /
-- collect_zip). Name remains always required.
--
-- Additive only: no rows are deleted and no existing column changes.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.qr_form
  add column if not exists require_email    boolean not null default true,
  add column if not exists require_phone    boolean not null default true,
  add column if not exists require_pet_name boolean not null default false,
  add column if not exists require_zip      boolean not null default false;

comment on column greendogops.qr_form.require_email is
  'Public capture form must include an email address. Enforced in the browser and again in the submit action.';
comment on column greendogops.qr_form.require_phone is
  'Public capture form must include a phone number. Enforced in the browser and again in the submit action.';
comment on column greendogops.qr_form.require_pet_name is
  'Pet name is required — only while collect_pet_name is on.';
comment on column greendogops.qr_form.require_zip is
  'ZIP code is required — only while collect_zip is on.';
