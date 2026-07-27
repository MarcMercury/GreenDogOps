-- ============================================================================
-- Green Dog Ops — 0133 Email Event Log (Resend webhooks)
-- ----------------------------------------------------------------------------
-- Records every transactional-email event Resend delivers to our webhook
-- (/api/email/webhook): sent, delivered, delivery_delayed, bounced,
-- complained, opened, clicked. This gives the Ops app a durable delivery log
-- and the raw material for bounce/complaint suppression.
--
-- Idempotent on the Resend event id (`resend_event_id`) so webhook retries —
-- Resend re-delivers until it gets a 2xx — never create duplicate rows.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.email_event (
  id               uuid primary key default gen_random_uuid(),
  resend_event_id  text unique,                 -- Svix message id (idempotency)
  event_type       text not null,               -- e.g. 'email.bounced'
  email_id         text,                         -- Resend message id (data.email_id)
  to_addrs         text[] not null default '{}', -- recipients
  from_addr        text,
  subject          text,
  -- For bounces/complaints: the reason/type Resend provides, when present.
  reason           text,
  payload          jsonb not null default '{}'::jsonb,  -- full event body
  occurred_at      timestamptz,                  -- event's own created_at
  created_at       timestamptz not null default now()
);

create index if not exists email_event_email_id_idx
  on greendogops.email_event (email_id);
create index if not exists email_event_type_idx
  on greendogops.email_event (event_type);
create index if not exists email_event_occurred_at_idx
  on greendogops.email_event (occurred_at desc);
