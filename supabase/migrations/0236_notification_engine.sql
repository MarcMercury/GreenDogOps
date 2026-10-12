-- ============================================================================
-- Green Dog Ops — 0236 Notification engine (Slack integration, phase 2)
-- ----------------------------------------------------------------------------
--   notification_event   one operational event published by a module
--                        (schedule.published, pto.requested, …). Recorded
--                        first, then fanned out to recipients by
--                        src/lib/notify/engine.ts. Idempotent on dedupe_key.
--   notification_rule    admin overrides of the code defaults in
--                        src/lib/notify/registry.ts — one row per event type.
--                        No row = the default applies.
--   notification_action  every Slack button click (Approve / Deny /
--                        Acknowledge / Complete): who, what, outcome.
--                        request_key makes a repeated click a no-op.
--
-- notification_delivery is generalised:
--   * it is addressed to a PERSON (recipient_person_id), so employees without
--     an Ops login can be DMed; notification_id (the in-app copy) is optional;
--   * channel 'slack_channel' posts to a Slack channel (slack_channel_id);
--   * it carries its own rendered content (title/body/href/blocks), the
--     permission it needs at send time (required_module), batching
--     (batch_until / coalesce_key) and a message_key so a sent card can be
--     updated in place (e.g. a PTO request once it is approved).
--
-- All tables stay service-role only.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- notification_event
-- ---------------------------------------------------------------------------
create table if not exists notification_event (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module text check (module is null or module ~ '^[a-z_]+$'),
  subject_type text check (subject_type is null or subject_type ~ '^[a-z_]+$'),
  subject_id text check (subject_id is null or length(subject_id) <= 100),
  subject_person_ids uuid[] not null default '{}',
  location_id uuid references location (id) on delete set null,
  actor_user_id uuid references app_user (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text check (dedupe_key is null or length(dedupe_key) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  error text,
  processed_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table notification_event is
  'Operational events published by Ops modules; fanned out to recipients by src/lib/notify/engine.ts. payload holds render data only — never compensation or HR-file content. Service role only.';
comment on column notification_event.subject_person_ids is
  'People the event is about (e.g. the employee whose shift changed). They may always see their own notification.';

create unique index if not exists notification_event_dedupe_uq
  on notification_event (dedupe_key) where dedupe_key is not null;
create index if not exists notification_event_queue_idx
  on notification_event (created_at) where status in ('pending', 'processing');
create index if not exists notification_event_subject_idx
  on notification_event (subject_type, subject_id);
create index if not exists notification_event_type_idx
  on notification_event (event_type, created_at desc);

drop trigger if exists set_updated_at on notification_event;
create trigger set_updated_at before update on notification_event
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_rule
-- ---------------------------------------------------------------------------
create table if not exists notification_rule (
  event_type text primary key check (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  enabled boolean not null default true,
  audience jsonb not null default '{}'::jsonb,
  deliver_dm boolean not null default true,
  deliver_inbox boolean not null default true,
  slack_channel_id text check (slack_channel_id is null or slack_channel_id ~ '^[CG][A-Z0-9]+$'),
  slack_channel_name text check (slack_channel_name is null or length(slack_channel_name) <= 100),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  batch_minutes integer not null default 0 check (batch_minutes between 0 and 1440),
  escalate_after_hours integer check (escalate_after_hours is null or escalate_after_hours between 1 and 720),
  escalate_roles text[] not null default '{}',
  updated_by uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table notification_rule is
  'Admin overrides (Admin ▸ Notifications) of the default routing in src/lib/notify/registry.ts. No row = code default. Service role only.';

drop trigger if exists set_updated_at on notification_rule;
create trigger set_updated_at before update on notification_rule
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_notification: link the in-app copy to its event
-- ---------------------------------------------------------------------------
alter table user_notification
  add column if not exists event_id uuid references notification_event (id) on delete set null;
create index if not exists user_notification_event_idx
  on user_notification (event_id) where event_id is not null;

-- ---------------------------------------------------------------------------
-- notification_delivery: person-addressed, channel posts, own content
-- ---------------------------------------------------------------------------
alter table notification_delivery alter column notification_id drop not null;

alter table notification_delivery
  add column if not exists event_id uuid references notification_event (id) on delete cascade,
  add column if not exists recipient_person_id uuid references person (id) on delete cascade,
  add column if not exists recipient_user_id uuid references app_user (id) on delete set null,
  add column if not exists event_type text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists href text,
  add column if not exists blocks jsonb,
  add column if not exists required_module text,
  add column if not exists audience_reason text,
  add column if not exists priority text not null default 'normal',
  add column if not exists coalesce_key text,
  add column if not exists message_key text,
  add column if not exists batched boolean not null default false,
  add column if not exists resolved_note text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references app_user (id) on delete set null;

alter table notification_delivery drop constraint if exists notification_delivery_channel_check;
alter table notification_delivery add constraint notification_delivery_channel_check
  check (channel in ('slack_dm', 'slack_channel'));

alter table notification_delivery drop constraint if exists notification_delivery_target_check;
alter table notification_delivery add constraint notification_delivery_target_check
  check (
    (channel = 'slack_dm' and (notification_id is not null or recipient_person_id is not null))
    or (channel = 'slack_channel' and slack_channel_id ~ '^[CG][A-Z0-9]+$')
  );

alter table notification_delivery drop constraint if exists notification_delivery_content_check;
alter table notification_delivery add constraint notification_delivery_content_check
  check (
    (title is null or length(btrim(title)) between 1 and 200)
    and (body is null or length(body) <= 3000)
    and (href is null or href ~ '^/([^/\\]|$)' or href ~ '^https://([a-z0-9-]+\.)*slack\.com/')
    and (event_type is null or event_type ~ '^[a-z_]+(\.[a-z_]+)+$')
    and (required_module is null or required_module ~ '^[a-z_]+$')
    and (priority in ('low', 'normal', 'high', 'urgent'))
    and (coalesce_key is null or length(coalesce_key) <= 200)
    and (message_key is null or length(message_key) <= 200)
    and (resolved_note is null or length(resolved_note) <= 300)
  );

comment on table notification_delivery is
  'Outbound copies of a notification (Slack DM to a person, or a Slack channel post). Recorded before sending; a send that may have reached Slack is never retried automatically. Service role only.';
comment on column notification_delivery.required_module is
  'Module the recipient must still be able to open at send time (null = the recipient is the subject, or the content is general).';
comment on column notification_delivery.coalesce_key is
  'While a delivery is still pending, a newer one with the same recipient + coalesce_key replaces its content instead of adding a message.';
comment on column notification_delivery.message_key is
  'Identifies the record a sent card is about (e.g. pto:<id>) so it can be updated in place when the record changes.';

-- One copy per event per person / per channel, however often the event is processed.
create unique index if not exists notification_delivery_event_person_uq
  on notification_delivery (event_id, channel, recipient_person_id)
  where event_id is not null and recipient_person_id is not null;
create unique index if not exists notification_delivery_event_channel_uq
  on notification_delivery (event_id, slack_channel_id)
  where event_id is not null and channel = 'slack_channel';
-- At most one pending (not yet sent) delivery per person per coalesce key.
create unique index if not exists notification_delivery_coalesce_uq
  on notification_delivery (recipient_person_id, coalesce_key)
  where status = 'pending' and coalesce_key is not null and recipient_person_id is not null;
create index if not exists notification_delivery_message_key_idx
  on notification_delivery (message_key) where message_key is not null and status = 'sent';
create index if not exists notification_delivery_recent_idx
  on notification_delivery (created_at desc);
create index if not exists notification_delivery_person_idx
  on notification_delivery (recipient_person_id, status);

-- ---------------------------------------------------------------------------
-- notification_action
-- ---------------------------------------------------------------------------
create table if not exists notification_action (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references notification_delivery (id) on delete set null,
  event_id uuid references notification_event (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$'),
  subject_type text check (subject_type is null or subject_type ~ '^[a-z_]+$'),
  subject_id text check (subject_id is null or length(subject_id) <= 100),
  slack_user_id text not null check (slack_user_id ~ '^[UW][A-Z0-9]+$'),
  actor_user_id uuid references app_user (id) on delete set null,
  outcome text not null default 'received'
    check (outcome in ('received', 'applied', 'already_done', 'forbidden', 'not_found', 'error')),
  detail text check (detail is null or length(detail) <= 500),
  request_key text not null check (length(request_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_key)
);

comment on table notification_action is
  'Audit of Slack button clicks on Ops notifications. request_key (Slack user + action_ts) makes a repeated delivery of the same click a no-op. Service role only.';

create index if not exists notification_action_subject_idx
  on notification_action (subject_type, subject_id);
create index if not exists notification_action_recent_idx
  on notification_action (created_at desc);

drop trigger if exists set_updated_at on notification_action;
create trigger set_updated_at before update on notification_action
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Service role only. The event trigger adds gdo_members_all to new tables;
-- replace it with an explicit deny-all (keeps rls_audit() clean).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['notification_event', 'notification_rule', 'notification_action'] loop
    execute format('alter table greendogops.%I enable row level security', t);
    execute format('drop policy if exists gdo_members_all on greendogops.%I', t);
    execute format('drop policy if exists service_role_only on greendogops.%I', t);
    execute format(
      'create policy service_role_only on greendogops.%I for all to authenticated using (false) with check (false)',
      t
    );
    execute format('revoke all on greendogops.%I from anon, authenticated', t);
  end loop;
end
$$;

-- The dispatcher now also processes queued events, escalations and
-- time-based reminders.
update greendogops.agent
set description = 'Processes queued Ops notification events, then sends Slack DMs and channel posts, batched digests, escalations and event reminders. DMs stay off until SLACK_DM_LIVE=true (or the recipient is in SLACK_DM_TEST_USER_IDS); otherwise they are marked skipped.'
where key = 'notification_dispatch';

commit;
