-- ============================================================================
-- Green Dog Ops — 0230 Work center (per-user dashboard)
-- ----------------------------------------------------------------------------
--   ops_task               a to-do assigned to one Ops login. Created in Ops,
--                          or by a Slack workflow through /api/tasks/inbound
--                          (source = 'slack', idempotent on external_ref).
--   user_notification      a user's in-app notification feed.
--   notification_delivery  one row per outbound copy of a notification (Slack
--                          DM today). Written BEFORE sending; the dispatcher
--                          (/api/notify/dispatch) claims and sends it.
--   reminder_rule          recurring "check this" reminders. owner_user_id
--                          null = admin-managed rule for a role/module
--                          audience; set = one user's personal reminder.
--   reminder_ack           "done for this occurrence", per user.
--
-- Module work (interviews, time-off approvals, expiring licenses, …) is NOT
-- copied into ops_task: the dashboard projects it from the module tables at
-- read time, so each module stays the single source of truth.
--
-- href columns accept an internal app path ("/ats/…") or a slack.com URL only.
--
-- All five tables are service-role only. The app reads/writes them in server
-- code, always filtered to the signed-in user (src/lib/worklist, src/lib/notify).
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- ops_task
-- ---------------------------------------------------------------------------
create table if not exists ops_task (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  details text check (details is null or length(details) <= 4000),
  assignee_user_id uuid not null references app_user (id) on delete cascade,
  created_by_user_id uuid references app_user (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'done', 'dismissed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  module text check (module is null or module ~ '^[a-z_]+$'),
  href text check ((href is null or href ~ '^/([^/\\]|$)' or href ~ '^https://([a-z0-9-]+\.)*slack\.com/')),
  action_target text not null default 'ops'
    check (action_target in ('ops', 'slack')),
  source text not null default 'ops'
    check (source in ('ops', 'slack', 'system')),
  external_ref text check (external_ref is null or length(external_ref) <= 200),
  slack_user_id text check (slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]+$'),
  completed_at timestamptz,
  completed_by_user_id uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_task_done_has_time check (status = 'open' or completed_at is not null)
);

comment on table ops_task is
  'Per-user to-do. source=ops (made in the app) | slack (Slack workflow via /api/tasks/inbound) | system. Service role only.';
comment on column ops_task.action_target is
  'Where the work happens: ops = open href in the app; slack = href is a Slack link.';
comment on column ops_task.external_ref is
  'Idempotency key from the creating system (e.g. a Slack workflow run id). Unique per source.';
comment on column ops_task.slack_user_id is
  'Slack user who created it, for source=slack.';

create unique index if not exists ops_task_source_ref_uq
  on ops_task (source, external_ref) where external_ref is not null;
create index if not exists ops_task_assignee_open_idx
  on ops_task (assignee_user_id, due_date) where status = 'open';
create index if not exists ops_task_creator_idx
  on ops_task (created_by_user_id, status);

drop trigger if exists set_updated_at on ops_task;
create trigger set_updated_at before update on ops_task
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_notification
-- ---------------------------------------------------------------------------
create table if not exists user_notification (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references app_user (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+(\.[a-z_]+)*$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text check (body is null or length(body) <= 2000),
  href text check ((href is null or href ~ '^/([^/\\]|$)' or href ~ '^https://([a-z0-9-]+\.)*slack\.com/')),
  module text check (module is null or module ~ '^[a-z_]+$'),
  severity text not null default 'info'
    check (severity in ('info', 'action', 'warning')),
  actor_user_id uuid references app_user (id) on delete set null,
  task_id uuid references ops_task (id) on delete cascade,
  dedupe_key text check (dedupe_key is null or length(dedupe_key) <= 200),
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table user_notification is
  'In-app notification feed per Ops login. kind is a dotted event name (task.assigned). Never holds compensation or HR-file content. Service role only.';

create unique index if not exists user_notification_dedupe_uq
  on user_notification (recipient_user_id, dedupe_key) where dedupe_key is not null;
create index if not exists user_notification_feed_idx
  on user_notification (recipient_user_id, created_at desc) where archived_at is null;

-- ---------------------------------------------------------------------------
-- notification_delivery
-- ---------------------------------------------------------------------------
create table if not exists notification_delivery (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references user_notification (id) on delete cascade,
  channel text not null check (channel in ('slack_dm')),
  slack_user_id text check (slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]+$'),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  slack_channel_id text,
  slack_ts text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);

comment on table notification_delivery is
  'Outbound copies of a notification. Recorded before sending; a send that may have reached Slack is never retried automatically. Service role only.';

create index if not exists notification_delivery_queue_idx
  on notification_delivery (next_attempt_at) where status in ('pending', 'sending');

drop trigger if exists set_updated_at on notification_delivery;
create trigger set_updated_at before update on notification_delivery
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- reminder_rule / reminder_ack
-- ---------------------------------------------------------------------------
create table if not exists reminder_rule (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  details text check (details is null or length(details) <= 2000),
  href text check ((href is null or href ~ '^/([^/\\]|$)' or href ~ '^https://([a-z0-9-]+\.)*slack\.com/')),
  module text check (module is null or module ~ '^[a-z_]+$'),
  cadence text not null
    check (cadence in ('weekly', 'monthly_day', 'monthly_weekday', 'monthly_business_day', 'yearly')),
  -- weekly: days it falls on (0 = Sunday … 6 = Saturday). monthly_weekday: one day.
  weekdays smallint[] not null default '{}'
    check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- monthly_day / yearly: 1–31 (clamped to short months), -1 = last day.
  -- monthly_business_day: 1–23 = Nth Mon–Fri, -1 = last Mon–Fri.
  month_day smallint check (month_day is null or month_day = -1 or month_day between 1 and 31),
  -- monthly_weekday: 1–5 = first…fifth, -1 = last.
  week_of_month smallint check (week_of_month is null or week_of_month = -1 or week_of_month between 1 and 5),
  month smallint check (month is null or month between 1 and 12),
  -- Shared rules only: roles that see it (empty = every role).
  audience_roles text[] not null default '{}'
    check (audience_roles <@ array['owner', 'admin', 'executive', 'manager', 'schedule_admin', 'marketing_admin', 'staff']),
  owner_user_id uuid references app_user (id) on delete cascade,
  is_active boolean not null default true,
  starts_on date not null default current_date,
  sort_order integer not null default 100,
  created_by_user_id uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_rule_cadence_fields check (
    case cadence
      when 'weekly' then cardinality(weekdays) > 0
      when 'monthly_day' then month_day is not null
      when 'monthly_business_day' then month_day is not null and (month_day = -1 or month_day <= 23)
      when 'monthly_weekday' then cardinality(weekdays) = 1 and week_of_month is not null
      when 'yearly' then month is not null and month_day is not null
    end
  ),
  constraint reminder_rule_personal_has_no_audience
    check (owner_user_id is null or cardinality(audience_roles) = 0)
);

comment on table reminder_rule is
  'Recurring reminders. owner_user_id null = admin-managed (audience_roles + module gate); set = personal. Occurrences are computed in src/lib/worklist/reminders.ts. Service role only.';

create index if not exists reminder_rule_owner_idx on reminder_rule (owner_user_id) where is_active;

drop trigger if exists set_updated_at on reminder_rule;
create trigger set_updated_at before update on reminder_rule
  for each row execute function set_updated_at();

create table if not exists reminder_ack (
  rule_id uuid not null references reminder_rule (id) on delete cascade,
  user_id uuid not null references app_user (id) on delete cascade,
  occurrence_date date not null,
  acked_at timestamptz not null default now(),
  primary key (rule_id, user_id, occurrence_date)
);

comment on table reminder_ack is
  'A user marked one occurrence of a reminder done. Service role only.';

create index if not exists reminder_ack_user_idx on reminder_ack (user_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- Service role only. The event trigger adds gdo_members_all to new tables;
-- replace it with an explicit deny-all (keeps rls_audit() clean).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'ops_task', 'user_notification', 'notification_delivery', 'reminder_rule', 'reminder_ack'
  ] loop
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

-- ---------------------------------------------------------------------------
-- Slack DM dispatcher, shown in Admin ▸ Agents. Runs are recorded only when
-- there was something to send.
-- ---------------------------------------------------------------------------
insert into greendogops.agent (key, name, description, category, schedule_cron, timezone, config)
values (
  'notification_dispatch',
  'Notification Dispatch',
  'Sends queued Ops notifications to people as Slack DMs. Off until SLACK_DM_LIVE=true (or the recipient is in SLACK_DM_TEST_USER_IDS); otherwise deliveries are marked skipped.',
  'notify',
  '*/5 * * * *',
  'America/Los_Angeles',
  jsonb_build_object('runner', 'inline', 'endpoint', '/api/notify/dispatch')
)
on conflict (key) do update set
  name          = excluded.name,
  description   = excluded.description,
  schedule_cron = excluded.schedule_cron,
  config        = greendogops.agent.config || excluded.config;

-- ---------------------------------------------------------------------------
-- Starter reminders (admin-managed; edit in Admin ▸ Reminders).
-- weekdays: 0 Sun, 1 Mon, … 5 Fri.
-- ---------------------------------------------------------------------------
insert into reminder_rule (title, details, href, module, cadence, weekdays, month_day, week_of_month, month, audience_roles, sort_order)
select * from (values
  ('Check your schedule for the week', 'Confirm your shifts and any time off for this week.',
     '/schedule', 'schedule', 'weekly', '{1}'::smallint[], null::smallint, null::smallint, null::smallint,
     '{}'::text[], 10),
  ('Review this week''s coverage', 'Look for open shifts, call-outs and approved time off that leaves gaps.',
     '/capacity', 'schedule', 'weekly', '{1}', null, null, null,
     '{owner,admin,manager,schedule_admin}', 20),
  ('Clear pending time-off requests', 'Approve or deny anything still waiting before the next schedule goes out.',
     '/schedule', 'schedule', 'weekly', '{3}', null, null, null,
     '{owner,admin,manager,schedule_admin}', 30),
  ('Finalize and publish next week''s schedule', 'Submit, approve and publish next week so staff can see it.',
     '/schedule', 'schedule', 'weekly', '{4}', null, null, null,
     '{owner,admin,manager,schedule_admin}', 40),
  ('Work the recruiting queues', 'New applicants, form responses and interviews waiting for a decision.',
     '/ats', 'ats', 'weekly', '{1,4}', null, null, null,
     '{owner,admin,executive,manager}', 50),
  ('Review expiring licenses and credentials', 'Renewals due in the next 60 days are on your work list.',
     '/hr', 'hr', 'monthly_business_day', '{}', 1, null, null,
     '{owner,admin,executive,manager}', 60),
  ('Review last month''s numbers', 'Revenue, appointments and client trends for the month just closed.',
     '/reporting', 'reporting', 'monthly_business_day', '{}', 2, null, null,
     '{owner,admin,executive}', 70),
  ('Plan next month''s CE events and outreach', 'Confirm speakers, venues and invitations for next month.',
     '/crm/ce', 'crm_ce', 'monthly_weekday', '{5}', null, -1, null,
     '{owner,admin,marketing_admin}', 80)
) as v(title, details, href, module, cadence, weekdays, month_day, week_of_month, month, audience_roles, sort_order)
where not exists (select 1 from reminder_rule where owner_user_id is null);

commit;
