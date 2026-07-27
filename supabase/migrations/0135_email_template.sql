-- ============================================================================
-- Green Dog Ops — 0135 Email Templates
-- ----------------------------------------------------------------------------
-- Reusable transactional-email templates managed from Admin > Templates and
-- used by the "Send Email" action on Referral CRM account pages. Subject/body
-- support {{variable}} placeholders that are filled from the account (contact
-- name, referral stats, last visit, sender, etc.) at send time.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.email_template (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,               -- display name in the dropdown
  description    text,                         -- admin-facing note
  category       text not null default 'referral',  -- which module uses it
  subject        text not null,
  body           text not null,               -- plain text with {{vars}}
  is_active      boolean not null default true,
  created_by     uuid,
  created_by_email text,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists email_template_category_idx
  on greendogops.email_template (category);
create index if not exists email_template_active_idx
  on greendogops.email_template (is_active);

-- Seed a couple of referral starter templates (only if the table is empty).
insert into greendogops.email_template (name, description, category, subject, body)
select * from (values
  (
    'Thank you for your referrals',
    'Warm thank-you highlighting recent referral volume.',
    'referral',
    'Thank you from Green Dog Dental, {{contact_first_name}}',
    E'Hi {{contact_first_name}},\n\nThank you for trusting Green Dog Dental with your patients at {{account_name}}. Your practice has sent us {{total_referrals}} referrals, and we are grateful for the partnership.\n\nIf there is anything we can do to make referring easier, just reply to this email.\n\nWarm regards,\n{{sender_name}}\nGreen Dog Dental'
  ),
  (
    'Check-in / reconnect',
    'Light touch check-in for accounts we have not visited recently.',
    'referral',
    'Checking in with {{account_name}}',
    E'Hi {{contact_first_name}},\n\nIt has been a little while since we connected — our last visit was {{last_visit_date}}. I wanted to check in and see how things are going at {{account_name}} and whether your team has any questions about dental cases.\n\nWould you be open to a quick visit? I would love to stop by.\n\nBest,\n{{sender_name}}\nGreen Dog Dental'
  ),
  (
    'Invitation to a CE / lunch & learn',
    'Invite the account to an upcoming CE or lunch-and-learn.',
    'referral',
    'You are invited: Green Dog Dental CE',
    E'Hi {{contact_first_name}},\n\nWe are hosting an upcoming continuing-education session and would love for the team at {{account_name}} to join us. It is a great chance to talk through dental cases and referral workflows.\n\nReply here and I will send over the details and dates.\n\nThanks,\n{{sender_name}}\nGreen Dog Dental'
  )
) as seed(name, description, category, subject, body)
where not exists (select 1 from greendogops.email_template);
