-- ============================================================================
-- Green Dog Ops — 0228 Texting (SMS via Twilio)
-- ----------------------------------------------------------------------------
--   sms_message   every text sent to or received from a candidate/employee,
--                 with Twilio's delivery status. person_id is null for a
--                 reply from a number we can't match to one person.
--   sms_opt_out   numbers that replied STOP (keyed by E.164 number, because
--                 STOP arrives from a phone, not a person). START removes it.
--   sms_consent   texting consent recorded by staff (employees, or candidates
--                 who agreed outside the application). The application's own
--                 acknowledgement lives in person_recruiting.application and is
--                 read directly, not copied here.
--
-- All three are service-role only: the app reads/writes them in server code
-- after canEditModule('ats' | 'hr') checks (src/lib/sms/send.ts).
-- ============================================================================

set search_path = greendogops, public;

begin;

create table if not exists sms_message (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references person (id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received')),
  twilio_sid text unique,
  error_code text,
  error_message text,
  sent_by uuid references app_user (id) on delete set null,
  sent_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table sms_message is 'Texts sent to / received from candidates and employees via Twilio. Service role only.';
comment on column sms_message.phone is 'The other party, E.164 (+13105551234)';
comment on column sms_message.twilio_sid is 'Twilio Message SID (SM…); unique so webhook retries are idempotent';

create index if not exists sms_message_person_idx on sms_message (person_id, created_at desc);
create index if not exists sms_message_phone_idx on sms_message (phone, created_at desc);

drop trigger if exists set_updated_at on sms_message;
create trigger set_updated_at before update on sms_message
  for each row execute function set_updated_at();

create table if not exists sms_opt_out (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  keyword text,
  opted_out_at timestamptz not null default now()
);

comment on table sms_opt_out is 'Numbers that replied STOP. Never text these until they reply START. Service role only.';

create table if not exists sms_consent (
  person_id uuid primary key references person (id) on delete cascade,
  source text not null,
  consented_at timestamptz not null default now(),
  recorded_by uuid references app_user (id) on delete set null,
  recorded_by_name text
);

comment on table sms_consent is 'Texting consent recorded by staff (how it was given in source). Service role only.';

-- The event trigger adds gdo_members_all to new tables; these are service-role
-- only, so replace it with an explicit deny-all (keeps rls_audit() clean).
do $$
declare
  t text;
begin
  foreach t in array array['sms_message', 'sms_opt_out', 'sms_consent'] loop
    execute format('alter table greendogops.%I enable row level security', t);
    execute format('drop policy if exists gdo_members_all on greendogops.%I', t);
    execute format('drop policy if exists service_role_only on greendogops.%I', t);
    execute format(
      'create policy service_role_only on greendogops.%I for all to authenticated using (false) with check (false)', t);
    execute format('revoke all on greendogops.%I from anon, authenticated', t);
  end loop;
end $$;

commit;
