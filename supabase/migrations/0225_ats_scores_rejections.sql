-- ============================================================================
-- Green Dog Ops — 0225 Recruiting CRM workflow: scores, review, rejections
-- ----------------------------------------------------------------------------
-- 1. Candidate Score becomes X / 10 (one decimal) with a change history. The
--    legacy spreadsheet scores were 0–5 whole numbers: doubled onto the new
--    scale, and 0 (which the app always treated as "unscored") cleared.
-- 2. Form Response Queue: a completed questionnaire is "Needs review" until a
--    recruiter acts on it.
-- 3. Rejections are their own queue: rejecting schedules a template email 48
--    hours out, which can be cancelled — or the rejection undone — until it
--    sends (/api/ats/rejections cron).
-- updated_at on person_recruiting is left untouched by the score conversion.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- 1. Candidate Score
-- ---------------------------------------------------------------------------
create table if not exists person_recruiting_score_backup_0225 as
select person_id, score from person_recruiting where score is not null;
alter table person_recruiting_score_backup_0225 enable row level security;
drop policy if exists gdo_members_all on person_recruiting_score_backup_0225;
drop policy if exists service_role_only on person_recruiting_score_backup_0225;
create policy service_role_only on person_recruiting_score_backup_0225
  for all to authenticated using (false) with check (false);

alter table person_recruiting disable trigger set_updated_at;
update person_recruiting r
set score = case when b.score > 0 and b.score <= 5 then b.score * 2 else null end
from person_recruiting_score_backup_0225 b
where b.person_id = r.person_id
  and r.score is not distinct from b.score
  and not exists (select 1 from information_schema.tables
                  where table_schema = 'greendogops' and table_name = 'recruiting_score_change');
alter table person_recruiting enable trigger set_updated_at;

alter table person_recruiting
  alter column score type numeric(3, 1) using round(score, 1),
  drop constraint if exists person_recruiting_score_check,
  add constraint person_recruiting_score_check check (score is null or (score >= 0 and score <= 10));

comment on column person_recruiting.score is 'Candidate Score, 0–10 (one decimal). Changes are logged in recruiting_score_change.';

create table if not exists recruiting_score_change (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  old_score numeric(3, 1),
  new_score numeric(3, 1),
  note text,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists recruiting_score_change_person_idx
  on recruiting_score_change (person_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Form Response Queue
-- ---------------------------------------------------------------------------
alter table recruiting_form_request
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_name text;

-- ---------------------------------------------------------------------------
-- 3. Rejection templates and the Rejected queue
-- ---------------------------------------------------------------------------
create table if not exists recruiting_email_template (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'rejection' check (kind in ('rejection')),
  name text not null,
  subject text not null,
  body text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column recruiting_email_template.body is 'Plain text; {first_name}, {full_name}, {role} are filled in when sent';

drop trigger if exists set_updated_at on recruiting_email_template;
create trigger set_updated_at before update on recruiting_email_template
  for each row execute function set_updated_at();

insert into recruiting_email_template (kind, name, subject, body, sort_order)
select * from (values
  ('rejection', 'Initial Application Rejection', 'Your application to Green Dog',
   E'Hi {first_name},\n\nThank you for your interest in the {role} position at Green Dog and for taking the time to apply.\n\nAfter reviewing your application, we''ve decided not to move forward at this time. We''ll keep your information on file and encourage you to apply for future openings that match your experience.\n\nWe wish you the very best in your search.', 1),
  ('rejection', 'Post-Screening Rejection', 'Your application to Green Dog',
   E'Hi {first_name},\n\nThank you for completing our questionnaire for the {role} position. We appreciate the time you put into it.\n\nAfter careful review, we''ve decided to move forward with other candidates whose experience more closely matches what we need right now. We''re grateful for your interest in Green Dog and wish you the best.', 2),
  ('rejection', 'Post-Interview Rejection', 'Following up on your interview with Green Dog',
   E'Hi {first_name},\n\nThank you for taking the time to interview with us for the {role} position. We enjoyed getting to know you.\n\nAfter a lot of consideration, we''ve decided to move forward with another candidate. This was not an easy decision, and we truly appreciate your interest in joining Green Dog. We''d be glad to hear from you again for future openings.', 3)
) as t(kind, name, subject, body, sort_order)
where not exists (select 1 from recruiting_email_template);

create table if not exists recruiting_rejection (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  rejected_from text not null,
  prev_stage text,
  prev_review_status text,
  rejected_stage text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz not null default now(),
  send_email boolean not null default true,
  template_id uuid references recruiting_email_template (id) on delete set null,
  template_name text,
  email_to text,
  email_scheduled_for timestamptz,
  email_status text not null default 'scheduled'
    check (email_status in ('scheduled', 'sending', 'sent', 'cancelled', 'not_sending', 'failed')),
  email_sent_at timestamptz,
  email_error text,
  undone_at timestamptz,
  undone_by_name text,
  created_at timestamptz not null default now()
);

comment on column recruiting_rejection.rejected_from is 'review | forms | interviews | profile';
comment on column recruiting_rejection.email_status is 'scheduled (48h window) | sending | sent | cancelled | not_sending (opted out / no email) | failed';

create index if not exists recruiting_rejection_person_idx
  on recruiting_rejection (person_id, rejected_at desc);
create index if not exists recruiting_rejection_due_idx
  on recruiting_rejection (email_scheduled_for) where email_status = 'scheduled' and undone_at is null;

commit;
