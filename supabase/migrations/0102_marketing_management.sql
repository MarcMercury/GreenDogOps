-- ============================================================================
-- Green Dog Ops — 0102 Marketing Management
-- ----------------------------------------------------------------------------
-- A command-center / hub for all things marketing. It does NOT replace the
-- existing marketing CRMs (Referral, Vendor & Partner, Rescue, Influencer, CE,
-- Student) — it ties them together and links out. This migration adds the
-- native, editable tables that back the /marketing page:
--
--   marketing_goal            — core goals / KPIs (target vs. current).
--   marketing_initiative      — the activity board (who / what / 3rd party /
--                               status / next action). The heart of the page.
--   marketing_event           — events pipeline + post-event recaps (ROI).
--   marketing_budget_period   — annual budget totals (spend-vs-budget).
--   marketing_budget_entry    — individual spend line items.
--   marketing_resource        — tools / portals / links directory. NEVER stores
--                               passwords — those live in the credentials vault
--                               (migration 0007). Only a pointer/note is kept.
--
-- Status / category columns are free text, enforced in the app layer, to avoid
-- the CHECK-constraint case-mismatch landmines seen on the Referral CRM.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1) Goals / KPIs
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_goal (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text,                       -- e.g. Growth, Events, Social
  metric_unit   text,                       -- e.g. clients, events, $, leads
  target_value  numeric,
  current_value numeric,
  period        text,                       -- e.g. '2026', 'Monthly'
  notes         text,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.marketing_goal;
create trigger set_updated_at before update on greendogops.marketing_goal
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_goal
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Initiatives / activity board
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_initiative (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text not null default 'other',
                -- events | social | partnerships | products | pr |
                -- engagement | referrals | other
  status        text not null default 'planned',
                -- idea | planned | in_progress | blocked | done
  priority      text not null default 'medium',   -- low | medium | high
  owner_name    text,                             -- free-text owner
  partner_name  text,                             -- 3rd-party partner, if any
  next_action   text,
  due_date      date,
  notes         text,
  links         jsonb not null default '[]'::jsonb, -- [{label,url}]
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_initiative_status_idx
  on greendogops.marketing_initiative (status);
create index if not exists marketing_initiative_due_idx
  on greendogops.marketing_initiative (due_date);

drop trigger if exists set_updated_at on greendogops.marketing_initiative;
create trigger set_updated_at before update on greendogops.marketing_initiative
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_initiative
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Events pipeline + recaps
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_event (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  event_type    text not null default 'third_party',
                -- hosted | third_party | tent | street_team | sponsorship |
                -- city | vet_conference | internal | awareness
  status        text not null default 'researching',
                -- researching | tentative | confirmed | completed | cancelled
  starts_on     date,
  ends_on       date,
  location      text,
  clinic_served text,                            -- Venice / Sherman Oaks / Valley
  owner_name    text,
  cost          numeric,
  staff_needed  text,
  description   text,
  -- Optional forward-link to a physical calendar row (Google sync = phase 2).
  calendar_event_id uuid references greendogops.calendar_event (id) on delete set null,
  -- Post-event recap / ROI ------------------------------------------------
  attendees        integer,
  signups          integer,
  appointments     integer,
  products_sold    text,
  redemption_codes text,
  coupons_redeemed integer,
  client_spend     numeric,
  feedback         text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_event_date_idx
  on greendogops.marketing_event (starts_on);
create index if not exists marketing_event_status_idx
  on greendogops.marketing_event (status);

drop trigger if exists set_updated_at on greendogops.marketing_event;
create trigger set_updated_at before update on greendogops.marketing_event
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_event
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Budget period totals
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_budget_period (
  id            uuid primary key default gen_random_uuid(),
  year          integer not null unique,
  total_budget  numeric not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.marketing_budget_period;
create trigger set_updated_at before update on greendogops.marketing_budget_period
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_budget_period
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Budget spend line items
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_budget_entry (
  id            uuid primary key default gen_random_uuid(),
  entry_date    date not null default current_date,
  category      text,                            -- Events, Social, Print, etc.
  business      text,                            -- vendor / payee
  description   text,
  amount        numeric not null default 0,
  paid_by       text,
  payment_method text,
  status        text not null default 'paid',    -- planned | paid | reimbursed
  receipt_submitted boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_budget_entry_date_idx
  on greendogops.marketing_budget_entry (entry_date desc);

drop trigger if exists set_updated_at on greendogops.marketing_budget_entry;
create trigger set_updated_at before update on greendogops.marketing_budget_entry
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_budget_entry
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Resources / tools directory (links only — NO passwords)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.marketing_resource (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'tool',
                -- tool | portal | social | document | vendor | membership
  url           text,
  description   text,
  owner_name    text,
  -- Human note about where the login lives (e.g. "Credentials Vault").
  -- Passwords are NEVER stored here; use the credentials vault (0007).
  credential_note text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.marketing_resource;
create trigger set_updated_at before update on greendogops.marketing_resource
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.marketing_resource
  to authenticated, service_role;

-- ============================================================================
-- Seed data (guarded so re-running never duplicates). Sourced from the uploaded
-- marketing workbooks; safe starting point the team can edit in-app.
-- ============================================================================

-- Goals -----------------------------------------------------------------------
insert into greendogops.marketing_goal
  (title, category, metric_unit, target_value, current_value, period, sort_order)
select * from (values
  ('New clients from marketing', 'Growth',  'clients', 50,  0,  'Monthly', 1),
  ('Events attended',            'Events',  'events',  24,  0,  '2026',    2),
  ('Partnerships created',       'Partners','partners',20,  0,  '2026',    3),
  ('Leads generated',            'Growth',  'leads',   500, 0,  '2026',    4),
  ('Marketing budget spend',     'Budget',  '$',       102428, 0, '2026',  5)
) as v(title, category, metric_unit, target_value, current_value, period, sort_order)
where not exists (select 1 from greendogops.marketing_goal);

-- Initiatives -----------------------------------------------------------------
insert into greendogops.marketing_initiative
  (title, category, status, priority, owner_name, partner_name, next_action, sort_order)
select * from (values
  ('Adoptapalooza 2026 planning', 'events',      'in_progress', 'high',   'Dre',      'Rescues & vendors', 'Confirm vendor list & sponsors', 1),
  ('Daily social content calendar','social',     'in_progress', 'high',   'Brittany', 'Hootsuite / Canva', 'Plan next 2 weeks of posts',     2),
  ('Influencer / GDU outreach',    'social',      'in_progress', 'medium', 'Brittany', 'Vet influencers',   'Follow up on new inquiries',     3),
  ('Chamber memberships & events', 'partnerships','planned',     'medium', 'Dre',      'SM & Venice Chambers','Renew memberships, submit promos',4),
  ('Product label & cards revamp', 'products',    'planned',     'medium', 'Marketing','Print vendor',      'Approve new labels with Doc',     5),
  ('Monthly event sourcing',       'events',      'in_progress', 'medium', 'Jenn',     null,               'Check event calendars for the month',6)
) as v(title, category, status, priority, owner_name, partner_name, next_action, sort_order)
where not exists (select 1 from greendogops.marketing_initiative);

-- Events ----------------------------------------------------------------------
insert into greendogops.marketing_event
  (name, event_type, status, starts_on, location, clinic_served, owner_name, cost,
   attendees, signups, appointments, feedback, sort_order)
select * from (values
  ('Venice Fest 2025', 'tent', 'completed', date '2025-11-22', 'Venice', 'Venice', 'Dre',
   725.50, 109, 95, 1,
   'Successful event — should do next year; can be handled with 3 staff.', 1)
) as v(name, event_type, status, starts_on, location, clinic_served, owner_name, cost,
       attendees, signups, appointments, feedback, sort_order)
where not exists (select 1 from greendogops.marketing_event where name = 'Venice Fest 2025');

insert into greendogops.marketing_event
  (name, event_type, status, starts_on, location, owner_name, description, sort_order)
select * from (values
  ('Adoptapalooza 2026', 'hosted',   'confirmed', date '2026-07-11', 'Van Nuys lot', 'Dre',
   'Flagship hosted adoption + vendor festival. Rescues, sponsors, tradeouts.', 2),
  ('Pet-Chella',         'hosted',   'tentative', null,             null,            'Marketing',
   'Recurring hosted adoption festival.', 3)
) as v(name, event_type, status, starts_on, location, owner_name, description, sort_order)
where not exists (select 1 from greendogops.marketing_event where name in ('Adoptapalooza 2026','Pet-Chella'));

-- Budget ----------------------------------------------------------------------
insert into greendogops.marketing_budget_period (year, total_budget, notes)
select 2026, 102427.68, 'Carried from 2024 budget & spend workbook as a baseline; adjust for 2026.'
where not exists (select 1 from greendogops.marketing_budget_period where year = 2026);

insert into greendogops.marketing_budget_entry
  (entry_date, category, business, description, amount, paid_by, payment_method, status)
select * from (values
  (date '2026-05-14', 'Print', 'FedEx',   'Adoptapalooza flyers',  52.23, 'Dre', 'Gladys AMEX 1057', 'paid'),
  (date '2026-05-17', 'Print', 'Staples', 'Adoptapalooza flyers', 120.71, 'Dre', 'Gladys AMEX 1057', 'paid')
) as v(entry_date, category, business, description, amount, paid_by, payment_method, status)
where not exists (select 1 from greendogops.marketing_budget_entry);

-- Resources -------------------------------------------------------------------
insert into greendogops.marketing_resource
  (name, category, url, description, credential_note, sort_order)
select * from (values
  ('Hootsuite',            'tool',       'https://hootsuite.com',       'Social scheduling & engagement.',        'Login in Credentials Vault.', 1),
  ('Canva',                'tool',       'https://canva.com',           'Graphics, flyers & content design.',     'Login in Credentials Vault.', 2),
  ('Shopify',              'tool',       'https://www.shopify.com',     'Green Dog Products / merch ecommerce.',  'Login in Credentials Vault.', 3),
  ('Sherman Oaks Chamber', 'membership', 'https://shermanoakschamber.org','Chamber of Commerce membership & events.', null, 4),
  ('Venice Chamber',       'membership', 'https://venicechamber.net',   'Chamber of Commerce membership & events.', null, 5),
  ('Marketing Google Calendar', 'portal', null,                         'Shared marketing events calendar (Google).','Access managed by Marketing.', 6)
) as v(name, category, url, description, credential_note, sort_order)
where not exists (select 1 from greendogops.marketing_resource);
