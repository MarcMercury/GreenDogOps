-- ============================================================================
-- Green Dog Ops — 0224 Recruiting: Forms and interview self-scheduling
-- ----------------------------------------------------------------------------
-- 1. Forms (the ATS "Forms" tab — an internal Google Forms for recruiting):
--      recruiting_form           a form definition. kind = application (the
--                                public Standard Application at /apply) or
--                                screening (a role-specific questionnaire)
--      recruiting_form_request   a screening form sent to one candidate; the
--                                opaque token in /forms/<token> is the only
--                                credential the candidate needs
--      recruiting_form_response  a submitted form, with a snapshot of the
--                                questions so later edits never garble answers
-- 2. Scheduling (a lightweight Calendly inside Ops):
--      recruiter_schedule        each interviewer's weekly availability,
--                                buffer, notice and Google connection status
--      recruiter_google_token    their Google Calendar refresh token —
--                                service-role only (no RLS policy)
--      interview_invite          a "pick a time" link sent to a candidate;
--                                /book/<token> books it into person_interview
--                                through book_interview_slot()
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- 1. Forms
-- ---------------------------------------------------------------------------
create table if not exists recruiting_form (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('application', 'screening')),
  name text not null,
  description text,
  intro text,
  success_message text,
  fields jsonb not null default '[]'::jsonb,
  job_titles text[] not null default '{}',
  slug text,
  is_default boolean not null default false,
  require_resume boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruiting_form_slug_check
    check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint recruiting_form_default_check
    check (not is_default or kind = 'application')
);

comment on table recruiting_form is 'Recruiting forms: the public Standard Application and role-specific screening questionnaires';
comment on column recruiting_form.fields is 'Questions (src/lib/ats/forms.ts RecruitingFormField[])';
comment on column recruiting_form.job_titles is 'Role titles this form is for (e.g. CSR); suggested first when sending';
comment on column recruiting_form.slug is 'Application forms: public URL /apply/<slug>';
comment on column recruiting_form.is_default is 'The application served at /apply';

create unique index if not exists recruiting_form_slug_key
  on recruiting_form (slug) where slug is not null;
create unique index if not exists recruiting_form_one_default
  on recruiting_form ((true)) where is_default;

drop trigger if exists set_updated_at on recruiting_form;
create trigger set_updated_at before update on recruiting_form
  for each row execute function set_updated_at();

create table if not exists recruiting_form_request (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  form_id uuid not null references recruiting_form (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'completed', 'cancelled')),
  sent_to text,
  sent_at timestamptz not null default now(),
  sent_by uuid,
  sent_by_name text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists recruiting_form_request_person_idx
  on recruiting_form_request (person_id, sent_at desc);

create table if not exists recruiting_form_response (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references recruiting_form (id) on delete set null,
  request_id uuid references recruiting_form_request (id) on delete set null,
  person_id uuid not null references person (id) on delete cascade,
  form_name text not null,
  form_kind text not null,
  fields jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

comment on column recruiting_form_response.fields is 'The questions as they were when submitted';
comment on column recruiting_form_response.answers is 'Answers keyed by question id; file answers hold person_document ids';

create index if not exists recruiting_form_response_person_idx
  on recruiting_form_response (person_id, submitted_at desc);
create index if not exists recruiting_form_response_form_idx
  on recruiting_form_response (form_id);

-- ---------------------------------------------------------------------------
-- 2. Scheduling
-- ---------------------------------------------------------------------------
create table if not exists recruiter_schedule (
  user_id uuid primary key references app_user (id) on delete cascade,
  timezone text not null default 'America/Los_Angeles',
  weekly_hours jsonb not null default '[]'::jsonb,
  default_duration integer not null default 30 check (default_duration between 10 and 240),
  buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120),
  min_notice_hours integer not null default 12 check (min_notice_hours between 0 and 336),
  is_active boolean not null default true,
  google_email text,
  google_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column recruiter_schedule.weekly_hours is '[{day: 0=Sun..6=Sat, start: "HH:MM", end: "HH:MM"}] in timezone';

drop trigger if exists set_updated_at on recruiter_schedule;
create trigger set_updated_at before update on recruiter_schedule
  for each row execute function set_updated_at();

create table if not exists recruiter_google_token (
  user_id uuid primary key references app_user (id) on delete cascade,
  google_email text,
  refresh_token text not null,
  scope text,
  updated_at timestamptz not null default now()
);

comment on table recruiter_google_token is 'Per-user Google Calendar OAuth refresh tokens. Service role only.';

-- Only the service-role key can read tokens: the blanket members policy the
-- new-object event trigger adds is replaced by an explicit deny-all, which
-- keeps rls_audit() clean.
alter table recruiter_google_token enable row level security;
drop policy if exists gdo_members_all on recruiter_google_token;
drop policy if exists service_role_only on recruiter_google_token;
create policy service_role_only on recruiter_google_token
  for all to authenticated using (false) with check (false);
revoke all on recruiter_google_token from anon, authenticated;

create table if not exists interview_invite (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  person_id uuid not null references person (id) on delete cascade,
  interview_type text not null default 'phone_screen',
  duration_minutes integer not null default 30 check (duration_minutes between 10 and 240),
  host_user_id uuid not null references app_user (id),
  host_name text,
  date_from date not null,
  date_to date not null,
  location text,
  message text,
  status text not null default 'sent' check (status in ('sent', 'booked', 'cancelled')),
  interview_id uuid references person_interview (id) on delete set null,
  booked_start timestamptz,
  booked_at timestamptz,
  sent_to text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint interview_invite_range_check check (date_to >= date_from)
);

create index if not exists interview_invite_person_idx
  on interview_invite (person_id, created_at desc);

alter table person_interview
  add column if not exists host_user_id uuid references app_user (id) on delete set null,
  add column if not exists invite_id uuid references interview_invite (id) on delete set null,
  add column if not exists google_event_id text;

create index if not exists person_interview_host_idx
  on person_interview (host_user_id, interview_date) where host_user_id is not null;

-- Book a candidate's chosen slot. Serialized per interviewer with an advisory
-- lock so two candidates on different links can't take the same time: the
-- overlap re-check, the invite claim (sent → booked) and the interview insert
-- happen in one transaction. Times are the interviewer's local wall clock,
-- like every other person_interview row. Service role only.
create or replace function book_interview_slot(
  p_invite_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_interviewer text,
  p_booked_start timestamptz
) returns uuid
language plpgsql
set search_path = greendogops, public
as $$
declare
  v_invite interview_invite%rowtype;
  v_interview_id uuid;
begin
  select * into v_invite from interview_invite where id = p_invite_id;
  if not found or v_invite.status <> 'sent' then
    raise exception 'invite_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtext('interview_host:' || v_invite.host_user_id::text));

  if exists (
    select 1 from person_interview
    where host_user_id = v_invite.host_user_id
      and status = 'scheduled'
      and interview_date = p_date
      and start_time is not null
      and start_time < p_end
      and coalesce(end_time, start_time + interval '60 minutes') > p_start
  ) then
    raise exception 'slot_taken';
  end if;

  update interview_invite
  set status = 'booked', booked_start = p_booked_start, booked_at = now()
  where id = p_invite_id and status = 'sent';
  if not found then
    raise exception 'invite_unavailable';
  end if;

  insert into person_interview (
    person_id, interview_date, start_time, end_time, interview_type, interviewer,
    location, status, responses, host_user_id, invite_id
  ) values (
    v_invite.person_id, p_date, p_start, p_end, v_invite.interview_type, p_interviewer,
    v_invite.location, 'scheduled', '[]'::jsonb, v_invite.host_user_id, v_invite.id
  ) returning id into v_interview_id;

  update interview_invite set interview_id = v_interview_id where id = p_invite_id;
  return v_interview_id;
end;
$$;

revoke all on function book_interview_slot(uuid, date, time, time, text, timestamptz) from public, anon, authenticated;
grant execute on function book_interview_slot(uuid, date, time, time, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Starter forms (first run only)
-- ---------------------------------------------------------------------------
insert into recruiting_form (kind, name, description, intro, success_message, fields, slug, is_default, require_resume)
select
  'application',
  'Green Dog Application',
  'The Standard Application linked from every job posting.',
  'Thanks for your interest in Green Dog! This takes about 3 minutes. Please attach your resume.',
  'Thanks for applying! We review new applications every business day and will reach out if you''re a fit.',
  $json$[
    {"id": "available_days", "type": "checkboxes", "label": "Which days are you available to work?", "description": null, "required": true,
     "options": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]},
    {"id": "employment_type", "type": "multiple_choice", "label": "What are you looking for?", "description": null, "required": true,
     "options": ["Full time", "Part time", "Per diem", "Either"]},
    {"id": "vet_experience", "type": "dropdown", "label": "Years of veterinary experience", "description": null, "required": true,
     "options": ["None", "Less than 1 year", "1–2 years", "3–5 years", "More than 5 years"]},
    {"id": "start_date", "type": "date", "label": "Earliest start date", "description": null, "required": false, "options": []},
    {"id": "over_18", "type": "yes_no", "label": "Are you at least 18 years old?", "description": null, "required": true, "options": []},
    {"id": "work_authorized", "type": "yes_no", "label": "Are you legally authorized to work in the United States?", "description": null, "required": true, "options": []},
    {"id": "heard_about", "type": "dropdown", "label": "How did you hear about this job?", "description": null, "required": false,
     "options": ["Indeed", "ZipRecruiter", "LinkedIn", "Social media", "Friend or employee referral", "School", "Other"]}
  ]$json$::jsonb,
  'green-dog',
  true,
  true
where not exists (select 1 from recruiting_form where kind = 'application');

insert into recruiting_form (kind, name, description, intro, fields, job_titles)
select
  'screening',
  'CSR Screening Questions',
  'Sent after approval, before the phone screen.',
  'We''d like to learn a little more about you before scheduling your first interview.',
  $json$[
    {"id": "ezyvet", "type": "yes_no", "label": "Have you used ezyVet before?", "description": null, "required": true, "options": []},
    {"id": "software", "type": "short_text", "label": "What veterinary or practice software have you worked with?", "description": null, "required": false, "options": []},
    {"id": "tools", "type": "checkboxes", "label": "Which of these are you comfortable using?", "description": null, "required": false,
     "options": ["Google Drive / Docs", "Google Sheets / spreadsheets", "Slack", "Multi-line phones"]},
    {"id": "difficult_client", "type": "long_text", "label": "Tell us about a time you handled a challenging client or coworker. What did you do?", "description": null, "required": true, "options": []},
    {"id": "locations", "type": "checkboxes", "label": "Which locations could you work at?", "description": null, "required": true,
     "options": ["Sherman Oaks", "Van Nuys", "Venice"]},
    {"id": "schedule_limits", "type": "long_text", "label": "Any day or time restrictions we should know about?", "description": null, "required": false, "options": []},
    {"id": "long_term", "type": "long_text", "label": "Are you looking for a long-term position? What would you like to grow into?", "description": null, "required": false, "options": []}
  ]$json$::jsonb,
  array['CSR', 'Remote CSR']
where not exists (select 1 from recruiting_form where kind = 'screening');

commit;
