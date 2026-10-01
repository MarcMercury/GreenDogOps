-- ============================================================================
-- Green Dog Ops — 0215 Post-submission confirmation screen for capture forms
-- ----------------------------------------------------------------------------
-- WHY: at an event the prize wheel is the draw, and staff currently have no way
-- to tell a person who actually submitted the form from one who scanned, saw
-- the questions and walked to the wheel anyway. Waiting for the leads list to
-- refresh is too slow to police a queue, so the proof has to be on the
-- scanner's own phone the instant they submit.
--
-- Fix: every qr_lead / crm_retail_lead gets a short confirmation code minted at
-- insert, and a form can opt in to showing it on a full-screen "show this to
-- staff" ticket alongside its own after-submission instructions. Staff check
-- the name and the live countdown on the screen; a borrowed screenshot shows a
-- stale time and the wrong name.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Confirmation code generator
-- ---------------------------------------------------------------------------
-- Crockford-style alphabet: no I, L, O, U, 0 or 1, because staff read these
-- codes off a phone screen at arm's length in daylight.
create or replace function greendogops.new_confirmation_code()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select string_agg(
           substr('23456789ABCDEFGHJKMNPQRSTVWXYZ',
                  (floor(random() * 30) + 1)::int, 1),
           ''
         )
  from generate_series(1, 6);
$$;

-- 0211 took EXECUTE away from PUBLIC (and so anon) on every greendogops
-- routine; a function added later must not quietly hand it back.
revoke all on function greendogops.new_confirmation_code() from public;
grant execute on function greendogops.new_confirmation_code()
  to authenticated, service_role;

comment on function greendogops.new_confirmation_code() is
  'Six-character human-readable confirmation code shown on the post-submission ticket. Ambiguous glyphs (I/L/O/U/0/1) are excluded.';

-- ---------------------------------------------------------------------------
-- 2. After-submission settings on the form
-- ---------------------------------------------------------------------------
alter table greendogops.qr_form
  add column if not exists post_submit_heading text,
  add column if not exists post_submit_message text,
  add column if not exists show_confirmation boolean not null default false,
  add column if not exists confirmation_note text;

comment on column greendogops.qr_form.post_submit_heading is
  'Large heading on the success screen. Null falls back to "Thanks — you''re all set!".';
comment on column greendogops.qr_form.post_submit_message is
  'The call to action shown after submitting, e.g. "Show this screen to a team member to spin the prize wheel!". Rendered as plain text, never HTML.';
comment on column greendogops.qr_form.show_confirmation is
  'When true the success screen renders the verification ticket: confirmation code, submitter name and a live submitted-at clock.';
comment on column greendogops.qr_form.confirmation_note is
  'Small print under the ticket, e.g. "One spin per household."';

-- ---------------------------------------------------------------------------
-- 3. Per-submission confirmation codes
-- ---------------------------------------------------------------------------
alter table greendogops.qr_lead
  add column if not exists confirmation_code text not null
    default greendogops.new_confirmation_code();

alter table greendogops.crm_retail_lead
  add column if not exists confirmation_code text not null
    default greendogops.new_confirmation_code();

-- Not unique: a collision is harmless (codes are only ever checked against one
-- event's leads) and a unique index would reject an otherwise valid submission.
create index if not exists qr_lead_confirmation_idx
  on greendogops.qr_lead (confirmation_code);
create index if not exists crm_retail_lead_confirmation_idx
  on greendogops.crm_retail_lead (confirmation_code);

comment on column greendogops.qr_lead.confirmation_code is
  'Shown to the scanner on the success screen so staff can verify a submission on the spot. Search it in Event Leads to settle a dispute.';

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Defaults only apply to new rows; give historic leads a code so the Event
-- Leads column is never blank.
update greendogops.qr_lead
   set confirmation_code = greendogops.new_confirmation_code()
 where confirmation_code is null or confirmation_code = '';

update greendogops.crm_retail_lead
   set confirmation_code = greendogops.new_confirmation_code()
 where confirmation_code is null or confirmation_code = '';
